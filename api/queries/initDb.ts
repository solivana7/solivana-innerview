import { getDb } from "./connection";
import { sql } from "drizzle-orm";

let initialized = false;
let initPromise: Promise<void> | null = null;

export async function initDb(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = getDb();

    // Free-tier device tracking
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS device_usage (
        device_id TEXT PRIMARY KEY,
        ip TEXT,
        free_scans_used INTEGER NOT NULL DEFAULT 0,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ip_usage (
        ip TEXT PRIMARY KEY,
        free_scans_used INTEGER NOT NULL DEFAULT 0,
        last_scan_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Account identity
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS accounts (
        email TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS magic_links (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS magic_links_email_idx ON magic_links(email);`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS account_sessions (
        session_token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        device_id TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS account_sessions_email_idx ON account_sessions(email);`);

    // Credits + subscriptions
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS account_credits (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        source TEXT NOT NULL,
        credits_total INTEGER,
        credits_used INTEGER NOT NULL DEFAULT 0,
        stripe_session_id TEXT,
        stripe_subscription_id TEXT,
        subscription_status TEXT,
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS account_credits_email_idx ON account_credits(email);`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS account_credits_session_uniq ON account_credits(stripe_session_id) WHERE stripe_session_id IS NOT NULL;`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS account_credits_subscription_uniq ON account_credits(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;`);

    await db.execute(sql`ALTER TABLE account_credits ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS account_credits_customer_idx ON account_credits(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;`);

    // Scan history
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS account_scans (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        scan_mode TEXT,
        wellness_score INTEGER,
        summary TEXT,
        full_analysis JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS account_scans_email_idx ON account_scans(email);`);

    // Webhook idempotency
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS processed_stripe_events (
        event_id TEXT PRIMARY KEY,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Promo codes (owner-issued free-credit grants)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        credits_grant INTEGER NOT NULL,
        max_uses INTEGER,
        used_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        note TEXT
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_redemptions (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL,
        email TEXT NOT NULL,
        redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_code_email_uniq ON promo_redemptions(code, email);`);

    initialized = true;
    console.log("[initDb] schema ready");
  })();

  return initPromise;
}
