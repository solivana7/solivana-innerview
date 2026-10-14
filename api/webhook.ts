import type { Context } from "hono";
import Stripe from "stripe";
import { env, hasStripe } from "./lib/env";
import { grantPackCredits, upsertUnlimitedSubscription, markEventProcessed, isEventProcessed, createMagicLink, ensureAccount } from "./queries/auth";
import { sendMagicLink, sendWebhookErrorAlert } from "./lib/email";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion });
  }
  return stripe;
}

/**
 * POST /api/stripe/webhook
 * Handles checkout completion (one-time packs) and subscription lifecycle
 * events (unlimited tier).
 */
export async function handleStripeWebhook(c: Context): Promise<Response> {
  if (!hasStripe) return c.json({ error: "Stripe not configured" }, 503);

  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing signature" }, 400);

  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, env.stripeWebhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "verification failed";
    console.warn("[stripe-webhook] signature verification failed:", msg);
    return c.json({ error: `Signature verification failed: ${msg}` }, 400);
  }

  // Idempotency: check (don't reserve) up front so genuine duplicates are
  // acknowledged without re-running the handler. We only RESERVE the event id
  // *after* a successful handler run — see endOfHandler() below. This way a
  // soft-fail (missing tier metadata, transient Anthropic timeout) leaves the
  // event un-marked so Stripe's automatic retries can recover it.
  if (await isEventProcessed(event.id)) {
    return c.json({ received: true, duplicate: true });
  }

  try {
    let response: Response;
    switch (event.type) {
      case "checkout.session.completed":
        response = await handleCheckoutCompleted(c, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        response = await handleSubscriptionUpdated(c, event.data.object as Stripe.Subscription, /*sendLink*/ event.type === "customer.subscription.created");
        break;
      case "customer.subscription.deleted":
        response = await handleSubscriptionDeleted(c, event.data.object as Stripe.Subscription);
        break;
      // Stripe ships both legacy ("invoice.payment_succeeded") and new
      // ("invoice_payment.paid") names for subscription renewal events.
      // Accept either so this works regardless of which event name your
      // webhook destination is configured to send.
      case "invoice.payment_succeeded":
      case "invoice_payment.paid" as Stripe.Event["type"]:
        response = await handleInvoicePaid(c, event.data.object as Stripe.Invoice);
        break;
      default:
        response = c.json({ received: true, type: event.type, ignored: true });
    }
    // Only mark processed if the handler returned 2xx — Stripe should retry
    // anything else.
    if (response.status >= 200 && response.status < 300) {
      await markEventProcessed(event.id);
    }
    return response;
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // Fire-and-forget ops alert to info@solivana.com so a silent
    // payment-flow break gets human eyes within seconds. Don't block the
    // 500 response on the email — Stripe will retry the event regardless.
    void sendWebhookErrorAlert({ eventId: event.id, eventType: event.type, err });
    // Don't mark processed — return 500 so Stripe retries.
    return c.json({ error: "handler failed" }, 500);
  }
}

async function handleCheckoutCompleted(c: Context, session: Stripe.Checkout.Session): Promise<Response> {
  const email = session.customer_details?.email ?? session.customer_email ?? "";
  if (!email) {
    // Soft-fail with 500 so Stripe retries — sometimes Stripe sends checkout
    // events before customer_details is finalized; a retry usually has it.
    console.warn("[stripe-webhook] checkout missing email — will retry", { sessionId: session.id });
    return c.json({ error: "no email yet" }, 500);
  }

  if (session.payment_status !== "paid" && session.mode !== "subscription") {
    console.warn("[stripe-webhook] checkout not paid yet", { sessionId: session.id, status: session.payment_status });
    return c.json({ received: true, status: session.payment_status });
  }

  if (session.mode === "subscription") {
    await ensureAccount(email);
    const token = await createMagicLink(email);
    await sendMagicLink({ email, token, isNew: true });
    return c.json({ received: true, type: "subscription_checkout" });
  }

  // Resolve tier+credits with three fallbacks so a misconfigured payment link
  // doesn't strand a paying customer:
  //   1. session.metadata (set on the payment link directly)
  //   2. product.metadata (set on the Stripe Product)
  //   3. amount_total inference (matches our $4.99 / $9.99 price scheme,
  //      USD only — guards against multi-currency mismatch)
  // ALSO: extract the product name to filter cross-app events. InnerView and
  // PetView share one Stripe account, so every webhook endpoint receives every
  // event. We must skip events whose product belongs to the other app.
  let md: Record<string, string> = (session.metadata ?? {}) as Record<string, string>;
  let productName = "";
  try {
    const expanded = await getStripe().checkout.sessions.retrieve(session.id, {
      expand: ["line_items.data.price.product"],
    });
    const product = expanded.line_items?.data?.[0]?.price?.product as Stripe.Product | undefined;
    productName = product?.name ?? "";
    if (!md.tier && product?.metadata) md = { ...product.metadata, ...md };
  } catch (err) {
    console.warn("[stripe-webhook] line-items expand failed:", err);
  }

  // Cross-app filter: skip events that belong to PetView (now branded
  // "InnerView Pets") or any other product on the shared Stripe account.
  // We must be careful: a substring match like .includes("innerview")
  // would FALSELY claim "InnerView Pets" events as ours. The authoritative
  // signal is the `app` metadata key (= "innerview" for this app, "petview"
  // for the pet app). Fall back to product-name match only when metadata
  // is missing AND the name doesn't contain "pets" (the only existing
  // collision).
  const lowerName = productName.toLowerCase();
  const lowerApp = (md.app || "").toLowerCase();
  const isForThisApp =
    lowerApp === "innerview" ||
    (!lowerApp && lowerName.includes("innerview") && !lowerName.includes("innerview pets"));
  const appHint = lowerApp || lowerName;
  if (appHint && !isForThisApp) {
    console.log("[stripe-webhook] event for another app, ignoring", { sessionId: session.id, productName, app: md.app });
    return c.json({ received: true, ignored_for_app: appHint });
  }

  if (!md.tier && session.currency === "usd") {
    const amount = session.amount_total;
    // New pricing (2026-05-14 restructure): 5/$9.99, 20/$29.99
    if (amount === 999) { md.tier = "starter"; md.credits = md.credits || "5"; }
    else if (amount === 2999) { md.tier = "pro"; md.credits = md.credits || "20"; }
    // Legacy support — anyone who bought at the old $4.99 / old $9.99-pro
    // prices still gets credited. Old tiers granted 10 / 100 — preserved.
    else if (amount === 499) { md.tier = "starter"; md.credits = md.credits || "10"; }
  }
  const tier = md.tier;

  if (tier !== "starter" && tier !== "pro") {
    // Hard fail with 500 — this should never happen with our payment link
    // setup. If it does, Stripe will retry (giving us time to fix metadata)
    // and the owner gets a Stripe Dashboard alert.
    console.error("[stripe-webhook] checkout missing/invalid tier (no fallback matched)", { sessionId: session.id, amount: session.amount_total, currency: session.currency, md });
    return c.json({ error: "missing tier metadata", sessionId: session.id }, 500);
  }
  const creditsRaw = md.credits;
  const credits = creditsRaw ? parseInt(creditsRaw, 10) : (tier === "starter" ? 10 : 100);
  if (!credits || isNaN(credits)) {
    console.error("[stripe-webhook] checkout missing/invalid credits", { sessionId: session.id, md });
    return c.json({ error: "missing credits metadata", sessionId: session.id }, 500);
  }

  const result = await grantPackCredits({
    email,
    source: tier as "starter" | "pro",
    credits,
    stripeSessionId: session.id,
  });

  // Always send a magic link so the buyer can sign in on this device or any other.
  const token = await createMagicLink(email);
  await sendMagicLink({ email, token, isNew: true });

  console.log("[stripe-webhook] pack granted", { sessionId: session.id, email, tier, credits, granted: result.granted });
  return c.json({ received: true, granted: result.granted });
}

async function handleSubscriptionUpdated(c: Context, sub: Stripe.Subscription, sendLink: boolean): Promise<Response> {
  // Cross-app filter: skip subscription events whose product belongs to PetView.
  // Both apps share one Stripe account → same event fires to both endpoints.
  try {
    const expanded = await getStripe().subscriptions.retrieve(sub.id, { expand: ["items.data.price.product"] });
    const product = expanded.items?.data?.[0]?.price?.product as Stripe.Product | undefined;
    const lowerApp = (product?.metadata?.app || "").toLowerCase();
    const lowerName = (product?.name || "").toLowerCase();
    // Same disambiguation as the checkout filter: substring match on
    // "innerview" would falsely admit "InnerView Pets" events. Trust the
    // `app` metadata key first; fall back to product name only when metadata
    // is missing AND the name doesn't contain the "pets" disambiguator.
    const isForThisApp =
      lowerApp === "innerview" ||
      (!lowerApp && lowerName.includes("innerview") && !lowerName.includes("innerview pets"));
    const appHint = lowerApp || lowerName;
    if (appHint && !isForThisApp) {
      console.log("[stripe-webhook] subscription for another app, ignoring", { subId: sub.id, productName: product?.name });
      return c.json({ received: true, ignored_for_app: appHint });
    }
  } catch (err) {
    console.warn("[stripe-webhook] subscription product expand failed:", err);
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    console.warn("[stripe-webhook] subscription missing customer", { subId: sub.id });
    return c.json({ received: true, warning: "no customer" });
  }
  // Look up email from the customer
  const customer = await getStripe().customers.retrieve(customerId);
  const email = (customer as Stripe.Customer).email ?? "";
  if (!email) {
    console.warn("[stripe-webhook] subscription customer has no email — will retry", { subId: sub.id });
    return c.json({ error: "no email yet" }, 500);
  }

  await upsertUnlimitedSubscription({
    email,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
  });

  // Only send a magic link on the FIRST subscription event (`created`). Monthly
  // renewal invoices were re-sending sign-in emails to existing subscribers — a
  // confusing "did I request this?" UX.
  if (sendLink) {
    const token = await createMagicLink(email);
    await sendMagicLink({ email, token, isNew: true });
  }

  console.log("[stripe-webhook] subscription upserted", { email, status: sub.status, sentLink: sendLink });
  return c.json({ received: true });
}

async function handleSubscriptionDeleted(c: Context, sub: Stripe.Subscription): Promise<Response> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return c.json({ received: true, warning: "no customer" });
  const customer = await getStripe().customers.retrieve(customerId);
  const email = (customer as Stripe.Customer).email ?? "";
  if (!email) return c.json({ received: true, warning: "no email" });

  await upsertUnlimitedSubscription({
    email,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    status: "canceled",
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
  });
  console.log("[stripe-webhook] subscription canceled", { email });
  return c.json({ received: true, canceled: true });
}

async function handleInvoicePaid(c: Context, invoice: Stripe.Invoice): Promise<Response> {
  const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (!subId) return c.json({ received: true, type: "invoice", note: "no subscription" });
  const sub = await getStripe().subscriptions.retrieve(subId);
  // Renewal — keep the subscription state fresh, but don't re-issue a magic
  // link to a subscriber who's already signed in somewhere.
  return handleSubscriptionUpdated(c, sub, /*sendLink*/ false);
}
