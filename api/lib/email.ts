import { Resend } from "resend";
import { env, hasEmail } from "./env";

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

export async function sendMagicLink(input: { email: string; token: string; isNew: boolean }): Promise<{ sent: boolean; reason?: string }> {
  if (!hasEmail) {
    console.warn("[email] RESEND_API_KEY not set — skipping magic link send");
    return { sent: false, reason: "no_email_configured" };
  }

  // Path-based token (more robust than ?token= against email-client URL
  // rewriting — Gmail in particular sometimes strips query strings).
  const url = `${env.publicBaseUrl}/auth/${encodeURIComponent(input.token)}`;
  const subject = input.isNew
    ? "Welcome to InnerView — confirm your email"
    : "Sign in to InnerView";

  const text = [
    input.isNew ? "Welcome to InnerView." : "Hi again.",
    "",
    "Click the link below to sign in. It expires in 24 hours.",
    "",
    url,
    "",
    "If you didn't request this, you can safely ignore this email.",
    "",
    "—",
    "InnerView · SoliVana Wellness",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#FFF8F0;color:#331D01;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.6">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E5DDD3;border-radius:16px;padding:32px">
      <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:300;font-size:24px;color:#331D01;margin:0 0 8px;letter-spacing:-0.01em">
        ${input.isNew ? "Welcome to InnerView." : "Sign in to InnerView."}
      </p>
      <p style="color:#786455;font-size:15px;margin:0 0 28px">
        Click the button below to ${input.isNew ? "confirm your email and continue" : "sign in"}. The link expires in 24 hours.
      </p>
      <p style="margin:0 0 28px">
        <a href="${url}" style="display:inline-block;padding:14px 28px;background:#EC9247;color:#fff;text-decoration:none;border-radius:999px;font-weight:500;font-size:14px;letter-spacing:0.02em">
          ${input.isNew ? "Confirm email" : "Sign in"}
        </a>
      </p>
      <p style="color:#B49F90;font-size:12px;margin:0 0 8px">Or copy this link into your browser:</p>
      <p style="color:#786455;font-size:12px;word-break:break-all;margin:0 0 28px">${url}</p>
      <p style="color:#B49F90;font-size:11px;margin:0;border-top:1px solid #F0EDED;padding-top:20px">
        If you didn't request this, you can safely ignore this email — no account was created without your action.
      </p>
      <p style="color:#B49F90;font-size:11px;margin:8px 0 0">
        InnerView · SoliVana Wellness
      </p>
    </div>
  </body>
</html>`;

  try {
    await getResend().emails.send({
      from: env.emailFrom,
      to: input.email,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { sent: false, reason: "send_failed" };
  }
}

// Ops alert — fired when the Stripe webhook handler throws a 500. Sends to
// the owner's info@ ops inbox, so it's an ops/internal notification (the
// "ops emails auto-send" carve-out applies). Stripe will keep retrying the
// event in the meantime; this is purely for human visibility.
export async function sendWebhookErrorAlert(input: { eventId: string; eventType: string; err: unknown }): Promise<void> {
  if (!hasEmail) {
    console.warn("[email] RESEND_API_KEY not set — skipping webhook alert");
    return;
  }
  const msg = input.err instanceof Error ? input.err.message : String(input.err);
  const stack = input.err instanceof Error ? input.err.stack : undefined;
  const body = [
    "InnerView — Stripe webhook handler returned 500.",
    "",
    `Event ID:   ${input.eventId}`,
    `Event type: ${input.eventType}`,
    `Time:       ${new Date().toISOString()}`,
    "",
    `Error: ${msg}`,
    "",
    stack ? `Stack:\n${stack}` : "",
    "",
    "Stripe will retry automatically. Check Dashboard → Developers → Webhooks if this fires repeatedly.",
  ].filter(Boolean).join("\n");
  try {
    await getResend().emails.send({
      from: env.emailFrom,
      to: "info@solivana.com",
      subject: `[InnerView webhook 500] ${input.eventType}`,
      text: body,
    });
  } catch (e) {
    console.error("[email] webhook alert send failed:", e);
  }
}
