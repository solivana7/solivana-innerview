import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { initDb } from "./queries/initDb";
import { getAccountStatus, listScans, grantAdminCredits } from "./queries/auth";
import { sql } from "drizzle-orm";

function verifyAdminToken(token: string | undefined): boolean {
  const expected = env.adminToken?.trim();
  if (!expected) return false;
  return token?.trim() === expected;
}

export const adminRouter = createRouter({
  verify: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      return { ok: verifyAdminToken(input.token) };
    }),

  searchUsers: publicQuery
    .input(z.object({ query: z.string().max(100).default(""), token: z.string() }))
    .query(async ({ input }) => {
      if (!verifyAdminToken(input.token)) {
        return { success: false as const, error: "Unauthorized" };
      }
      await initDb();
      const db = getDb();
      const q = `%${input.query.toLowerCase()}%`;
      const rows = await db.execute(sql`
        SELECT a.email, a.created_at,
          COALESCE(SUM(CASE WHEN ac.source <> 'unlimited' AND ac.credits_total IS NOT NULL THEN GREATEST(0, ac.credits_total - ac.credits_used) ELSE 0 END), 0)::int AS remaining_credits,
          BOOL_OR(ac.source = 'unlimited' AND ac.subscription_status IN ('active', 'trialing') AND (ac.current_period_end IS NULL OR ac.current_period_end > NOW())) AS has_unlimited
        FROM accounts a
        LEFT JOIN account_credits ac ON a.email = ac.email
        WHERE a.email ILIKE ${q}
        GROUP BY a.email, a.created_at
        ORDER BY a.created_at DESC
        LIMIT 100;
      `);
      const results = Array.isArray(rows) ? rows : (rows as { rows?: Array<unknown> }).rows ?? [];
      const users = results.map((r: unknown) => {
        const row = r as { email: string; created_at: Date | string; remaining_credits: number; has_unlimited: boolean };
        return {
          email: row.email,
          createdAt: row.created_at,
          remainingCredits: Number(row.remaining_credits ?? 0),
          hasUnlimited: Boolean(row.has_unlimited),
        };
      });
      return { success: true as const, users };
    }),

  getUser: publicQuery
    .input(z.object({ email: z.string().email(), token: z.string() }))
    .query(async ({ input }) => {
      if (!verifyAdminToken(input.token)) {
        return { success: false as const, error: "Unauthorized" };
      }
      const status = await getAccountStatus(input.email);
      const scans = await listScans(input.email, 20);

      await initDb();
      const db = getDb();
      const creditRows = await db.execute(sql`
        SELECT id, source, credits_total, credits_used, subscription_status, current_period_end, created_at, note
        FROM account_credits
        WHERE email = ${input.email.toLowerCase()}
        ORDER BY created_at DESC;
      `);
      const rawCredits = Array.isArray(creditRows) ? creditRows : (creditRows as { rows?: Array<unknown> }).rows ?? [];
      const credits = rawCredits.map((r: unknown) => {
        const row = r as {
          id: number;
          source: string;
          credits_total: number | null;
          credits_used: number;
          subscription_status: string | null;
          current_period_end: Date | string | null;
          created_at: Date | string;
          note: string | null;
        };
        return {
          id: row.id,
          source: row.source,
          creditsTotal: row.credits_total,
          creditsUsed: row.credits_used,
          remaining: row.credits_total != null ? Math.max(0, row.credits_total - row.credits_used) : null,
          subscriptionStatus: row.subscription_status,
          currentPeriodEnd: row.current_period_end,
          createdAt: row.created_at,
          note: row.note,
        };
      });

      return {
        success: true as const,
        user: { ...status, scans, credits },
      };
    }),

  grantCredits: publicQuery
    .input(z.object({
      email: z.string().email(),
      credits: z.number().int().min(1).max(1000),
      note: z.string().max(200).optional(),
      token: z.string(),
    }))
    .mutation(async ({ input }) => {
      if (!verifyAdminToken(input.token)) {
        return { success: false as const, error: "Unauthorized" };
      }
      const result = await grantAdminCredits({
        email: input.email,
        credits: input.credits,
        note: input.note,
      });
      return { success: true as const, remaining: result.remaining };
    }),
});
