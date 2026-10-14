import sharp from "sharp";

/**
 * Resize an incoming photo down to ≤1024px max edge and re-encode as WebP at
 * quality 82 BEFORE sending to Claude vision. Does three things:
 *   1. Strips EXIF (privacy + smaller payload).
 *   2. Honors EXIF orientation so portrait phone shots aren't sideways.
 *   3. Cuts Claude vision token cost ~60-70% on phone uploads (a 6MB JPEG
 *      becomes ~80KB WebP — same visible detail at 1024px, far fewer image
 *      tokens).
 *
 * 1024px is well within the threshold above which Claude's vision quality
 * stops improving (1568px), so we sacrifice nothing observable while
 * eliminating the cost amplifier.
 */
export async function resizeForVision(
  base64: string,
): Promise<{ data: string; mediaType: "image/webp" }> {
  const buf = Buffer.from(base64, "base64");
  const out = await sharp(buf)
    .rotate() // honor EXIF orientation
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  return { data: out.toString("base64"), mediaType: "image/webp" };
}
