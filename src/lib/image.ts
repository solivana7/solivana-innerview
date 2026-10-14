// Client-side image preprocessing.
//
// Why this matters: phone cameras hand us 4-8MB photos at 4032×3024. Claude
// Vision charges per image token (~1 token per 0.75 megapixel chunk). A
// 4032×3024 photo = ~4500 tokens per image. A 1024px-long-edge image = ~960.
// Plus, oversized base64 payloads inflate bandwidth and occasionally trip
// upstream limits. This shrinks every photo to ~1MB JPEG before upload.

const MAX_LONG_EDGE = 1280;
const JPEG_QUALITY = 0.85;

export interface PreprocessOptions {
  maxLongEdge?: number;
  quality?: number;
  /** Optional center-crop after resize. e.g. 0.85 keeps the central 85%. */
  centerCrop?: number;
}

/**
 * Read a File (from <input type="file">) → resize, recompress, return base64.
 * Always outputs JPEG for consistent backend MIME handling.
 */
export async function preprocessFile(
  file: File,
  opts: PreprocessOptions = {},
): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  return preprocessDataUrl(dataUrl, opts);
}

/**
 * Same as preprocessFile but takes an existing data URL (e.g. from a webcam
 * canvas) instead of a File.
 */
export async function preprocessDataUrl(
  dataUrl: string,
  opts: PreprocessOptions = {},
): Promise<string> {
  const maxLongEdge = opts.maxLongEdge ?? MAX_LONG_EDGE;
  const quality = opts.quality ?? JPEG_QUALITY;
  const crop = opts.centerCrop ?? 1;

  const img = await loadImage(dataUrl);
  const { width: srcW, height: srcH } = img;

  // Compute target dimensions: scale so the long edge ≤ maxLongEdge
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const targetW = Math.round(srcW * scale);
  const targetH = Math.round(srcH * scale);

  // Apply center crop if requested
  const cropW = Math.round(targetW * crop);
  const cropH = Math.round(targetH * crop);
  const offsetX = Math.round((targetW - cropW) / 2);
  const offsetY = Math.round((targetH - cropH) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // High-quality downscale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -offsetX, -offsetY, targetW, targetH);

  return canvas.toDataURL("image/jpeg", quality);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = src;
  });
}

/**
 * Approximate base64 string size in bytes (3/4 of length, ignoring padding).
 * Useful for surfacing "this image is too large" before upload.
 */
export function base64Bytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Best-effort face detection + crop. Uses the browser-native FaceDetector API
 * where available (Chrome/Edge with Shape Detection enabled). Falls back to a
 * tight center-crop. Output is then resized + recompressed.
 *
 * For InnerView the face crop also captures the area below the chin where
 * the tongue is — we expand the detected face bbox downward 30% and outward
 * 15% to make sure the tongue isn't clipped.
 */
export async function detectFaceAndCrop(
  dataUrl: string,
  opts: PreprocessOptions = {},
): Promise<{ dataUrl: string; method: "face" | "center" }> {
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const FaceDetectorCtor = (globalThis as { FaceDetector?: new (opts?: { fastMode?: boolean }) => { detect: (src: HTMLImageElement) => Promise<Array<{ boundingBox: DOMRect }>> } }).FaceDetector;

  let cropBox: { x: number; y: number; w: number; h: number } | null = null;
  let method: "face" | "center" = "center";

  if (FaceDetectorCtor) {
    try {
      const detector = new FaceDetectorCtor({ fastMode: true });
      const faces = await detector.detect(img);
      if (faces && faces.length > 0) {
        // Use the largest face by area (handles group photos by picking the closest)
        const largest = faces.reduce((a, b) =>
          a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height ? a : b
        );
        const fb = largest.boundingBox;
        // Expand: 15% horizontally on each side, 30% downward to capture tongue
        const padX = fb.width * 0.15;
        const padTop = fb.height * 0.15;
        const padBot = fb.height * 0.30;
        cropBox = {
          x: Math.max(0, fb.x - padX),
          y: Math.max(0, fb.y - padTop),
          w: Math.min(W, fb.width + padX * 2),
          h: Math.min(H - Math.max(0, fb.y - padTop), fb.height + padTop + padBot),
        };
        method = "face";
      }
    } catch {
      // FaceDetector exists but threw — fall through to center crop
    }
  }

  if (!cropBox) {
    // Fallback: assume the subject is in the central 70%
    const cropFraction = 0.7;
    const cw = W * cropFraction;
    const ch = H * cropFraction;
    cropBox = {
      x: (W - cw) / 2,
      y: (H - ch) / 2,
      w: cw,
      h: ch,
    };
  }

  // Render the cropped region to a canvas, then run through preprocessDataUrl
  // for the resize + recompress pass.
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropBox.w;
  cropCanvas.height = cropBox.h;
  const ctx = cropCanvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, cropBox.x, cropBox.y, cropBox.w, cropBox.h, 0, 0, cropBox.w, cropBox.h);
  const cropped = cropCanvas.toDataURL("image/jpeg", 0.95);

  const final = await preprocessDataUrl(cropped, opts);
  return { dataUrl: final, method };
}
