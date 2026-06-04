import React from "react";
import { Link } from "react-router-dom";
import { useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useSiweSession } from "../lib/siwe.js";
import { useFollowsQuery, usePublishersQuery } from "../lib/hooks.js";
import { Icons } from "./icons.jsx";
import { Avatar, ConnectWallet } from "./primitives.jsx";
import { OrbPip } from "./console_orb.jsx";
import { Publisher } from "./view_publisher.jsx";
import { Queue, Timeline } from "./view_timeline.jsx";
/* Hatch Console — shell: left rail, top bar, hash router. */
const { useState: useStateS, useEffect: useEffectS } = React;

const ROUTES = [
  { key: "timeline", label: "Your Timeline", icon: "Activity", crumb: "Dashboard" },
  { key: "queue", label: "Incubation", icon: "Timer", crumb: "Dashboard / Queue" },
  { key: "publishers", label: "Publishers", icon: "Users", crumb: "Publishers" },
  { key: "publisher", label: "Command Center", icon: "Feather", crumb: "Publisher" },
  { key: "compose", label: "Seal a hatch", icon: "Plus", crumb: "Publisher / Compose" },
  { key: "record", label: "Track Record", icon: "LineChart", crumb: "Publisher / Record" },
  { key: "hatch", label: "Hatch Detail", icon: "MailOpen", crumb: "Hatch" },
];

function useRoute() {
  const get = () => (location.hash.replace(/^#\/?/, "").split("/")[0] || "timeline");
  const [route, setRoute] = useStateS(get());
  useEffectS(() => {
    const on = () => { setRoute(get()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (k) => { location.hash = "#/" + k; }];
}
export { useRoute };

function RailContent({ route, go, asDrawer }) {
  const I = Icons;
  return (
    <>
      <Link to="/" className="rail-brand" title="Back to landing">
        <img className="rail-logo" src="/hatch-logo.jpg" alt="" aria-hidden="true" />
        <span className="wordmark-text">Hatch</span>
      </Link>
      <nav>
        {ROUTES.map((r) => {
          const Ic = I[r.icon];
          return (
            <a key={r.key} className={"rail-link" + (route === r.key ? " active" : "")}
              href={"#/" + r.key} onClick={(e) => { e.preventDefault(); go(r.key); }}>
              <Ic size={asDrawer ? 17 : 20} />
              <span>{r.label}</span>
              {r.badge && <span className="badge">{r.badge}</span>}
            </a>
          );
        })}
      </nav>
      <FollowingList go={go} />
      <div className="rail-spacer"></div>
      <RailUser />
    </>
  );
}

function Rail({ route, go }) {
  return (
    <aside className="rail">
      <RailContent route={route} go={go} asDrawer={false} />
    </aside>
  );
}
export { Rail };

function RailDrawer({ open, onClose, route, go }) {
  useEffectS(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="rail-drawer-backdrop" onClick={onClose} />
      <aside className="rail-drawer" role="dialog" aria-modal="true">
        <RailContent route={route} go={(k) => { onClose(); go(k); }} asDrawer={true} />
      </aside>
    </>
  );
}
export { RailDrawer };

function shortAddress(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Not signed in";
}

const WALLET_COLORS = ["#E04F2C", "#2D5F4F", "#C28D3A", "#8A5A2B", "#5C544A"];
function walletAvatar(addr) {
  if (!addr) return { avatar: "var(--bg-subtle)", initials: "—" };
  const seed = parseInt(addr.slice(2, 6), 16);
  return {
    avatar: WALLET_COLORS[seed % WALLET_COLORS.length],
    initials: addr.slice(2, 4).toUpperCase(),
  };
}

function FollowingList({ go }) {
  const { session } = useSiweSession();
  const followsQ = useFollowsQuery(session?.wallet);
  const pubsQ = usePublishersQuery();
  const isLoading = followsQ.isLoading || pubsQ.isLoading;
  // Defensive: the API contract is Address[] (strings) but a bad row or a
  // schema drift would crash the page on `.toLowerCase()`. Coerce + filter.
  const followedRoots = (followsQ.data ?? [])
    .filter((r) => typeof r === "string" && r.length > 0);
  const pubsByRoot = React.useMemo(() => {
    const m = new Map();
    for (const p of pubsQ.data ?? []) {
      if (typeof p?.publisherRootIp === "string") m.set(p.publisherRootIp.toLowerCase(), p);
    }
    return m;
  }, [pubsQ.data]);
  const items = followedRoots
    .map((r) => pubsByRoot.get(r.toLowerCase()))
    .filter(Boolean);

  if (!session?.wallet) {
    return (
      <div className="rail-follow-wrap">
        <div className="rail-section">Following</div>
        <div className="rail-empty">Sign in to follow publishers.</div>
      </div>
    );
  }

  return (
    <div className="rail-follow-wrap">
      <div className="rail-section">Following</div>
      {isLoading && <div className="rail-empty">Loading…</div>}
      {!isLoading && items.length === 0 && (
        <a className="rail-follow" href="#/publishers" onClick={(e) => { e.preventDefault(); go("publishers"); }} style={{ color: "var(--hot)" }}>
          <span className="dot" style={{ background: "var(--hot)" }}></span>
          <span>Browse publishers →</span>
        </a>
      )}
      {items.map((p) => {
        const root = p.publisherRootIp;
        const label = p.displayName || shortAddress(root);
        return (
          <a key={root} className="rail-follow" href="#/record" onClick={(e) => { e.preventDefault(); go("record"); }}>
            <span className="dot" style={{ background: "var(--verdant)" }}></span>
            <span>{label}</span>
          </a>
        );
      })}
    </div>
  );
}

function RailUser() {
  const { session } = useSiweSession();
  const pubAvatar = walletAvatar(session?.wallet);
  return (
    <div className="rail-user">
      <Avatar pub={pubAvatar} size={32} />
      <div className="meta">
        <div className="h">{session?.wallet ? "Signed in" : "Sign in"}</div>
        <div className="a" title={session?.wallet ?? undefined}>{shortAddress(session?.wallet)}</div>
      </div>
    </div>
  );
}

function TopBarBalance() {
  const { session } = useSiweSession();
  const { data, isLoading } = useBalance({ address: session?.wallet });
  if (!session?.wallet) return <span className="topbar-balance"><span className="lbl">BAL</span> —</span>;
  const formatted = data ? Number(formatUnits(data.value, data.decimals)).toFixed(4) : (isLoading ? "…" : "—");
  return <span className="topbar-balance"><span className="lbl">BAL</span> {formatted} IP</span>;
}

function TopBar({ route, theme, onToggleTheme, nearestState, onOpenDrawer }) {
  const I = Icons;
  const r = ROUTES.find((x) => x.key === route) || ROUTES[0];
  const [now, setNow] = useStateS(new Date());
  useEffectS(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const clock = now.toUTCString().slice(17, 25);
  const stateLabel = { sealed: "SEALED", incubating: "INCUBATING", hatching: "HATCHING", public: "PUBLIC" }[nearestState] || "INCUBATING";
  return (
    <div className="topbar">
      <div className="topbar-left">
        {onOpenDrawer && (
          <button className="rail-hamburger" onClick={onOpenDrawer} aria-label="Open menu">
            <I.Menu size={18} />
          </button>
        )}
        <span className="topbar-crumb">{r.crumb}</span>
      </div>
      <div className="topbar-right">
        <span className="topbar-state" title="Nearest reveal state">
          <OrbPip state={nearestState} size={22} />
          {stateLabel}
        </span>
        <span className="topbar-clock">{clock} UTC</span>
        <TopBarBalance />
        <ConnectWallet />
        <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {theme === "dark" ? <I.Sun size={16} /> : <I.Moon size={16} />}
        </button>
      </div>
    </div>
  );
}
export { TopBar };