/* HatchArtifact — the defining Hatch symbol.
 *
 * A premium engineered capsule — not a literal egg, not a sphere, not a
 * crypto token. An industrial artifact with an egg-like silhouette:
 * slightly taller than wide, perfectly symmetrical, minimal, memorable.
 *
 * Think: a sealed intelligence capsule, a futuristic vault, something
 * Apple hardware or Dieter Rams would produce if they designed secrets.
 *
 * Architecture — 5 independently animated SVG layers:
 *   1. Ambient Layer  — environmental halo, communicates weight
 *   2. Glow Layer     — subsurface light through seams/cracks
 *   3. Outer Shell    — the capsule body, matte ceramic surface
 *   4. Fracture Layer — hairline cracks, path-length animated
 *   5. Inner Core     — the revealed payload
 *
 * Driven by a continuous `progress` prop (0–1) mapped from scroll,
 * or by a discrete `state` prop for non-scroll contexts. The artifact
 * interpolates all layer parameters through piecewise-linear curves
 * defined in tokens.ts.
 *
 * The shell is a symmetric superellipse — not a circle, not a biological
 * egg. In the `public` state, a rough diagonal fault separates into two
 * ceramic halves, revealing the glowing inner core. */

import { useMemo, useRef, useEffect } from "react";
import { motion, useReducedMotion, useMotionValue, useSpring } from "framer-motion";
import { ease, artifactLerp, stateToProgress, type HatchState } from "./tokens.js";

interface HatchArtifactProps {
  /** Continuous 0–1 progress (scroll-driven). Takes priority over `state`. */
  progress?: number;
  /** Discrete state fallback (used when not scroll-driven, e.g. console). */
  state?: HatchState;
  size?: number | string;
  /** React to cursor proximity with 3D perspective tilt. Default true. */
  cursorTilt?: boolean;
  className?: string;
}

/* ── Capsule geometry ──────────────────────────────────────────────────
 *
 * The capsule is drawn in a 400×480 viewBox (taller than wide). The body is
 * a symmetrical superellipse, then detailed with an equatorial seam and
 * micro-bevels so the silhouette reads as a sealed hardware vault.
 *
 * The fault line runs diagonally through the shell and splits into two
 * ceramic halves that drift apart along that diagonal.
 * ─────────────────────────────────────────────────────────────────── */

const VB_W = 400;
const VB_H = 480;
const CX = VB_W / 2;     // 200
const CY = VB_H / 2;     // 240

const BODY_W = 218;
const BODY_H = 340;
const HALF_W = BODY_W / 2;

function makeShellPath(yOffset: number = 0): string {
  const top = CY - BODY_H / 2 + yOffset;
  const bot = CY + BODY_H / 2 + yOffset;

  return [
    `M ${CX} ${top}`,
    `C ${CX + HALF_W * 0.78} ${top + 8}, ${CX + HALF_W} ${top + 74}, ${CX + HALF_W} ${CY + yOffset}`,
    `C ${CX + HALF_W} ${bot - 74}, ${CX + HALF_W * 0.78} ${bot - 8}, ${CX} ${bot}`,
    `C ${CX - HALF_W * 0.78} ${bot - 8}, ${CX - HALF_W} ${bot - 74}, ${CX - HALF_W} ${CY + yOffset}`,
    `C ${CX - HALF_W} ${top + 74}, ${CX - HALF_W * 0.78} ${top + 8}, ${CX} ${top}`,
    "Z",
  ].join(" ");
}

function makeInsetPath(): string {
  const w = BODY_W - 26;
  const h = BODY_H - 34;
  const hw = w / 2;
  const top = CY - h / 2;
  const bot = CY + h / 2;

  return [
    `M ${CX} ${top}`,
    `C ${CX + hw * 0.72} ${top + 8}, ${CX + hw} ${top + 66}, ${CX + hw} ${CY}`,
    `C ${CX + hw} ${bot - 66}, ${CX + hw * 0.72} ${bot - 8}, ${CX} ${bot}`,
    `C ${CX - hw * 0.72} ${bot - 8}, ${CX - hw} ${bot - 66}, ${CX - hw} ${CY}`,
    `C ${CX - hw} ${top + 66}, ${CX - hw * 0.72} ${top + 8}, ${CX} ${top}`,
    "Z",
  ].join(" ");
}

const DIAGONAL_FAULT_POINTS: Array<[number, number]> = [
  [CX - 92, CY - 54],
  [CX - 58, CY - 34],
  [CX - 28, CY - 42],
  [CX - 4, CY - 12],
  [CX + 28, CY - 20],
  [CX + 58, CY + 18],
  [CX + 96, CY + 38],
];

const FAULT_CLIP_POINTS: Array<[number, number]> = [
  [CX - 140, CY - 78],
  ...DIAGONAL_FAULT_POINTS,
  [CX + 140, CY + 60],
];

function makePointPath(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

function makeFaultClipPath(side: "upper" | "lower"): string {
  const first = FAULT_CLIP_POINTS[0];
  const last = FAULT_CLIP_POINTS[FAULT_CLIP_POINTS.length - 1];
  const points = FAULT_CLIP_POINTS.map(([x, y]) => `L ${x} ${y}`).join(" ");
  const reversePoints = [...FAULT_CLIP_POINTS].reverse().map(([x, y]) => `L ${x} ${y}`).join(" ");

  if (side === "upper") {
    return [
      "M -80 -80",
      `L ${VB_W + 80} -80`,
      `L ${last[0]} ${last[1]}`,
      reversePoints,
      "Z",
    ].join(" ");
  }

  return [
    `M ${first[0]} ${first[1]}`,
    points,
    `L ${VB_W + 80} ${VB_H + 80}`,
    `L -80 ${VB_H + 80}`,
    "Z",
  ].join(" ");
}

function makeFaultBandPath(amount: number = 20): string {
  const first = DIAGONAL_FAULT_POINTS[0];
  const last = DIAGONAL_FAULT_POINTS[DIAGONAL_FAULT_POINTS.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const upper = DIAGONAL_FAULT_POINTS.map(([x, y]) => [x + nx * amount, y + ny * amount]);
  const lower = [...DIAGONAL_FAULT_POINTS].reverse().map(([x, y]) => [x - nx * amount, y - ny * amount]);
  return [...upper, ...lower]
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ") + " Z";
}

// Fracture paths — rough diagonal crack with smaller branches
const FRACTURE_PATHS = [
  makePointPath(DIAGONAL_FAULT_POINTS),
  `M ${CX - 28} ${CY - 42} L ${CX - 46} ${CY - 74} L ${CX - 38} ${CY - 102}`,
  `M ${CX - 4} ${CY - 12} L ${CX + 8} ${CY - 52} L ${CX + 2} ${CY - 86}`,
  `M ${CX + 28} ${CY - 20} L ${CX + 60} ${CY - 50} L ${CX + 78} ${CY - 74}`,
  `M ${CX + 58} ${CY + 18} L ${CX + 44} ${CY + 56} L ${CX + 52} ${CY + 84}`,
  `M ${CX - 58} ${CY - 34} L ${CX - 86} ${CY - 16} L ${CX - 104} ${CY - 22}`,
];

// Inner core shape — a smaller, smoother form inside the shell
function makeCorePath(): string {
  const coreW = 90;
  const coreH = 120;
  const r = 42;
  const top = CY - coreH / 2;
  const bot = CY + coreH / 2;
  const hw = coreW / 2;

  return [
    `M ${CX} ${top}`,
    `C ${CX + hw * 0.6} ${top + r * 0.1}, ${CX + hw} ${top + r * 0.7}, ${CX + hw} ${CY}`,
    `C ${CX + hw} ${CY + r * 0.5}, ${CX + hw * 0.6} ${bot - r * 0.1}, ${CX} ${bot}`,
    `C ${CX - hw * 0.6} ${bot - r * 0.1}, ${CX - hw} ${CY + r * 0.5}, ${CX - hw} ${CY}`,
    `C ${CX - hw} ${top + r * 0.7}, ${CX - hw * 0.6} ${top + r * 0.1}, ${CX} ${top}`,
    "Z",
  ].join(" ");
}


export function HatchArtifact({
  progress,
  state = "incubating",
  size = 400,
  cursorTilt = true,
  className,
}: HatchArtifactProps) {
  const reduced = useReducedMotion();
  const id = useMemo(() => Math.random().toString(36).slice(2, 9), []);

  // Resolve progress: prop > state conversion
  const resolvedProgress = progress ?? stateToProgress(state);
  const layers = artifactLerp(resolvedProgress);

  // ── Cursor tilt (3D perspective rotation) ──────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const sx = useSpring(rx, { stiffness: 140, damping: 22, mass: 0.7 });
  const sy = useSpring(ry, { stiffness: 140, damping: 22, mass: 0.7 });

  useEffect(() => {
    if (reduced || !cursorTilt || !rootRef.current) return;
    const el = rootRef.current;
    let raf = 0;
    let nextX = 0;
    let nextY = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) / (r.width / 2);
      const dy = (e.clientY - cy) / (r.height / 2);
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) { nextX = 0; nextY = 0; }
      else { nextX = -dy * 5; nextY = dx * 5; }  // max 5° tilt — subtler than the orb
      if (!raf) raf = requestAnimationFrame(() => { rx.set(nextX); ry.set(nextY); raf = 0; });
    };
    const onLeave = () => { rx.set(0); ry.set(0); };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [cursorTilt, reduced, rx, ry]);

  // ── Derived animation values ───────────────────────────────────────
  const breathDur = reduced ? 0 : (8 - layers.breathSpeed * 6); // 8s → 2s
  const shellSep = layers.shellSeparation;
  const isSplit = shellSep > 0.01;
  const halfDriftX = shellSep * 24;
  const halfDriftY = shellSep * 38;
  const upperHalfTransform = `translate(${halfDriftX} ${-halfDriftY}) rotate(${shellSep * 1.6} ${CX} ${CY})`;
  const lowerHalfTransform = `translate(${-halfDriftX} ${halfDriftY}) rotate(${-shellSep * 1.6} ${CX} ${CY})`;

  // Pre-compute paths
  const shellFullPath = useMemo(() => makeShellPath(), []);
  const shellInsetPath = useMemo(() => makeInsetPath(), []);
  const faultPath = useMemo(() => makePointPath(DIAGONAL_FAULT_POINTS), []);
  const faultBandPath = useMemo(() => makeFaultBandPath(18), []);
  const upperFaultClipPath = useMemo(() => makeFaultClipPath("upper"), []);
  const lowerFaultClipPath = useMemo(() => makeFaultClipPath("lower"), []);
  const corePath = useMemo(() => makeCorePath(), []);

  const faultOpacity = 0.1 + layers.glowIntensity * 0.7;

  return (
    <motion.div
      ref={rootRef}
      className={className}
      style={{
        width: size,
        height: typeof size === "number" ? size * (VB_H / VB_W) : "100%",
        position: "relative",
        isolation: "isolate",
        perspective: 800,
        transformStyle: "preserve-3d",
      }}
      aria-hidden
    >
      <motion.div
        style={{
          width: "100%",
          height: "100%",
          rotateX: sx,
          rotateY: sy,
          transformStyle: "preserve-3d",
          willChange: "transform",
        }}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          height="100%"
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            {/* Ceramic surface gradient — matte, warm, physically grounded */}
            <radialGradient id={`shell-fill-${id}`} cx="42%" cy="35%" r="65%">
              <stop offset="0%"  stopColor="var(--bg-surface)" stopOpacity={0.98} />
              <stop offset="34%" stopColor="var(--bg-subtle)" stopOpacity={0.98} />
              <stop offset="72%" stopColor="var(--rule-strong)" stopOpacity={0.88} />
              <stop offset="100%" stopColor="var(--ink-soft)" stopOpacity={0.64} />
            </radialGradient>

            {/* Highlight sheen — simulates directional light on ceramic */}
            <linearGradient id={`shell-sheen-${id}`} x1="30%" y1="0%" x2="70%" y2="100%">
              <stop offset="0%"  stopColor="#FFFFFF" stopOpacity={0.42} />
              <stop offset="34%" stopColor="#FFFFFF" stopOpacity={0.12} />
              <stop offset="66%" stopColor="#FFFFFF" stopOpacity={0} />
              <stop offset="100%" stopColor="#1A1815" stopOpacity={0.07} />
            </linearGradient>

            {/* Subsurface glow — warm light bleeding through material */}
            <radialGradient id={`glow-${id}`} cx="50%" cy="50%" r="45%">
              <stop offset="0%"  stopColor="#FFD7A6" stopOpacity={0.85} />
              <stop offset="30%" stopColor="#E89060" stopOpacity={0.5} />
              <stop offset="65%" stopColor="#C05A30" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#E04F2C" stopOpacity={0} />
            </radialGradient>

            {/* Core fill — the revealed payload */}
            <radialGradient id={`core-fill-${id}`} cx="48%" cy="45%" r="55%">
              <stop offset="0%"  stopColor="#FFE6C2" stopOpacity={0.95} />
              <stop offset="35%" stopColor="#FFCF96" stopOpacity={0.8} />
              <stop offset="70%" stopColor="#E09050" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#C05A30" stopOpacity={0.2} />
            </radialGradient>

            {/* Ambient halo */}
            <radialGradient id={`ambient-${id}`} cx="50%" cy="48%" r="50%">
              <stop offset="0%"  stopColor="#E04F2C" stopOpacity={0.1} />
              <stop offset="44%" stopColor="#E04F2C" stopOpacity={0.045} />
              <stop offset="100%" stopColor="#E04F2C" stopOpacity={0} />
            </radialGradient>

            <filter id={`shell-shadow-${id}`} x="-35%" y="-28%" width="170%" height="168%">
              <feDropShadow dx="0" dy="28" stdDeviation="22" floodColor="#1A1815" floodOpacity="0.18" />
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#1A1815" floodOpacity="0.12" />
            </filter>

            {/* Seam glow filter */}
            <filter id={`seam-glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" />
            </filter>

            {/* Fracture glow filter */}
            <filter id={`frac-glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>

            {/* Rim light filter — very subtle top edge highlight */}
            <filter id={`rim-${id}`} x="-5%" y="-5%" width="110%" height="110%">
              <feGaussianBlur stdDeviation="0.6" />
            </filter>

            {/* Clip path for the shell interior (hides core outside shell) */}
            <clipPath id={`shell-clip-${id}`}>
              <path d={shellFullPath} />
            </clipPath>
            <clipPath id={`fault-upper-${id}`}>
              <path d={upperFaultClipPath} />
            </clipPath>
            <clipPath id={`fault-lower-${id}`}>
              <path d={lowerFaultClipPath} />
            </clipPath>
          </defs>

          {/* ════════════════════════════════════════════════════════════
               LAYER 1: AMBIENT — environmental halo
               ════════════════════════════════════════════════════════════ */}
          <motion.ellipse
            cx={CX} cy={CY}
            rx={180} ry={210}
            fill={`url(#ambient-${id})`}
            initial={false}
            animate={reduced ? {} : {
              scale: [1, 1.04, 1],
              opacity: [layers.ambientScale * 0.7, layers.ambientScale, layers.ambientScale * 0.7],
            }}
            transition={reduced ? undefined : {
              duration: breathDur,
              repeat: Infinity,
              ease: ease.drift,
            }}
            style={{ transformOrigin: `${CX}px ${CY}px` }}
          />

          {/* ════════════════════════════════════════════════════════════
               LAYER 2: GLOW — subsurface light through seams
               ════════════════════════════════════════════════════════════ */}
          <motion.ellipse
            cx={CX} cy={CY}
            rx={75 + layers.glowIntensity * 20}
            ry={95 + layers.glowIntensity * 25}
            fill={`url(#glow-${id})`}
            opacity={layers.glowIntensity}
            initial={false}
            animate={reduced ? {} : {
              scale: [1, 1 + layers.glowIntensity * 0.15, 1],
              opacity: [
                layers.glowIntensity * 0.7,
                layers.glowIntensity,
                layers.glowIntensity * 0.7,
              ],
            }}
            transition={reduced ? undefined : {
              duration: breathDur * 0.8,
              repeat: Infinity,
              ease: ease.drift,
            }}
            style={{ transformOrigin: `${CX}px ${CY}px` }}
          />

          {layers.glowIntensity > 0.08 && (
            <motion.path
              d={faultPath}
              fill="none"
              stroke="#FFD7A6"
              strokeWidth={1 + layers.glowIntensity * 2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={faultOpacity}
              filter={`url(#seam-glow-${id})`}
              initial={false}
              animate={reduced ? {} : {
                opacity: [faultOpacity * 0.4, faultOpacity, faultOpacity * 0.4],
              }}
              transition={reduced ? undefined : {
                duration: breathDur * 0.65,
                repeat: Infinity,
                ease: ease.drift,
              }}
            />
          )}

          {/* ════════════════════════════════════════════════════════════
               LAYER 5: INNER CORE — the revealed payload
               (rendered before shell so shell occludes it; clip handles edge)
               ════════════════════════════════════════════════════════════ */}
          {layers.coreOpacity > 0.02 && (
            <g clipPath={isSplit ? undefined : `url(#shell-clip-${id})`}>
              <motion.path
                d={corePath}
                fill={`url(#core-fill-${id})`}
                opacity={layers.coreOpacity}
                initial={false}
                animate={reduced ? {} : {
                  scale: [1, 1 + layers.coreOpacity * 0.04, 1],
                  opacity: [
                    layers.coreOpacity * 0.85,
                    layers.coreOpacity,
                    layers.coreOpacity * 0.85,
                  ],
                }}
                transition={reduced ? undefined : {
                  duration: breathDur * 1.2,
                  repeat: Infinity,
                  ease: ease.drift,
                }}
                style={{
                  transformOrigin: `${CX}px ${CY}px`,
                  filter: layers.coreOpacity > 0.5
                    ? `drop-shadow(0 0 ${12 + layers.coreOpacity * 16}px rgba(255, 200, 140, ${layers.coreOpacity * 0.4}))`
                    : undefined,
                }}
              />
              {/* Core center ember */}
              <motion.ellipse
                cx={CX} cy={CY}
                rx={18} ry={24}
                fill="#FFE6C2"
                opacity={layers.coreOpacity * 0.7}
                initial={false}
                animate={reduced ? {} : {
                  scale: [1, 1.12, 1],
                  opacity: [layers.coreOpacity * 0.5, layers.coreOpacity * 0.8, layers.coreOpacity * 0.5],
                }}
                transition={reduced ? undefined : {
                  duration: breathDur * 0.7,
                  repeat: Infinity,
                  ease: ease.drift,
                }}
                style={{ transformOrigin: `${CX}px ${CY}px` }}
              />
            </g>
          )}

          {/* ════════════════════════════════════════════════════════════
               LAYER 3: OUTER SHELL — the capsule body
               ════════════════════════════════════════════════════════════ */}
          {isSplit ? (
            <>
              {/* Shell splits along the same jagged diagonal fault the user sees forming. */}
              <g clipPath={`url(#fault-upper-${id})`} transform={upperHalfTransform}>
                <path d={shellFullPath} fill={`url(#shell-fill-${id})`} filter={`url(#shell-shadow-${id})`} />
                <path d={shellFullPath} fill={`url(#shell-sheen-${id})`} />
                <path d={shellInsetPath} fill="none" stroke="rgba(26,24,21,0.13)" strokeWidth="0.7" opacity="0.54" />
              </g>
              <g clipPath={`url(#fault-lower-${id})`} transform={lowerHalfTransform}>
                <path d={shellFullPath} fill={`url(#shell-fill-${id})`} filter={`url(#shell-shadow-${id})`} />
                <path d={shellFullPath} fill={`url(#shell-sheen-${id})`} />
                <path d={shellInsetPath} fill="none" stroke="rgba(26,24,21,0.15)" strokeWidth="0.7" opacity="0.5" />
              </g>
              <path
                d={faultPath}
                transform={upperHalfTransform}
                fill="none"
                stroke="var(--rule-strong)"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.5}
              />
              <path
                d={faultPath}
                transform={lowerHalfTransform}
                fill="none"
                stroke="rgba(26,24,21,0.24)"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.42}
              />
              <motion.path
                d={faultBandPath}
                fill={`url(#core-fill-${id})`}
                opacity={layers.coreOpacity * 0.78}
                filter={`url(#frac-glow-${id})`}
                initial={false}
                animate={reduced ? {} : {
                  opacity: [
                    layers.coreOpacity * 0.5,
                    layers.coreOpacity * 0.82,
                    layers.coreOpacity * 0.5,
                  ],
                }}
                transition={reduced ? undefined : {
                  duration: breathDur,
                  repeat: Infinity,
                  ease: ease.drift,
                }}
              />
            </>
          ) : (
            <>
              {/* Unified shell */}
              <motion.path
                d={shellFullPath}
                fill={`url(#shell-fill-${id})`}
                filter={`url(#shell-shadow-${id})`}
                initial={false}
                animate={reduced ? {} : {
                  scale: [1, 1 + layers.breathSpeed * 0.015, 1],
                }}
                transition={reduced ? undefined : {
                  duration: breathDur,
                  repeat: Infinity,
                  ease: ease.drift,
                }}
                style={{ transformOrigin: `${CX}px ${CY}px` }}
              />
              {/* Sheen overlay */}
              <path d={shellFullPath} fill={`url(#shell-sheen-${id})`} />
            </>
          )}

          {!isSplit && (
            <>
              <path
                d={shellInsetPath}
                fill="none"
                stroke="rgba(26,24,21,0.16)"
                strokeWidth="0.8"
                opacity={0.5 + layers.glowIntensity * 0.18}
              />
            </>
          )}

          {layers.glowIntensity > 0.08 && !isSplit && (
            <motion.path
              d={faultPath}
              fill="none"
              stroke="#FFD7A6"
              strokeWidth={0.8 + layers.glowIntensity * 1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={faultOpacity * 0.7}
              filter={`url(#seam-glow-${id})`}
              initial={false}
              animate={reduced ? {} : {
                opacity: [faultOpacity * 0.38, faultOpacity * 0.78, faultOpacity * 0.38],
              }}
              transition={reduced ? undefined : {
                duration: breathDur * 0.72,
                repeat: Infinity,
                ease: ease.drift,
              }}
            />
          )}

          {/* Rim highlight — thin bright edge at top of capsule */}
          {!isSplit && (
            <path
              d={shellFullPath}
              fill="none"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="1"
              filter={`url(#rim-${id})`}
            />
          )}

          {/* Micro-bevel — interior edge shadow for depth */}
          {!isSplit && (
            <path
              d={shellFullPath}
              fill="none"
              stroke="rgba(26,24,21,0.18)"
              strokeWidth="0.5"
            />
          )}

          {/* ════════════════════════════════════════════════════════════
               LAYER 4: FRACTURE — hairline cracks
               ════════════════════════════════════════════════════════════ */}
          {layers.fractureReveal > 0.01 && (
            <g filter={`url(#frac-glow-${id})`}>
              {FRACTURE_PATHS.map((d, i) => (
                <motion.path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#FFC890"
                  strokeWidth={0.8 + layers.fractureReveal * 0.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  initial={false}
                  animate={{
                    strokeDashoffset: 1 - layers.fractureReveal * (0.5 + i * 0.09),
                    opacity: 0.3 + layers.fractureReveal * 0.6,
                  }}
                  transition={{
                    duration: 0.8,
                    ease: ease.reveal,
                  }}
                  style={{
                    strokeDasharray: 1,
                    filter: layers.fractureReveal > 0.3
                      ? `drop-shadow(0 0 ${3 + layers.fractureReveal * 5}px rgba(255, 200, 144, ${0.3 + layers.fractureReveal * 0.4}))`
                      : undefined,
                  }}
                />
              ))}
            </g>
          )}

          {layers.fractureReveal <= 0.01 && (
            <path
              d={faultPath}
              fill="none"
              stroke="rgba(26,24,21,0.1)"
              strokeWidth="0.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.34"
            />
          )}
        </svg>
      </motion.div>
    </motion.div>
  );
}
