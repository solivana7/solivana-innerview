import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import type { Analysis } from "../api/analyze";
import { preprocessFile, preprocessDataUrl, base64Bytes, detectFaceAndCrop } from "@/lib/image";
import { getDeviceId, getUnlockToken, setUnlockToken, clearUnlockToken } from "@/lib/device";
import { getSessionToken, setSessionToken, clearSessionToken, withCoupon } from "@/lib/account";
import "./App.css";

type Screen = "showcase" | "tips" | "upload" | "analyzing" | "result" | "therapy" | "about" | "paywall" | "unlock" | "auth" | "account" | "signin" | "admin";
type ScanMode = "tongue" | "face" | "both";

interface PaymentLinks { starter: string; pro: string; unlimited: string }

const SOLIVANA_THERAPIES = [
  { name: "REST Floating Therapy", tagline: "Sensory deprivation",  desc: "1,100 lbs of Epsom salt. Body weightless. Mind silent.", duration: "60 min", url: "https://solivana.com/float-therapy/", benefits: ["Nervous system reset", "Magnesium absorption", "Stress hormone reduction"] },
  { name: "Fire & Ice Contrast Therapy", tagline: "Thermal contrast", desc: "Full-spectrum infrared sauna paired with cold plunge.", duration: "60 min", url: "https://solivana.com/infrared-sauna-cold-plunge/", benefits: ["Circulation", "Inflammation reduction", "Detoxification"] },
  { name: "Halotherapy", tagline: "Respiratory wellness", desc: "Himalayan salt room with pharmaceutical-grade dry salt aerosol.", duration: "60 min", url: "https://solivana.com/halotherapy/", benefits: ["Respiratory health", "Allergy relief", "Immune support"] },
  { name: "PEMF Therapy", tagline: "Cellular charge", desc: "Pulsed electromagnetic fields recharge cellular voltage.", duration: "20 min", url: "https://solivana.com/pemf-therapy/", benefits: ["Cellular energy", "Pain relief", "Circulation"] },
  { name: "EMTT Therapy", tagline: "Deep tissue magnetic", desc: "High-frequency magnetic therapy at 300 kHz reaches deep into joints.", duration: "30 min", url: "https://solivana.com/emtt-2/", benefits: ["Deep tissue repair", "Joint relief", "Tendon healing"] },
  { name: "Red Light Therapy", tagline: "Photobiomodulation", desc: "660nm and 850nm wavelengths for cellular activation.", duration: "20 min", url: "https://solivana.com/red-light-therapy/", benefits: ["Collagen production", "Skin renewal", "Recovery"] },
  { name: "Pressotherapy", tagline: "Lymphatic compression", desc: "Medical-grade compression moves lymph in rhythmic waves.", duration: "60 min", url: "https://solivana.com/pressotherapy/", benefits: ["Lymphatic drainage", "Fluid relief", "Detox"] },
  { name: "Bowenwork", tagline: "Soft tissue reset", desc: "Gentle rolling moves signal the nervous system to release chronic patterns.", duration: "60 min", url: "https://solivana.com/bowenwork/", benefits: ["Nervous system reset", "Tension release", "Whole-body balance"] },
  { name: "Vibration Plate Therapy", tagline: "Whole-body vibration", desc: "Micro-oscillations for lymphatic activation and muscle tone.", duration: "10 min", url: "https://solivana.com/vibrational-therapy/", benefits: ["Lymphatic flow", "Muscle tone", "Balance"] },
  { name: "NeuroVIZR Brain Reset", tagline: "Cognitive reset", desc: "Precision light and sound guides your brain into deep rest or focus.", duration: "20 min", url: "https://solivana.com/neurovizr/", benefits: ["Brain state shift", "Deep relaxation", "Sleep support"] },
  { name: "Biofield Energy Healing", tagline: "Biofield wellness", desc: "Fully clothed energy work for nervous system regulation.", duration: "60 min", url: "https://solivana.com/energy-healing/", benefits: ["Energy balance", "Stress reduction", "Emotional release"] },
];

const BOOKING_URL = "https://solivanaspa.floathelm.com/";

const COMPLIANCE_TEXT = "InnerView is a wellness pattern-observation tool. It is not a medical device, does not diagnose, treat, cure, or prevent any disease, and is not a substitute for licensed medical care. Statements have not been evaluated by the FDA.";

/* ─── ICONS (stroke-current so they inherit text color) ─── */
const I = {
  Sparkle: ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M5 3l.5 1.5L7 5l-1.5.5L5 7l-.5-1.5L3 5l1.5-.5z"/><path d="M19 15l.5 1.5L21 17l-1.5.5L19 19l-.5-1.5L17 17l1.5-.5z"/></svg>,
  Camera:  ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  Image:   ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>,
  Check:   ({ className = "w-4 h-4" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className} aria-hidden><path d="M5 13l4 4L19 7"/></svg>,
  Close:   ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden><path d="M18 6L6 18M6 6l12 12"/></svg>,
  ArrowR:  ({ className = "w-4 h-4" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden><path d="M5 12h14M13 5l7 7-7 7"/></svg>,
  Sun:     ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  Eye:     ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Leaf:    ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89-.66.95 1.24C8.08 19.41 12.37 14.56 17 8z"/><path d="M12.04 4.5C8.5 7.76 6 10.73 6 14c0 1.83.55 3.53 1.5 5h3c-1.5-2-2.5-4.5-2.5-7 0-2.15.9-4.1 2.54-5.5z"/></svg>,
  Lock:    ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  Frame:   ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 15s2-2 5-2 5 2 5 2"/></svg>,
  Mouth:   ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>,
  Plain:   ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>,
  NoFlash: ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
  Alert:   ({ className = "w-5 h-5" }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
};

/* ─── REUSABLE STYLE TOKENS ─── */
const cls = {
  container: "max-w-7xl mx-auto px-6 lg:px-12",
  label: "font-hero text-xs tracking-[0.32em] uppercase text-coffeeText",
  labelAccent: "font-hero text-xs tracking-[0.32em] uppercase text-accent",
  h1: "font-hero font-light text-brown leading-[1.05] tracking-tight",
  h2: "font-heading font-light text-brown leading-[1.15] tracking-tight",
  h3: "font-heading font-medium text-brown",
  body: "font-body text-coffeeText leading-relaxed",
  card: "bg-paper border border-coffee/30 rounded-2xl p-6",
  btnPrimary: "inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-accent text-white font-heading font-medium text-sm tracking-wide hover:bg-accent/90 active:scale-[0.98] transition-all touch-min",
  btnSecondary: "inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-brown/30 text-brown font-heading font-medium text-sm tracking-wide hover:bg-coffeeLight active:scale-[0.98] transition-all touch-min",
  btnGhost: "inline-flex items-center gap-1.5 text-sm font-heading text-accent hover:text-brown transition-colors touch-min",
};

/* ═══════════════════════════════════════════════════════════ */
/*  HEADER + COMPLIANCE BANNER + FOOTER                       */
/* ═══════════════════════════════════════════════════════════ */
function Header({ onAbout, onScan, onSignin, onAccount }: { onAbout: () => void; onScan: () => void; onSignin?: () => void; onAccount?: () => void }) {
  // Live status badge — refetches every 30s. Bypasses query when no session.
  const sessionToken = getSessionToken();
  const status = trpc.access.myStatus.useQuery({ sessionToken }, {
    enabled: Boolean(sessionToken),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const signedIn = status.data?.signedIn === true;
  const credits = signedIn ? status.data.totalCredits : 0;
  const hasUnlimited = signedIn && status.data.hasUnlimited;
  const email = signedIn ? status.data.email : null;

  return (
    <header className="sticky top-0 z-30 bg-soft/85 supports-[backdrop-filter]:bg-soft/85 backdrop-blur-md border-b border-coffee/20">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-brown focus:text-paper focus:px-4 focus:py-2 focus:rounded-lg focus:font-hero focus:text-xs focus:tracking-[0.22em] focus:uppercase">Skip to content</a>
      <nav className={cls.container + " flex items-center justify-between py-4 gap-2"} aria-label="Primary">
        <a href="/" className="flex items-baseline gap-2 touch-min flex-shrink-0">
          <span className="font-hero text-xl text-brown tracking-tight">InnerView</span>
          <span className="font-hero text-[10px] tracking-[0.28em] uppercase text-accent">by SoliVana</span>
        </a>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          {signedIn && (
            <button
              onClick={onAccount}
              aria-label={`Account · ${email}`}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-paper border border-coffee/30 text-xs hover:border-accent/50 transition-colors touch-min"
            >
              <span className="font-heading font-medium text-accent tabular-nums">
                {hasUnlimited ? "∞" : credits}
              </span>
              <span className="text-coffeeText">{hasUnlimited ? "Unlimited" : credits === 1 ? "scan left" : "scans"}</span>
              <span className="text-coffeeText/40">·</span>
              <span className="text-coffeeText truncate max-w-[160px]">{email}</span>
            </button>
          )}
          {signedIn && (
            <button
              onClick={onAccount}
              aria-label="Account"
              className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-paper border border-coffee/30 text-xs touch-min"
            >
              <span className="font-heading font-medium text-accent tabular-nums">{hasUnlimited ? "∞" : credits}</span>
            </button>
          )}
          {!signedIn && onSignin && (
            <button onClick={onSignin} className="font-hero text-xs tracking-[0.22em] uppercase text-coffeeText hover:text-brown transition-colors touch-min px-3">Sign in</button>
          )}
          <button onClick={onAbout} className="font-hero text-xs tracking-[0.22em] uppercase text-coffeeText hover:text-brown transition-colors touch-min px-3 hidden sm:inline">Science</button>
          <button onClick={onScan} className={cls.btnPrimary + " !px-5 !py-2.5 text-xs"}>Begin Scan</button>
        </div>
      </nav>
    </header>
  );
}

function ComplianceBanner() {
  return (
    <div className="bg-coffeeLight border-b border-coffee/30" role="region" aria-label="Important wellness disclaimer">
      <div className={cls.container + " py-2.5 flex items-start gap-2 text-xs text-brown"}>
        <I.Alert className="w-4 h-4 mt-0.5 text-accent flex-shrink-0" />
        <p className="font-body">{COMPLIANCE_TEXT}</p>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="bg-paper border-t border-coffee/20 mt-16">
      <div className={cls.container + " py-10"}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="font-hero text-lg text-brown tracking-tight">InnerView <span className="text-accent text-xs tracking-[0.3em] uppercase ml-2">by SoliVana</span></p>
            <p className={cls.body + " text-sm mt-2"}>Wellness pattern observation through Ayurveda and Traditional Chinese Medicine.</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
            {[
              { label: "SoliVana", href: "https://solivana.com" },
              { label: "Privacy", href: "https://tools.solivana.io/privacy" },
              { label: "Terms", href: "https://tools.solivana.io/terms" },
              { label: "Refund", href: "https://tools.solivana.io/refund" },
              { label: "AI Disclosure", href: "https://tools.solivana.io/privacy#ai" },
            ].map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="font-hero text-xs tracking-[0.22em] uppercase text-brown hover:text-accent transition-colors">{l.label}</a>
            ))}
            <a href="mailto:info@solivana.com" className="font-hero text-xs tracking-[0.22em] uppercase text-brown hover:text-accent transition-colors">Support</a>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-coffee/20">
          <p className={cls.body + " text-xs"}>{COMPLIANCE_TEXT}</p>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  SHOWCASE / LANDING                                        */
/* ═══════════════════════════════════════════════════════════ */
function Showcase({ onScan, onAbout, onSignin, onAccount }: { onScan: () => void; onAbout: () => void; onSignin: () => void; onAccount: () => void }) {
  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout} onScan={onScan} onSignin={onSignin} onAccount={onAccount} />
      <ComplianceBanner />

      <main id="main" tabIndex={-1}>
        {/* HERO */}
        <section className={cls.container + " py-16 lg:py-28"}>
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
            <div className="lg:col-span-7">
              <p className={cls.labelAccent + " mb-4"}>Wellness Pattern Observation</p>
              <h1 className={cls.h1 + " text-5xl sm:text-6xl lg:text-7xl mb-6"}>
                Two ancient lenses.<br />
                <span className="text-accent">One quiet observation.</span>
              </h1>
              <p className="font-body text-lg lg:text-xl text-coffeeText leading-relaxed max-w-2xl mb-8">
                A photo of your face and tongue, read through Ayurveda and Traditional Chinese Medicine.
                You receive observations, not a diagnosis — patterns to notice and gentle practices to explore.
              </p>
              <div className="inline-flex items-center gap-2 mb-5 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/30 text-xs font-hero tracking-[0.22em] uppercase text-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden /> First reading is on us
              </div>
              <div className="flex flex-wrap gap-3 mb-6">
                <button onClick={onScan} className={cls.btnPrimary + " text-base !px-8 !py-4"}>
                  <I.Sparkle /> Begin Your Scan
                </button>
                <button onClick={onAbout} className={cls.btnSecondary + " text-base !px-8 !py-4"}>
                  How It Works
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mb-5">
                <div className="rounded-2xl border border-coffee/30 bg-paper px-5 py-4">
                  <p className="font-heading text-2xl text-brown leading-none">Free</p>
                  <p className="font-hero text-[11px] tracking-[0.22em] uppercase text-coffeeText mt-2">1 reading</p>
                  <p className="text-xs text-brown/70 mt-1">One per device, on us.</p>
                </div>
                <div className="rounded-2xl border border-coffee/30 bg-paper px-5 py-4">
                  <p className="font-heading text-2xl text-brown leading-none">$9.99</p>
                  <p className="font-hero text-[11px] tracking-[0.22em] uppercase text-coffeeText mt-2">5 readings</p>
                  <p className="text-xs text-brown/70 mt-1">One-time. Never expires.</p>
                </div>
                <div className="rounded-2xl border-2 border-accent/60 bg-accent/8 px-5 py-4 relative">
                  <span className="absolute -top-2 right-4 font-hero text-[9px] tracking-[0.22em] uppercase text-paper bg-accent px-2 py-0.5 rounded-full">Most loved</span>
                  <p className="font-heading text-2xl text-brown leading-none">$19.99<span className="text-sm text-coffeeText font-body">/mo</span></p>
                  <p className="font-hero text-[11px] tracking-[0.22em] uppercase text-accent mt-2">Unlimited</p>
                  <p className="text-xs text-brown/70 mt-1">Or $199/yr · 2 months free.</p>
                </div>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-hero tracking-[0.22em] uppercase text-brown">
                <li className="flex items-center gap-2"><span aria-hidden className="w-1 h-1 rounded-full bg-accent" />Cancel or pause anytime</li>
                <li className="flex items-center gap-2"><span aria-hidden className="w-1 h-1 rounded-full bg-accent" />Photo not stored</li>
                <li className="flex items-center gap-2"><span aria-hidden className="w-1 h-1 rounded-full bg-accent" />No sign-up to start</li>
              </ul>
            </div>

            <aside className="lg:col-span-5">
              <div className="bg-paper border border-coffee/30 rounded-3xl p-8 lg:p-10">
                <p className={cls.labelAccent + " mb-3"}>What You'll Receive</p>
                <ul className="space-y-4">
                  {[
                    { k: "Ayurveda dosha balance", v: "Vata · Pitta · Kapha" },
                    { k: "TCM five-element reading", v: "Wood · Fire · Earth · Metal · Water" },
                    { k: "Tongue body observations", v: "Color · coating · shape" },
                    { k: "Facial zone notes", v: "Forehead · cheeks · under eyes" },
                    { k: "Daily wellness practices", v: "Food · movement · breath · rest" },
                    { k: "Therapy suggestions", v: "Drawn from SoliVana's modalities" },
                  ].map((it) => (
                    <li key={it.k} className="flex items-start gap-3">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" aria-hidden />
                      <div>
                        <p className="font-heading font-medium text-brown">{it.k}</p>
                        <p className="text-sm text-coffeeText">{it.v}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </section>

        {/* TWO-FRAMEWORK EXPLAINER */}
        <section className="bg-paper border-y border-coffee/20">
          <div className={cls.container + " py-20"}>
            <p className={cls.labelAccent + " mb-3"}>Two Lenses, One Reading</p>
            <h2 className={cls.h2 + " text-4xl lg:text-5xl mb-4 max-w-3xl"}>
              Ayurveda asks <em className="text-accent not-italic">who you are.</em><br />
              TCM asks <em className="text-accent not-italic">what's moving today.</em>
            </h2>
            <p className="font-body text-lg text-coffeeText max-w-3xl mb-12">Both have read faces and tongues for thousands of years. InnerView reads the same signals — through both lenses — and gives you the cross-section.</p>

            <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
              <article className="bg-soft border border-coffee/30 rounded-2xl p-8">
                <p className={cls.labelAccent + " mb-3"}>Ayurveda · 5,000 years</p>
                <h3 className="font-heading text-2xl text-brown mb-3">Three doshas</h3>
                <p className={cls.body + " mb-5"}>The original constitutional framework. Vata governs movement, Pitta transformation, Kapha structure. Your photo helps identify your dominant pattern.</p>
                <ul className="space-y-2 text-sm text-coffeeText">
                  <li><strong className="text-brown">Vata</strong> — air & ether. Quick, light, creative.</li>
                  <li><strong className="text-brown">Pitta</strong> — fire & water. Focused, sharp, warm.</li>
                  <li><strong className="text-brown">Kapha</strong> — earth & water. Steady, grounded, calm.</li>
                </ul>
              </article>

              <article className="bg-soft border border-coffee/30 rounded-2xl p-8">
                <p className={cls.labelAccent + " mb-3"}>TCM · 2,500 years</p>
                <h3 className="font-heading text-2xl text-brown mb-3">Five elements</h3>
                <p className={cls.body + " mb-5"}>Tongue and face zones map to organ systems. The dominant element shifts with season, stress, and the moment. We read the snapshot.</p>
                <ul className="space-y-2 text-sm text-coffeeText">
                  <li><strong className="text-brown">Wood</strong> — Liver, Gallbladder. Vision, plans.</li>
                  <li><strong className="text-brown">Fire</strong> — Heart, Small Intestine. Joy, circulation.</li>
                  <li><strong className="text-brown">Earth</strong> — Spleen, Stomach. Digestion, worry.</li>
                  <li><strong className="text-brown">Metal</strong> — Lung, Large Intestine. Breath, grief.</li>
                  <li><strong className="text-brown">Water</strong> — Kidney, Bladder. Will, fear.</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS — 3 steps */}
        <section className={cls.container + " py-20"}>
          <p className={cls.labelAccent + " mb-3"}>How It Works</p>
          <h2 className={cls.h2 + " text-4xl lg:text-5xl mb-12 max-w-3xl"}>Three quiet steps.</h2>
          <ol className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {[
              { n: "01", title: "Capture", desc: "Take a clear photo of your face and tongue in natural light. Phone camera is enough." },
              { n: "02", title: "Observe", desc: "Your image is read through Ayurveda and TCM frameworks in roughly twenty seconds." },
              { n: "03", title: "Receive", desc: "A two-lens reading with daily practices and therapy directions you can explore at your pace." },
            ].map((s) => (
              <li key={s.n} className="bg-paper border border-coffee/30 rounded-2xl p-8">
                <p className="font-hero text-5xl text-accent/40 leading-none mb-4">{s.n}</p>
                <h3 className="font-heading text-xl text-brown mb-2">{s.title}</h3>
                <p className={cls.body}>{s.desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* CLOSING CTA — single, no duplicate */}
        <section className="bg-paper border-y border-coffee/20">
          <div className={cls.container + " py-20 text-center"}>
            <p className={cls.labelAccent + " mb-3"}>When You're Ready</p>
            <h2 className={cls.h2 + " text-4xl lg:text-5xl mb-6"}>
              From observation<br />
              <span className="text-accent">to gentle action.</span>
            </h2>
            <p className="font-body text-lg text-coffeeText max-w-xl mx-auto mb-8">InnerView shows you patterns. SoliVana offers the room, the therapies, and the time to work with them.</p>
            <button onClick={onScan} className={cls.btnPrimary + " text-base !px-8 !py-4"}>
              <I.Sparkle /> Begin Your Scan
            </button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  PHOTO TIPS                                                */
/* ═══════════════════════════════════════════════════════════ */
function PhotoTipsScreen({ onContinue, onClose, onAbout }: { onContinue: () => void; onClose: () => void; onAbout?: () => void }) {
  const tips = [
    { icon: <I.Sun />,     title: "Natural light",          desc: "Face a window or step outside. Avoid hard shadows or strong overhead light." },
    { icon: <I.Camera />,  title: "Arm's length",           desc: "Hold the phone at eye level, around an arm's length away." },
    { icon: <I.Frame />,   title: "Face forward, eyes open", desc: "Look straight at the lens with a neutral expression." },
    { icon: <I.Mouth />,   title: "Tongue slightly out",    desc: "Relax your tongue past your lips so the body and coating are visible." },
    { icon: <I.NoFlash />, title: "No filters or flash",    desc: "Turn off beauty filters and flash. We need your true skin tone." },
    { icon: <I.Plain />,   title: "Plain background",       desc: "A solid wall is best. Avoid busy patterns behind your face." },
  ];
  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={onContinue} />
      <ComplianceBanner />
      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-20"}>
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className={cls.labelAccent}>Before You Scan</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2"}>How to take a great photo.</h1>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>
        <p className="font-body text-lg text-coffeeText mb-10 max-w-2xl">A clearer photo means a more useful reading. Six quick guidelines.</p>

        <div className="grid md:grid-cols-5 gap-6 items-center mb-10 bg-paper border border-coffee/30 rounded-2xl p-5 lg:p-6">
          <div className="md:col-span-2 rounded-xl overflow-hidden bg-brown">
            <img src="/face-zones.jpg" alt="Face wireframe with cheeks, jaw, and tongue zones highlighted — reference for what InnerView observes" className="w-full aspect-square object-cover block" />
          </div>
          <div className="md:col-span-3">
            <p className={cls.labelAccent + " mb-2"}>Where we look</p>
            <p className={cls.body + " text-sm mb-3"}>
              We read your face in zones — cheeks, jaw, forehead, between the brows, under the eyes — and your
              tongue in four regions (tip, sides, center, root). Each zone carries its own meaning in the
              traditions we use.
            </p>
            <p className={cls.body + " text-sm"}>
              Center your face, hold the phone at eye level, and frame from collarbone to crown. The wider zones
              (cheeks, jaw) tell us the most when they're well-lit and not in shadow.
            </p>
          </div>
        </div>

        <ol className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {tips.map((t, i) => (
            <li key={i} className="bg-paper border border-coffee/30 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">{t.icon}</div>
                <div>
                  <h2 className="font-heading font-medium text-brown mb-1">{t.title}</h2>
                  <p className={cls.body + " text-sm"}>{t.desc}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-3">
          <button onClick={onContinue} className={cls.btnPrimary + " text-base !px-8 !py-4"}>
            <I.Camera /> I'm ready
          </button>
          <button onClick={onClose} className={cls.btnSecondary + " text-base !px-8 !py-4"}>Back</button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  CONSENT GATE + UPLOAD                                     */
/* ═══════════════════════════════════════════════════════════ */
function UploadScreen({ onImageSelected, onClose, onAbout }: { onImageSelected: (img: string, mode: ScanMode) => void; onClose: () => void; onAbout?: () => void }) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("both");
  const [showWebcam, setShowWebcam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentAi, setConsentAi] = useState(false);
  const [consentBio, setConsentBio] = useState(false);
  const [consentAge, setConsentAge] = useState(false);
  const isMobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const allConsented = consentAi && consentBio && consentAge;

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    if (!/^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.type)) {
      setError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("Image is huge. Try a smaller photo (under 25MB).");
      return;
    }
    try {
      // First pass: resize + recompress to a workable size
      const resized = await preprocessFile(file, { maxLongEdge: 1600, quality: 0.92 });
      // Second pass: face-detect + crop (or center-crop fallback). Final
      // output capped at 1280px / q85 — Claude has plenty to read but the
      // payload stays small.
      const { dataUrl } = await detectFaceAndCrop(resized, { maxLongEdge: 1280, quality: 0.85 });
      setPreview(dataUrl);
    } catch (e) {
      setError("We couldn't read that file. Please try another.");
    }
  }, []);

  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={() => {}} />
      <ComplianceBanner />
      {showWebcam && <WebcamCapture onCapture={(img) => { setPreview(img); setShowWebcam(false); }} onClose={() => setShowWebcam(false)} />}

      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} className="hidden" />
      <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} className="hidden" />

      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-16"}>
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className={cls.labelAccent}>Your Photo</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2"}>Capture or upload.</h1>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Left: preview + capture */}
          <div className="lg:col-span-7">
            <div className="bg-paper border border-coffee/30 rounded-2xl overflow-hidden mb-5">
              {preview ? (
                <img src={preview} alt="Your selected photo preview" className="w-full aspect-[4/3] object-cover" />
              ) : (
                <div className="w-full aspect-[4/3] flex flex-col items-center justify-center text-coffeeText p-8">
                  <div className="w-16 h-16 rounded-full bg-coffeeLight flex items-center justify-center mb-3"><I.Camera className="w-7 h-7 text-accent" /></div>
                  <p className="font-heading text-base">No photo selected yet</p>
                  <p className="text-sm mt-1">Use the camera or pick from your gallery</p>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 bg-destructive/5 border border-destructive/30 text-destructive rounded-xl p-3 mb-5">
                <I.Alert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-body">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-6">
              <button onClick={() => isMobile ? cameraRef.current?.click() : setShowWebcam(true)} className={cls.btnSecondary + " w-full !py-5 flex-col gap-2"}>
                <I.Camera className="w-6 h-6" />
                <span>Use camera</span>
              </button>
              <button onClick={() => galleryRef.current?.click()} className={cls.btnSecondary + " w-full !py-5 flex-col gap-2"}>
                <I.Image className="w-6 h-6" />
                <span>From gallery</span>
              </button>
            </div>
          </div>

          {/* Right: scan mode + consent + analyze */}
          <div className="lg:col-span-5">
            <fieldset className="mb-8">
              <legend className={cls.labelAccent + " mb-3"}>What to read</legend>
              <div
                role="radiogroup"
                aria-label="What to read"
                className="grid grid-cols-3 gap-2"
                onKeyDown={(e) => {
                  const opts: ScanMode[] = ["tongue", "face", "both"];
                  const idx = opts.indexOf(scanMode);
                  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setScanMode(opts[(idx + 1) % opts.length]!); }
                  if (e.key === "ArrowLeft" || e.key === "ArrowUp")    { e.preventDefault(); setScanMode(opts[(idx - 1 + opts.length) % opts.length]!); }
                }}
              >
                {(["tongue", "face", "both"] as ScanMode[]).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={scanMode === m} tabIndex={scanMode === m ? 0 : -1} onClick={() => setScanMode(m)} className={`py-3 rounded-xl font-heading font-medium text-sm transition-all border ${scanMode === m ? "bg-accent border-accent text-white" : "bg-paper border-coffee/30 text-brown hover:bg-coffeeLight"}`}>
                    {m === "tongue" ? "Tongue" : m === "face" ? "Face" : "Both"}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="bg-paper border border-coffee/30 rounded-2xl p-5 mb-6">
              <legend className={cls.labelAccent + " px-2"}>Consent</legend>
              {[
                { id: "ai",  v: consentAi,  set: setConsentAi,  label: "I understand my photo will be sent to SoliVana's AI vision system for analysis. Results are AI-generated and may contain errors." },
                { id: "bio", v: consentBio, set: setConsentBio, label: "I consent to the processing of my facial photograph as biometric data. I will not include identifiable other people in my photo." },
                { id: "age", v: consentAge, set: setConsentAge, label: "I am 18 years of age or older." },
              ].map((c) => (
                <label key={c.id} className="flex items-start gap-3 mb-3 last:mb-0 cursor-pointer">
                  <input type="checkbox" checked={c.v} onChange={(e) => c.set(e.target.checked)} className="mt-1 w-4 h-4 accent-accent flex-shrink-0" />
                  <span className="text-sm font-body text-coffeeText">{c.label}</span>
                </label>
              ))}
            </fieldset>

            <button
              onClick={() => preview && allConsented && onImageSelected(preview, scanMode)}
              disabled={!preview || !allConsented}
              className={cls.btnPrimary + " w-full text-base !py-4 disabled:opacity-60 disabled:cursor-not-allowed"}
            >
              <I.Sparkle /> Analyze <I.ArrowR />
            </button>

            <div className="flex items-start gap-2 mt-4">
              <I.Lock className="w-4 h-4 text-coffeeText mt-0.5 flex-shrink-0" />
              <p className="text-xs text-brown font-body">Your photo is sent to SoliVana's AI vision system for analysis only. It isn't retained by default and isn't stored on our servers.</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  WEBCAM CAPTURE (desktop)                                   */
/* ═══════════════════════════════════════════════════════════ */
function WebcamCapture({ onCapture, onClose }: { onCapture: (img: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("Your browser doesn't support camera capture. Please upload a photo instead.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } } })
      .then((s) => { streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch((e: DOMException) => {
        if (e.name === "NotAllowedError") setErr("Camera permission was declined. Enable camera access in your browser settings or upload a photo instead.");
        else if (e.name === "NotFoundError") setErr("No camera was found on this device. Upload a photo instead.");
        else setErr("Camera couldn't start. Please upload a photo instead.");
      });
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, []);

  const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  const capture = async () => {
    if (!videoRef.current) return;
    const c = document.createElement("canvas");
    c.width = videoRef.current.videoWidth;
    c.height = videoRef.current.videoHeight;
    c.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    stop();
    const raw = c.toDataURL("image/jpeg", 0.95);
    // Face-detect crop on webcam captures too — webcam frames often have
    // wide framing that confuses Claude.
    const { dataUrl } = await detectFaceAndCrop(raw, { maxLongEdge: 1280, quality: 0.85 });
    onCapture(dataUrl);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Camera capture" className="fixed inset-0 z-50 bg-brown/95 flex flex-col">
      <div className="flex items-center justify-between p-5">
        <span className="font-heading text-paper">Take your photo</span>
        <button onClick={() => { stop(); onClose(); }} aria-label="Close camera" className="text-paper hover:text-accent touch-min p-2"><I.Close className="w-6 h-6" /></button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {err ? (
          <div className="text-center max-w-md">
            <div className="w-12 h-12 rounded-full bg-paper/10 mx-auto mb-4 flex items-center justify-center text-accent"><I.Alert className="w-6 h-6" /></div>
            <p className="font-body text-paper mb-6">{err}</p>
            <button onClick={() => { stop(); onClose(); }} className={cls.btnPrimary}>Go back</button>
          </div>
        ) : (
          <>
            <div className="relative w-full max-w-2xl aspect-[4/3] rounded-2xl overflow-hidden bg-black mb-8">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            <button onClick={capture} aria-label="Capture photo" className="w-20 h-20 rounded-full border-4 border-paper/80 bg-accent flex items-center justify-center active:scale-95 transition-transform">
              <I.Camera className="w-8 h-8 text-paper" />
            </button>
            <p className="text-paper/60 text-xs font-hero tracking-[0.3em] uppercase mt-4">Tap to capture</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ANALYZING SCREEN                                          */
/* ═══════════════════════════════════════════════════════════ */
type ApiResponse =
  | { success: true; analysis: Analysis }
  | { success: false; code: string; message: string; paymentLinks?: PaymentLinks };

function AnalyzingScreen({ image, scanMode, onComplete, onPaywall, onError, onRetry, onAbout }: {
  image: string;
  scanMode: ScanMode;
  onComplete: (r: Analysis) => void;
  onPaywall: (links: PaymentLinks) => void;
  onError: (msg: string, code: string) => void;
  onRetry: () => void;
  onAbout?: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [hasError, setHasError] = useState<{ msg: string; code: string } | null>(null);
  const completedRef = useRef(false);

  const steps = [
    { name: "Tongue body & coating",    desc: "Color · coating · shape · moisture" },
    { name: "Facial zones",             desc: "Complexion · cheeks · forehead · jaw" },
    { name: "Eye observations",         desc: "Sclera · conjunctiva" },
    { name: "Ayurveda dosha pattern",   desc: "Vata · Pitta · Kapha balance" },
    { name: "TCM five-element pattern", desc: "Wood · Fire · Earth · Metal · Water" },
    { name: "Drafting your reading",    desc: "Cross-referencing both lenses" },
  ];

  const mutation = trpc.analyze.wellness.useMutation({
    onSuccess: (data: ApiResponse) => {
      if (data.success) {
        completedRef.current = true;
        setProgress(100);
        setTimeout(() => onComplete(data.analysis), 500);
      } else if (data.code === "paywall" && data.paymentLinks) {
        onPaywall(data.paymentLinks);
      } else {
        setHasError({ msg: data.message, code: data.code });
        onError(data.message, data.code);
      }
    },
    onError: (err) => {
      const msg = err.message || "Connection error. Please try again.";
      setHasError({ msg, code: "network_error" });
      onError(msg, "network_error");
    },
  });

  useEffect(() => {
    // Animate progress smoothly. Cap at 96% until the mutation actually
    // returns (then jump to 100). Pace is non-linear: fast to ~70%, then
    // slow as we approach the cap so the bar feels honest if Claude is
    // taking longer than typical.
    const start = Date.now();
    const interval = setInterval(() => {
      if (completedRef.current) { clearInterval(interval); return; }
      const elapsed = Date.now() - start;
      // Aim for ~70% in first 12s, ~96% by 60s, asymptote thereafter.
      const t = elapsed / 1000;
      const pct = Math.min(96, Math.round(96 * (1 - Math.exp(-t / 18))));
      setProgress(pct);
    }, 150);
    mutation.mutate({
      imageBase64: image,
      scanMode,
      deviceId: getDeviceId(),
      sessionToken: getSessionToken(),
      unlockToken: getUnlockToken(),
    });
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, scanMode]);

  if (hasError) {
    return (
      <div className="min-h-screen bg-soft flex items-center justify-center px-6">
        <div className="bg-paper border border-coffee/30 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 mx-auto mb-4 flex items-center justify-center text-destructive"><I.Alert className="w-6 h-6" /></div>
          <h2 className="font-heading text-xl text-brown mb-2">We couldn't complete your reading</h2>
          <p className={cls.body + " mb-6"}>{hasError.msg}</p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button onClick={onRetry} className={cls.btnPrimary}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  const stepIndex = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));

  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={() => {}} />
      <main id="main" tabIndex={-1} className={cls.container + " py-8 lg:py-12"}>
        <div className="max-w-2xl mx-auto" role="status" aria-live="polite" aria-label={`Reading ${progress}% complete`}>
          {/* Photo with % overlay + progress bar */}
          <div className="relative aspect-[3/4] rounded-3xl overflow-hidden border-2 border-accent/40 mb-8 shadow-lg max-w-sm mx-auto bg-coffeeLight">
            <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="zone-overlay" aria-hidden="true"><div className="zone-fore" /></div>
            <div className="absolute inset-0 bg-gradient-to-t from-brown/85 via-brown/15 to-brown/10" />
            <div className="absolute inset-x-0 bottom-0 px-8 pb-7">
              <p className="font-hero text-7xl lg:text-8xl text-paper text-center mb-4 tabular-nums leading-none" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.5)" }}>
                {progress}<span className="text-4xl lg:text-5xl">%</span>
              </p>
              <div className="h-[3px] bg-paper/25 rounded-full overflow-hidden">
                <div className="h-full bg-accent transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          {/* Step checklist */}
          <ul className="space-y-3 max-w-md mx-auto">
            {steps.map((s, i) => {
              const done = i < stepIndex || progress === 100;
              const active = i === stepIndex && progress < 100;
              return (
                <li key={s.name} className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-heading font-medium transition-all duration-300 ${
                    done
                      ? "bg-green-100 text-green-700 ring-1 ring-green-200"
                      : active
                        ? "bg-accent text-paper ring-2 ring-accent/30"
                        : "bg-coffeeLight text-coffeeText/40"
                  }`}>
                    {done ? <I.Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <div className={`flex-1 transition-opacity duration-300 ${done || active ? "" : "opacity-40"}`}>
                    <p className={`font-heading font-medium ${active ? "text-brown" : "text-brown/80"}`}>{s.name}</p>
                    <p className="text-sm text-coffeeText">{s.desc}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-center text-xs font-hero tracking-[0.22em] uppercase text-coffeeText mt-8">
            Up to 2 minutes for the full reading
          </p>
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  RESULT SCREEN — Ayurveda + TCM dual                       */
/* ═══════════════════════════════════════════════════════════ */
function BalanceBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm font-heading text-brown">{label}</span>
        <span className="text-sm text-coffeeText tabular-nums">{value}</span>
      </div>
      <div className="h-2 bg-coffeeLight rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function ResultScreen({ result, image, onViewTherapies, onClose, onNewScan, onAccount, onAbout, onUpsell }: {
  result: Analysis;
  image: string;
  onViewTherapies: () => void;
  onClose: () => void;
  onNewScan: () => void;
  onAccount?: () => void;
  onAbout?: () => void;
  onUpsell?: () => void;
}) {
  const r = result;

  // Trigger low-credit nudge if we're at 1 scan left for the signed-in user
  const sessionToken = getSessionToken();
  const status = trpc.access.myStatus.useQuery({ sessionToken }, { enabled: Boolean(sessionToken) });
  const showNudge = status.data?.signedIn && !status.data.hasUnlimited && status.data.totalCredits === 1;

  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={onNewScan} onAccount={onAccount} />
      {showNudge && onUpsell && (
        <div className="bg-accent/10 border-b border-accent/30">
          <div className={cls.container + " py-3 flex flex-col sm:flex-row items-center gap-3 justify-between"}>
            <p className={cls.body + " text-sm"}>
              <strong className="text-brown">1 scan left.</strong> Top up now and save <strong className="text-accent">10%</strong> — or go unlimited for $19.99/mo.
            </p>
            <button onClick={onUpsell} className={cls.btnPrimary + " !py-2 !px-5 text-xs"}>See options <I.ArrowR /></button>
          </div>
        </div>
      )}
      <ComplianceBanner />

      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-16"}>
        {/* Top: header + photo + score */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <p className={cls.labelAccent}>Your Reading</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2"}>What we observed.</h1>
          </div>
          <button onClick={onClose} aria-label="Close reading" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>

        <div className="grid lg:grid-cols-12 gap-8 mb-12">
          <div className="lg:col-span-4">
            <div className="bg-paper border border-coffee/30 rounded-2xl overflow-hidden">
              <img src={image} alt="Your wellness scan" className="w-full aspect-[3/4] object-cover" />
            </div>
          </div>
          <div className="lg:col-span-8 flex flex-col gap-6">
            <div className="bg-paper border border-coffee/30 rounded-2xl p-7">
              <p className="font-hero text-[11px] tracking-[0.22em] uppercase text-accent mb-3">AI-generated · Observation, not diagnosis</p>
              <div className="flex items-baseline gap-3 mb-5">
                <span className="font-hero text-6xl text-accent leading-none">{r.wellnessScore}</span>
                <span className="text-sm text-brown">/ 100 wellness pattern score</span>
              </div>
              <div className={cls.body + " text-base space-y-4"}>
                {r.scoreRationale.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para.trim()}</p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* THEMES TO NOTICE — second position, right after the overview */}
        {r.priorityThemes.length > 0 && (
          <section className="mb-12">
            <p className={cls.labelAccent + " mb-3"}>Themes to Notice</p>
            <h2 className={cls.h2 + " text-2xl lg:text-3xl mb-5"}>Where to focus your attention.</h2>
            <ul className="grid md:grid-cols-3 gap-4">
              {r.priorityThemes.map((t, i) => (
                <li key={i} className="bg-paper border border-coffee/30 rounded-2xl p-5">
                  <span className="font-hero text-3xl text-accent/40 leading-none">{String(i + 1).padStart(2, "0")}</span>
                  <p className={cls.body + " text-sm mt-3"}>{t}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Tongue patterns */}
        {r.tonguePatterns.length > 0 && (
          <section className="mb-10">
            <p className={cls.labelAccent + " mb-3"}>Tongue Observations</p>
            <h2 className={cls.h2 + " text-2xl mb-5"}>What your tongue is showing.</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {r.tonguePatterns.map((p, i) => (
                <div key={i} className="bg-paper border border-coffee/30 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-heading font-medium text-brown">{p.name}</h3>
                    <span className={`text-xs font-hero tracking-wider uppercase px-2.5 py-1 rounded-full flex-shrink-0 ${p.intensity === "Prominent" ? "bg-accent/15 text-accent" : p.intensity === "Notable" ? "bg-coffeeLight text-brown" : "bg-coffeeLight text-coffeeText"}`}>{p.intensity}</span>
                  </div>
                  <p className={cls.body + " text-sm"}>{p.observation}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Face zones */}
        {r.faceObservations.length > 0 && (
          <section className="mb-10">
            <p className={cls.labelAccent + " mb-3"}>Facial Zone Notes</p>
            <h2 className={cls.h2 + " text-2xl mb-5"}>What your face is showing.</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {r.faceObservations.map((o, i) => (
                <div key={i} className="bg-paper border border-coffee/30 rounded-2xl p-5">
                  <h3 className="font-heading font-medium text-brown capitalize mb-1">{o.area.replace(/([A-Z])/g, " $1")}</h3>
                  <p className={cls.body + " text-sm mb-2"}>{o.observation}</p>
                  <p className="text-xs text-accent font-hero tracking-wider">{o.traditionalContext}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Eyes (if observed) */}
        {(r.eyeObservations.sclera || r.eyeObservations.conjunctiva) && (
          <section className="mb-10">
            <p className={cls.labelAccent + " mb-3"}>Eye Observations</p>
            <div className="bg-paper border border-coffee/30 rounded-2xl p-6 grid md:grid-cols-2 gap-4">
              {r.eyeObservations.sclera && (
                <div>
                  <h3 className="font-heading font-medium text-brown mb-1">Sclera</h3>
                  <p className={cls.body + " text-sm"}>{r.eyeObservations.sclera}</p>
                </div>
              )}
              {r.eyeObservations.conjunctiva && (
                <div>
                  <h3 className="font-heading font-medium text-brown mb-1">Conjunctiva</h3>
                  <p className={cls.body + " text-sm"}>{r.eyeObservations.conjunctiva}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Two-lens reading — moved below the area observations so the
            health findings lead and the framework breakdown supports them */}
        <section className="mb-12">
          <p className={cls.labelAccent + " mb-3"}>Through Two Traditional Lenses</p>
          <h2 className={cls.h2 + " text-2xl mb-5"}>Constitutional patterns.</h2>
          <div className="grid lg:grid-cols-2 gap-6">
            <article className="bg-paper border border-coffee/30 rounded-2xl p-7">
              <p className={cls.labelAccent + " mb-3"}>Ayurveda Lens</p>
              <h3 className="font-heading text-2xl text-brown mb-1">Dominant: <span className="text-accent">{r.ayurveda.dominantDosha}</span></h3>
              <p className={cls.body + " mb-5 text-sm"}>{r.ayurveda.constitutionalNote}</p>
              <div className="space-y-3">
                <BalanceBar label="Vata" value={r.ayurveda.doshaBalance.vata} />
                <BalanceBar label="Pitta" value={r.ayurveda.doshaBalance.pitta} />
                <BalanceBar label="Kapha" value={r.ayurveda.doshaBalance.kapha} />
              </div>
            </article>
            <article className="bg-paper border border-coffee/30 rounded-2xl p-7">
              <p className={cls.labelAccent + " mb-3"}>TCM Lens</p>
              <h3 className="font-heading text-2xl text-brown mb-1">Dominant: <span className="text-accent">{r.tcm.dominantElement}</span></h3>
              <p className={cls.body + " mb-5 text-sm"}>{r.tcm.constitutionalNote}</p>
              <div className="space-y-3">
                <BalanceBar label="Wood" value={r.tcm.elementBalance.wood} />
                <BalanceBar label="Fire" value={r.tcm.elementBalance.fire} />
                <BalanceBar label="Earth" value={r.tcm.elementBalance.earth} />
                <BalanceBar label="Metal" value={r.tcm.elementBalance.metal} />
                <BalanceBar label="Water" value={r.tcm.elementBalance.water} />
              </div>
            </article>
          </div>
        </section>

        {/* Daily practices */}
        {r.dailyPractices.length > 0 && (
          <section className="mb-10">
            <p className={cls.labelAccent + " mb-3"}>Daily Practices to Explore</p>
            <h2 className={cls.h2 + " text-2xl mb-5"}>Small, gentle, every day.</h2>
            <ol className="bg-paper border border-coffee/30 rounded-2xl p-6 grid md:grid-cols-2 gap-x-8 gap-y-4">
              {r.dailyPractices.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-hero text-coffeeText flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className={cls.body + " text-sm"}>{p}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Nutrition themes */}
        {r.nutritionThemes.length > 0 && (
          <section className="mb-10">
            <p className={cls.labelAccent + " mb-3"}>Food Direction</p>
            <p className="text-xs text-brown mb-4 italic">General themes only. Talk with a qualified practitioner about specific foods or supplements.</p>
            <ul className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              {r.nutritionThemes.map((n, i) => (
                <li key={i} className="bg-paper border border-coffee/30 rounded-2xl p-4">
                  <p className={cls.body + " text-sm"}>{n}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Therapy recommendations */}
        {r.solivanaTherapies.length > 0 && (
          <section className="mb-12">
            <p className={cls.labelAccent + " mb-3"}>Suggested SoliVana Therapies</p>
            <h2 className={cls.h2 + " text-2xl mb-5"}>Where to take this next.</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {r.solivanaTherapies.map((rec, i) => {
                const matched = SOLIVANA_THERAPIES.find((m) => rec.toLowerCase().includes(m.name.toLowerCase().split(" ")[0]!.toLowerCase()));
                if (!matched) {
                  return (
                    <div key={i} className="bg-paper border border-coffee/30 rounded-2xl p-5">
                      <p className="font-heading font-medium text-brown">{rec}</p>
                    </div>
                  );
                }
                return (
                  <div key={i} className="bg-paper border border-coffee/30 rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="font-heading font-medium text-brown">{matched.name}</h3>
                      <span className="text-xs text-brown bg-coffeeLight px-2.5 py-1 rounded-full font-hero tracking-wider flex-shrink-0">{matched.duration}</span>
                    </div>
                    <p className="text-xs font-hero tracking-wider uppercase text-accent mb-2">{matched.tagline}</p>
                    <p className={cls.body + " text-sm mb-4"}>{matched.desc}</p>
                    <a href={matched.url} target="_blank" rel="noopener noreferrer" className={cls.btnGhost}>Learn more <I.ArrowR /></a>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* CTAs */}
        <div className="flex flex-wrap gap-3 mb-12">
          <button onClick={onViewTherapies} className={cls.btnPrimary + " text-base !px-8 !py-4"}>
            Explore all SoliVana modalities <I.ArrowR />
          </button>
          <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className={cls.btnSecondary + " text-base !px-8 !py-4"}>
            Book at SoliVana
          </a>
          <button onClick={onNewScan} className={cls.btnSecondary + " text-base !px-8 !py-4"}>
            New scan
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  THERAPY GALLERY                                            */
/* ═══════════════════════════════════════════════════════════ */
function TherapyScreen({ onClose, onAbout }: { onClose: () => void; onAbout?: () => void }) {
  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={onClose} />
      <ComplianceBanner />
      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-16"}>
        <div className="flex items-start justify-between mb-10">
          <div>
            <p className={cls.labelAccent}>The SoliVana Library</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2"}>Eleven modalities. One destination.</h1>
            <p className="font-body text-lg text-coffeeText max-w-2xl mt-4">Each therapy is a different doorway into the same nervous system. Pick the one that meets you where you are today.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SOLIVANA_THERAPIES.map((m) => (
            <article key={m.name} className="bg-paper border border-coffee/30 rounded-2xl p-6 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h2 className="font-heading text-lg text-brown">{m.name}</h2>
                <span className="text-xs text-brown bg-coffeeLight px-2.5 py-1 rounded-full font-hero tracking-wider flex-shrink-0">{m.duration}</span>
              </div>
              <p className="text-xs font-hero tracking-wider uppercase text-accent mb-3">{m.tagline}</p>
              <p className={cls.body + " text-sm mb-4"}>{m.desc}</p>
              <ul className="flex flex-wrap gap-1.5 mb-5">
                {m.benefits.map((b) => <li key={b} className="text-xs text-brown bg-coffeeLight px-2 py-1 rounded-full font-hero tracking-wider">{b}</li>)}
              </ul>
              <a href={m.url} target="_blank" rel="noopener noreferrer" className={cls.btnGhost + " mt-auto"}>Learn more <I.ArrowR /></a>
            </article>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" className={cls.btnPrimary + " text-base !px-8 !py-4"}>Book at SoliVana <I.ArrowR /></a>
          <button onClick={onClose} className={cls.btnSecondary + " text-base !px-8 !py-4"}>Back</button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ABOUT — research + AI disclosure                           */
/* ═══════════════════════════════════════════════════════════ */
function AboutPage({ onBack }: { onBack: () => void }) {
  const faqs: { q: string; a: React.ReactNode }[] = [
    {
      q: "Do I need to create an account or enter a card to try it?",
      a: (
        <p>No. Every device gets one free reading up front — no sign-up, no card. When you want another reading or unlimited access, sign in with your email (no password) and your reading history follows you.</p>
      ),
    },
    {
      q: "Can I cancel my subscription anytime?",
      a: (
        <>
          <p className="mb-2">Yes. The <strong className="text-brown">Manage subscription</strong> button on your Account page opens the Stripe Customer Portal — pause, cancel, update your card, or download invoices in one place.</p>
          <p>Cancellation takes effect at the end of your current billing period; you keep access through the date you've already paid for.</p>
        </>
      ),
    },
    {
      q: "Do you offer refunds?",
      a: (
        <>
          <p className="mb-2"><strong className="text-brown">Unlimited (monthly or annual):</strong> 14-day money-back guarantee from your first paid charge.</p>
          <p className="mb-2"><strong className="text-brown">Scan packs:</strong> unused credits are refundable within 14 days. Scans you've already run aren't refundable — each scan triggers a paid AI analysis the moment you submit.</p>
          <p>Email <a href="mailto:info@solivana.com" className="text-accent hover:underline">info@solivana.com</a> from the email you bought with. Full policy at <a href="https://tools.solivana.io/refund" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">tools.solivana.io/refund</a>.</p>
        </>
      ),
    },
    {
      q: "Can I switch plans later?",
      a: (
        <p>Yes. Open the Customer Portal from your Account page and upgrade or downgrade anytime — Stripe handles proration automatically, so you're only billed for the difference.</p>
      ),
    },
    {
      q: "What happens to my photos?",
      a: (
        <>
          <p className="mb-2">Photos are sent to SoliVana's AI vision system for analysis and aren't retained as permanent images on our servers. The reading itself stays tied to your email so you can revisit it later.</p>
          <p>Full detail in our <a href="https://tools.solivana.io/privacy#ai" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Privacy Policy</a>.</p>
        </>
      ),
    },
    {
      q: "Is this medical advice?",
      a: (
        <p>No. InnerView reads photos through Ayurveda and Traditional Chinese Medicine — frameworks for observation, not diagnosis. The reading is a starting point for conversation with a licensed practitioner, never a substitute for medical care.</p>
      ),
    },
  ];

  const papers = [
    { title: "Validating a sclera-based smartphone app for screening jaundiced newborns in Ghana", journal: "Pediatrics 2022",                desc: "Enweronu-Laryea et al. — 336 infants. Smartphone sclera imaging matched a reference transcutaneous bilirubinometer (sensitivity 0.94, AUROC 0.90) using only a phone camera.", url: "https://pubmed.ncbi.nlm.nih.gov/35656782/" },
    { title: "Smartphone app for non-invasive detection of anemia",                                journal: "Nature Communications 2018",     desc: "Mannino et al. (Emory / Georgia Tech) — 97% sensitivity for anemia (n=100) from patient-sourced photos of fingernail beds; personalized calibration accuracy ±0.92 g/dL of CBC hemoglobin.", url: "https://pubmed.ncbi.nlm.nih.gov/30514831/" },
    { title: "Prediction of anemia and hemoglobin estimation using a smartphone camera",            journal: "PLOS ONE 2021",                  desc: "Suner et al. (Brown University ED) — palpebral conjunctiva photos, 344 patients. Accuracy 94.4% for low (<7 g/dL) transfusion thresholds.",                                                  url: "https://pubmed.ncbi.nlm.nih.gov/34260592/" },
    { title: "AI in tongue diagnosis: deep CNN for tooth-marked tongue",                            journal: "Comput Struct Biotechnol J 2020", desc: "Wang et al. (Beijing University of Chinese Medicine) — ResNet34 CNN trained on 1,548 tongue images. Recognizes tooth-marked tongue (a TCM spleen-deficiency sign) with >90% accuracy.",  url: "https://pubmed.ncbi.nlm.nih.gov/32368332/" },
    { title: "Remote photoplethysmography accurately measures respiratory rate",                    journal: "J Clinical Medicine 2022",       desc: "Allado et al. (CHRU-Nancy) — hospital-based trial, 963 patients. Webcam rPPG agreement with standard respiratory-rate monitoring reached 96%.",                                              url: "https://pubmed.ncbi.nlm.nih.gov/35806932/" },
  ];
  const stories = [
    { quote: "I scanned after a brutal week. The reading flagged hydration and nervous-system load — exactly what I'd been ignoring. Started REST Floating that weekend.", attribution: "Sarah K., founder · San Francisco" },
    { quote: "Read my tongue more carefully than my acupuncturist did last visit. The Earth-element note matched what she's been saying for years.", attribution: "Maya T., yoga teacher" },
    { quote: "The daily practices were boring on purpose. Warm dinners, no late food, breath work. Six weeks in, sleeping through the night again.", attribution: "David L., engineer · Palo Alto" },
  ];
  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={() => {}} onScan={onBack} />
      <ComplianceBanner />
      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-16"}>
        <div className="flex items-start justify-between mb-10">
          <div>
            <p className={cls.labelAccent}>The Science Behind InnerView</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2 max-w-3xl"}>Two old frameworks. One modern lens.</h1>
          </div>
          <button onClick={onBack} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 mb-12">
          <div className="lg:col-span-2">
            <p className="font-body text-lg text-coffeeText leading-relaxed mb-6">
              InnerView reads your photo through Ayurveda and Traditional Chinese Medicine — two frameworks that
              have observed faces and tongues for thousands of years. SoliVana AI applies these frameworks to your
              image, returning observations rather than diagnoses.
            </p>
            <p className={cls.body + " mb-6"}>
              Our purpose is to make these traditions accessible — not to replace your physician, your acupuncturist,
              your Ayurvedic practitioner, or any licensed care. The score, the patterns, the practices — all of it
              is a starting point, not a verdict.
            </p>

            <h2 className="font-heading text-2xl text-brown mb-4 mt-10">The face as a map</h2>
            <p className={cls.body + " mb-6"}>
              Both Ayurveda and Traditional Chinese Medicine treat the face as a map. Each zone corresponds to
              an internal system these traditions spent millennia observing — a vocabulary for noticing that
              long predates modern imaging.
            </p>
            <div className="grid md:grid-cols-2 gap-6 items-center mb-10">
              <div className="rounded-2xl overflow-hidden border border-coffee/30 bg-brown">
                <img src="/face-zones.jpg" alt="Face wireframe with the cheek and jaw zones highlighted, illustrating traditional zone-to-organ mapping used in TCM and Ayurveda observation" className="w-full h-auto block" />
              </div>
              <ul className={cls.body + " text-sm space-y-2"}>
                <li><strong className="text-brown">Forehead</strong> — bladder, nervous-system load</li>
                <li><strong className="text-brown">Between brows</strong> — liver, processing capacity</li>
                <li><strong className="text-brown">Under eyes</strong> — kidneys, hydration, sleep depth</li>
                <li><strong className="text-brown">Cheeks</strong> — lungs, stomach, respiratory and digestive function</li>
                <li><strong className="text-brown">Nose</strong> — heart and circulation</li>
                <li><strong className="text-brown">Chin &amp; jawline</strong> — kidneys, hormonal patterns</li>
                <li><strong className="text-brown">Tongue</strong> — read in zones too: tip (heart, lungs), sides (liver, gallbladder), center (stomach, spleen), root (kidneys)</li>
              </ul>
            </div>

            <h2 className="font-heading text-2xl text-brown mb-4 mt-10">Selected research</h2>
            <p className={cls.body + " text-sm mb-6"}>Peer-reviewed work on smartphone-based visual observation that informs how we approach the reading. Each link verified.</p>
            <ul className="space-y-3">
              {papers.map((p) => (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="block bg-paper border border-coffee/30 rounded-2xl p-5 hover:border-accent/40 transition-colors">
                    <h3 className="font-heading font-medium text-brown mb-1">{p.title}</h3>
                    <p className="text-xs font-hero tracking-wider uppercase text-accent mb-2">{p.journal}</p>
                    <p className={cls.body + " text-sm"}>{p.desc}</p>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <aside className="lg:col-span-1">
            <div className="bg-paper border border-coffee/30 rounded-2xl p-6 sticky top-28">
              <p className={cls.labelAccent + " mb-4"}>From early users</p>
              <ul className="space-y-5">
                {stories.map((s, i) => (
                  <li key={i}>
                    <p className={cls.body + " text-sm italic mb-2 text-brown"}>"{s.quote}"</p>
                    <p className="text-xs font-hero tracking-[0.18em] uppercase text-coffeeText">— {s.attribution}</p>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-hero tracking-[0.18em] uppercase text-coffeeText/80 mt-6 pt-4 border-t border-coffee/20">Composite from early-user feedback. Individual results vary.</p>
            </div>
          </aside>
        </div>

        <section aria-labelledby="faq-heading" className="mt-4 mb-12 pt-12 border-t border-coffee/20">
          <p className={cls.labelAccent}>Common questions</p>
          <h2 id="faq-heading" className={cls.h1 + " text-3xl lg:text-4xl mt-2 mb-8 max-w-2xl"}>Things people ask</h2>
          <ul className="space-y-3 max-w-3xl">
            {faqs.map((f, i) => (
              <li key={i}>
                <details className="group bg-paper border border-coffee/30 rounded-2xl px-6 py-4 open:border-accent/40 transition-colors">
                  <summary className="font-heading text-brown text-lg cursor-pointer list-none flex items-center justify-between gap-4 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper rounded">
                    <span>{f.q}</span>
                    <span aria-hidden="true" className="text-accent text-2xl leading-none transition-transform group-open:rotate-45 shrink-0">+</span>
                  </summary>
                  <div className={cls.body + " text-sm mt-4 leading-relaxed"}>{f.a}</div>
                </details>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex gap-3">
          <button onClick={onBack} className={cls.btnPrimary + " text-base !px-8 !py-4"}>Return to InnerView</button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  SIGN-IN MODAL                                               */
/* ═══════════════════════════════════════════════════════════ */
function SigninScreen({ onClose, reason, errorMsg }: { onClose: () => void; reason?: string; errorMsg?: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const requestLink = trpc.auth.requestLink.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      await requestLink.mutateAsync({ email: email.trim() });
      setSent(true);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-soft flex items-center justify-center px-6">
      <div className="bg-paper border border-coffee/30 rounded-2xl p-8 max-w-md w-full">
        <button onClick={onClose} aria-label="Close" className="float-right text-coffeeText hover:text-brown touch-min p-2 -mt-2 -mr-2"><I.Close className="w-5 h-5" /></button>

        {sent ? (
          <>
            <div className="w-12 h-12 rounded-full bg-accent/15 mx-auto mb-4 flex items-center justify-center text-accent"><I.Check className="w-6 h-6" /></div>
            <h2 className="font-heading text-2xl text-brown mb-2 text-center">Check your inbox</h2>
            <p className={cls.body + " text-center mb-6"}>We sent a sign-in link to <strong className="text-brown">{email}</strong>. Click it to continue. The link is good for 24 hours.</p>
            <p className="text-xs text-brown text-center">Don't see it? Check your spam folder. The sender is <em>info@solivana.com</em>.</p>
          </>
        ) : (
          <>
            <p className={cls.labelAccent + " mb-2"}>{reason === "out_of_scans" ? "Continue your reading" : "Sign in"}</p>
            <h2 className="font-heading text-2xl text-brown mb-3">Enter your email to continue.</h2>
            {errorMsg && (
              <div role="alert" className="mb-5 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm text-brown">
                {errorMsg}
              </div>
            )}
            <p className={cls.body + " text-sm mb-6"}>
              We'll email you a one-tap sign-in link. No password to remember. Your purchased scans + reading history stay tied to your email.
            </p>
            <form onSubmit={handleSubmit}>
              <label className="block text-xs font-hero tracking-wider uppercase text-coffeeText mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none mb-5"
              />
              <button type="submit" disabled={requestLink.isPending || !email.trim()} className={cls.btnPrimary + " w-full !py-4 disabled:opacity-60"}>
                {requestLink.isPending ? "Sending…" : "Email me a link"} <I.ArrowR />
              </button>
            </form>
            <p className="text-xs text-brown mt-4 text-center">By continuing you agree to our <a href="https://tools.solivana.io/terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Terms</a> and <a href="https://tools.solivana.io/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Privacy Policy</a>.</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  AUTH (magic-link landing)                                   */
/* ═══════════════════════════════════════════════════════════ */
function AuthPage({ onSignedIn, onError }: { onSignedIn: () => void; onError: (msg: string) => void }) {
  // Capture token ONCE at mount. We replaceState("/") on success, which would
  // otherwise blank the regex match on the next render and re-fire the effect.
  const [token] = useState(() => {
    const pathMatch = window.location.pathname.match(/^\/auth\/(.+)$/);
    const queryToken = new URLSearchParams(window.location.search).get("token");
    return pathMatch ? decodeURIComponent(pathMatch[1]) : (queryToken ?? "");
  });
  const exchange = trpc.auth.exchangeToken.useMutation();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { onError("This sign-in link is missing a token."); return; }
    exchange.mutateAsync({ token })
      .then((res) => {
        if (res.ok) {
          setSessionToken(res.sessionToken);
          setDone(true);
          window.history.replaceState({}, "", "/");
          setTimeout(onSignedIn, 600);
        } else {
          onError(res.reason === "expired" ? "This sign-in link expired. Request a new one."
            : res.reason === "already_used" ? "This link was already used. Request a new one."
            : "This sign-in link isn't valid. Request a new one.");
        }
      })
      .catch(() => onError("Sign-in failed. Please try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="min-h-screen bg-soft flex items-center justify-center px-6">
      <div className="bg-paper border border-coffee/30 rounded-2xl p-8 max-w-md w-full text-center">
        {done ? (
          <>
            <div className="w-12 h-12 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center text-green-700"><I.Check className="w-6 h-6" /></div>
            <h2 className="font-heading text-xl text-brown mb-2">Signed in</h2>
            <p className={cls.body}>Taking you back to InnerView…</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-coffeeLight mx-auto mb-4 flex items-center justify-center"><div className="h-1 w-6 shimmer-bar rounded-full" /></div>
            <h2 className="font-heading text-xl text-brown mb-2">Signing you in…</h2>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ACCOUNT (history + sign out)                                */
/* ═══════════════════════════════════════════════════════════ */
function AccountPage({ onClose, onSignedOut, onUpgrade, onAbout, onAdmin }: { onClose: () => void; onSignedOut: () => void; onUpgrade: () => void; onAbout?: () => void; onAdmin?: () => void }) {
  const sessionToken = getSessionToken();
  const status = trpc.access.myStatus.useQuery({ sessionToken });
  const history = trpc.auth.history.useQuery({ sessionToken: sessionToken ?? "", limit: 20 }, { enabled: Boolean(sessionToken) });
  const signOut = trpc.auth.signOut.useMutation();
  const redeem = trpc.auth.redeemPromo.useMutation();
  const openPortal = trpc.auth.openBillingPortal.useMutation();
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [portalErr, setPortalErr] = useState<string | null>(null);

  const manageSubscription = async () => {
    if (!sessionToken) return;
    setPortalErr(null);
    try {
      const result = await openPortal.mutateAsync({ sessionToken, returnUrl: window.location.origin + "/account" });
      if (result.ok) {
        window.location.href = result.url;
      } else {
        const msgs: Record<string, string> = {
          stripe_unconfigured: "Billing portal isn't available right now.",
          not_signed_in: "Please sign in again.",
          no_subscription: "No subscription found on this account.",
          stripe_lookup_failed: "Couldn't reach Stripe — try again in a moment.",
          no_customer: "Couldn't locate the Stripe customer for this subscription.",
          portal_create_failed: "Billing portal couldn't be opened. Email info@solivana.com.",
        };
        setPortalErr(msgs[result.reason] ?? "Couldn't open the billing portal.");
      }
    } catch {
      setPortalErr("Couldn't reach the billing portal. Try again in a moment.");
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken || !code.trim()) return;
    setRedeemMsg(null);
    try {
      const result = await redeem.mutateAsync({ sessionToken, code: code.trim() });
      if (result.ok) {
        setRedeemMsg({ ok: true, text: `${result.creditsGranted} scan${result.creditsGranted === 1 ? "" : "s"} added.` });
        setCode("");
        utils.access.myStatus.invalidate();
      } else {
        const msgs: Record<string, string> = {
          invalid_code: "Code not found.",
          disabled: "Code is no longer active.",
          expired: "Code expired.",
          exhausted: "Code is fully redeemed.",
          already_redeemed: "You've already used this code.",
          not_signed_in: "Please sign in first.",
        };
        setRedeemMsg({ ok: false, text: msgs[result.reason] ?? "Couldn't redeem." });
      }
    } catch {
      setRedeemMsg({ ok: false, text: "Couldn't redeem. Please try again." });
    }
  };

  const doSignOut = async () => {
    if (sessionToken) await signOut.mutateAsync({ sessionToken }).catch(() => {});
    clearSessionToken();
    onSignedOut();
  };

  if (!status.data?.signedIn) {
    return (
      <div className="min-h-screen bg-soft flex items-center justify-center px-6">
        <div className="bg-paper border border-coffee/30 rounded-2xl p-8 max-w-md w-full text-center">
          <h2 className="font-heading text-xl text-brown mb-3">Not signed in</h2>
          <button onClick={onClose} className={cls.btnPrimary}>Back</button>
        </div>
      </div>
    );
  }

  const s = status.data;
  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={onClose} onAccount={() => {}} />
      <ComplianceBanner />
      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-16"}>
        <div className="flex items-start justify-between mb-10 gap-4">
          <div>
            <p className={cls.labelAccent}>Your Account</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2"}>{s.email}</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onAdmin && (
              <button onClick={onAdmin} className={cls.btnGhost + " text-xs !px-3 !py-2"}>Admin</button>
            )}
            <button onClick={doSignOut} className={cls.btnSecondary + " !px-4 !py-2 text-xs"} aria-label="Sign out of this account">Sign out</button>
            <button onClick={onClose} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 mb-10">
          <div className="bg-paper border border-coffee/30 rounded-2xl p-6">
            <p className={cls.labelAccent + " mb-2"}>Scans Available</p>
            <p className="font-hero text-5xl text-accent leading-none mb-2">{s.hasUnlimited ? "∞" : s.totalCredits}</p>
            <p className="text-sm text-coffeeText">{s.hasUnlimited ? "Unlimited subscription active" : s.totalCredits === 0 ? "No scans remaining" : s.totalCredits === 1 ? "1 scan remaining" : `${s.totalCredits} scans remaining`}</p>
            {!s.hasUnlimited && (
              <button onClick={onUpgrade} className={cls.btnGhost + " mt-3"}>Add more <I.ArrowR /></button>
            )}
          </div>
          <div className="bg-paper border border-coffee/30 rounded-2xl p-6">
            <p className={cls.labelAccent + " mb-2"}>Scans Completed</p>
            <p className="font-hero text-5xl text-brown leading-none mb-2">{s.scanCount}</p>
            <p className="text-sm text-coffeeText">All-time readings</p>
          </div>
        </div>

        {s.hasUnlimited && (
          <div className="bg-paper border border-coffee/30 rounded-2xl p-6 mb-10 max-w-2xl">
            <p className={cls.labelAccent + " mb-2"}>Subscription</p>
            <p className={cls.body + " text-sm mb-1"}>
              Unlimited plan, status: <strong className="text-brown">{s.subscriptionStatus ?? "active"}</strong>
              {s.unlimitedUntil ? ` · renews ${new Date(s.unlimitedUntil).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}.
            </p>
            <p className={cls.body + " text-sm mb-4"}>Manage billing, pause your subscription, update your card, or cancel anytime — all in one place.</p>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={manageSubscription} disabled={openPortal.isPending} className={cls.btnPrimary + " !py-3 disabled:opacity-60"}>
                {openPortal.isPending ? "Opening…" : "Manage subscription"}
              </button>
              <span className="text-xs text-coffeeText">Opens Stripe's secure billing portal.</span>
            </div>
            {portalErr && <p className="text-sm mt-3 text-destructive">{portalErr}</p>}
          </div>
        )}

        {/* Promo code redemption */}
        <div className="bg-paper border border-coffee/30 rounded-2xl p-6 mb-10 max-w-2xl">
          <p className={cls.labelAccent + " mb-2"}>Have a promo code?</p>
          <p className={cls.body + " text-sm mb-4"}>Enter the code to add free scans to your account.</p>
          <form onSubmit={submitCode} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setRedeemMsg(null); }}
              placeholder="WELCOME10"
              className="flex-1 px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown uppercase tracking-wider focus:border-accent focus:outline-none"
              maxLength={40}
              autoComplete="off"
            />
            <button type="submit" disabled={redeem.isPending || !code.trim()} className={cls.btnPrimary + " !py-3 disabled:opacity-60"}>
              {redeem.isPending ? "Redeeming…" : "Redeem"}
            </button>
          </form>
          {redeemMsg && (
            <p className={`text-sm mt-3 ${redeemMsg.ok ? "text-green-700" : "text-destructive"}`}>{redeemMsg.text}</p>
          )}
        </div>

        <p className={cls.labelAccent + " mb-3"}>Your Reading History</p>
        <h2 className={cls.h2 + " text-2xl mb-5"}>Past scans.</h2>
        {history.data?.scans.length ? (
          <ul className="grid md:grid-cols-2 gap-4 mb-12">
            {history.data.scans.map((scan) => (
              <li key={scan.id} className="bg-paper border border-coffee/30 rounded-2xl p-5">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <span className="font-heading text-lg text-brown">{scan.wellnessScore ?? "—"}<span className="text-sm text-coffeeText"> / 100</span></span>
                  <span className="text-xs font-hero tracking-wider uppercase text-coffeeText">
                    {new Date(scan.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <p className={cls.body + " text-sm"}>{scan.summary || "No summary saved."}</p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="bg-paper border border-coffee/30 rounded-2xl p-8 text-center text-coffeeText">
            <p className="font-body">No scans yet. Run your first reading to start your history.</p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button onClick={onClose} className={cls.btnPrimary}>Begin a scan <I.ArrowR /></button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  PAYWALL                                                     */
/* ═══════════════════════════════════════════════════════════ */
function Paywall({ links, onClose, onAlreadyPaid, onSignOut, onRedeemed, couponCode, discounted, onAbout }: { links: PaymentLinks; onClose: () => void; onAlreadyPaid: () => void; onSignOut?: () => void; onRedeemed?: () => void; couponCode?: string; discounted?: boolean; onAbout?: () => void }) {
  const sessionToken = getSessionToken();
  const status = trpc.access.myStatus.useQuery({ sessionToken }, { enabled: Boolean(sessionToken) });
  const signedIn = status.data?.signedIn === true;
  const signedInEmail = signedIn ? status.data.email : null;
  const utils = trpc.useUtils();
  const redeem = trpc.auth.redeemPromo.useMutation();
  const [code, setCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    if (!sessionToken) {
      setRedeemMsg({ ok: false, text: "Sign in first to redeem a code." });
      return;
    }
    setRedeemMsg(null);
    try {
      const result = await redeem.mutateAsync({ sessionToken, code: code.trim() });
      if (result.ok) {
        setRedeemMsg({ ok: true, text: `${result.creditsGranted} scan${result.creditsGranted === 1 ? "" : "s"} added — taking you back…` });
        setCode("");
        await utils.access.myStatus.invalidate();
        setTimeout(() => onRedeemed?.(), 800);
      } else {
        const msgs: Record<string, string> = {
          invalid_code: "Code not found.",
          disabled: "Code is no longer active.",
          expired: "Code expired.",
          exhausted: "Code is fully redeemed.",
          already_redeemed: "You've already used this code.",
          not_signed_in: "Sign in first to redeem.",
        };
        setRedeemMsg({ ok: false, text: msgs[result.reason] ?? "Couldn't redeem." });
      }
    } catch {
      setRedeemMsg({ ok: false, text: "Couldn't redeem. Please try again." });
    }
  };

  const apply = (url: string) => discounted && couponCode ? withCoupon(url, couponCode) : url;
  const tiers = [
    { name: "5 Readings",        price: discounted ? "$8.99" : "$9.99", scans: "5 readings",       perScan: "$2.00 per reading",                       href: apply(links.starter),  highlight: false, sub: false, original: discounted ? "$9.99" : null },
    { name: "Monthly Unlimited", price: "$19.99",                       scans: "Unlimited",        perScan: "Pause or cancel anytime",                  href: links.unlimited,       highlight: false, sub: true,  original: null },
    { name: "Annual Unlimited",  price: "$199",                         scans: "Unlimited / year", perScan: "2 months free · cancel anytime",          href: links.unlimitedAnnual, highlight: true,  sub: true,  original: null },
  ].filter((t) => t.href);
  return (
    <div className="min-h-screen bg-soft">
      <Header onAbout={onAbout ?? (() => {})} onScan={() => {}} />
      <ComplianceBanner />
      <main id="main" tabIndex={-1} className={cls.container + " py-12 lg:py-20"}>
        <div className="flex items-start justify-between mb-10">
          <div>
            <p className={cls.labelAccent}>Continue Your Reading</p>
            <h1 className={cls.h1 + " text-4xl lg:text-5xl mt-2"}>{discounted ? "Top up your readings — 10% off today." : "You've used your free scan."}</h1>
            <p className="font-body text-lg text-coffeeText max-w-2xl mt-4">Two options to keep going. Both are one-time payments — no subscriptions, no recurring charges.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>

        {discounted && (
          <div className="mb-6 px-4 py-3 bg-accent/10 border border-accent/30 rounded-xl text-sm text-brown max-w-3xl">
            <strong className="text-accent">10% off</strong> applied to packs — limited-time top-up offer.
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {tiers.map((t) => (
            <article key={t.name} className={`bg-paper border rounded-2xl p-7 flex flex-col ${t.highlight ? "border-accent ring-2 ring-accent/20" : "border-coffee/30"}`}>
              {t.highlight && <p className={cls.labelAccent + " mb-2"}>Best Value</p>}
              {t.sub && <p className={cls.labelAccent + " mb-2"}>Best for Regulars</p>}
              <h2 className="font-heading text-2xl text-brown mb-1">{t.name}</h2>
              <div className="my-4">
                {t.original && <span className="block text-sm text-coffeeText line-through mb-1">{t.original}</span>}
                <p className="font-hero text-5xl text-brown leading-none">
                  {t.price}{t.sub && <span className="text-base text-coffeeText font-body font-normal">/mo</span>}
                </p>
              </div>
              <p className={cls.body + " text-base mb-1"}>{t.scans}</p>
              <p className="text-sm text-coffeeText mb-6">{t.perScan}</p>
              <a href={t.href} className={`${t.highlight || t.sub ? cls.btnPrimary : cls.btnSecondary} w-full mt-auto !py-4`}>
                {t.sub ? "Subscribe" : `Buy ${t.name}`} <I.ArrowR />
              </a>
            </article>
          ))}
        </div>

        {/* Promo code redemption */}
        <div className="bg-paper border border-coffee/30 rounded-2xl p-5 max-w-3xl mb-6">
          <p className={cls.labelAccent + " mb-2"}>Have a promo code?</p>
          <p className={cls.body + " text-sm mb-3"}>
            {signedIn ? "Redeem to add free scans to your account." : "Sign in first, then redeem to add free scans."}
          </p>
          <form onSubmit={submitCode} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setRedeemMsg(null); }}
              placeholder="WELCOME10"
              className="flex-1 px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown uppercase tracking-wider focus:border-accent focus:outline-none"
              maxLength={40}
              autoComplete="off"
            />
            {signedIn ? (
              <button type="submit" disabled={redeem.isPending || !code.trim()} className={cls.btnPrimary + " !py-3 disabled:opacity-60"}>
                {redeem.isPending ? "Redeeming…" : "Redeem"}
              </button>
            ) : (
              <button type="button" onClick={onAlreadyPaid} className={cls.btnPrimary + " !py-3"}>
                Sign in to redeem
              </button>
            )}
          </form>
          {redeemMsg && (
            <p className={`text-sm mt-3 ${redeemMsg.ok ? "text-green-700" : "text-destructive"}`}>{redeemMsg.text}</p>
          )}
        </div>

        {signedIn ? (
          <div className="bg-paper border border-coffee/30 rounded-2xl p-5 max-w-3xl mb-6">
            <p className={cls.body + " text-sm mb-3"}>Signed in as <strong className="text-brown">{signedInEmail}</strong>. Purchases will be added to this account.</p>
            <button onClick={onSignOut} className={cls.btnGhost}>Not you? Sign out</button>
          </div>
        ) : (
          <div className="bg-paper border border-coffee/30 rounded-2xl p-5 max-w-3xl mb-6">
            <p className="font-heading font-medium text-brown mb-1">Already purchased?</p>
            <p className={cls.body + " text-sm mb-3"}>Sign in with the email you used at checkout — your scans are tied to your account, not this device.</p>
            <button onClick={onAlreadyPaid} className={cls.btnGhost}>Already purchased? Sign in</button>
          </div>
        )}

        <p className="text-xs text-brown max-w-3xl">
          Payments are processed securely by Stripe. Receipts go to the email you provide at checkout. Scans never expire — use your pack at your own pace.
          One free scan per device.
        </p>
      </main>
      <Footer />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  UNLOCK (Stripe success redirect lands here)                 */
/* ═══════════════════════════════════════════════════════════ */
function UnlockPage({ onContinue, onSignin }: { onContinue: () => void; onSignin?: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id") ?? "";
  const [retries, setRetries] = useState(0);
  const [unlocked, setUnlocked] = useState<{ tier: string; credits: number } | null>(null);
  const [stuck, setStuck] = useState(false);

  const query = trpc.access.unlock.useQuery({ sessionId }, {
    enabled: Boolean(sessionId),
    refetchInterval: unlocked ? false : (retries > 8 ? false : 1500),
  });

  useEffect(() => {
    if (!sessionId) return;
    if (query.data && query.data.found) {
      setUnlockToken(query.data.unlockToken);
      setUnlocked({ tier: query.data.tier, credits: query.data.credits });
      // Strip session_id from URL
      window.history.replaceState({}, "", "/");
    } else if (query.isFetched) {
      setRetries((r) => r + 1);
      if (retries >= 8) setStuck(true);
    }
  }, [query.data, query.isFetched, retries, sessionId]);

  return (
    <div className="min-h-screen bg-soft flex items-center justify-center px-6">
      <div className="bg-paper border border-coffee/30 rounded-2xl p-8 max-w-md w-full text-center">
        {!sessionId ? (
          <>
            <div className="w-12 h-12 rounded-full bg-accent/15 mx-auto mb-4 flex items-center justify-center text-accent"><I.Check className="w-6 h-6" /></div>
            <h2 className="font-heading text-xl text-brown mb-2">Your purchase is in.</h2>
            <p className={cls.body + " mb-6"}>Stripe didn't pass us your session ID on the redirect (this happens with some discount checkouts), but your credits are already attached to the email you used at checkout. Sign in with that email to continue.</p>
            <div className="flex gap-3 justify-center flex-wrap">
              {onSignin && <button onClick={onSignin} className={cls.btnPrimary}>Sign in to use credits</button>}
              <button onClick={onContinue} className={cls.btnSecondary}>Back to InnerView</button>
            </div>
          </>
        ) : unlocked ? (
          <>
            <div className="w-12 h-12 rounded-full bg-green-100 mx-auto mb-4 flex items-center justify-center text-green-700"><I.Check className="w-6 h-6" /></div>
            <h2 className="font-heading text-xl text-brown mb-2">You're all set</h2>
            <p className={cls.body + " mb-2"}>Your <strong className="text-brown capitalize">{unlocked.tier} Pack</strong> is active on this device.</p>
            <p className={cls.body + " mb-6"}><strong className="text-accent">{unlocked.credits}</strong> scans available.</p>
            <button onClick={onContinue} className={cls.btnPrimary}>Begin a scan <I.ArrowR /></button>
          </>
        ) : stuck ? (
          <>
            <div className="w-12 h-12 rounded-full bg-coffeeLight mx-auto mb-4 flex items-center justify-center text-coffeeText"><I.Alert className="w-6 h-6" /></div>
            <h2 className="font-heading text-xl text-brown mb-2">Still waiting on Stripe…</h2>
            <p className={cls.body + " mb-6"}>Stripe usually confirms in a few seconds, but it can take up to a minute. Your credits are tied to your account email — if you don't see them here, sign in with that email from the home page.</p>
            <div className="flex gap-3 justify-center flex-wrap">
              <button onClick={() => window.location.reload()} className={cls.btnPrimary}>Refresh</button>
              <button onClick={onContinue} className={cls.btnSecondary}>Back to home</button>
            </div>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-coffeeLight mx-auto mb-4 flex items-center justify-center text-accent">
              <div className="h-1 w-6 shimmer-bar rounded-full" />
            </div>
            <h2 className="font-heading text-xl text-brown mb-2">Unlocking your pack…</h2>
            <p className={cls.body + " mb-4"}>Confirming your payment with Stripe.</p>
            <button onClick={onContinue} className={cls.btnGhost}>Back to home</button>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ADMIN                                                       */
/* ═══════════════════════════════════════════════════════════ */
function AdminPage({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [token, setToken] = useState(() => localStorage.getItem("iv_admin_token") ?? "");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [grantCount, setGrantCount] = useState(1);
  const [grantNote, setGrantNote] = useState("");
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [directEmail, setDirectEmail] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const search = trpc.admin.searchUsers.useQuery(
    { query: searchQuery.trim(), token },
    { enabled: authed && hasSearched }
  );
  const user = trpc.admin.getUser.useQuery(
    { email: selectedEmail ?? "", token },
    { enabled: authed && Boolean(selectedEmail) }
  );
  const grant = trpc.admin.grantCredits.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setGrantMsg({ ok: true, text: `${grantCount} credit${grantCount === 1 ? "" : "s"} granted. User now has ${data.remaining} total.` });
        setGrantCount(1);
        setGrantNote("");
        user.refetch();
        search.refetch();
      } else {
        setGrantMsg({ ok: false, text: data.error ?? "Failed to grant credits." });
      }
    },
    onError: (err) => {
      setGrantMsg({ ok: false, text: err.message || "Failed to grant credits." });
    },
  });

  const doAuth = async () => {
    if (!token.trim()) return;
    setAuthError(null);
    setAuthChecking(true);
    try {
      const res = await utils.client.admin.verify.query({ token: token.trim() });
      if (res.ok) {
        localStorage.setItem("iv_admin_token", token.trim());
        setAuthed(true);
      } else {
        setAuthError("That admin token doesn't match. Check ADMIN_TOKEN in your Railway env vars.");
        localStorage.removeItem("iv_admin_token");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unable to verify token. Check your network.";
      setAuthError(msg);
    } finally {
      setAuthChecking(false);
    }
  };

  const doDirectGrant = (e: React.FormEvent) => {
    e.preventDefault();
    const email = directEmail.trim();
    if (!email || grantCount < 1) return;
    setGrantMsg(null);
    grant.mutate({ email, credits: grantCount, note: grantNote || undefined, token });
  };

  const doSearch = () => {
    const q = inputValue.trim();
    setSearchQuery(q);
    setSelectedEmail(null);
    setHasSearched(true);
  };

  const doShowAll = () => {
    setInputValue("");
    setSearchQuery("");
    setSelectedEmail(null);
    setHasSearched(true);
  };

  const doGrant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmail || grantCount < 1) return;
    setGrantMsg(null);
    grant.mutate({ email: selectedEmail, credits: grantCount, note: grantNote || undefined, token });
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-soft flex items-center justify-center px-6">
        <div className="bg-paper border border-coffee/30 rounded-2xl p-8 max-w-md w-full">
          <h2 className={cls.h2 + " text-2xl mb-4"}>InnerView Admin</h2>
          <p className={cls.body + " text-sm mb-6"}>Enter your admin token to access the backoffice.</p>
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); setAuthError(null); }}
            placeholder="Admin token"
            className="w-full px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none mb-4"
            onKeyDown={(e) => e.key === "Enter" && !authChecking && doAuth()}
            disabled={authChecking}
          />
          {authError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs text-red-800">{authError}</p>
            </div>
          )}
          <button
            onClick={doAuth}
            disabled={authChecking || !token.trim()}
            className={cls.btnPrimary + " w-full disabled:opacity-50"}
          >{authChecking ? "Verifying…" : "Enter"}</button>
          <button onClick={onClose} className={cls.btnGhost + " w-full justify-center mt-4"}>Back to home</button>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-soft">
      <div className={cls.container + " py-8 lg:py-12"}>
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <p className={cls.labelAccent}>Backoffice</p>
            <h1 className={cls.h1 + " text-3xl lg:text-4xl mt-2"}>Admin</h1>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-coffeeText hover:text-brown touch-min p-2"><I.Close className="w-6 h-6" /></button>
        </div>

        {/* Search */}
        <div className="bg-paper border border-coffee/30 rounded-2xl p-6 mb-8 max-w-xl">
          <p className={cls.labelAccent + " mb-3"}>Find User</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Search by email..."
              className="flex-1 px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <button onClick={doSearch} className={cls.btnPrimary + " !px-5"}>Search</button>
          </div>
          <button onClick={doShowAll} className={cls.btnGhost + " mt-3 text-xs"}>Show all accounts</button>

          {search.isLoading && (
            <div className="mt-4 flex items-center gap-2 text-sm text-coffeeText">
              <span className="inline-block w-4 h-4 border-2 border-coffee/20 border-t-accent rounded-full animate-spin" />
              Searching…
            </div>
          )}
          {search.isError && <p className="text-sm text-destructive mt-4">Search failed. Check connection or token.</p>}
          {hasSearched && !search.isLoading && search.data?.success && search.data.users.length === 0 && (
            <div className="mt-4 bg-coffeeLight rounded-xl p-4">
              <p className="text-sm text-brown">No users found for "{searchQuery}".</p>
            </div>
          )}
          {search.data?.success && search.data.users.length > 0 && (
            <ul className="mt-4 space-y-2">
              {search.data.users.map((u) => (
                <li key={u.email}>
                  <button
                    onClick={() => setSelectedEmail(u.email)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${selectedEmail === u.email ? "border-accent bg-accent/5" : "border-coffee/20 hover:bg-coffeeLight"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-body text-brown text-sm">{u.email}</span>
                      <span className="text-xs text-coffeeText">
                        {u.hasUnlimited ? "Unlimited" : `${u.remainingCredits} credit${u.remainingCredits === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Direct grant — bypasses search; works even when no accounts row exists */}
        <div className="bg-paper border border-coffee/30 rounded-2xl p-6 mb-8 max-w-xl">
          <p className={cls.labelAccent + " mb-3"}>Direct grant (skip search)</p>
          <p className="text-xs text-coffeeText mb-4">Use this to grant credits to an email even if it doesn't appear in search. The account row is created automatically on grant.</p>
          <form onSubmit={doDirectGrant} className="space-y-3">
            <input
              type="email"
              value={directEmail}
              onChange={(e) => setDirectEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none"
              required
            />
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={1000}
                value={grantCount}
                onChange={(e) => setGrantCount(parseInt(e.target.value) || 1)}
                className="w-24 px-3 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none"
              />
              <input
                type="text"
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
                placeholder="Note (optional)"
                className="flex-1 px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none"
              />
            </div>
            <button type="submit" disabled={grant.isPending || !directEmail.trim()} className={cls.btnPrimary + " w-full disabled:opacity-50"}>
              {grant.isPending ? "Granting…" : `Grant ${grantCount} credit${grantCount === 1 ? "" : "s"}`}
            </button>
            {grantMsg && !selectedEmail && (
              <p className={`text-sm mt-2 ${grantMsg.ok ? "text-green-700" : "text-red-700"}`}>{grantMsg.text}</p>
            )}
          </form>
        </div>

        {/* User detail */}
        {selectedEmail && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="bg-paper border border-coffee/30 rounded-2xl p-6">
                <p className={cls.labelAccent + " mb-3"}>User Overview</p>
                {user.isLoading && <p className="text-sm text-coffeeText">Loading user…</p>}
                {user.isError && <p className="text-sm text-destructive">Failed to load user.</p>}
                {user.data?.success && (
                  <>
                    <p className="font-body text-brown mb-1"><strong>Email:</strong> {user.data.user.email}</p>
                    <p className="font-body text-brown mb-1"><strong>Credits:</strong> {user.data.user.hasUnlimited ? "∞ Unlimited" : user.data.user.totalCredits}</p>
                    <p className="font-body text-brown mb-1"><strong>Scans:</strong> {user.data.user.scanCount}</p>
                    {user.data.user.hasUnlimited && user.data.user.unlimitedUntil && (
                      <p className="font-body text-brown mb-1"><strong>Renews:</strong> {new Date(user.data.user.unlimitedUntil).toLocaleDateString()}</p>
                    )}
                  </>
                )}
              </div>

              {user.data?.success && (
                <div className="bg-paper border border-coffee/30 rounded-2xl p-6">
                  <p className={cls.labelAccent + " mb-3"}>Grant Free Credits</p>
                  <form onSubmit={doGrant} className="space-y-3">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={grantCount}
                      onChange={(e) => setGrantCount(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none"
                    />
                    <input
                      type="text"
                      value={grantNote}
                      onChange={(e) => setGrantNote(e.target.value)}
                      placeholder="Note (optional) — e.g. 'Refund for error on 5/17'"
                      className="w-full px-4 py-3 rounded-xl border border-coffee/40 bg-soft font-body text-brown focus:border-accent focus:outline-none"
                    />
                    <button type="submit" disabled={grant.isPending} className={cls.btnPrimary + " w-full disabled:opacity-60"}>
                      {grant.isPending ? "Granting…" : `Grant ${grantCount} credit${grantCount === 1 ? "" : "s"}`}
                    </button>
                  </form>
                  {grantMsg && (
                    <p className={`text-sm mt-3 ${grantMsg.ok ? "text-green-700" : "text-destructive"}`}>{grantMsg.text}</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-6">
              {user.data?.success && (
                <div className="bg-paper border border-coffee/30 rounded-2xl p-6">
                  <p className={cls.labelAccent + " mb-3"}>Credit Packs</p>
                  {user.data.user.credits.length === 0 ? (
                    <p className="text-sm text-coffeeText">No credit packs.</p>
                  ) : (
                    <ul className="space-y-2">
                      {user.data.user.credits.map((c) => (
                        <li key={c.id} className="text-sm border-b border-coffee/10 pb-2 last:border-0">
                          <div className="flex justify-between">
                            <span className="font-body text-brown">{c.source}</span>
                            <span className="text-coffeeText">
                              {c.remaining != null ? `${c.remaining} / ${c.creditsTotal} left` : c.subscriptionStatus ?? "—"}
                            </span>
                          </div>
                          {c.note && <p className="text-xs text-coffeeText mt-0.5">{c.note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {user.data?.success && (
                <div className="bg-paper border border-coffee/30 rounded-2xl p-6">
                  <p className={cls.labelAccent + " mb-3"}>Recent Scans</p>
                  {user.data.user.scans.length === 0 ? (
                    <p className="text-sm text-coffeeText">No scans yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {user.data.user.scans.map((s) => (
                        <li key={s.id} className="text-sm border-b border-coffee/10 pb-2 last:border-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-heading text-brown">{s.wellnessScore ?? "—"}/100</span>
                            <span className="text-xs text-coffeeText">
                              {new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                          </div>
                          <p className="text-coffeeText mt-0.5 line-clamp-2">{s.summary || "No summary."}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
/*  ROOT APP — screen state machine                            */
/* ═══════════════════════════════════════════════════════════ */
export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const isUnlockPath = path === "/unlock";
  const isAuthPath = path === "/auth" || path.startsWith("/auth/");
  const isAdminPath = path === "/admin";
  const [screen, setScreen] = useState<Screen>(isAdminPath ? "admin" : isAuthPath ? "auth" : isUnlockPath ? "unlock" : "showcase");
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [scanMode, setScanMode] = useState<ScanMode>("both");
  const [analysisResult, setAnalysisResult] = useState<Analysis | null>(null);
  const [paywallLinks, setPaywallLinks] = useState<PaymentLinks | null>(null);
  const [paywallDiscounted, setPaywallDiscounted] = useState(false);
  const [signinError, setSigninError] = useState<string | undefined>(undefined);
  const [paywallCoupon, setPaywallCoupon] = useState<string | undefined>(undefined);
  const utils = trpc.useUtils();

  // Ensure a device id exists at first render
  useEffect(() => { getDeviceId(); }, []);

  // Gate: pre-flight check before letting the user enter the photo flow.
  const beginScan = useCallback(async () => {
    setSelectedImage("");
    setAnalysisResult(null);
    try {
      const decision = await utils.access.check.fetch({
        deviceId: getDeviceId(),
        sessionToken: getSessionToken(),
        unlockToken: getUnlockToken(),
      });
      if (!decision.allowed) {
        if (decision.reason === "needs_signin") {
          setScreen("signin");
          return;
        }
        if (decision.reason === "paywall" && decision.paymentLinks) {
          setPaywallLinks(decision.paymentLinks);
          setPaywallCoupon(decision.couponCode);
          setPaywallDiscounted(false);
          setScreen("paywall");
          return;
        }
        if (decision.reason === "global_quota_exhausted" && decision.paymentLinks) {
          setPaywallLinks(decision.paymentLinks);
          setPaywallCoupon(undefined);
          setPaywallDiscounted(false);
          setScreen("paywall");
          return;
        }
      }
    } catch {}
    setScreen("tips");
  }, [utils]);

  // Open paywall directly (used by Account "Add more" button + low-credit upsell)
  const openPaywall = useCallback(async (discounted = false) => {
    try {
      const links = await utils.access.paymentLinks.fetch();
      setPaywallLinks({ starter: links.starter, pro: links.pro, unlimited: links.unlimited });
      setPaywallCoupon(links.couponCode);
      setPaywallDiscounted(discounted);
      setScreen("paywall");
    } catch {
      setScreen("paywall");
    }
  }, [utils]);

  const startNew = beginScan;

  const handleImageSelected = useCallback((img: string, mode: ScanMode) => {
    setSelectedImage(img);
    setScanMode(mode);
    setScreen("analyzing");
  }, []);

  const handleAnalysisComplete = useCallback((result: Analysis) => {
    setAnalysisResult(result);
    setScreen("result");
  }, []);

  const handlePaywall = useCallback((links: PaymentLinks) => {
    setPaywallLinks(links);
    setScreen("paywall");
  }, []);

  const handleAnalysisError = useCallback(() => {}, []);

  if (screen === "admin")     return <AdminPage onClose={() => setScreen("showcase")} />;
  if (screen === "auth")      return <AuthPage onSignedIn={() => { beginScan(); }} onError={(msg) => { setSigninError(msg); setScreen("signin"); }} />;
  if (screen === "signin")    return <SigninScreen onClose={() => { setSigninError(undefined); setScreen("showcase"); }} reason="out_of_scans" errorMsg={signinError} />;
  const goAbout = () => setScreen("about");
  if (screen === "account")   return <AccountPage onClose={() => setScreen("showcase")} onSignedOut={() => setScreen("showcase")} onUpgrade={() => openPaywall(false)} onAbout={goAbout} onAdmin={() => setScreen("admin")} />;
  if (screen === "unlock")    return <UnlockPage onContinue={() => setScreen("showcase")} onSignin={() => setScreen("signin")} />;
  if (screen === "paywall" && paywallLinks) return <Paywall
    links={paywallLinks}
    couponCode={paywallCoupon}
    discounted={paywallDiscounted}
    onClose={() => setScreen("showcase")}
    onAlreadyPaid={() => setScreen("signin")}
    onRedeemed={beginScan}
    onAbout={goAbout}
    onSignOut={async () => {
      const t = getSessionToken();
      if (t) { try { await utils.client.auth.signOut.mutate({ sessionToken: t }); } catch {} }
      clearSessionToken();
      setScreen("showcase");
    }}
  />;
  if (screen === "about")     return <AboutPage onBack={() => setScreen("showcase")} />;
  if (screen === "tips")      return <PhotoTipsScreen onContinue={() => setScreen("upload")} onClose={() => setScreen("showcase")} onAbout={goAbout} />;
  if (screen === "upload")    return <UploadScreen onImageSelected={handleImageSelected} onClose={() => setScreen("showcase")} onAbout={goAbout} />;
  if (screen === "analyzing") return <AnalyzingScreen image={selectedImage} scanMode={scanMode} onComplete={handleAnalysisComplete} onPaywall={handlePaywall} onError={handleAnalysisError} onRetry={() => setScreen("upload")} onAbout={goAbout} />;
  if (screen === "result" && analysisResult) return <ResultScreen result={analysisResult} image={selectedImage} onViewTherapies={() => setScreen("therapy")} onClose={() => setScreen("showcase")} onNewScan={beginScan} onAccount={() => setScreen("account")} onAbout={goAbout} onUpsell={() => openPaywall(true)} />;
  if (screen === "therapy")   return <TherapyScreen onClose={() => setScreen("result")} onAbout={goAbout} />;

  return <Showcase onScan={beginScan} onAbout={() => setScreen("about")} onSignin={() => setScreen("signin")} onAccount={() => setScreen("account")} />;
}
