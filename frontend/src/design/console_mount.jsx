import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rail, TopBar, useRoute } from "./console_shell.jsx";
import { Compose } from "./view_compose.jsx";
import { HatchDetail } from "./view_hatch.jsx";
import { Publisher, TrackRecord } from "./view_publisher.jsx";
import { Publishers } from "./view_publishers.jsx";
import { Queue, Timeline } from "./view_timeline.jsx";

/* Hatch Console — app mount + per-view transition choreography.
 *
 * View changes inside the Console are NOT cinematic (no pin scrolling) — they
 * need to feel responsive and immediate, like a film cut, not a slow camera
 * pan. AnimatePresence handles the swap; each view enters with a clip-path
 * slit opening top-down + slight scale lift, and exits the same way reversed.
 * The persistent OrbStage in the top-level layout morphs its position/state
 * concurrently, so the user feels one continuous space.
 *
 * Easing matches the system's Apple-grade expo-out — same curve language as
 * the Landing chapter reveals. Duration is shorter (0.5s) because Console
 * users navigate frequently and shouldn't wait for choreography. */
const { useState: useStateApp, useEffect: useEffectApp } = React;

const viewTransition = { duration: 0.5, ease: [0.19, 1, 0.22, 1] };

export function ConsoleApp() {
  const [theme, setTheme] = useStateApp("light");
  const [route, go] = useRoute();
  const [nearestState, setNearestState] = useStateApp("incubating");

  useEffectApp(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const VIEWS = {
    timeline: Timeline,
    queue: Queue,
    publishers: Publishers,
    publisher: Publisher,
    record: TrackRecord,
    hatch: HatchDetail,
    compose: Compose,
  };
  const View = VIEWS[route] || Timeline;

  return (
    <div className="console">
      <Rail route={route} go={go} />
      <div className="workspace">
        <TopBar route={route} theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          nearestState={nearestState} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route}
            initial={{ opacity: 0, scale: 1.012, clipPath: "inset(6% 0 0 0)" }}
            animate={{ opacity: 1, scale: 1,     clipPath: "inset(0% 0 0 0)" }}
            exit={{    opacity: 0, scale: 0.994, clipPath: "inset(0 0 6% 0)" }}
            transition={viewTransition}
            style={{ willChange: "transform, opacity, clip-path", flex: 1, minHeight: 0 }}
          >
            <View onNearestState={setNearestState} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
