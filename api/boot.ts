import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env, hasDb } from "./lib/env";
import { handleStripeWebhook } from "./webhook";
import { initDb } from "./queries/initDb";

const app = new Hono<{ Bindings: HttpBindings }>();

// Security headers on every response
app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    // Tightened from `https:` wildcard to specific origins. Prevents an
    // attacker-injected <img> from being used as a DNS/URL exfil channel.
    imgSrc: ["'self'", "data:", "blob:", "https://*.solivana.io", "https://*.solivana.ai", "https://*.solivana.com", "https://*.stripe.com"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
  },
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: { camera: ["self"], microphone: [], geolocation: [] },
  crossOriginEmbedderPolicy: false,
}));

// Request log (prod only — dev gets vite's own log)
if (env.isProduction) {
  app.use("*", logger());
}

// In-memory per-IP rate limit. Simple sliding window. For multi-instance scale
// this needs to move to Redis or the Postgres add-on.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12; // 12 scans per minute per IP
const ipBuckets = new Map<string, number[]>();

function getClientIp(headers: Headers): string {
  // Take RIGHTMOST IP from x-forwarded-for, not leftmost. The leftmost is
  // attacker-controllable (any spoofed X-Forwarded-For: 1.2.3.4 prepends).
  // The rightmost is the IP closest to our trusted edge proxy (Railway).
  // x-real-ip is also set by Railway's edge with the real client IP.
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xf = headers.get("x-forwarded-for");
  if (xf) {
    const ips = xf.split(",").map((s) => s.trim()).filter(Boolean);
    return ips[ips.length - 1] ?? "unknown";
  }
  return "unknown";
}

app.use("/api/trpc/*", async (c, next) => {
  const ip = getClientIp(c.req.raw.headers);
  const now = Date.now();
  const bucket = (ipBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (bucket.length >= RATE_MAX) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }
  bucket.push(now);
  ipBuckets.set(ip, bucket);
  await next();
});

// Body limit only on the trpc route (where uploads land). 8MB covers a 6MB
// phone photo after base64 inflation. Health check + static assets are
// unbounded.
app.use("/api/trpc/*", bodyLimit({ maxSize: 8 * 1024 * 1024 }));

app.get("/api/health", (c) => c.json({ status: "ok", uptime: process.uptime() }));

// Stripe webhook — must be raw body, NOT parsed by trpc. Bind before the
// trpc catch-all. Signature verification happens inside the handler.
app.post("/api/stripe/webhook", handleStripeWebhook);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // Bootstrap DB schema if configured. Fire-and-forget so a transient DB
  // outage doesn't block the server from accepting health checks.
  if (hasDb) {
    initDb().catch((e) => console.error("[initDb] failed:", e));
  }

  const port = parseInt(process.env.PORT || "3000");
  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`InnerView listening on :${port}`);
  });

  // Graceful shutdown — drain in-flight requests before Railway sends SIGKILL
  const shutdown = (sig: string) => {
    console.log(`${sig} received, draining...`);
    server.close(() => {
      console.log("Server closed cleanly");
      process.exit(0);
    });
    setTimeout(() => {
      console.warn("Drain timeout, forcing exit");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Periodic GC of stale rate-limit buckets so the Map doesn't grow forever
  setInterval(() => {
    const cutoff = Date.now() - RATE_WINDOW_MS * 2;
    for (const [ip, times] of ipBuckets) {
      const filtered = times.filter((t) => t > cutoff);
      if (filtered.length === 0) ipBuckets.delete(ip);
      else ipBuckets.set(ip, filtered);
    }
  }, 60_000).unref();
}
