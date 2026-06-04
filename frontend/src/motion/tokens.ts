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

/* ── Artifact interpolation ────────────────────────────────────────────
 *
 * The HatchArtifact is driven by a continuous 0→1 progress value (scroll
 * position). Each layer reads its own parameter from a piecewise-linear
 * interpolation so that state transitions feel organic — not stepped.
 *
 * Keyframe stops are { at: number; value: number }[] — "at progress X,
 * this layer should be at value Y." Everything between is lerped.
 * ──────────────────────────────────────────────────────────────────── */

export interface ArtifactLayers {
  /** 0 = shell closed, 1 = shell fully separated */
  shellSeparation: number;
  /** 0 = no fractures visible, 1 = all fractures fully drawn */
  fractureReveal: number;
  /** 0 = core invisible, 1 = core fully visible + glowing */
  coreOpacity: number;
  /** 0 = no glow, 1 = full subsurface glow */
  glowIntensity: number;
  /** 0 = ambient dormant, 1 = ambient fully alive */
  ambientScale: number;
  /** Breathing speed multiplier — faster = more urgent */
  breathSpeed: number;
  /** Current conceptual state name (for readout labels) */
  stateName: HatchState;
}

type Keyframe = { at: number; value: number };

function lerpStops(stops: Keyframe[], t: number): number {
  if (t <= stops[0].at) return stops[0].value;
  if (t >= stops[stops.length - 1].at) return stops[stops.length - 1].value;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.at && t <= b.at) {
      const local = (t - a.at) / (b.at - a.at);
      return a.value + (b.value - a.value) * local;
    }
  }
  return stops[stops.length - 1].value;
}

const SHELL_STOPS: Keyframe[]    = [{ at: 0, value: 0 }, { at: 0.45, value: 0 }, { at: 0.7, value: 0.3 }, { at: 0.85, value: 0.7 }, { at: 1, value: 1 }];
const FRACTURE_STOPS: Keyframe[] = [{ at: 0, value: 0 }, { at: 0.28, value: 0 }, { at: 0.4, value: 0.12 }, { at: 0.55, value: 0.45 }, { at: 0.75, value: 0.85 }, { at: 1, value: 1 }];
const CORE_STOPS: Keyframe[]     = [{ at: 0, value: 0 }, { at: 0.2, value: 0.05 }, { at: 0.4, value: 0.2 }, { at: 0.65, value: 0.55 }, { at: 0.85, value: 0.85 }, { at: 1, value: 1 }];
const GLOW_STOPS: Keyframe[]     = [{ at: 0, value: 0.06 }, { at: 0.25, value: 0.15 }, { at: 0.5, value: 0.4 }, { at: 0.75, value: 0.75 }, { at: 1, value: 0.55 }];
const AMBIENT_STOPS: Keyframe[]  = [{ at: 0, value: 0.3 }, { at: 0.25, value: 0.4 }, { at: 0.5, value: 0.6 }, { at: 0.75, value: 0.9 }, { at: 1, value: 0.65 }];
const BREATH_STOPS: Keyframe[]   = [{ at: 0, value: 0.12 }, { at: 0.25, value: 0.25 }, { at: 0.5, value: 0.55 }, { at: 0.75, value: 0.85 }, { at: 1, value: 0.2 }];

function stateNameAt(t: number): HatchState {
  if (t < 0.22) return "sealed";
  if (t < 0.48) return "incubating";
  if (t < 0.78) return "hatching";
  return "public";
}

export function artifactLerp(progress: number): ArtifactLayers {
  const t = Math.max(0, Math.min(1, progress));
  return {
    shellSeparation: lerpStops(SHELL_STOPS, t),
    fractureReveal:  lerpStops(FRACTURE_STOPS, t),
    coreOpacity:     lerpStops(CORE_STOPS, t),
    glowIntensity:   lerpStops(GLOW_STOPS, t),
    ambientScale:    lerpStops(AMBIENT_STOPS, t),
    breathSpeed:     lerpStops(BREATH_STOPS, t),
    stateName:       stateNameAt(t),
  };
}

/** Convert a discrete HatchState to a representative progress value
 *  (used when the artifact is not scroll-driven, e.g. console rail). */
export function stateToProgress(state: HatchState): number {
  switch (state) {
    case "sealed":     return 0.0;
    case "incubating": return 0.35;
    case "hatching":   return 0.65;
    case "public":     return 1.0;
  }
}
