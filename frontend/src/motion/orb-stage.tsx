/* OrbStage — the persistent HatchOrb above the route tree.
 *
 * The orb is rendered once at the top of the layout (z above Atmosphere,
 * z below interactive content). Routes don't render their own orb; instead,
 * each route declares a destination by placing a `[data-orb-anchor]` element
 * in its DOM. The OrbStage observes the document for the active anchor,
 * reads its bounding rect, and animates the orb to fill it.
 *
 * On route change, the orb morphs both POSITION (rect) and STATE (sealed →
 * incubating → hatching → public) via FM spring + the orb's internal
 * state-machine. There is one continuous artifact across the whole app.
 *
 * Anchor element protocol:
 *   <div data-orb-anchor data-orb-state="incubating" />
 *
 * The OrbStage element itself has pointer-events: none so it never blocks
 * interaction with content underneath. */

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { HatchOrb } from "./hatch-orb.js";
import type { HatchState } from "./tokens.js";

interface OrbTarget {
  left: number;
  top: number;
  width: number;
  height: number;
  state: HatchState;
}

const DEFAULT_TARGET: OrbTarget = {
  left: -9999, top: -9999, width: 0, height: 0, state: "incubating",
};

export function OrbStage() {
  const [target, setTarget] = useState<OrbTarget>(DEFAULT_TARGET);
  const location = useLocation();
  const lastAnchorRef = useRef<Element | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector("[data-orb-anchor]");
      if (!el) {
        // No anchor in the current route (e.g., the Console pages render a
        // static logo mark instead of the animated orb). Reset to the
        // off-screen sentinel so the orb doesn't hover at its last position.
        lastAnchorRef.current = null;
        setTarget(DEFAULT_TARGET);
        return;
      }
      lastAnchorRef.current = el;
      const r = el.getBoundingClientRect();
      const state = (el.getAttribute("data-orb-state") as HatchState) || "incubating";
      setTarget({ left: r.left, top: r.top, width: r.width, height: r.height, state });
    };

    // Re-measure on every layout-affecting event. RAF-throttled so scroll
    // (especially with smooth scroll) doesn't drown us.
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; measure(); });
    };

    measure();

    // MutationObserver — anchor element added/removed on route change.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-orb-anchor", "data-orb-state"] });

    // ResizeObserver — anchor's size changes (window resize, content shift).
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [location.pathname]);

  // While the anchor is offscreen sentinel, render but hidden.
  const visible = target.width > 0 && target.height > 0;

  return (
    <motion.div
      aria-hidden
      animate={{
        x: target.left,
        y: target.top,
        width: target.width,
        height: target.height,
        opacity: visible ? 1 : 0,
      }}
      transition={{
        x:        { type: "spring", stiffness: 140, damping: 26, mass: 0.9 },
        y:        { type: "spring", stiffness: 140, damping: 26, mass: 0.9 },
        width:    { type: "spring", stiffness: 120, damping: 24, mass: 1.0 },
        height:   { type: "spring", stiffness: 120, damping: 24, mass: 1.0 },
        opacity:  { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
      }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 1,
        willChange: "transform, width, height, opacity",
      }}
    >
      <HatchOrb
        state={target.state}
        size={Math.min(target.width, target.height)}
        particles={Math.min(target.width, target.height) >= 120}
        cursorTilt={Math.min(target.width, target.height) >= 180}
      />
    </motion.div>
  );
}
