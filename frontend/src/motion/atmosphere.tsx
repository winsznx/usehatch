/* Atmosphere — a single fixed, continuous background that lives across every
 * route. Two warm radial fields drift on independent slow oscillations; a
 * vignette anchors the corners. This is the spatial element that makes every
 * page feel like the same room, regardless of route. */

import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ease } from "./tokens.js";

export function Atmosphere() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();

  // The hot field slowly shifts vertically with overall page scroll — gives
  // a sense of "the scene moves slightly as you descend".
  const hotShift = useTransform(scrollYProgress, [0, 1], ["-2%", "8%"]);
  const coolShift = useTransform(scrollYProgress, [0, 1], ["3%", "-5%"]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
        background: "var(--bg-paper)",
        overflow: "hidden",
      }}
    >
      {/* Hot field — warm vermilion glow, drifts across the page */}
      <motion.div
        initial={false}
        animate={reduced ? {} : { x: ["-8%", "8%", "-8%"], y: ["-4%", "5%", "-4%"] }}
        transition={reduced ? undefined : { duration: 38, repeat: Infinity, ease: ease.drift }}
        style={{
          position: "absolute",
          inset: "-20%",
          background: "radial-gradient(50% 40% at 30% 35%, rgba(224, 79, 44, 0.12) 0%, rgba(224, 79, 44, 0) 65%)",
          y: hotShift,
          willChange: "transform",
        }}
      />
      {/* Cool field — desaturated warm cream, counter-orbit */}
      <motion.div
        initial={false}
        animate={reduced ? {} : { x: ["6%", "-6%", "6%"], y: ["3%", "-4%", "3%"] }}
        transition={reduced ? undefined : { duration: 52, repeat: Infinity, ease: ease.drift }}
        style={{
          position: "absolute",
          inset: "-20%",
          background: "radial-gradient(45% 35% at 75% 65%, rgba(194, 141, 58, 0.10) 0%, rgba(194, 141, 58, 0) 60%)",
          y: coolShift,
          willChange: "transform",
        }}
      />
      {/* Vignette — anchors corners, gives the impression of depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(26, 24, 21, 0.06) 100%)",
        }}
      />
    </div>
  );
}
