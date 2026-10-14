// Anonymous per-device identifier stored in localStorage. Pair with the
// IP fallback on the backend for the second line of defense against the
// trivial "clear cookies / open incognito" bypass.

const DEVICE_KEY = "innerview_device_id";
const TOKEN_KEY = "innerview_unlock_token";

function generateUuid(): string {
  // Prefer crypto.randomUUID (widely supported now) — fall back to Math.random
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "dev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = generateUuid();
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      // localStorage unavailable (private mode in some browsers, full disk, etc).
      // Generate a per-page-load id so the request doesn't 400; this user will
      // get treated as anonymous-without-tracking.
    }
  }
  return id;
}

export function getUnlockToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const t = localStorage.getItem(TOKEN_KEY);
  return t || undefined;
}

export function setUnlockToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

export function clearUnlockToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}
