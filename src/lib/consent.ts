const CONSENT_KEY = "innerview_cookie_consent";

export type ConsentState = "accepted" | "declined" | null;

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(CONSENT_KEY);
  if (v === "accepted" || v === "declined") return v;
  return null;
}

export function setConsent(state: ConsentState): void {
  if (typeof window === "undefined") return;
  if (state) {
    localStorage.setItem(CONSENT_KEY, state);
  } else {
    localStorage.removeItem(CONSENT_KEY);
  }
}

const ESSENTIAL_KEYS = [
  "innerview_session_token",
  "innerview_device_id",
  "innerview_unlock_token",
  "innerview_return_to",
  "innerview_draft",
  "iv_admin_token",
];

export function canUseStorage(key: string): boolean {
  const consent = getConsent();
  if (consent === "accepted") return true;
  // Essential keys always allowed (session, device, auth redirect, draft)
  return ESSENTIAL_KEYS.includes(key);
}
