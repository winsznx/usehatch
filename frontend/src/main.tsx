import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import "./design/styles.css";
import "./design/landing.css";
import "./design/console.css";
import "./motion/motion.css";

import { LenisProvider } from "./motion/lenis-provider.js";
import { Atmosphere } from "./motion/atmosphere.js";
import { RouteTransition } from "./motion/route-transition.js";
import { OrbStage } from "./motion/orb-stage.js";
import { HatchOrb } from "./motion/hatch-orb.js";
import { Chapter, Stage } from "./motion/chapter.js";

import { wagmiConfig, hatchLightTheme } from "./lib/wagmi.js";
import { queryClient } from "./lib/queries.js";
import { SiweProvider } from "./lib/siwe.js";
import { WebSocketProvider } from "./lib/ws.js";

import { App as Landing } from "./design/app.jsx";
import { ConsoleApp } from "./design/console_mount.jsx";

// Expose motion primitives to the (untyped) design JSX layer.
(globalThis as { HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).HatchOrb = HatchOrb;
(globalThis as { HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).Chapter = Chapter;
(globalThis as { HatchOrb?: unknown; Chapter?: unknown; Stage?: unknown }).Stage = Stage;

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
            <Route path="*" element={<Landing />} />
          </Routes>
        </DevErrorBoundary>
      </RouteTransition>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={hatchLightTheme} modalSize="compact">
          <SiweProvider>
            <WebSocketProvider>
              <LenisProvider>
                <AppRouter />
              </LenisProvider>
            </WebSocketProvider>
          </SiweProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
