/* Chapter — the unit of narrative in the Landing journey.
 *
 * Calibrated against the reference's actual motion DNA:
 *   - GSAP ScrollTrigger with `pin: true` so each scene HOLDS the viewport
 *     while its choreography plays out (cinematic camera-hold, not slide-past).
 *   - `scrub: 1` so scroll-linked transforms have the 1s smoothing window —
 *     this is the "weighted, settling" feel that defines premium scroll.
 *   - Each chapter occupies ~200% of viewport height of scroll distance.
 *   - The mask-reveal entrance uses `cubic-bezier(.19, 1, .22, 1)` — the
 *     decisive Apple expo-out.
 *
 * Result: scrolling feels like the camera moving through one continuous
 * scene rather than slides shuffling onto a stack. The chapter doesn't
 * "appear" — the camera pulls focus to it. */

import { useRef, useEffect, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ease, dur, SCRUB, CHAPTER_HOLD } from "./tokens.js";
// ScrollTrigger is registered once in LenisProvider, which also handles
// the lenis.on("scroll", ScrollTrigger.update) sync + GSAP ticker driving
// Lenis RAF. Chapter does NOT subscribe to Lenis directly — that would
// cause duplicate update calls and stutter on trackpad wheel.

interface ChapterProps {
  children: ReactNode;
  /** Pin the chapter to the viewport while its inner choreography plays.
   *  Default true for non-hero chapters. Hero passes false (it owns the top). */
  pin?: boolean;
  /** Apply mask-reveal entrance choreography. Default true. */
  reveal?: boolean;
  /** Parallax depth — drives the foreground vs background displacement during
   *  pin. 0 = static, 1 = strong displacement. Default 0.4. */
  depth?: number;
  /** Scroll length the chapter holds, as a multiplier of viewport height.
   *  Default matches the system token (200 = 2× vh). */
  hold?: number;
  className?: string;
  id?: string;
}

export function Chapter({
  children, pin = true, reveal = true, depth = 0.4,
  hold = CHAPTER_HOLD, className, id,
}: ChapterProps) {
  const wrap = useRef<HTMLDivElement>(null);   // pin target
  const inner = useRef<HTMLDivElement>(null);  // parallax target
  const inView = useInView(wrap, { amount: 0.15, margin: "0px 0px -10% 0px" });
  const reduced = useReducedMotion();

  // GSAP ScrollTrigger handles pinning + scroll-scrubbed parallax. FM owns
  // the discrete clip-path reveal at entrance. ScrollTrigger ↔ Lenis sync is
  // set up once in LenisProvider; this Chapter is purely a consumer.
  useEffect(() => {
    if (reduced || !wrap.current) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap.current!,
          start: "top top",
          end: `+=${hold}%`,
          scrub: SCRUB,
          pin: pin,
          pinSpacing: true,
          anticipatePin: 1,
        },
      });

      if (inner.current && depth > 0) {
        // Parallax displacement: the chapter's content gently rises during
        // its scroll hold — gives the impression of camera depth.
        tl.fromTo(
          inner.current,
          { y: 80 * depth, scale: 1 + depth * 0.02, opacity: 0.92 },
          { y: -60 * depth, scale: 1, opacity: 1, ease: "none" },
          0,
        );
      }
    }, wrap);

    return () => ctx.revert();
  }, [reduced, pin, hold, depth]);

  // Reduced motion: ship it static and accessible.
  if (reduced) {
    return <section ref={wrap} id={id} className={className}>{children}</section>;
  }

  return (
    <section ref={wrap} id={id} className={className} style={{ position: "relative" }}>
      <div ref={inner} style={{ willChange: "transform, opacity" }}>
        {reveal ? (
          <motion.div
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={inView ? { clipPath: "inset(0 0 0% 0)" } : undefined}
            transition={{ duration: dur.cinematic, ease: ease.reveal }}
            style={{ willChange: "clip-path" }}
          >
            {children}
          </motion.div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** Stage — a parallax companion inside a Chapter. Use for subtitles, mono
 *  readouts, decorative rules — anything that should feel like it lives at
 *  a different physical distance from the main type. Now ScrollTrigger-driven. */
export function Stage({ children, depth = 0.6, className }: { children: ReactNode; depth?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ref.current!,
        { y: 30 * depth },
        {
          y: -30 * depth,
          ease: "none",
          scrollTrigger: {
            trigger: ref.current!,
            start: "top bottom",
            end: "bottom top",
            scrub: SCRUB,
          },
        },
      );
    }, ref);
    return () => ctx.revert();
  }, [reduced, depth]);

  return <div ref={ref} className={className} style={{ willChange: "transform" }}>{children}</div>;
}
