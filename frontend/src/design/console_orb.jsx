import React from "react";
import { Reveal } from "./primitives.jsx";
/* Hatch Console — the Hatch object as a stateful mascot + state indicator.
   States: sealed (no motion) · incubating (slow pulse) · hatching (fracture) · public (exposed, stable)
   Sizes: any px via `size`. Used in topbar (pip), queue hero, hatch detail, profile. */
const { useState: useStateO, useEffect: useEffectO, useRef: useRefO } = React;

function HatchOrb({ state = "incubating", size = 220, rings = true, seam = true }) {
  return (
    <div className="orb" data-state={state} style={{ width: size, height: size }}>
      {rings && (
        <>
          <div className="orb-ring orb-ring--1"></div>
          <div className="orb-ring orb-ring--2"></div>
          <div className="orb-ring orb-ring--3"></div>
        </>
      )}
      <div className="orb-core">
        {seam && <span className="orb-seam"></span>}
        <span className="orb-ember"></span>
        <span className="orb-fracture" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </div>
    </div>
  );
}
export { HatchOrb };

/* A tiny inline orb pip for the top bar — reflects the nearest reveal's state. */
function OrbPip({ state = "incubating", size = 26 }) {
  return <HatchOrb state={state} size={size} rings={false} seam={false} />;
}
export { OrbPip };

/* ---------- Reveal countdown that drives state transitions ---------- */
/* Returns a lifecycle state from ms-to-reveal: sealed (>24h) · incubating (<24h) · hatching (~0) · public (<0) */
function stateFromMs(ms) {
  if (ms <= 0) return "public";
  if (ms <= 3000) return "hatching";
  if (ms <= 24 * 3600 * 1000) return "incubating";
  return "sealed";
}
export { stateFromMs };

/* ---------- Big mono countdown (console flavor — splits units) ---------- */
function BigCountdown({ revealAt, onState }) {
  const [, force] = useStateO(0);
  useEffectO(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = revealAt - Date.now();
  useEffectO(() => { onState && onState(stateFromMs(ms)); });
  if (ms <= 0) {
    return <span className="bigcount is-public">UNSEALED</span>;
  }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
  const hot = ms <= 5 * 60 * 1000;
  const pad = (n) => String(n).padStart(2, "0");
  const units = [];
  if (d > 0) units.push([d, "D"]);
  units.push([pad(h), "H"], [pad(mi), "M"], [pad(se), "S"]);
  return (
    <span className={"bigcount" + (hot ? " is-hot" : "")}>
      {units.map(([v, u], i) => (
        <span className="bigcount-unit" key={i}>
          <span className="bigcount-v">{v}</span>
          <span className="bigcount-u">{u}</span>
        </span>
      ))}
    </span>
  );
}
export { BigCountdown };

/* ---------- Sparkline / reputation curve (editorial, not a chart card) ---------- */
function Curve({ data, width = 640, height = 180, accent = "var(--hot)", markers = null, fill = true, axis = true }) {
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 6;
  const span = max - min || 1;
  const X = (i) => (i / (data.length - 1)) * (width - pad * 2) + pad;
  const Y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const pts = data.map((v, i) => [X(i), Y(v)]);
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = line + ` L ${X(data.length - 1).toFixed(1)} ${height - pad} L ${X(0).toFixed(1)} ${height - pad} Z`;
  const uid = "cv" + Math.round(width) + data.length;
  return (
    <svg className="curve" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {axis && [0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" x2={width} y1={height * g} y2={height * g} stroke="var(--rule)" strokeWidth="1" />
      ))}
      {fill && <path d={area} fill={`url(#${uid})`} />}
      <path d={line} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {markers && markers.map((mk, i) => {
        const x = X(mk.i), y = Y(data[mk.i]);
        return <circle key={i} cx={x} cy={y} r="3.5" fill={mk.kind === "miss" ? "var(--hot)" : "var(--verdant)"} stroke="var(--bg-surface)" strokeWidth="1.5" />;
      })}
      <circle cx={X(data.length - 1)} cy={Y(data[data.length - 1])} r="4" fill={accent} stroke="var(--bg-surface)" strokeWidth="2" />
    </svg>
  );
}
export { Curve };