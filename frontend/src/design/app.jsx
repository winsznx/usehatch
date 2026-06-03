import React from "react";
import { Atmosphere, Header, Hero, Lifecycle, Manifesto } from "./landing_a.jsx";
import { Closing, Footer, LiveProof, Trust } from "./landing_b.jsx";

/* The Chapter primitive lives in our motion module — but the design layer is
 * untyped JSX. Pull it from globalThis (main.tsx exposes it), with a graceful
 * pass-through fallback so the page still works if motion fails to load. */
const Chapter = (typeof globalThis !== "undefined" && globalThis.Chapter)
  ? globalThis.Chapter
  : ({ children, id }) => <section id={id}>{children}</section>;

/* Hatch — landing page as a narrative journey.
 *
 * The Hero is unpinned: it owns the opening shot, free to scroll naturally
 * as the user begins. Every subsequent chapter is pinned via GSAP
 * ScrollTrigger — the viewport HOLDS while inner parallax + reveal
 * choreography plays. Result: scrolling feels like the camera moving
 * through one continuous scene, not slides shuffling past.
 *
 * Depth values progress so the camera feels like it's pulling further into
 * the page; the Atmosphere layer behind everything ties it into one room. */
const { useState: useStateApp } = React;

export function App() {
  const [theme, setTheme] = useStateApp("light"); // light default per spec; no storage (hard constraint)
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return (
    <>
      <Atmosphere />
      <Header theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />
      <div className="lp-shell">
        <main>
          {/* Hero: unpinned. The opening shot scrolls naturally. */}
          <Chapter pin={false} reveal={false} depth={0} id="ch-hero"><Hero /></Chapter>

          {/* Manifesto: the first held scene. Patient hold; gentle depth. */}
          <Chapter depth={0.35} hold={90} id="ch-manifesto"><Manifesto /></Chapter>

          {/* Lifecycle: the system explained. Longer hold; deeper parallax. */}
          <Chapter depth={0.5} hold={110} id="ch-lifecycle"><Lifecycle /></Chapter>

          {/* LiveProof: the feed reveals — shorter hold so cards have room to breathe. */}
          <Chapter depth={0.4} hold={85} id="ch-proof"><LiveProof /></Chapter>

          {/* Trust: the foundation. Calm hold. */}
          <Chapter depth={0.35} hold={80} id="ch-trust"><Trust /></Chapter>

          {/* Closing: the resolution. Decisive hold, full depth. */}
          <Chapter depth={0.55} hold={90} id="ch-closing"><Closing /></Chapter>
        </main>
        <Footer />
      </div>
    </>
  );
}
