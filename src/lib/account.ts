// Long-lived session token tied to a verified email account.
// Stored in localStorage, sent with every authenticated tRPC call.

const SESSION_KEY = "innerview_session_token";

export function getSessionToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const t = localStorage.getItem(SESSION_KEY);
  return t || undefined;
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SESSION_KEY, token); } catch {}
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

/**
 * Append the 10% restock coupon code to a Stripe payment link so the
 * checkout opens with the discount pre-applied. Stripe Payment Links
 * support `prefilled_promo_code` query parameter when "Allow promotion
 * codes" is enabled on the link.
 */
export function withCoupon(url: string, couponCode?: string): string {
  if (!url || !couponCode) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}prefilled_promo_code=${encodeURIComponent(couponCode)}`;
}
