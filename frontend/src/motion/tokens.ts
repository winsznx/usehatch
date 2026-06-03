/* Hatch motion tokens — the unified language. Calibrated against the
 * reference's actual GSAP/Lenis/cubic-bezier values. Every duration, curve,
 * and spring across the app must come from here.
 *
 * The signature curves are Apple-grade expo-outs (strong initial weight,
 * dramatic settle into rest). Linear is reserved for scroll-scrubbed
 * animations. Anything S-curved is for decisive chapter transitions where
 * the system has to feel intentional. */

import type { Transition } from "framer-motion";

/** Cubic-bezier curves named for what they communicate, not what they look like. */
export const ease = {
  /** Default. Apple-grade expo-out. Strong start, dramatic settle. */
  primary:    [0.16, 1, 0.3, 1]     as const,
  /** Reveal. Even more decisive than primary; patient at first. */
  reveal:     [0.19, 1, 0.22, 1]    as const,
  /** Seal. Decisive S-curve — closing/locking. */
  seal:       [0.87, 0, 0.13, 1]    as const,
  /** Gravity. Slow start, fast finish — for objects falling into place. */
  gravity:    [0.5, 0.5, 0, 1]      as const,
  /** Drift. Ambient continuous loops (atmosphere, breathing orb). */
  drift:      [0.07, 0.5, 0.5, 1]   as const,
  /** Snap. Instant decisions (button press, micro-interaction). */
  snap:       [0.4, 0, 0.2, 1]      as const,
  /** Linear — reserved for scroll-scrubbed transforms only. Never for entrance. */
  linear:     [0, 0, 1, 1]          as const,
};

/** Durations in seconds. Calibrated to the reference's actual values. */
export const dur = {
  instant: 0.18,
  fast:    0.32,
  base:    0.5,        // most micro-interactions land here
  slow:    0.8,        // chapter reveals land here
  cinematic: 1.0,      // the longest curtain-opens
  epic:    1.6,
} as const;

/** Scroll-scrub smoothing window. GSAP ScrollTrigger value (in seconds).
 *  1.0 = the reference's setting — gives scroll-linked motion the "weighted,
 *  settling" feel that defines premium scroll experiences. */
export const SCRUB = 1.0;

/** How long each chapter holds the viewport before the next takes over.
 *  Expressed as a viewport-height multiplier (200 = the chapter pins for 2× vh
 *  of scroll). The reference uses 200–220%. */
export const CHAPTER_HOLD = 200;

/** Springs — used only for direct UI response, never for ambient motion. */
export const spring = {
  /** Hero / large motion — weighted, settles confidently. */
  weighted: { type: "spring", stiffness: 120, damping: 28, mass: 1.2 } satisfies Transition,
  /** UI response — tighter, still settling not snapping. */
  ui:       { type: "spring", stiffness: 220, damping: 26, mass: 0.6 } satisfies Transition,
  /** Hover/press — fast, no overshoot. */
  press:    { type: "spring", stiffness: 380, damping: 32, mass: 0.4 } satisfies Transition,
};

/** Stagger for elements in the same scene. Always tight; never theatrical. */
export const stagger = {
  tight:   0.04,
  base:    0.08,
  patient: 0.14,
} as const;

/** Lifecycle states drive everything else. Each has its own tempo. */
export type HatchState = "sealed" | "incubating" | "hatching" | "public";
export const stateTempo: Record<HatchState, { breath: number; pulse: number; opacity: number }> = {
  sealed:     { breath: 8.0, pulse: 0.00, opacity: 0.55 }, // still, deep
  incubating: { breath: 5.5, pulse: 0.18, opacity: 0.75 }, // warming
  hatching:   { breath: 2.2, pulse: 0.42, opacity: 0.95 }, // urgent
  public:     { breath: 6.0, pulse: 0.10, opacity: 1.00 }, // open, calm
};
