import { getDb } from "./connection";
import { deviceUsage, ipUsage, accountCredits } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { initDb } from "./initDb";

const FREE_SCANS_PER_DEVICE = 1;
const IP_LOOKBACK_HOURS = 24;

// Cost-amplification ceiling. An attacker rotating device fingerprints and IPs
// could otherwise mint unlimited free scans, each costing ~$0.018 of Claude
// inference. 500/day caps the worst-case anonymous spend at ~$9/day per app.
// Real users never come close — we serve <100 anonymous scans/day in steady
// state. If we hit the cap legitimately (e.g., a viral moment), we paywall
// instead of subsidizing Claude — the paid path stays open.
const GLOBAL_FREE_SCANS_PER_DAY = 500;

export type AccessDecision =
  | { allowed: true; reason: "free_first" | "free_remaining"; remaining?: number }
  | { allowed: false; reason: "paywall"; usedToday: number }
  | { allowed: false; reason: "global_quota_exhausted"; servedToday: number; cap: number };

async function freeScansServedLast24h(): Promise<number> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM device_usage WHERE first_seen > NOW() - INTERVAL '24 hours';
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: Array<{ n: number }> }).rows) ?? [];
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
}

// Free-tier check (anonymous, device-tied). Account-tied checks live in
// queries/auth.ts via checkAccountAccess.
export async function checkAccess(input: { deviceId: string; ip: string; unlockToken?: string }): Promise<AccessDecision> {
  await initDb();
  const db = getDb();

  const deviceRows = await db.select().from(deviceUsage).where(eq(deviceUsage.deviceId, input.deviceId)).limit(1);
  const deviceUsed = deviceRows[0]?.freeScansUsed ?? 0;

  const ipRows = await db
    .select()
    .from(ipUsage)
    .where(sql`${ipUsage.ip} = ${input.ip} AND ${ipUsage.lastScanAt} > NOW() - INTERVAL '${sql.raw(String(IP_LOOKBACK_HOURS))} hours'`)
    .limit(1);
  const ipUsed = ipRows[0]?.freeScansUsed ?? 0;

  const effectiveUsed = Math.max(deviceUsed, ipUsed);

  if (effectiveUsed < FREE_SCANS_PER_DEVICE) {
    // Only consult the global cap for users about to consume a fresh free
    // scan. Returning users (paywall path) and paid users bypass it.
    const servedToday = await freeScansServedLast24h();
    if (servedToday >= GLOBAL_FREE_SCANS_PER_DAY) {
      return { allowed: false, reason: "global_quota_exhausted", servedToday, cap: GLOBAL_FREE_SCANS_PER_DAY };
    }
    return {
      allowed: true,
      reason: effectiveUsed === 0 ? "free_first" : "free_remaining",
      remaining: FREE_SCANS_PER_DEVICE - effectiveUsed,
    };
  }
  return { allowed: false, reason: "paywall", usedToday: effectiveUsed };
}

export async function recordScan(input: { deviceId: string; ip: string; unlockToken?: string }): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO device_usage (device_id, ip, free_scans_used, first_seen, last_seen)
    VALUES (${input.deviceId}, ${input.ip}, 1, NOW(), NOW())
    ON CONFLICT (device_id) DO UPDATE
    SET free_scans_used = device_usage.free_scans_used + 1,
        ip = ${input.ip},
        last_seen = NOW();
  `);
  await db.execute(sql`
    INSERT INTO ip_usage (ip, free_scans_used, last_scan_at)
    VALUES (${input.ip}, 1, NOW())
    ON CONFLICT (ip) DO UPDATE
    SET free_scans_used = ip_usage.free_scans_used + 1,
        last_scan_at = NOW();
  `);
}

// Legacy lookup for the /unlock?session_id=cs_xxx redirect URL. Now backed
// by account_credits (the new schema replaces paid_users). Returns the
// email + remaining credits if a row exists for that session.
export async function lookupUnlockBySession(sessionId: string): Promise<{ unlockToken: string; email: string; tier: string; credits: number } | null> {
  await initDb();
  const db = getDb();
  const rows = await db.select().from(accountCredits).where(eq(accountCredits.stripeSessionId, sessionId)).limit(1);
  const u = rows[0];
  if (!u) return null;
  const credits = u.creditsTotal != null ? Math.max(0, u.creditsTotal - u.creditsUsed) : 0;
  // unlockToken slot is now the session id itself for backwards compat
  return { unlockToken: sessionId, email: u.email, tier: u.source, credits };
}
