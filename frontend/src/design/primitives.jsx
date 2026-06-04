import React from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "./icons.jsx";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSignMessage, useSwitchChain, useDisconnect } from "wagmi";
import { formatEther, getAddress } from "viem";

/* ---------- Adapters: API publisher/hatch → display fields ---------- */
const PUB_PALETTE = ["#E04F2C", "#2D5F4F", "#C28D3A", "#8A5A2B", "#5C544A"];
export function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}
/** Safe lowercase — never throws. Used for all address normalization so a
 *  bad row, undefined field, or schema drift can't crash a route. */
export const lc = (s) => (typeof s === "string" ? s.toLowerCase() : "");
export function pubDisplay(pub) {
  // pub: PublisherSummary | null/undefined. Returns shape for Avatar/header.
  if (!pub) return { avatar: "var(--bg-subtle)", initials: "??", handle: "unknown", verified: false };
  const root = pub.publisherRootIp ?? "";
  const seed = root ? parseInt(root.slice(2, 6), 16) : 0;
  return {
    avatar: PUB_PALETTE[seed % PUB_PALETTE.length],
    initials: (pub.displayName ?? root.slice(2, 4)).slice(0, 2).toUpperCase(),
    handle: pub.displayName ?? shortAddr(root),
    verified: !!pub.verified,
  };
}
const MODE_LABEL = { 0: "per-hatch", 1: "sub-only", 2: "dual" };
export function hatchModeLabel(mode) {
  return MODE_LABEL[mode] ?? "unknown";
}
export function formatPrice(priceWei) {
  if (!priceWei) return null;
  try { return `${Number(formatEther(BigInt(priceWei))).toFixed(2)} IP`; } catch { return null; }
}
/* Hatch — component primitives. Exported to window. */
const { useState, useEffect, useRef } = React;

/* ---------- hooks ---------- */
function useInView(opts) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.15, ...(opts || {}) });
    io.observe(el);
    // Safety net: never leave content hidden (covers print, export, missed observers).
    const fallback = setTimeout(() => setSeen(true), 1600);
    return () => { io.disconnect(); clearTimeout(fallback); };
  }, []);
  return [ref, seen];
}
export { useInView };

function Reveal({ children, delay = 0, as = "div", className = "", ...rest }) {
  const [ref, seen] = useInView();
  const Tag = as;
  return (
    <Tag ref={ref} className={"reveal-up " + (seen ? "in " : "") + className}
      style={{ transitionDelay: seen ? delay + "ms" : "0ms" }} {...rest}>
      {children}
    </Tag>
  );
}
export { Reveal };

function useCountUp(target, run, dur = 1200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf, start;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / dur, 1);
      setVal(target * ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Guarantee the final value even if rAF is throttled (background tab / capture).
    const guard = setTimeout(() => setVal(target), dur + 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(guard); };
  }, [run, target]);
  return val;
}
export { useCountUp };

/* ---------- Button ---------- */
function Button({ variant = "primary", size = "md", children, className = "", ...rest }) {
  return (
    <button className={`btn btn--${variant} btn--${size} ${className}`} {...rest}>{children}</button>
  );
}
export { Button };

/* ---------- Avatar ---------- */
function Avatar({ pub, size = 24 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: pub.avatar, fontSize: size * 0.42 }}>
      {pub.initials}
    </span>
  );
}
export { Avatar };

/* ---------- StatusPill ---------- */
const STATUS_META = {
  sealed: { label: "Sealed", cls: "pill-sealed", icon: "Lock" },
  active: { label: "Active", cls: "pill-active", icon: "Clock" },
  revealed: { label: "Unsealed", cls: "pill-revealed", icon: "MailOpen" },
  resolved: { label: "Resolved", cls: "pill-resolved", icon: "CheckCircle2" },
  disputed: { label: "Disputed", cls: "pill-disputed", icon: "AlertTriangle" },
};
function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.sealed;
  const Ic = Icons[m.icon];
  return <span className={"status-pill " + m.cls}><Ic size={12} />{m.label}</span>;
}
export { StatusPill };

/* ---------- CountdownTimer ---------- */
function pad(n) { return String(n).padStart(2, "0"); }
function CountdownTimer({ revealAt, size = "md", onZero }) {
  const [, force] = useState(0);
  const fired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = revealAt - Date.now();
  useEffect(() => { if (ms <= 0 && !fired.current) { fired.current = true; onZero && onZero(); } });

  let text, hot = false;
  if (ms <= 0) {
    text = ms > -3000 ? "REVEALING…" : "UNSEALED";
    hot = ms > -3000;
  } else {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (ms >= DAY_MS) text = `REVEALS IN ${d}D ${h}H`;
    else if (ms >= HOUR_MS) text = `REVEALS IN ${pad(h)}:${pad(m)}:${pad(sec)}`;
    else text = `REVEALS IN ${pad(m)}:${pad(sec)}`;
    if (ms <= 5 * 60 * 1000) hot = true;
  }
  return <span className={`countdown countdown--${size}` + (hot ? " is-hot" : "")}>{text}</span>;
}
const DAY_MS = 86400 * 1000, HOUR_MS = 3600 * 1000;
export { CountdownTimer };

/* ---------- TrackRecordBadge ---------- */
function TrackRecordBadge({ pub, size = "sm" }) {
  const color = pub.dot === "verdant" ? "var(--verdant)" : pub.dot === "hot" ? "var(--hot)" : "var(--ink-soft)";
  const fs = size === "md" ? 14 : 12;
  return (
    <span className="track-badge" style={{ fontSize: fs }}>
      <span className="track-dot" style={{ background: color }} />
      <span className="track-acc">{pub.accuracy}%</span>
      <span className="track-sep">·</span>
      <span className="track-count" style={{ fontSize: fs - 1 }}>{pub.hatches} hatches</span>
      <span className="track-tip body-xs ink-soft">
        Weighted accuracy across {pub.hatches} resolved hatches. Last 5: {pub.last5}.
      </span>
    </span>
  );
}
export { TrackRecordBadge };

/* ---------- WaxSeal ---------- */
function WaxSeal({ size = 30, pulse = false }) {
  return (
    <span className={"wax" + (pulse ? " wax-pulse" : "")} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="12" fill="var(--hot)" />
        <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(0,0,0,0.13)" strokeWidth="1.2" />
        <circle cx="15" cy="15" r="7.6" fill="none" stroke="var(--bg-paper)" strokeWidth="1" opacity="0.45" />
        <circle cx="15" cy="15" r="2.3" fill="var(--bg-paper)" opacity="0.5" />
      </svg>
    </span>
  );
}
function WaxSealCracked({ size = 30 }) {
  return (
    <span className="wax" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 30 30">
        <defs>
          <clipPath id={"l" + size}><polygon points="0,0 13,0 17,30 0,30" /></clipPath>
          <clipPath id={"r" + size}><polygon points="15,0 30,0 30,30 19,30" /></clipPath>
        </defs>
        <g clipPath={`url(#l${size})`} transform="rotate(-4 15 15) translate(-1.4 0)">
          <circle cx="15" cy="15" r="12" fill="var(--hot)" opacity="0.92" />
          <circle cx="15" cy="15" r="7.4" fill="none" stroke="var(--bg-paper)" strokeWidth="1.1" opacity="0.5" />
        </g>
        <g clipPath={`url(#r${size})`} transform="rotate(5 15 15) translate(1.8 1.4)">
          <circle cx="15" cy="15" r="12" fill="var(--hot)" opacity="0.92" />
          <circle cx="15" cy="15" r="7.4" fill="none" stroke="var(--bg-paper)" strokeWidth="1.1" opacity="0.5" />
        </g>
      </svg>
    </span>
  );
}
export { WaxSeal };
export { WaxSealCracked };

/* ---------- TrustStrip ---------- */
function TrustStrip({ items, className = "" }) {
  return (
    <div className={"trust-strip mono-sm " + className}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="trust-sep">·</span>}
          {it.href ? (
            <a href={it.href}>{it.label}{it.ext && <Icons.ExternalLink size={11} />}</a>
          ) : (
            <span>{it.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
export { TrustStrip };

/* ---------- MetricStrip ---------- */
function Metric({ value, suffix = "", label, decimals = 0, run }) {
  const isNum = typeof value === "number";
  const v = useCountUp(isNum ? value : 0, run && isNum);
  const display = isNum ? Math.round(v).toLocaleString() : value;
  return (
    <div className="metric">
      <span className="metric-value">{display}{suffix}</span>
      <span className="metric-label label-sm">{label}</span>
    </div>
  );
}
function MetricStrip({ metrics }) {
  const [ref, seen] = useInView();
  return (
    <div className="metric-strip" ref={ref}>
      {metrics.map((m, i) => <Metric key={i} {...m} run={seen} />)}
    </div>
  );
}
export { MetricStrip };

/* ---------- HatchCard ---------- */
function HatchCard({ hatch, pub }) {
  const navigate = useNavigate();
  const cracked = hatch.status === "revealed" || hatch.status === "resolved";
  const sealedLike = hatch.status === "sealed" || hatch.status === "active";
  const display = pubDisplay(pub);
  const modeLabel = hatchModeLabel(hatch.mode);
  const priceLabel = formatPrice(hatch.perHatchPriceWei);
  const revealAtMs = hatch.revealAt ? new Date(hatch.revealAt).getTime() : null;
  const unsealedLabel = cracked && revealAtMs ? relTimeAgo(revealAtMs) : null;

  return (
    <article
      className={"hatch-card status-" + hatch.status}
      onClick={() => navigate(`/console#/hatch/${hatch.uuid}`)}
      style={{ cursor: "pointer" }}
    >
      <div className="card-seal">{cracked ? <WaxSealCracked size={28} /> : <WaxSeal size={28} />}</div>
      <div className="card-head">
        <div className="card-pub">
          <Avatar pub={display} />
          <span className="card-handle label-md">{display.handle}</span>
          {display.verified && <span className="verified-dot" title="Verified publisher" />}
        </div>
      </div>
      <h3 className="card-title display-md" style={{ fontSize: 22, lineHeight: "28px" }}>{hatch.title ?? `Hatch #${hatch.uuid}`}</h3>
      {cracked && hatch.summary && <p className="card-preview reading-body" style={{ fontSize: 16, lineHeight: "26px" }}>{hatch.summary}</p>}
      <div className="card-status-row">
        <StatusPill status={hatch.status} />
        {sealedLike && revealAtMs
          ? <CountdownTimer revealAt={revealAtMs} size="md" />
          : unsealedLabel ? <span className="mono-sm ink-soft" style={{ textTransform: "none" }}>unsealed {unsealedLabel}</span> : null}
      </div>
      <div className="card-meta body-sm">
        <span>Mode: {modeLabel}</span>
        {priceLabel && <>
          <span className="trust-sep">·</span>
          <span className="meta-mono">{priceLabel}</span>
        </>}
      </div>
    </article>
  );
}

function relTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export { HatchCard };

/* ---------- ConnectWallet — RainbowKit modal → SIWE handshake ---------- */
const AENEID_CHAIN_ID = 1315;

function ConnectWallet() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState(/** @type {string | null} */ (null));
  const [pendingSiwe, setPendingSiwe] = useState(false);
  const navigate = useNavigate();
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const { openConnectModal } = useConnectModal();
  const { address: wagmiAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync } = useDisconnect();

  // Mirror the SIWE session into local state. No localStorage (Section 1.3).
  React.useEffect(() => {
    let active = true;
    (async () => {
      const { subscribeSiwe, getSiweWallet } = await import("../lib/siwe.js");
      if (!active) return;
      const initial = getSiweWallet();
      if (initial) setAddress(initial);
      const unsub = subscribeSiwe((s) => {
        if (!active) return;
        setAddress(s ? s.wallet : null);
      });
      return () => unsub();
    })();
    return () => { active = false; };
  }, []);

  async function runSiwe(connectedAddress) {
    const [{ SiweMessage }, { api }, { setSiweSession }] = await Promise.all([
      import("../siwe-message.js"),
      import("../api.js"),
      import("../lib/siwe.js"),
    ]);
    if (chainId !== AENEID_CHAIN_ID) {
      try { await switchChainAsync({ chainId: AENEID_CHAIN_ID }); } catch (err) {
        throw new Error(`Switch to Story Aeneid failed: ${err?.message || err}`);
      }
    }
    const checksummed = getAddress(connectedAddress);
    const { nonce } = await api.siweNonce(checksummed);
    const message = new SiweMessage({
      domain: window.location.host,
      address: checksummed,
      statement: "Sign in to Hatch - programmable embargoes on Story.",
      uri: window.location.origin,
      version: "1",
      chainId: AENEID_CHAIN_ID,
      nonce,
    }).prepareMessage();
    const signature = await signMessageAsync({ message, account: checksummed });
    const { token, wallet } = await api.siweVerify(message, signature);
    setSiweSession({ token, wallet });
    setAddress(wallet);
  }

  // If the user clicks Sign in without a wallet, open the RainbowKit modal
  // and resume the SIWE handshake once the connection lands.
  React.useEffect(() => {
    if (!pendingSiwe || !isConnected || !wagmiAddress) return;
    setPendingSiwe(false);
    setBusy(true);
    (async () => {
      try { await runSiwe(wagmiAddress); }
      catch (e) { alert(`Sign-in failed: ${(e && e.message) || e}`); }
      finally { setBusy(false); }
    })();
  }, [pendingSiwe, isConnected, wagmiAddress]);

  // wagmi auto-reconnects to the active injected wallet on page load, so
  // `openConnectModal` is `undefined` until we disconnect. Once disconnected,
  // the picker becomes available and we trigger it here.
  React.useEffect(() => {
    if (pendingSiwe && !isConnected && openConnectModal) openConnectModal();
  }, [pendingSiwe, isConnected, openConnectModal]);

  async function onSignIn() {
    if (busy) return;
    setPendingSiwe(true);
    if (isConnected) {
      try { await disconnectAsync(); } catch { /* fall through; effect retries */ }
      return; // effect above will open the modal once isConnected flips to false
    }
    if (openConnectModal) openConnectModal();
  }

  async function onDisconnect() {
    const { setSiweSession } = await import("../lib/siwe.js");
    try { await disconnectAsync(); } catch { /* user already gone */ }
    setSiweSession(null);
    setAddress(null);
    setOpen(false);
  }

  if (!address) {
    return (
      <button className="btn-connect" onClick={onSignIn} disabled={busy}>
        <Icons.Wallet size={15} />
        {busy ? "Signing…" : "Sign in"}
      </button>
    );
  }
  const short = address.slice(0, 6) + "…" + address.slice(-4);
  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button className="btn-connect connected" onClick={() => setOpen((o) => !o)}>
        <span className="wallet-dot" />
        <span className="mono-sm" style={{ textTransform: "none" }}>{short}</span>
        <Icons.ChevronDown size={14} />
      </button>
      {open && (
        <div className="wallet-menu">
          <button className="label-md" onClick={() => { navigate("/console#/publisher"); setOpen(false); }}>
            Dashboard
          </button>
          <button className="label-md" onClick={() => { navigator.clipboard?.writeText(address); setOpen(false); }}>
            Copy address
          </button>
          <button className="label-md" onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
export { ConnectWallet };