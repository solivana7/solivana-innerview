import { getDb } from "./connection";
import { accounts, magicLinks, accountSessions, accountCredits, accountScans } from "@db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { initDb } from "./initDb";
import { randomBytes } from "node:crypto";

const MAGIC_TTL_MIN = 60 * 24; // 24 hours — friendlier than 30m for users who come back later
const SESSION_TTL_DAYS = 90;

export function newToken(prefix = "tok"): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export async function ensureAccount(email: string): Promise<{ isNew: boolean }> {
  await initDb();
  const db = getDb();
  const lower = email.toLowerCase().trim();
  const existing = await db.select().from(accounts).where(eq(accounts.email, lower)).limit(1);
  if (existing[0]) return { isNew: false };
  await db.execute(sql`
    INSERT INTO accounts (email, created_at)
    VALUES (${lower}, NOW())
    ON CONFLICT (email) DO NOTHING;
  `);
  return { isNew: true };
}

// Per-email cooldown for magic-link requests. Prevents email-bombing any
// address. If the most recent un-expired link for this email was created
// in the last 60s, return that token instead of generating a new one.
const MAGIC_LINK_COOLDOWN_SEC = 60;

export async function createMagicLink(email: string): Promise<string> {
  await initDb();
  const db = getDb();
  const lower = email.toLowerCase().trim();

  const recent = await db.execute(sql`
    SELECT token FROM magic_links
    WHERE email = ${lower}
      AND expires_at > NOW()
      AND created_at > NOW() - INTERVAL '${sql.raw(String(MAGIC_LINK_COOLDOWN_SEC))} seconds'
    ORDER BY created_at DESC
    LIMIT 1;
  `);
  const recentRows = (Array.isArray(recent) ? recent : (recent as { rows?: Array<{ token: string }> }).rows) ?? [];
  const reuse = (recentRows[0] as { token?: string } | undefined)?.token;
  if (reuse) return reuse;

  const token = newToken("ml");
  await db.execute(sql`
    INSERT INTO magic_links (token, email, expires_at, created_at)
    VALUES (${token}, ${lower}, NOW() + INTERVAL '${sql.raw(String(MAGIC_TTL_MIN))} minutes', NOW());
  `);
  return token;
}

export async function exchangeMagicLink(token: string, deviceId: string | null, userAgent: string | null): Promise<{ ok: true; sessionToken: string; email: string } | { ok: false; reason: string }> {
  await initDb();
  const db = getDb();

  // Atomic claim: only the row that's still un-used + un-expired flips. Two
  // simultaneous clicks on the same email link → exactly one wins.
  const claimed = await db.execute(sql`
    UPDATE magic_links
    SET used_at = NOW()
    WHERE token = ${token} AND used_at IS NULL AND expires_at > NOW()
    RETURNING email;
  `);
  const claimedRows = (Array.isArray(claimed) ? claimed : (claimed as { rows?: Array<{ email: string }> }).rows) ?? [];
  const email = (claimedRows[0] as { email?: string } | undefined)?.email;

  if (!email) {
    // Distinguish "doesn't exist" from "already used / expired" so the SPA
    // can show the right error message.
    const peek = await db.select().from(magicLinks).where(eq(magicLinks.token, token)).limit(1);
    const link = peek[0];
    if (!link) return { ok: false, reason: "invalid_token" };
    if (link.usedAt) return { ok: false, reason: "already_used" };
    if (new Date(link.expiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid_token" };
  }

  const sessionToken = newToken("ses");
  await ensureAccount(email);
  await db.execute(sql`
    INSERT INTO account_sessions (session_token, email, device_id, user_agent, created_at, last_seen, expires_at)
    VALUES (${sessionToken}, ${email}, ${deviceId ?? null}, ${userAgent?.slice(0, 200) ?? null}, NOW(), NOW(), NOW() + INTERVAL '${sql.raw(String(SESSION_TTL_DAYS))} days');
  `);
  return { ok: true, sessionToken, email };
}

export async function getSession(sessionToken: string | undefined | null): Promise<{ email: string } | null> {
  if (!sessionToken) return null;
  await initDb();
  const db = getDb();
  const rows = await db.select().from(accountSessions).where(eq(accountSessions.sessionToken, sessionToken)).limit(1);
  const sess = rows[0];
  if (!sess) return null;
  if (sess.expiresAt && new Date(sess.expiresAt).getTime() < Date.now()) return null;
  // Touch last_seen async (don't block)
  db.execute(sql`UPDATE account_sessions SET last_seen = NOW() WHERE session_token = ${sessionToken};`).catch(() => {});
  return { email: sess.email };
}

export async function deleteSession(sessionToken: string): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute(sql`DELETE FROM account_sessions WHERE session_token = ${sessionToken};`);
}

export interface AccountStatus {
  email: string;
  totalCredits: number; // sum of remaining one-time pack credits
  hasUnlimited: boolean;
  unlimitedUntil: Date | null;
  subscriptionStatus: string | null;
  scanCount: number;
}

export async function getAccountStatus(email: string): Promise<AccountStatus> {
  await initDb();
  const db = getDb();
  const lower = email.toLowerCase();

  const credits = await db.select().from(accountCredits).where(eq(accountCredits.email, lower));
  let totalCredits = 0;
  let hasUnlimited = false;
  let unlimitedUntil: Date | null = null;
  let subscriptionStatus: string | null = null;
  for (const c of credits) {
    if (c.source === "unlimited") {
      if (c.subscriptionStatus === "active" || c.subscriptionStatus === "trialing") {
        if (!c.currentPeriodEnd || new Date(c.currentPeriodEnd).getTime() > Date.now()) {
          hasUnlimited = true;
          unlimitedUntil = c.currentPeriodEnd ? new Date(c.currentPeriodEnd) : null;
          subscriptionStatus = c.subscriptionStatus;
        }
      }
    } else if (c.creditsTotal != null) {
      totalCredits += Math.max(0, c.creditsTotal - c.creditsUsed);
    }
  }

  const counts = await db.execute(sql`SELECT COUNT(*)::int AS n FROM account_scans WHERE email = ${lower};`);
  const scanCount = Number((counts as unknown as { rows: Array<{ n: number }> }).rows?.[0]?.n ?? 0);

  return { email: lower, totalCredits, hasUnlimited, unlimitedUntil, subscriptionStatus, scanCount };
}

export type AccountDecision =
  | { allowed: true; reason: "unlimited" | "credit"; remaining: number | null }
  | { allowed: false; reason: "no_credits"; totalCredits: 0 }
  | { allowed: false; reason: "unlimited_capped"; monthlyCount: number; monthlyCap: number };

// Hard monthly cap on the Unlimited tier. Marketing copy stays "unlimited" —
// 99% of real users won't notice. Caps the worst-case Claude bill from a
// single subscriber abusing the tier (without the cap, one user could burn
// $1,000+/mo of inference at $0.018/scan × 60K scans).
export const UNLIMITED_MONTHLY_CAP = 30;

async function countScansThisMonth(email: string): Promise<number> {
  await initDb();
  const db = getDb();
  const lower = email.toLowerCase();
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM account_scans
    WHERE email = ${lower}
      AND created_at >= date_trunc('month', NOW());
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: Array<{ n: number }> }).rows) ?? [];
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
}

export async function checkAccountAccess(email: string): Promise<AccountDecision> {
  const status = await getAccountStatus(email);
  if (status.hasUnlimited) {
    const monthlyCount = await countScansThisMonth(email);
    if (monthlyCount >= UNLIMITED_MONTHLY_CAP) {
      return { allowed: false, reason: "unlimited_capped", monthlyCount, monthlyCap: UNLIMITED_MONTHLY_CAP };
    }
    return { allowed: true, reason: "unlimited", remaining: UNLIMITED_MONTHLY_CAP - monthlyCount };
  }
  if (status.totalCredits > 0) return { allowed: true, reason: "credit", remaining: status.totalCredits };
  return { allowed: false, reason: "no_credits", totalCredits: 0 };
}

// Atomic credit consumption — returns true if a credit was decremented,
// false if the user has no remaining credits. Closes the TOCTOU race where
// two parallel scans could both pass the credit gate and both call Claude
// off a single credit (cost-amplification exploit).
//
// Call this BEFORE the Claude call, not after. If Claude fails the user
// loses one credit on retry — acceptable trade vs. the alternative of
// granting unbounded free Claude calls.
//
// Unlimited tier doesn't go through this path (gated by monthly cap, not
// credit pool).
export async function consumeOneCreditAtomic(email: string): Promise<boolean> {
  await initDb();
  const db = getDb();
  const lower = email.toLowerCase();
  const result = await db.execute(sql`
    WITH next AS (
      SELECT id FROM account_credits
      WHERE email = ${lower}
        AND source <> 'unlimited'
        AND credits_total IS NOT NULL
        AND credits_used < credits_total
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE account_credits SET credits_used = credits_used + 1
    WHERE id IN (SELECT id FROM next)
    RETURNING id;
  `);
  const len = Array.isArray(result) ? result.length : (result as { rows?: Array<unknown> }).rows?.length ?? 0;
  return len > 0;
}

// Legacy fire-and-forget version retained as a no-op shim so older callers
// don't break during the refactor. New code MUST use consumeOneCreditAtomic.
export async function consumeOneCredit(email: string): Promise<void> {
  await consumeOneCreditAtomic(email);
}

export async function recordAccountScan(input: {
  email: string;
  scanMode: string;
  wellnessScore: number;
  summary: string;
  fullAnalysis: unknown;
}): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO account_scans (email, scan_mode, wellness_score, summary, full_analysis, created_at)
    VALUES (${input.email.toLowerCase()}, ${input.scanMode}, ${input.wellnessScore}, ${input.summary}, ${JSON.stringify(input.fullAnalysis)}::jsonb, NOW());
  `);
}

export async function listScans(email: string, limit = 20): Promise<Array<{ id: number; createdAt: Date; scanMode: string | null; wellnessScore: number | null; summary: string | null }>> {
  await initDb();
  const db = getDb();
  const rows = await db
    .select({ id: accountScans.id, createdAt: accountScans.createdAt, scanMode: accountScans.scanMode, wellnessScore: accountScans.wellnessScore, summary: accountScans.summary })
    .from(accountScans)
    .where(eq(accountScans.email, email.toLowerCase()))
    .orderBy(desc(accountScans.createdAt))
    .limit(limit);
  return rows;
}

// Webhook helpers
export async function grantPackCredits(input: {
  email: string;
  source: "starter" | "pro";
  credits: number;
  stripeSessionId: string;
}): Promise<{ granted: boolean }> {
  await initDb();
  const db = getDb();
  await ensureAccount(input.email);
  const result = await db.execute(sql`
    INSERT INTO account_credits (email, source, credits_total, credits_used, stripe_session_id, created_at)
    VALUES (${input.email.toLowerCase()}, ${input.source}, ${input.credits}, 0, ${input.stripeSessionId}, NOW())
    ON CONFLICT (stripe_session_id) WHERE stripe_session_id IS NOT NULL DO NOTHING
    RETURNING id;
  `);
  // Driver-shape guard: postgres-js returns the rows array directly,
  // node-pg returns { rows }. If neither shape matches we treat as an error
  // (would silently mark events processed in handleStripeWebhook otherwise).
  const len = Array.isArray(result)
    ? result.length
    : (result as { rows?: Array<unknown> }).rows?.length;
  if (len === undefined) {
    throw new Error(`grantPackCredits: unexpected db.execute return shape — driver may have changed`);
  }
  return { granted: len > 0 };
}

export async function upsertUnlimitedSubscription(input: {
  email: string;
  stripeSubscriptionId: string;
  stripeCustomerId?: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  await initDb();
  const db = getDb();
  await ensureAccount(input.email);
  await db.execute(sql`
    INSERT INTO account_credits (email, source, credits_total, credits_used, stripe_subscription_id, stripe_customer_id, subscription_status, current_period_end, created_at)
    VALUES (${input.email.toLowerCase()}, 'unlimited', NULL, 0, ${input.stripeSubscriptionId}, ${input.stripeCustomerId ?? null}, ${input.status}, ${input.currentPeriodEnd ? input.currentPeriodEnd.toISOString() : null}, NOW())
    ON CONFLICT (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL DO UPDATE
      SET subscription_status = EXCLUDED.subscription_status,
          current_period_end = EXCLUDED.current_period_end,
          stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, account_credits.stripe_customer_id);
  `);
}

// Look up Stripe identifiers for the billing-portal flow. Returns the most
// recent unlimited row (active or canceled) so a paused/canceled user can
// still reach the portal to reactivate or update their card.
export async function getStripeIdentifiersForBillingPortal(email: string): Promise<{
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
} | null> {
  await initDb();
  const db = getDb();
  const lower = email.toLowerCase();
  const result = await db.execute(sql`
    SELECT stripe_customer_id, stripe_subscription_id
    FROM account_credits
    WHERE email = ${lower}
      AND source = 'unlimited'
      AND stripe_subscription_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: Array<{ stripe_customer_id: string | null; stripe_subscription_id: string | null }> }).rows) ?? [];
  const row = rows[0] as { stripe_customer_id: string | null; stripe_subscription_id: string | null } | undefined;
  if (!row) return null;
  return { stripeCustomerId: row.stripe_customer_id ?? null, stripeSubscriptionId: row.stripe_subscription_id ?? null };
}

// Backfill the customer id once we've looked it up via Stripe API.
export async function setStripeCustomerId(input: {
  email: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
}): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute(sql`
    UPDATE account_credits
    SET stripe_customer_id = ${input.stripeCustomerId}
    WHERE email = ${input.email.toLowerCase()}
      AND stripe_subscription_id = ${input.stripeSubscriptionId}
      AND stripe_customer_id IS NULL;
  `);
}

export async function findEmailBySession(sessionId: string): Promise<string | null> {
  await initDb();
  const db = getDb();
  const rows = await db.select({ email: accountCredits.email }).from(accountCredits).where(eq(accountCredits.stripeSessionId, sessionId)).limit(1);
  return rows[0]?.email ?? null;
}

// Read-only idempotency check. Used at the TOP of the webhook handler so we
// can reject genuine Stripe retries without re-running the side effects.
export async function isEventProcessed(eventId: string): Promise<boolean> {
  await initDb();
  const db = getDb();
  const result = await db.execute(sql`
    SELECT 1 FROM processed_stripe_events WHERE event_id = ${eventId} LIMIT 1;
  `);
  // postgres-js returns the rows array directly; node-pg returns { rows }.
  // Either way, length > 0 = already processed.
  const len = Array.isArray(result) ? result.length : (result as { rows?: Array<unknown> }).rows?.length ?? 0;
  return len > 0;
}

// Reserve the event id only AFTER a handler runs successfully. If the handler
// soft-fails (no email, missing tier, transient timeout) we leave this row
// un-written so Stripe's automatic retries can recover.
export async function markEventProcessed(eventId: string): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO processed_stripe_events (event_id, processed_at)
    VALUES (${eventId}, NOW())
    ON CONFLICT (event_id) DO NOTHING;
  `);
}

// ─── Promo codes ─────────────────────────────────────────────────────────

export type PromoRedemption =
  | { ok: true; creditsGranted: number; remaining: number | null }
  | { ok: false; reason: "invalid_code" | "expired" | "exhausted" | "already_redeemed" | "disabled" };

export async function grantAdminCredits(input: {
  email: string;
  credits: number;
  note?: string;
}): Promise<{ granted: true; remaining: number }> {
  await initDb();
  const db = getDb();
  const lower = input.email.toLowerCase().trim();
  await ensureAccount(lower);
  await db.execute(sql`
    INSERT INTO account_credits (email, source, credits_total, credits_used, stripe_session_id, created_at, note)
    VALUES (${lower}, 'admin_grant', ${input.credits}, 0, NULL, NOW(), ${input.note ?? null});
  `);
  const status = await getAccountStatus(lower);
  return { granted: true, remaining: status.totalCredits };
}

export async function redeemPromoCode(input: { code: string; email: string }): Promise<PromoRedemption> {
  await initDb();
  const db = getDb();
  const code = input.code.trim().toUpperCase();
  const lowerEmail = input.email.toLowerCase();

  // Lookup code
  const rows = await db.execute(sql`SELECT * FROM promo_codes WHERE code = ${code} LIMIT 1;`);
  const c = (rows as unknown as { rows?: Array<{ code: string; credits_grant: number; max_uses: number | null; used_count: number; active: number; expires_at: Date | string | null }> }).rows?.[0];
  if (!c) return { ok: false, reason: "invalid_code" };
  if (!c.active) return { ok: false, reason: "disabled" };
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (c.max_uses != null && c.used_count >= c.max_uses) return { ok: false, reason: "exhausted" };

  // Has this email already redeemed this code?
  const dup = await db.execute(sql`SELECT id FROM promo_redemptions WHERE code = ${code} AND email = ${lowerEmail} LIMIT 1;`);
  if ((dup as unknown as { rows?: Array<unknown> }).rows?.length) {
    return { ok: false, reason: "already_redeemed" };
  }

  // Atomic: write redemption + grant credits + bump used_count
  await ensureAccount(lowerEmail);
  await db.execute(sql`
    INSERT INTO promo_redemptions (code, email, redeemed_at) VALUES (${code}, ${lowerEmail}, NOW())
    ON CONFLICT (code, email) DO NOTHING;
  `);
  await db.execute(sql`UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ${code};`);
  await db.execute(sql`
    INSERT INTO account_credits (email, source, credits_total, credits_used, stripe_session_id, created_at)
    VALUES (${lowerEmail}, ${"promo:" + code}, ${c.credits_grant}, 0, NULL, NOW());
  `);

  // Calculate remaining for response
  const status = await getAccountStatus(lowerEmail);
  return { ok: true, creditsGranted: c.credits_grant, remaining: status.totalCredits };
}
