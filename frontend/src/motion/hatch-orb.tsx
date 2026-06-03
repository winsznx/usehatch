/* HatchOrb — the signature, persistent Hatch artifact.
 *
 * Physically believable: a glowing core suspended inside layered orbiting rings,
 * surrounded by particle satellites, with organic fissure cracks that emerge as
 * state advances. The orb responds to cursor proximity with subtle perspective
 * tilt (3D rotation, CSS transform only — GPU-cheap).
 *
 * State machine (discrete beats, not just continuous animation):
 *   sealed     — rings tight + slow, core dim, no fissures, particles bound
 *   incubating — rings drift, core warms and pulses, particles loosen
 *   hatching   — rings accelerate, fissures form, core pulses urgently, particles escape
 *   public     — rings open, fissures complete, core radiates calmly, particles stable
 *
 * This is THE system artifact — same component used in Landing Hero, Console
 * Rail, and per-view headers. OrbStage portals it across routes with FM
 * spring animation; the orb's internal state machine handles the rest. */

import { useMemo, useRef, useEffect } from "react";
import { motion, useReducedMotion, useMotionValue, useSpring } from "framer-motion";
import { ease, stateTempo, type HatchState } from "./tokens.js";

interface HatchOrbProps {
  state?: HatchState;
  size?: number;
  /** Show fissures (cracks that grow as state advances). Default true. */
  fissures?: boolean;
  /** Show orbiting particles. Default true at size >= 120. */
  particles?: boolean;
  /** React to cursor proximity with 3D perspective tilt. Default true. */
  cursorTilt?: boolean;
  className?: string;
}

export function HatchOrb({
  state = "incubating",
  size = 360,
  fissures = true,
  particles,
  cursorTilt = true,
  className,
}: HatchOrbProps) {
  const reduced = useReducedMotion();
  const tempo = stateTempo[state];
  const id = useMemo(() => Math.random().toString(36).slice(2, 9), []);
  const showParticles = particles ?? size >= 120;

  // Fissure progression: 0 = no crack, 1 = fully open
  const fissureProgress = state === "sealed" ? 0 : state === "incubating" ? 0.16 : state === "hatching" ? 0.68 : 1;

  // Cursor-aware perspective tilt (3D rotation on x/y axes).
  // The orb feels like a physical object when you move the cursor near it.
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
      // Only react within a 1.5× radius — feels intentional, not jumpy.
      if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) { nextX = 0; nextY = 0; }
      else { nextX = -dy * 7; nextY = dx * 7; }  // max 7° tilt
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

  // Particle satellite positions — placed deterministically on a ring so they
  // re-render cleanly without flicker.
  const particleSpec = useMemo(() => {
    if (!showParticles) return [];
    const n = 8;
    return Array.from({ length: n }, (_, i) => ({
      angle: (i / n) * Math.PI * 2,
      radius: 170 + (i % 3) * 12,
      speed:  18 + (i % 4) * 5,
      size: 2 + (i % 3),
    }));
  }, [showParticles]);

  const breathDur = reduced ? 0 : tempo.breath;
  const pulseDur = reduced ? 0 : 1.6;

  // Fissure paths — organic, jagged lines that radiate from the center.
  // We pre-compute multiple fissure segments and reveal them via path-length animation.
  const fissurePaths = useMemo(() => [
    "M 200 200 L 240 130 L 252 90",
    "M 200 200 L 290 220 L 332 240",
    "M 200 200 L 165 280 L 150 320",
    "M 200 200 L 100 195 L 60 200",
    "M 200 200 L 210 110 L 192 70",
  ], []);

  return (
    <motion.div
      ref={rootRef}
      className={className}
      style={{
        width: size,
        height: size,
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
        <svg viewBox="0 0 400 400" width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
          <defs>
            {/* Core gradient — deep ember through to outer shell */}
            <radialGradient id={`c-${id}`} cx="42%" cy="38%" r="58%">
              <stop offset="0%"  stopColor="#FFD7A6" stopOpacity={tempo.opacity} />
              <stop offset="18%" stopColor="#F09060" stopOpacity={tempo.opacity * 0.9} />
              <stop offset="55%" stopColor="#3a1a0c" stopOpacity={tempo.opacity * 0.88} />
              <stop offset="100%" stopColor="#0a0503" stopOpacity={0.97} />
            </radialGradient>

            {/* Outer halo — vermilion glow strength tied to state pulse */}
            <radialGradient id={`h-${id}`} cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#E04F2C" stopOpacity={0.12 + tempo.pulse * 0.2} />
              <stop offset="100%" stopColor="#E04F2C" stopOpacity={0} />
            </radialGradient>

            {/* Rim sheen — gives the shell physical weight */}
            <linearGradient id={`r-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"  stopColor="rgba(255,255,255,0.55)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.18)" />
            </linearGradient>

            {/* Inner glow for the core (separate from main core gradient) */}
            <radialGradient id={`g-${id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFE6C2" stopOpacity={0.95} />
              <stop offset="40%" stopColor="#FF9F60" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#E04F2C" stopOpacity={0} />
            </radialGradient>

            {/* Fissure glow — internal light leaking through cracks */}
            <filter id={`f-${id}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>

          {/* Outer halo — slow drift, never stops */}
          <motion.circle
            cx="200" cy="200" r="195"
            fill={`url(#h-${id})`}
            initial={false}
            animate={reduced ? {} : { scale: [1, 1.06, 1], opacity: [0.6, 1, 0.6] }}
            transition={reduced ? undefined : { duration: breathDur, repeat: Infinity, ease: ease.drift }}
            style={{ transformOrigin: "200px 200px" }}
          />

          {/* Outermost orbit ring — thin, dashed, drifts slowly */}
          <motion.g
            initial={false}
            animate={reduced ? {} : { rotate: 360 }}
            transition={reduced ? undefined : { duration: 70 / Math.max(0.3, tempo.pulse + 0.5), repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "200px 200px" }}
          >
            <circle cx="200" cy="200" r="158" fill="none" stroke="rgba(212, 200, 178, 0.42)" strokeWidth="1" strokeDasharray="2 6" />
            <circle cx="200" cy="200" r="158" fill="none" stroke="rgba(224, 79, 44, 0.22)" strokeWidth="3" pathLength="1" strokeDasharray="0.16 0.84" />
          </motion.g>

          {/* Middle orbit — counter-rotation for parallax */}
          <motion.g
            initial={false}
            animate={reduced ? {} : { rotate: -360 }}
            transition={reduced ? undefined : { duration: 95 / Math.max(0.3, tempo.pulse + 0.5), repeat: Infinity, ease: "linear" }}
            style={{ transformOrigin: "200px 200px" }}
          >
            <circle cx="200" cy="200" r="128" fill="none" stroke="rgba(212, 200, 178, 0.7)" strokeWidth="1" />
            {/* Punctuation marks at cardinal directions */}
            {[0, 90, 180, 270].map((deg) => (
              <circle
                key={deg}
                cx={200 + 128 * Math.cos((deg * Math.PI) / 180)}
                cy={200 + 128 * Math.sin((deg * Math.PI) / 180)}
                r="2.5"
                fill="rgba(224, 79, 44, 0.6)"
              />
            ))}
          </motion.g>

          {/* Particle satellites — small dots orbiting on independent loops */}
          {showParticles && particleSpec.map((p, i) => (
            <motion.g
              key={i}
              initial={false}
              animate={reduced ? {} : { rotate: 360 }}
              transition={reduced ? undefined : { duration: p.speed / Math.max(0.4, tempo.pulse + 0.5), repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: "200px 200px" }}
            >
              <motion.circle
                cx={200 + p.radius * Math.cos(p.angle)}
                cy={200 + p.radius * Math.sin(p.angle)}
                r={p.size}
                fill="rgba(224, 79, 44, 0.7)"
                initial={false}
                animate={reduced ? {} : { opacity: [0.4, 0.95, 0.4] }}
                transition={reduced ? undefined : { duration: 2 + (i % 3), repeat: Infinity, ease: ease.drift, delay: i * 0.12 }}
              />
            </motion.g>
          ))}

          {/* Body — the shell with rim sheen */}
          <motion.circle
            cx="200" cy="200" r="118"
            fill={`url(#c-${id})`}
            initial={false}
            animate={reduced ? {} : { scale: [1, 1.018, 1] }}
            transition={reduced ? undefined : { duration: breathDur, repeat: Infinity, ease: ease.drift }}
            style={{ transformOrigin: "200px 200px" }}
          />
          <circle cx="200" cy="200" r="118" fill={`url(#r-${id})`} opacity={0.75} />

          {/* Fissures — organic cracks that grow as state advances */}
          {fissures && fissureProgress > 0 && (
            <g filter={`url(#f-${id})`}>
              {fissurePaths.map((d, i) => (
                <motion.path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#FFC890"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  pathLength="1"
                  initial={false}
                  animate={{
                    strokeDashoffset: 1 - fissureProgress * (0.6 + i * 0.08),
                    opacity: 0.4 + fissureProgress * 0.5,
                  }}
                  transition={{ duration: 1.6, ease: ease.reveal, delay: i * 0.05 }}
                  style={{ strokeDasharray: 1, filter: "drop-shadow(0 0 4px rgba(255,200,144,0.55))" }}
                />
              ))}
            </g>
          )}

          {/* Inner glow halo — separate from main core, gives depth */}
          <motion.circle
            cx="200" cy="200" r="46"
            fill={`url(#g-${id})`}
            initial={false}
            animate={reduced ? {} : { scale: [1, 1 + tempo.pulse * 0.3, 1], opacity: [0.6, 0.95, 0.6] }}
            transition={reduced ? undefined : { duration: pulseDur, repeat: Infinity, ease: ease.drift }}
            style={{ transformOrigin: "200px 200px" }}
          />

          {/* Core — the ember at the heart, state-driven pulse */}
          <motion.circle
            cx="200" cy="200" r="20"
            fill="#E04F2C"
            initial={false}
            animate={reduced ? {} : {
              scale: [1, 1 + tempo.pulse * 0.6, 1],
              opacity: [0.88, 1, 0.88],
            }}
            transition={reduced ? undefined : { duration: pulseDur, repeat: Infinity, ease: ease.drift }}
            style={{
              transformOrigin: "200px 200px",
              filter: tempo.pulse > 0.2 ? "drop-shadow(0 0 22px rgba(224, 79, 44, 0.65))" : undefined,
            }}
          />

          {/* Cardinal seam ring around the core */}
          <motion.circle
            cx="200" cy="200" r="32"
            fill="none"
            stroke="#FAF7F2"
            strokeWidth="1.5"
            opacity={0.5}
            initial={false}
            animate={reduced ? {} : { scale: [1, 1.18, 1], opacity: [0.45, 0.65, 0.45] }}
            transition={reduced ? undefined : { duration: pulseDur * 1.6, repeat: Infinity, ease: ease.drift }}
            style={{ transformOrigin: "200px 200px" }}
          />

          {/* Equatorial seam — the dominant fissure across the orb's middle */}
          {fissures && fissureProgress > 0 && (
            <motion.line
              x1={200 - (160 * fissureProgress) / 2} y1="200"
              x2={200 + (160 * fissureProgress) / 2} y2="200"
              stroke="#FFC890"
              strokeWidth="2"
              strokeLinecap="round"
              initial={false}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: ease.drift }}
              style={{ filter: "drop-shadow(0 0 8px rgba(255, 184, 112, 0.7))" }}
            />
          )}
        </svg>
      </motion.div>
    </motion.div>
  );
}
