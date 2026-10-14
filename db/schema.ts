import { pgTable, text, integer, timestamp, serial, jsonb } from "drizzle-orm/pg-core";

// ─── Free-tier device tracking (kept for the 1 free scan before signup) ───
export const deviceUsage = pgTable("device_usage", {
  deviceId: text("device_id").primaryKey(),
  ip: text("ip"),
  freeScansUsed: integer("free_scans_used").notNull().default(0),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

export const ipUsage = pgTable("ip_usage", {
  ip: text("ip").primaryKey(),
  freeScansUsed: integer("free_scans_used").notNull().default(0),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Account-tied identity ───────────────────────────────────────────────
// Once a user verifies their email via magic link, they have an account.
// Credits + scan history live under this email.
export const accounts = pgTable("accounts", {
  email: text("email").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One-time tokens for email verification + sign-in
export const magicLinks = pgTable("magic_links", {
  token: text("token").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Long-lived sessions stored in client localStorage
export const accountSessions = pgTable("account_sessions", {
  sessionToken: text("session_token").primaryKey(),
  email: text("email").notNull(),
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// Credits + subscriptions per account. One row per pack purchase OR per
// active subscription. Unlimited subs have credits_total NULL and a non-null
// subscription_status.
export const accountCredits = pgTable("account_credits", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  source: text("source").notNull(), // 'starter' | 'pro' | 'unlimited'
  creditsTotal: integer("credits_total"), // NULL for unlimited
  creditsUsed: integer("credits_used").notNull().default(0),
  stripeSessionId: text("stripe_session_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Scan history per account
export const accountScans = pgTable("account_scans", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  scanMode: text("scan_mode"),
  wellnessScore: integer("wellness_score"),
  summary: text("summary"),
  fullAnalysis: jsonb("full_analysis"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Webhook idempotency
export const processedStripeEvents = pgTable("processed_stripe_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// Promo codes — owner-issued free-credit grants
export const promoCodes = pgTable("promo_codes", {
  code: text("code").primaryKey(), // canonical: uppercase, no spaces
  creditsGrant: integer("credits_grant").notNull(),
  maxUses: integer("max_uses"), // NULL = unlimited
  usedCount: integer("used_count").notNull().default(0),
  active: integer("active").notNull().default(1), // 1 = active, 0 = disabled
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"), // free-form, e.g. "Launch promo", "Press giveaway"
});

// One redemption per email per code (prevents repeat use of same code by same account)
export const promoRedemptions = pgTable("promo_redemptions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  email: text("email").notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
});
