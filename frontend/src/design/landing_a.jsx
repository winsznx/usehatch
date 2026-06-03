import React from "react";
import { useNavigate } from "react-router-dom";
import { Curve } from "./console_orb.jsx";
import { Icons } from "./icons.jsx";
import { Avatar, Button, ConnectWallet, CountdownTimer, Reveal, StatusPill, WaxSeal, WaxSealCracked, lc, pubDisplay, useInView } from "./primitives.jsx";
import { useHatchesQuery, usePublishersQuery } from "../lib/hooks.js";
/* Hatch — landing redesign · sections A
   Atmosphere, Header, HatchObject, Hero, Manifesto, Lifecycle chapters */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;

/* ---------- Atmosphere (incubation heat + grain) ---------- */
function Atmosphere() {
  return (
    <div className="lp-atmosphere" aria-hidden="true">
      <div className="lp-heat"></div>
      <div className="lp-grain"></div>
    </div>
  );
}
export { Atmosphere };

/* ---------- Header (floating capsule) ---------- */
function Header({ theme, onToggleTheme }) {
  const I = Icons;
  const [scrolled, setScrolled] = useStateA(false);
  useEffectA(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={"header" + (scrolled ? " scrolled" : "")}>
      <div className="header-inner">
        <a className="wordmark" href="#top">
          <img className="egg-mark" src="/hatch-logo.jpg" alt="" aria-hidden="true" />
          <span className="wordmark-text">Hatch</span>
        </a>
        <nav className="header-nav label-md">
          <a className="nav-link" href="#lifecycle">Lifecycle</a>
          <a className="nav-link" href="#live">Live now</a>
          <a className="nav-link" href="#trust">Transparency</a>
        </nav>
        <div className="header-right">
          <span className="nav-divider" aria-hidden="true"></span>
          <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
            {theme === "dark" ? <I.Sun size={16} /> : <I.Moon size={16} />}
          </button>
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
export { Header };

/* ---------- The Hatch Object — anchor for the persistent OrbStage ---------- */
/* The orb itself lives at the top of the layout (OrbStage); routes/views only
 * advertise WHERE it should land via `data-orb-anchor`. This component renders
 * just the anchor box + countdown overlay. The orb morphs to fill the anchor's
 * bounding rect with FM springs on route changes. */
function HatchObject({ revealAt, bare = false, state }) {
  const [, force] = useStateA(0);
  useEffectA(() => {
    if (bare) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [bare]);

  // Derive lifecycle state from revealAt if not explicitly provided.
  let inferred = state;
  if (!inferred && !bare) {
    const ms = revealAt - Date.now();
    if (ms <= 0) inferred = "public";
    else if (ms < 60 * 60 * 1000) inferred = "hatching";   // <1h
    else if (ms < 24 * 60 * 60 * 1000) inferred = "incubating"; // <24h
    else inferred = "sealed";
  }
  inferred = inferred || "incubating";

  let time = null;
  if (!bare) {
    const ms = Math.max(0, revealAt - Date.now());
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    time = <span className="lp-core-time">{h}:{m}:{sec}</span>;
  }

  return (
    <div
      className="lp-object hatch-orb-anchor"
      data-orb-anchor
      data-orb-state={inferred}
    >
      {!bare && (
        <div className="lp-orb-overlay">
          {time}
        </div>
      )}
    </div>
  );
}
export { HatchObject };

/* ---------- Hero ---------- */
function Hero() {
  const I = Icons;
  const navigate = useNavigate();
  const featuredQ = useHatchesQuery({ status: "active", limit: 1 });
  const allHatchesQ = useHatchesQuery({ limit: 200 });
  const pubsQ = usePublishersQuery();
  const featured = featuredQ.data?.[0];
  const featuredRevealMs = featured?.revealAt ? new Date(featured.revealAt).getTime() : null;
  const totalHatches = allHatchesQ.data?.length ?? 0;
  const totalPubs = pubsQ.data?.length ?? 0;
  const resolvedCount = (allHatchesQ.data ?? []).filter((h) => h.status === "resolved").length;
  return (
    <section className="lp-hero" id="top">
      <div className="mono-sm lp-hero-eyebrow">
        <span className="lp-livedot"></span>
        STORY PROTOCOL · LIVE ON AENEID
      </div>
      <h1 className="lp-d1 lp-hero-line lp-hero-line--over">Sealed alpha.</h1>
      <div className="lp-objectwrap">
        {featuredRevealMs ? <HatchObject revealAt={featuredRevealMs} /> : <HatchObject revealAt={Date.now() + 86400_000} bare={true} />}
      </div>
      <h1 className="lp-d1 lp-hero-line lp-hero-line--under">Public <span className="accent">on timer.</span></h1>

      <p className="body-lg lp-hero-sub">
        Publishers seal predictions, research, and scoops. The vault cannot be opened early —
        not by us, not by them. When the timer hits zero, the chain unseals it for everyone,
        and the record becomes permanent.
      </p>
      <div className="lp-hero-ctas">
        <Button variant="primary" size="lg" onClick={() => navigate("/console")}>
          See what's sealed <I.ArrowRight size={16} />
        </Button>
        <Button variant="outline" size="lg" onClick={() => navigate("/console#/publisher")}>
          Become a publisher
        </Button>
      </div>
      <div className="mono-sm lp-hero-readout">
        <span>{totalPubs} PUBLISHER{totalPubs === 1 ? "" : "S"}</span>
        <span className="sep">·</span>
        <span>{totalHatches} HATCH{totalHatches === 1 ? "" : "ES"}</span>
        <span className="sep">·</span>
        <span>{resolvedCount} RESOLVED</span>
      </div>

      <div className="mono-sm lp-scrollcue" aria-hidden="true">
        <span>THE LIFECYCLE</span>
        <I.ArrowDown size={16} />
      </div>
    </section>
  );
}
export { Hero };

/* ---------- Manifesto ---------- */
function Manifesto() {
  return (
    <section className="lp-manifesto">
      <Reveal className="lp-manifesto-inner">
        <p className="lp-d3">
          The information already exists.<br />
          <span className="muted">You simply</span> <span className="accent">cannot see it yet.</span>
        </p>
      </Reveal>
    </section>
  );
}
export { Manifesto };

/* ============================================================
   LIFECYCLE — four narrative chapters on a spine
   ============================================================ */
function Lifecycle() {
  const spineRef = useRefA(null);
  const wrapRef = useRefA(null);
  useEffectA(() => {
    const onScroll = () => {
      const wrap = wrapRef.current, fill = spineRef.current;
      if (!wrap || !fill) return;
      const r = wrap.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = r.height - vh * 0.4;
      const passed = Math.min(Math.max(vh * 0.5 - r.top, 0), total);
      fill.style.setProperty("--fill", (total > 0 ? (passed / total) * 100 : 0) + "%");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);

  return (
    <section className="lp-life" id="lifecycle">
      <div className="lp-life-head">
        <h2 className="lp-d2">The lifecycle of a secret.</h2>
        <div className="mono-sm">SEALED → INCUBATING → HATCHING → PUBLIC</div>
      </div>
      <div className="lp-chapters" ref={wrapRef}>
        <div className="lp-spine"><div className="lp-spine-fill" ref={spineRef}></div></div>
        <ChapterSealed />
        <ChapterIncubating />
        <ChapterHatching />
        <ChapterPublic />
      </div>
    </section>
  );
}
export { Lifecycle };

function ChapterShell({ state, index, label, title, lede, meta, visual, flip }) {
  return (
    <div className={"lp-chapter" + (flip ? " lp-chapter--flip" : "")} data-state={state}>
      <div className="lp-node"><span className="lp-node-dot"></span></div>
      <Reveal className="lp-chapter-body">
        <div className="lp-chapter-copy">
          <div className="lp-chapter-index"><span>{index}</span><span className="lp-state">{label}</span></div>
          <h3 className="lp-d3 lp-chapter-title">{title}</h3>
          <p className="body-lg lp-chapter-lede">{lede}</p>
          {meta && <div className="lp-chapter-meta mono-sm">{meta}</div>}
        </div>
        <div className="lp-vis">{visual}</div>
      </Reveal>
    </div>
  );
}

/* 01 — SEALED */
function ChapterSealed() {
  const cipher = "8f3a c1d0 47 b9 e2 6c 1a fd 90 5e 2b 7c 41 a8 d3 0f 9b 22 e7 4c 88 1d 6f a0 3e b5 7a 2c 91 ed 44 0a 5f c8 13 9d 6e 27 b1 4f 80 a3 5c d9 e1 36 7b 0c";
  return (
    <ChapterShell
      state="sealed" index="01" label="SEALED"
      title={<>The information<br />already exists.</>}
      lede={<>A publisher writes their call and locks it on Story CDR. The ciphertext lives on-chain from the first second — but the embargo holds. Even Hatch cannot read it.</>}
      meta={<><Icons.Lock size={13} /> ENCRYPTED ON STORY CDR · 1024-BYTE INLINE</>}
      visual={
        <div className="lp-sealed-panel">
          <div className="lp-sealed-head">
            <span className="mono-sm">VAULT #4090 · MANIFEST</span>
            <StatusPill status="sealed" />
          </div>
          <div className="lp-cipher">
            {cipher.split(" ").map((c, i) => (
              <React.Fragment key={i}>
                <span className={i % 9 === 4 ? "glow" : ""}>{c}</span>{" "}
              </React.Fragment>
            ))}
          </div>
          <div className="lp-sealed-foot body-sm">
            <span>Sealed by @fridaybrief</span>
            <span className="mono-sm">11.4 KB</span>
          </div>
        </div>
      }
    />
  );
}

/* 02 — INCUBATING */
function ChapterIncubating() {
  const featuredQ = useHatchesQuery({ status: "active", limit: 1 });
  const pubsQ = usePublishersQuery();
  const hatch = featuredQ.data?.[0];
  const revealAtMs = hatch?.revealAt ? new Date(hatch.revealAt).getTime() : null;
  const pub = pubsQ.data?.find((p) => hatch && lc(p.publisherRootIp) === lc(hatch.publisherRootIp));
  const pubDisp = pubDisplay(pub);
  const headPubs = (pubsQ.data ?? []).slice(0, 4);
  return (
    <ChapterShell
      state="incubating" index="02" label="INCUBATING" flip
      title={<>People are<br />already waiting.</>}
      lede={<>Subscribers pay for early access while the timer runs. They can read the moment it opens — anonymously, if they choose, through a one-time lent wallet. The queue is real; the wait is the product.</>}
      meta={<><Icons.Users size={13} /> READS ROUTE THROUGH A ONE-TIME WALLET · ANONYMOUS</>}
      visual={
        <div className="lp-incu">
          {revealAtMs ? (
            <>
              <div className="lp-incu-count"><CountdownTimer revealAt={revealAtMs} size="lg" /></div>
              <div className="body-sm lp-incu-label">Until {pubDisp.handle}'s "{hatch.title ?? `Hatch #${hatch.uuid}`}" unseals.</div>
            </>
          ) : (
            <div className="body-sm lp-incu-label ink-soft">No hatches currently incubating.</div>
          )}
          <div className="lp-incu-divider"></div>
          <div className="lp-queue">
            <div className="lp-queue-avatars">
              {headPubs.map((p) => <Avatar key={p.publisherRootIp} pub={pubDisplay(p)} size={30} />)}
            </div>
            <div className="body-md lp-queue-text"><b>{headPubs.length}</b> publisher{headPubs.length === 1 ? "" : "s"} live on Hatch</div>
          </div>
        </div>
      }
    />
  );
}

/* 03 — HATCHING */
function ChapterHatching() {
  const [ref, seen] = useInView({ threshold: 0.4 });
  const [open, setOpen] = useStateA(false);
  const [cracking, setCracking] = useStateA(false);
  const play = () => {
    setOpen(false); setCracking(false);
    requestAnimationFrame(() => {
      setCracking(true);
      setTimeout(() => setOpen(true), 180);
      setTimeout(() => setCracking(false), 640);
    });
  };
  useEffectA(() => { if (seen) { const t = setTimeout(play, 320); return () => clearTimeout(t); } }, [seen]);
  return (
    <ChapterShell
      state="hatching" index="03" label="HATCHING"
      title={<>Time unlocks it.<br />Not a person.</>}
      lede={<>When the timer expires, the vault auto-unseals — no manual action, no platform discretion, no insider preview. The wax cracks. The content emerges. An oracle attests the outcome.</>}
      meta={<><Icons.Timer size={13} /> CDR PRECOMPILE · accessCDR() · PUBLIC FOREVER AFTER</>}
      visual={
        <div className={"lp-reveal" + (open ? " is-open" : "") + (cracking ? " is-cracking" : "")} ref={ref}>
          <div className="lp-crackline"></div>
          <div className="lp-reveal-sealwrap">
            {open ? <WaxSealCracked size={30} /> : <WaxSeal size={30} pulse={cracking} />}
          </div>
          <div className="lp-reveal-lid">
            <span className="lp-reveal-status">
              <Icons.MailOpen size={14} /> {open ? "UNSEALED" : "REVEALING…"}
            </span>
            <h4 className="display-md lp-reveal-title" style={{ fontSize: 22, lineHeight: "28px" }}>
              The Frax-curve depeg pattern, with receipts
            </h4>
          </div>
          <div className="lp-reveal-content">
            <p className="reading-body" style={{ fontSize: 16, lineHeight: "26px" }}>
              Three pools quoted the same depth and called it liquidity. It wasn't. Here's the
              pattern that preceded every Frax-curve wobble this cycle — with the on-chain receipts.
            </p>
            <div className="lp-reveal-foot body-sm">
              <Icons.Check size={14} /> Unsealed 14 min ago · readable by anyone
            </div>
          </div>
          <div className="lp-replay">
            <button onClick={play}><Icons.Flame size={13} /> Replay the reveal</button>
          </div>
        </div>
      }
    />
  );
}

/* 04 — PUBLIC */
function ChapterPublic() {
  const pubsQ = usePublishersQuery();
  const resolvedQ = useHatchesQuery({ status: "resolved", limit: 20 });
  const pub = pubsQ.data?.[0];
  const pubDisp = pubDisplay(pub);
  const resolved = (resolvedQ.data ?? []).filter((h) => !pub || lc(h.publisherRootIp) === lc(pub.publisherRootIp)).slice(0, 5);
  const totalResolved = resolvedQ.data?.length ?? 0;
  return (
    <ChapterShell
      state="public" index="04" label="PUBLIC" flip
      title={<>The record<br />becomes permanent.</>}
      lede={<>Every reveal updates a price-weighted accuracy score that nobody can edit — not even the publisher. Cheap throwaways can't game it. The track record is on-chain, auditable, and compounds with every call.</>}
      meta={<><Icons.LineChart size={13} /> WEIGHTED ACCURACY · IMMUTABLE · ROYALTIES ROUTE TO IP ROOT</>}
      visual={
        <div className="lp-ledger">
          <div className="lp-ledger-head">
            <div className="lp-ledger-pub">
              <Avatar pub={pubDisp} size={34} />
              <div>
                <div className="heading-sm name">{pubDisp.handle}</div>
                <div className="mono-sm ink-soft" style={{ textTransform: "none" }}>{pub?.publisherRootIp ?? "no publishers yet"}</div>
              </div>
            </div>
            <div className="lp-ledger-acc">
              <div className="big">{totalResolved}</div>
              <div className="label-sm lbl">resolved</div>
            </div>
          </div>
          <div className="lp-ledger-rows">
            {resolved.length === 0 && <div className="body-sm ink-soft" style={{ padding: 12 }}>No resolutions on the ledger yet.</div>}
            {resolved.map((h) => (
              <div className="lp-ledger-row" key={h.uuid}>
                <span className="body-sm t">{h.title ?? `Hatch #${h.uuid}`}</span>
                <span className="v hit">
                  <Icons.CheckCircle2 size={13} />
                  Resolved
                </span>
              </div>
            ))}
          </div>
          <div className="mono-sm lp-ledger-foot">ATTESTED ON-CHAIN · STORY AENEID</div>
        </div>
      }
    />
  );
}