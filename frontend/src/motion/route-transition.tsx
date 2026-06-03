/* RouteTransition — choreographs the change between Landing and Console.
 *
 * Outgoing scene recedes: scale 1 → 0.96, opacity 1 → 0, clip-path closing
 * from the bottom up. Incoming scene arrives: clip opens from the top, scale
 * 1.02 → 1, opacity 0 → 1. The two crossfade with overlap so the page is
 * never blank — there's always something on screen, the camera just pans.
 *
 * Lenis is told to ScrollTo(0) on route enter so each route opens at its
 * own beginning, but the motion makes that feel intentional, not abrupt. */

import { AnimatePresence, motion, type Transition } from "framer-motion";
import { useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { useLenis } from "./lenis-provider.js";
import { ease, dur } from "./tokens.js";

const enter: Transition = { duration: dur.slow, ease: ease.reveal };
// `exit` timing is set inline on the motion element below.

export function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const lenis = useLenis();

  useEffect(() => {
    // Snap to top on route change — but instantly, so the choreography starts clean.
    lenis?.scrollTo(0, { immediate: true });
  }, [location.pathname, lenis]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, scale: 1.015, clipPath: "inset(8% 0 0 0)" }}
        animate={{ opacity: 1, scale: 1,     clipPath: "inset(0% 0 0 0)" }}
        exit={{    opacity: 0, scale: 0.985, clipPath: "inset(0 0 8% 0)" }}
        transition={enter}
        style={{ willChange: "transform, opacity, clip-path", minHeight: "100vh" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
