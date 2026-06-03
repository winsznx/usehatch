/* LenisProvider — momentum-based smooth scroll, GSAP-synced.
 *
 * Canonical Lenis + GSAP ScrollTrigger integration:
 *   1. GSAP's own ticker drives Lenis's RAF (one animation frame loop)
 *   2. Lenis emits 'scroll' → ScrollTrigger.update() — pinned chapters track
 *   3. lagSmoothing(0) so GSAP doesn't skip frames
 *
 * StrictMode-safe: the Lenis instance lives inside useEffect (not useMemo) so
 * React's dev-mode double-invoke creates a fresh instance each run. With
 * useMemo + effect-destroy, the second effect run would reattach to a
 * destroyed Lenis and silently no-op every wheel event. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const LenisContext = createContext<Lenis | null>(null);

export function useLenis(): Lenis | null {
  return useContext(LenisContext);
}

export function LenisProvider({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);

  useEffect(() => {
    // Create the instance HERE so each effect-run owns its own (StrictMode-safe).
    const l = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.4,
      orientation: "vertical",
      gestureOrientation: "vertical",
      syncTouch: false,
    });
    setLenis(l);

    // Lenis → ScrollTrigger sync
    const onScroll = () => ScrollTrigger.update();
    l.on("scroll", onScroll);

    // GSAP ticker → Lenis RAF (single animation loop)
    const tick = (time: number) => l.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // Keyboard scroll
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const vh = window.innerHeight;
      const step = (delta: number) => {
        e.preventDefault();
        l.scrollTo(l.scroll + delta, { lock: false, force: true });
      };
      switch (e.key) {
        case "ArrowDown":              return step(120);
        case "ArrowUp":                return step(-120);
        case "PageDown":               return step(vh * 0.9);
        case "PageUp":                 return step(-vh * 0.9);
        case " ":
        case "Spacebar":               return step(e.shiftKey ? -vh * 0.9 : vh * 0.9);
        case "Home": {
          e.preventDefault();
          l.scrollTo(0, { lock: false, force: true });
          return;
        }
        case "End": {
          e.preventDefault();
          l.scrollTo(document.documentElement.scrollHeight, { lock: false, force: true });
          return;
        }
        default: return;
      }
    };
    window.addEventListener("keydown", onKey, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKey);
      gsap.ticker.remove(tick);
      l.off("scroll", onScroll);
      l.destroy();
    };
  }, []);

  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}
