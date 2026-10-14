import { z } from "zod";
import Stripe from "stripe";
import { createRouter, publicQuery } from "./middleware";
import { ensureAccount, createMagicLink, exchangeMagicLink, getSession, getAccountStatus, listScans, deleteSession, redeemPromoCode, getStripeIdentifiersForBillingPortal, setStripeCustomerId } from "./queries/auth";
import { sendMagicLink } from "./lib/email";
import { env, hasDb, hasEmail, hasStripe } from "./lib/env";

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(env.stripeSecretKey, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion });
  }
  return stripeClient;
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const authRouter = createRouter({
  // Request a magic link. We don't reveal whether the email exists — always
  // return { sent: true } unless the email itself is malformed.
  requestLink: publicQuery
    .input(z.object({ email: emailSchema }))
    .mutation(async ({ input }): Promise<{ sent: boolean; emailConfigured: boolean }> => {
      if (!hasDb) return { sent: false, emailConfigured: false };
      const { isNew } = await ensureAccount(input.email);
      const token = await createMagicLink(input.email);
      const { sent } = await sendMagicLink({ email: input.email, token, isNew });
      return { sent, emailConfigured: hasEmail };
    }),

  // Exchange a magic-link token for a long-lived session token.
  exchangeToken: publicQuery
    .input(z.object({ token: z.string().min(8) }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true; sessionToken: string; email: string } | { ok: false; reason: string }> => {
      if (!hasDb) return { ok: false, reason: "db_unavailable" };
      const ua = ctx.req.headers.get("user-agent");
      const deviceId = ctx.req.headers.get("x-device-id");
      return exchangeMagicLink(input.token, deviceId, ua);
    }),

  // Lookup current session — returns email + credit/sub status + history count
  session: publicQuery
    .input(z.object({ sessionToken: z.string().optional() }))
    .query(async ({ input }) => {
      const sess = await getSession(input.sessionToken);
      if (!sess) return { signedIn: false as const };
      const status = await getAccountStatus(sess.email);
      return {
        signedIn: true as const,
        email: status.email,
        totalCredits: status.totalCredits,
        hasUnlimited: status.hasUnlimited,
        unlimitedUntil: status.unlimitedUntil,
        subscriptionStatus: status.subscriptionStatus,
        scanCount: status.scanCount,
      };
    }),

  // Recent scans for the signed-in user
  history: publicQuery
    .input(z.object({ sessionToken: z.string().min(8), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const sess = await getSession(input.sessionToken);
      if (!sess) return { scans: [] };
      const scans = await listScans(sess.email, input.limit);
      return { scans };
    }),

  signOut: publicQuery
    .input(z.object({ sessionToken: z.string().min(8) }))
    .mutation(async ({ input }) => {
      await deleteSession(input.sessionToken);
      return { ok: true };
    }),

  // Redeem an owner-issued promo code. Caller must be signed in (we tie
  // credits to the verified email so the same code can't be reused across
  // burner accounts trivially).
  redeemPromo: publicQuery
    .input(z.object({ sessionToken: z.string().min(8), code: z.string().min(2).max(40) }))
    .mutation(async ({ input }) => {
      const sess = await getSession(input.sessionToken);
      if (!sess) return { ok: false as const, reason: "not_signed_in" as const };
      return redeemPromoCode({ code: input.code, email: sess.email });
    }),

  // Open a Stripe Customer Billing Portal session — handles pause, cancel,
  // payment-method update, and invoice history. California BPC §17602
  // (Automatic Renewal Law) requires subscribers to be able to cancel
  // in-app through the same channel they signed up.
  openBillingPortal: publicQuery
    .input(z.object({ sessionToken: z.string().min(8), returnUrl: z.string().url() }))
    .mutation(async ({ input }): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
      if (!hasStripe) return { ok: false, reason: "stripe_unconfigured" };
      const sess = await getSession(input.sessionToken);
      if (!sess) return { ok: false, reason: "not_signed_in" };

      const ids = await getStripeIdentifiersForBillingPortal(sess.email);
      if (!ids?.stripeSubscriptionId) return { ok: false, reason: "no_subscription" };

      let customerId = ids.stripeCustomerId;
      if (!customerId) {
        try {
          const sub = await getStripe().subscriptions.retrieve(ids.stripeSubscriptionId);
          customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
          if (customerId) {
            await setStripeCustomerId({ email: sess.email, stripeSubscriptionId: ids.stripeSubscriptionId, stripeCustomerId: customerId });
          }
        } catch (err) {
          console.warn("[openBillingPortal] subscription retrieve failed:", err);
          return { ok: false, reason: "stripe_lookup_failed" };
        }
      }
      if (!customerId) return { ok: false, reason: "no_customer" };

      try {
        const portal = await getStripe().billingPortal.sessions.create({
          customer: customerId,
          return_url: input.returnUrl,
          ...(env.stripeBillingPortalConfigId ? { configuration: env.stripeBillingPortalConfigId } : {}),
        });
        return { ok: true, url: portal.url };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "portal_create_failed";
        console.error("[openBillingPortal] create failed:", msg);
        return { ok: false, reason: "portal_create_failed" };
      }
    }),
});
