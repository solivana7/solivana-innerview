import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function optional(name: string): string {
  return process.env[name] ?? "";
}

export const env = {
  isProduction: process.env.NODE_ENV === "production",
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  databaseUrl: optional("DATABASE_URL"),

  // Public-facing base URL — used in magic-link emails
  publicBaseUrl: optional("PUBLIC_BASE_URL") || "https://innerview.solivana.io",

  // Email (Resend) for magic links
  resendApiKey: optional("RESEND_API_KEY"),
  emailFrom: optional("EMAIL_FROM") || "InnerView <info@solivana.com>",

  // Stripe — all optional in dev so the app boots without them; gated by
  // hasStripe at call time.
  stripeSecretKey: optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  stripeLinkStarter: optional("STRIPE_LINK_STARTER"),
  stripeLinkPro: optional("STRIPE_LINK_PRO"),
  stripeLinkUnlimited: optional("STRIPE_LINK_UNLIMITED"),
  stripeLinkUnlimitedAnnual: optional("STRIPE_LINK_UNLIMITED_ANNUAL"),
  stripeCouponRestock: optional("STRIPE_COUPON_RESTOCK") || "RESTOCK10",
  // Stripe Customer Portal configuration ID (bpc_xxx). When set, billing
  // portal sessions use this specific configuration; when blank, Stripe
  // falls back to the dashboard's default config.
  stripeBillingPortalConfigId: optional("STRIPE_BILLING_PORTAL_CONFIG_ID"),
  adminEmails: optional("ADMIN_EMAILS"),

  // Admin token for backoffice routes (grant credits, view users)
  adminToken: optional("ADMIN_TOKEN"),
};

export const hasStripe = Boolean(env.stripeSecretKey && env.stripeWebhookSecret);
export const hasDb = Boolean(env.databaseUrl);
export const hasEmail = Boolean(env.resendApiKey);
