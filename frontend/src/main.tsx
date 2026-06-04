/* Polyfill Node's `Buffer` global before any module that depends on it loads.
 * @piplabs/cdr-crypto's WASM wrapper calls `Buffer.alloc(...)` at runtime, which
 * blows up in the browser as "Buffer is not defined" during CDR vault encrypt. */
import { Buffer } from "buffer";
(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./design/styles.css";
import "./design/landing.css";
import "./design/console.css";
import "./motion/motion.css";

import { LenisProvider } from "./motion/lenis-provider.js";
import { Atmosphere } from "./motion/atmosphere.js";
import { RouteTransition } from "./motion/route-transition.js";
import { OrbStage } from "./motion/orb-stage.js";
import { HatchArtifact } from "./motion/hatch-artifact.js";
import { Chapter, Stage } from "./motion/chapter.js";

import { AppProviders } from "./lib/privy.js";
import { SiweProvider } from "./lib/siwe.js";
import { WebSocketProvider } from "./lib/ws.js";

import { App as Landing } from "./design/app.jsx";
import { ConsoleApp } from "./design/console_mount.jsx";

// DocsApp is lazy-loaded so the markdown + syntax-highlighting libs (react-markdown,
// remark-gfm, rehype-highlight, rehype-slug) do not weigh down the landing/console
// bundles. The /docs route is rarely the first page a visitor lands on.
const DocsApp = React.lazy(() => import("./design/docs_app.jsx").then((m) => ({ default: m.DocsApp })));

// Expose motion primitives to the (untyped) design JSX layer.
(globalThis as { HatchArtifact?: unknown; HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).HatchArtifact = HatchArtifact;
(globalThis as { HatchArtifact?: unknown; HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).HatchOrb = HatchArtifact; // backward compat alias
(globalThis as { HatchArtifact?: unknown; HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).Chapter = Chapter;
(globalThis as { HatchArtifact?: unknown; HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).Stage = Stage;

class DevErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[DevErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <pre style={{ position: "fixed", inset: 0, padding: 24, margin: 0, background: "#FFF7F2", color: "#1A1815", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", overflow: "auto", zIndex: 9999 }}>
          {`Render error\n\n${e?.name}: ${e?.message}\n\n${e?.stack ?? ""}`}
        </pre>
      );
    }
    return this.props.children;
  }
}

function AppRouter() {
  return (
    <BrowserRouter>
      <Atmosphere />
      <OrbStage />
      <RouteTransition>
        <DevErrorBoundary>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/console" element={<ConsoleApp />} />
            <Route path="/console/*" element={<ConsoleApp />} />
            <Route path="/docs" element={<React.Suspense fallback={null}><DocsApp /></React.Suspense>} />
            <Route path="/docs/*" element={<React.Suspense fallback={null}><DocsApp /></React.Suspense>} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </DevErrorBoundary>
      </RouteTransition>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <SiweProvider>
        <WebSocketProvider>
          <LenisProvider>
            <AppRouter />
          </LenisProvider>
        </WebSocketProvider>
      </SiweProvider>
    </AppProviders>
  </React.StrictMode>,
);
