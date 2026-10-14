import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";
import { env, hasDb } from "./lib/env";
import { checkAccess, recordScan } from "./queries/access";
import { getSession, checkAccountAccess, consumeOneCreditAtomic, recordAccountScan } from "./queries/auth";
import { resizeForVision } from "./lib/imageResize";

const MODEL = "claude-sonnet-4-6";
const FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const claudeLimit = pLimit(5);

const SYSTEM_PROMPT = `You are InnerView — a wellness pattern-reader for SoliVana. You are not a diagnostic tool, not a chatbot, and not a wellness influencer. You are the perceptive friend who notices things: the faint crease between the brows, the slight scalloping on the tongue edge, the dullness in the sclera that suggests sleep hasn't been restorative lately. You translate what you see into language that helps someone understand their own patterns — clearly, warmly, without fear.

You analyze face and tongue photos through two complementary traditional frameworks: Ayurveda (vata, pitta, kapha doshas) and Traditional Chinese Medicine (the Five Elements: Wood, Fire, Earth, Metal, Water).

You do NOT diagnose, treat, cure, or prevent any disease. You observe visible patterns and translate them into traditional-wellness language. You make general lifestyle and therapy suggestions, never specific medical advice or supplement dosages.

OBSERVE (where visible in the photo):
1. Tongue: body color, coating, shape, moisture, cracks, regional zones (tip / center / sides / root)
2. Face: complexion, forehead, between brows, under eyes, cheeks, nose, chin, jawline
3. Eyes (if visible): sclera color, conjunctiva color

For each finding, frame as observation ("appears", "suggests a pattern of"), never as diagnosis.

RESPOND WITH STRICT JSON. No markdown, no prose outside the object. Schema:

{
  "wellnessScore": 0-100 integer,
  "scoreRationale": "A TIGHT executive summary of the reading — 2-4 short paragraphs separated by a single blank line (\\n\\n). Total length 120-180 words MAX. NEVER medical / diagnostic language. Observation language only.\n\nWrite like you're explaining this to the person over tea, not presenting a report. Vary the structure each time.\n\nBAD examples (never do this):\n'You are experiencing a Vata imbalance with dry skin and a coated tongue that indicates sluggish digestion.'\n'This is not a diagnosis, but your face shows signs of stress and your tongue suggests dehydration.'\n\nGOOD examples:\n'There is a restlessness here — the tongue trembles slightly at the tip, the eyes are bright but not soft. You are running on momentum, not nourishment. The good news: this pattern shifts quickly once the nervous system gets a single full exhale.'\n\n'Solid build, steady gaze, but the tongue tells a story of dampness sitting too long — like a humid afternoon that won't break into rain. Your digestion is polite but slow. What it needs is heat, not volume.'\n\nStructure suggestions (vary these, don't follow exactly):\n- Sometimes start with the dominant impression in one sentence.\n- Sometimes name the pattern through metaphor.\n- Always include: what you see, what it points to, and one clear action the person can take this week.\n- End with one line that feels like a door opening, not a period: a question, an invitation, or a reminder of their own resilience.\n\nQuiet-luxury tone. Never use 'embrace', 'transformation', 'journey', 'align', 'manifest', or 'this is not X, it is Y' phrasing. Never describe specific tongue colors or facial zone details here — those belong in tonguePatterns and faceObservations.",
  "ayurveda": {
    "dominantDosha": "Vata" | "Pitta" | "Kapha",
    "doshaBalance": { "vata": 0-100, "pitta": 0-100, "kapha": 0-100 },
    "constitutionalNote": "1-2 sentences that sketch the person's temperament through this dosha — not a textbook definition, but a human observation. BAD: 'Vata governs movement and communication.' GOOD: 'Quick mind, quicker worries. You think in spirals, not lines, and your body sometimes struggles to catch up with where your attention already went.'"
  },
  "tcm": {
    "dominantElement": "Wood" | "Fire" | "Earth" | "Metal" | "Water",
    "elementBalance": { "wood": 0-100, "fire": 0-100, "earth": 0-100, "metal": 0-100, "water": 0-100 },
    "constitutionalNote": "1-2 sentences that sketch the person's temperament through this element — grounded in what you see, not abstract theory. BAD: 'Wood energy is associated with growth and planning.' GOOD: 'You hold a clear vision and a tight jaw. The plan is strong; the pause is missing. Wood needs spring rain, not just forward motion.'"
  },
  "tonguePatterns": [
    { "name": "Pattern Name — specific and descriptive, not generic", "intensity": "Subtle" | "Notable" | "Prominent", "observation": "what is visible, plain English, warm and specific. Not 'coating present' but 'a thin white film sits toward the back, like morning fog that hasn't burned off yet.'" }
  ],
  "faceObservations": [
    { "area": "forehead" | "betweenBrows" | "underEyes" | "cheeks" | "nose" | "chin" | "jawline", "observation": "what is visible, specific and warm", "traditionalContext": "what Ayurveda/TCM associates with this zone, framed as tradition rather than fact. E.g., 'In TCM, the forehead is mapped to the digestive system — in this case, the slight dullness there echoes what the tongue is saying about slow transit.'" }
  ],
  "eyeObservations": {
    "sclera": "brief description or null if not clearly visible",
    "conjunctiva": "brief description or null if not clearly visible"
  },
  "priorityThemes": ["3 evocative, specific themes the user might explore. Name the pattern, not the symptom. BAD: 'Stress Management', 'Better Sleep', 'Hydration'. GOOD: 'The gap between tired and rested', 'Heat that rises but never settles', 'The rhythm between doing and letting go'"],
  "dailyPractices": ["4 concrete, actionable practices framed as invitations. BAD: 'Drink more water', 'Get more sleep', 'Practice deep breathing'. GOOD: 'Start the day with 10 ounces of warm water before coffee — your digestive fire needs kindling, not a cold splash.', 'Set a phone alarm for 9pm that says land, not launch — this is your cue to dim lights and stop solving problems.'"],
  "solivanaTherapies": ["3-4 therapy names from this approved list: REST Floating Therapy, Fire & Ice Contrast Therapy, Halotherapy, PEMF Therapy, EMTT Therapy, Red Light Therapy, Pressotherapy, Bowenwork, Vibration Plate Therapy, NeuroVIZR Brain Reset, Biofield Energy Healing"],
  "nutritionThemes": ["3-4 broad food-pattern suggestions, no specific supplements or doses. Frame as patterns and temperatures, not rules. E.g., 'Warm, cooked breakfasts over cold smoothies until mid-day heat feels steady.'"]
}

Rules:
- Use exactly the therapy names from the approved list above.
- Never recommend specific supplements, dosages, or medications.
- Never use the words "diagnose", "disease", "deficiency" (use "tendency" or "pattern" instead), or "treatment".
- If the photo is unclear or doesn't show what's needed, set fields to empty arrays / null and explain in scoreRationale.`;

const analysisSchema = z.object({
  wellnessScore: z.number().int().min(0).max(100),
  scoreRationale: z.string().min(120),
  ayurveda: z.object({
    dominantDosha: z.enum(["Vata", "Pitta", "Kapha"]),
    doshaBalance: z.object({ vata: z.number().min(0).max(100), pitta: z.number().min(0).max(100), kapha: z.number().min(0).max(100) }),
    constitutionalNote: z.string(),
  }),
  tcm: z.object({
    dominantElement: z.enum(["Wood", "Fire", "Earth", "Metal", "Water"]),
    elementBalance: z.object({ wood: z.number().min(0).max(100), fire: z.number().min(0).max(100), earth: z.number().min(0).max(100), metal: z.number().min(0).max(100), water: z.number().min(0).max(100) }),
    constitutionalNote: z.string(),
  }),
  tonguePatterns: z.array(z.object({ name: z.string(), intensity: z.enum(["Subtle", "Notable", "Prominent"]), observation: z.string() })),
  faceObservations: z.array(z.object({ area: z.string(), observation: z.string(), traditionalContext: z.string() })),
  eyeObservations: z.object({ sclera: z.string().nullable(), conjunctiva: z.string().nullable() }),
  priorityThemes: z.array(z.string()),
  dailyPractices: z.array(z.string()),
  solivanaTherapies: z.array(z.string()),
  nutritionThemes: z.array(z.string()),
});

export type Analysis = z.infer<typeof analysisSchema>;

type ApiResult =
  | { success: true; analysis: Analysis }
  | { success: false; code: "no_api_key" | "validation_failed" | "upstream_timeout" | "upstream_error" | "rate_limited"; message: string }
  | { success: false; code: "needs_signin" | "paywall"; message: string; signedIn: boolean; paymentLinks?: { starter: string; pro: string; unlimited: string; unlimitedAnnual: string }; couponCode?: string };

function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Vision calls on a face+tongue photo can run 30-60s on Sonnet-4-6 — give
// each attempt 60s and one retry, total budget 120s.
const anthropic = new Anthropic({
  apiKey: env.anthropicApiKey || "missing",
  timeout: 60_000,
  maxRetries: 2,
});

const allowedMimes = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMime = typeof allowedMimes[number];

function detectMime(base64: string): AllowedMime | null {
  try {
    const head = Buffer.from(base64.slice(0, 24), "base64");
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
    if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
    return null;
  } catch {
    return null;
  }
}

export const analyzeRouter = createRouter({
  wellness: publicQuery
    .input(z.object({
      imageBase64: z.string().min(64).max(9_500_000),
      scanMode: z.enum(["tongue", "face", "both"]).default("both"),
      deviceId: z.string().min(8).max(64).optional(),
      sessionToken: z.string().optional(),
      // legacy
      unlockToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<ApiResult> => {
      if (!env.anthropicApiKey) {
        return { success: false, code: "no_api_key", message: "Analysis is temporarily unavailable. Please try again later." };
      }

      // ─── Gate ───
      // 1. Signed-in user with credits or unlimited -> allow
      // 2. Anon device with free scan available -> allow
      // 3. Else -> needs_signin (anon) or paywall (signed-in)
      const ip = getClientIp(ctx.req);
      let authorizedAccountEmail: string | null = null;
      // Tracks whether the gated user is consuming from a credit pack
      // (vs unlimited subscription). Used to decide whether to atomically
      // decrement a credit BEFORE the Claude call.
      let onCreditPath = false;
      if (hasDb) {
        const sess = await getSession(input.sessionToken);
        if (sess) {
          const acct = await checkAccountAccess(sess.email);
          if (!acct.allowed) {
            const message = acct.reason === "unlimited_capped"
              ? `You've used all ${acct.monthlyCap} readings on your Unlimited plan this month. Your cap resets on the 1st.`
              : "You're out of readings. Add a pack or go unlimited.";
            return {
              success: false,
              code: "paywall",
              message,
              signedIn: true,
              paymentLinks: { starter: env.stripeLinkStarter, pro: env.stripeLinkPro, unlimited: env.stripeLinkUnlimited, unlimitedAnnual: env.stripeLinkUnlimitedAnnual },
              couponCode: env.stripeCouponRestock,
            };
          }
          authorizedAccountEmail = sess.email;
          onCreditPath = acct.reason === "credit";

          // Atomic credit consumption BEFORE the Claude call. Closes the
          // TOCTOU race where two parallel scans could both pass the gate
          // off a single remaining credit and both call Claude.
          if (onCreditPath) {
            const consumed = await consumeOneCreditAtomic(sess.email);
            if (!consumed) {
              // Race lost — someone else used our last credit between gate
              // and consume. Send them to paywall.
              return {
                success: false,
                code: "paywall",
                message: "You're out of readings. Add a pack or go unlimited.",
                signedIn: true,
                paymentLinks: { starter: env.stripeLinkStarter, pro: env.stripeLinkPro, unlimited: env.stripeLinkUnlimited, unlimitedAnnual: env.stripeLinkUnlimitedAnnual },
                couponCode: env.stripeCouponRestock,
              };
            }
          }
        } else if (input.deviceId) {
          const decision = await checkAccess({ deviceId: input.deviceId, ip, unlockToken: input.unlockToken });
          if (!decision.allowed) {
            return {
              success: false,
              code: "needs_signin",
              message: "You've used your free scan. Create an account to continue.",
              signedIn: false,
            };
          }
        }
      }

      // ─── Claude vision call ───
      const rawBase64 = input.imageBase64.includes(",") ? input.imageBase64.split(",")[1]! : input.imageBase64;
      if (!detectMime(rawBase64)) {
        return { success: false, code: "validation_failed", message: "Image format not supported. Use JPEG, PNG, or WebP." };
      }
      // Resize to ≤1024px WebP — cuts Claude vision token cost ~60-70% on
      // phone uploads. EXIF stripped + orientation honored as a side effect.
      let base64Data: string;
      let mediaType: "image/webp";
      try {
        const resized = await resizeForVision(rawBase64);
        base64Data = resized.data;
        mediaType = resized.mediaType;
      } catch (err) {
        console.error("[analyze.wellness] resize failed:", err);
        return { success: false, code: "validation_failed", message: "We couldn't read this photo. Try a different one." };
      }

      const modePrompt = input.scanMode === "tongue"
        ? "Focus primarily on tongue analysis."
        : input.scanMode === "face"
          ? "Focus primarily on facial and eye analysis."
          : "Analyze tongue, face, and eyes together.";

      const callClaude = (model: string) =>
        claudeLimit(() =>
          anthropic.messages.create({
            model,
            max_tokens: 1800,
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
                { type: "text", text: `${modePrompt}\n\nReturn only the JSON object, no surrounding text.` },
              ],
            }],
          })
        );

      try {
        let response;
        try {
          response = await callClaude(MODEL);
        } catch (primaryErr: unknown) {
          const pe = primaryErr as { status?: number };
          // Sonnet is overloaded — fall back to Haiku 4.5 so the user still
          // gets a reading. Output is shorter but the same JSON shape.
          if (pe?.status === 529 || pe?.status === 503) {
            console.warn("[analyze.wellness] Sonnet overloaded, falling back to Haiku 4.5");
            response = await callClaude(FALLBACK_MODEL);
          } else {
            throw primaryErr;
          }
        }

        const text = response.content
          .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
          .map((c) => c.text)
          .join("");
        const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (!match) return { success: false, code: "validation_failed", message: "We couldn't read the response. Please try a different photo." };
          try { parsed = JSON.parse(match[0]); } catch {
            return { success: false, code: "validation_failed", message: "We couldn't read the response. Please try a different photo." };
          }
        }

        const result = analysisSchema.safeParse(parsed);
        if (!result.success) {
          return { success: false, code: "validation_failed", message: "We couldn't read the response. Please try again." };
        }

        // ─── Record success ───
        // Credit was already atomically consumed BEFORE the Claude call (above).
        // Just record the scan here so it shows up in history + counts toward
        // the monthly Unlimited cap.
        if (hasDb) {
          if (authorizedAccountEmail) {
            await recordAccountScan({
              email: authorizedAccountEmail,
              scanMode: input.scanMode,
              wellnessScore: result.data.wellnessScore,
              summary: result.data.scoreRationale,
              fullAnalysis: result.data,
            }).catch((e) => console.error("[analyze] recordAccountScan failed:", e));
          } else if (input.deviceId) {
            await recordScan({ deviceId: input.deviceId, ip, unlockToken: input.unlockToken }).catch((e) => console.error("[analyze] recordScan failed:", e));
          }
        }

        return { success: true, analysis: result.data };
      } catch (err: unknown) {
        const e = err as { status?: number; name?: string; message?: string };
        // Log every detail so we can diagnose without guessing
        console.error("[analyze.wellness] Claude call failed", { name: e?.name, status: e?.status, message: e?.message });
        if (e?.name === "APIConnectionTimeoutError" || e?.name === "AbortError") {
          return { success: false, code: "upstream_timeout", message: "We're seeing more readings than usual right now. Please try again in a few minutes — your photo is fine." };
        }
        if (e?.status === 429 || e?.status === 529) {
          return { success: false, code: "rate_limited", message: "We're seeing more readings than usual right now. Please try again in a few minutes — your photo is fine." };
        }
        if (e?.status === 400) {
          return { success: false, code: "rate_limited", message: "We're seeing more readings than usual right now. Please try again in a few minutes — your photo is fine." };
        }
        if (e?.status && e.status >= 500) {
          return { success: false, code: "upstream_error", message: "We're seeing more readings than usual right now. Please try again in a few minutes — your photo is fine." };
        }
        return { success: false, code: "upstream_error", message: "We're seeing more readings than usual right now. Please try again in a few minutes — your photo is fine." };
      }
    }),
});
