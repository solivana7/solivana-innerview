# InnerView by SoliVana

**AI instruments that measure wellness.** InnerView reads face and tongue photos through the lens of Ayurveda and Traditional Chinese Medicine — two frameworks that have observed these patterns for thousands of years — and returns structured, observation-not-diagnosis wellness readings.

Live at [innerview.solivana.io](https://innerview.solivana.io).

## The problem

Practitioners of Ayurveda and TCM read face and tongue patterns to understand constitutional balance, organ-system load, and lifestyle strain. The reading is real, but it doesn't scale: one practitioner, one patient, one session at a time. Most people never get a reading at all.

## The approach

InnerView turns a phone selfie and a tongue photo into a structured wellness reading:

1. **Photo intake** — guided capture (lighting, angle, and framing tips baked into the UI) with on-device face detection and cropping before upload.
2. **Claude Vision analysis** — the photo is analyzed by the Claude Vision API, framed through Ayurvedic and TCM pattern language (dosha balance, five-element mapping, facial zone / tongue feature observations).
3. **Observation-not-diagnosis guardrails** — the system prompt constrains the model to observational, pattern-language output and forbids diagnostic claims; the same disclaimer ships in the product UI on every screen.

**Observation, not diagnosis.** InnerView is a wellness pattern-observation tool. It is not a medical device and does not diagnose, treat, cure, or prevent any disease. Statements have not been evaluated by the FDA.

## Engineering highlights

- **Magic-link auth** — passwordless email sign-in (Resend) with long-lived session tokens tied to device fingerprint; free-scan unlock tokens survive logout via a signed local token.
- **Stripe credit packs + subscription** — one-time credit packs and an annual unlimited plan via Stripe Payment Links; webhook handler maps checkout metadata to tiers idempotently (processed-event ledger) and grants credits in the same transaction as purchase confirmation.
- **Atomic credit grants** — credit balance updates run in a single Postgres transaction with row locking; analysis spend is debited only after a successful model response, with automatic refund-on-failure.
- **IP rate limiting** — per-IP and per-account throttles on the analysis endpoint, plus a global daily quota with graceful paywall handoff.
- **Composite-labeled testimonials** — the social-proof block is explicitly labeled "Composite from early-user feedback," keeping marketing honest.
- **Research-anchored About page** — each cited paper links to its PubMed record.

## Tech stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS  |
| Backend  | Hono + tRPC 11 + Node.js (Dockerfile)        |
| AI       | Claude Vision API (Anthropic)                |
| Database | Postgres + Drizzle ORM                       |
| Auth     | Magic-link email (Resend) + session tokens   |
| Payments | Stripe (Payment Links + webhooks + portal)   |
| Deploy   | Railway (healthcheck on `/api/health`)       |

## Repo layout

```
api/        Hono server: tRPC routers (analyze, auth, access, admin), Stripe webhook, email
db/         Drizzle schema + migrations (users, sessions, analyses, credits, promo codes)
src/        React app (screens: showcase, capture tips, upload, result, therapy, paywall, admin)
contracts/  Shared tRPC contract types
public/     App imagery
```

## Local development

```bash
npm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY (local dev only)
npm run dev
```

Required environment variables (names only — real values live in the hosting provider's secret store, never in the repo): `ANTHROPIC_API_KEY`, `DATABASE_URL`, `RESEND_API_KEY`, `PUBLIC_BASE_URL`, `EMAIL_FROM`, and the `STRIPE_*` set for payments.

---

Portfolio — code shared for review, not licensed for reuse.
