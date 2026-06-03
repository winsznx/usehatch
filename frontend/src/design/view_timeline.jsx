import React from "react";
import { BigCountdown, HatchOrb } from "./console_orb.jsx";
import { Icons } from "./icons.jsx";
import { Avatar, CountdownTimer, lc, pubDisplay, shortAddr } from "./primitives.jsx";
import { useMyQueueQuery, useMyTimelineQuery, usePublishersQuery } from "../lib/hooks.js";
import { useSiweSession } from "../lib/siwe.js";
/* Hatch Console — Timeline (activity river) + Queue (Incubation Chamber). */
const { useState: useStateT } = React;

function relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}
function dayBucket(ts) {
  const diff = Date.now() - ts;
  const h = diff / 3600000;
  if (h < 24) return "Today";
  if (h < 48) return "Yesterday";
  return "Earlier this week";
}

const EVENT_META = {
  revealed: { icon: "MailOpen", kind: "revealed", label: "Revealed" },
  upcoming: { icon: "Timer", kind: "upcoming", label: "Upcoming reveal" },
  outcome: { icon: "CheckCircle2", kind: "outcome", label: "Outcome resolved" },
};

function Timeline({ onNearestState }) {
  const I = Icons;
  const { session } = useSiweSession();
  const timelineQ = useMyTimelineQuery();
  const pubsQ = usePublishersQuery();
  React.useEffect(() => { onNearestState && onNearestState("incubating"); }, []);

  const pubsByRoot = React.useMemo(() => {
    const m = new Map();
    for (const p of pubsQ.data ?? []) m.set(lc(p.publisherRootIp), p);
    return m;
  }, [pubsQ.data]);

  const events = (timelineQ.data ?? []).map((e) => ({ ...e, tsMs: new Date(e.ts).getTime() }));

  const groups = [];
  events.forEach((e) => {
    const b = dayBucket(e.tsMs);
    let g = groups.find((x) => x.label === b);
    if (!g) { g = { label: b, items: [] }; groups.push(g); }
    g.items.push(e);
  });

  const todayReveals = events.filter((e) => e.type === "revealed" && dayBucket(e.tsMs) === "Today").length;
  const outcomesToday = events.filter((e) => e.type === "outcome" && dayBucket(e.tsMs) === "Today").length;

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Activity size={13} /> Your Timeline</span>
        <h1 className="c-d1">Everything moving through time.</h1>
        <div className="mast-summary">
          <b>{todayReveals} reveal{todayReveals === 1 ? "" : "s"}</b> today <span style={{ color: "var(--rule-strong)" }}>·</span> <b className="verdant">{outcomesToday} outcome{outcomesToday === 1 ? "" : "s"}</b> resolved today
        </div>
      </div>

      <div className="river">
        {groups.length > 0 && <div className="river-thread"></div>}
        {!session?.token && <div className="body-md ink-soft" style={{ padding: 32 }}>Sign in to see your timeline.</div>}
        {session?.token && timelineQ.isLoading && <div className="body-md ink-soft" style={{ padding: 32 }}>Loading…</div>}
        {session?.token && !timelineQ.isLoading && events.length === 0 && (
          <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <div className="body-md ink-soft">No activity yet — follow publishers or subscribe to start your timeline.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <a className="btn btn--primary btn--md" href="#/publishers" onClick={(e) => { e.preventDefault(); location.hash = "#/publishers"; }}>Browse publishers <I.ArrowRight size={14} /></a>
              <a className="btn btn--outline btn--md" href="#/queue" onClick={(e) => { e.preventDefault(); location.hash = "#/queue"; }}>See active hatches</a>
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div className="river-group" key={g.label}>
            <div className="river-group-label">{g.label}</div>
            {g.items.map((e, i) => {
              const meta = EVENT_META[e.type];
              if (!meta) return null;
              const Ic = I[meta.icon];
              const pub = pubsByRoot.get(lc(e.publisherRootIp));
              const handle = pubDisplay(pub).handle;
              return (
                <div className="event" data-kind={meta.kind} key={i}>
                  <div className="event-time">{relTime(e.tsMs)}</div>
                  <div className="event-node"><span className="ico"><Ic size={15} /></span></div>
                  <div className="event-body">
                    <div className="event-lead"><span className="event-kind">{meta.label}</span></div>
                    {e.title && <div className="event-title">{e.title}</div>}
                    {renderEventBody(e, handle, I)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
export { Timeline };

function renderEventBody(e, handle, I) {
  if (e.type === "revealed") {
    return (
      <>
        <div className="event-meta"><span>by {handle}</span> <span style={{ color: "var(--rule-strong)" }}>·</span> <span className="mono">now readable</span></div>
        <div className="event-cta"><a href={`#/hatch/${e.uuid}`} onClick={(ev)=>{ev.preventDefault(); location.hash=`#/hatch/${e.uuid}`;}}>Read it <I.ArrowRight size={13} /></a></div>
      </>
    );
  }
  if (e.type === "upcoming") {
    const revealMs = e.revealAt ? new Date(e.revealAt).getTime() : null;
    return (
      <div className="event-meta">
        <span>by {handle}</span>
        <span style={{ color: "var(--rule-strong)" }}>·</span>
        {revealMs && <span className="event-count"><CountdownTimer revealAt={revealMs} size="sm" /></span>}
        {e.mine && <span className="incu-access" style={{ fontFamily: "IBM Plex Mono", fontSize: 11, letterSpacing: "0.05em" }}>· YOURS</span>}
      </div>
    );
  }
  if (e.type === "outcome") {
    return (
      <div className="event-meta">
        <span className="event-hit"><I.CheckCircle2 size={13} /> Finalized</span>
        {e.outcomeValue && <>
          <span style={{ color: "var(--rule-strong)" }}>·</span>
          <span className="mono">value {e.outcomeValue}</span>
        </>}
        {e.mine && <span className="mono">· your record</span>}
      </div>
    );
  }
  return null;
}

/* ============================================================
   QUEUE — "Incubation Chamber" · countdown-driven
   ============================================================ */
function bucketFor(ms) {
  const h = ms / 3600000;
  if (h < 24) return "Today";
  if (h < 48) return "Tomorrow";
  if (h < 24 * 7) return "This Week";
  return "Later";
}
function Queue({ onNearestState }) {
  const I = Icons;
  const { session } = useSiweSession();
  const queueQ = useMyQueueQuery();
  const pubsQ = usePublishersQuery();
  const [, force] = useStateT(0);
  React.useEffect(() => { const id = setInterval(() => force((x) => x + 1), 30000); return () => clearInterval(id); }, []);
  React.useEffect(() => { onNearestState && onNearestState("incubating"); }, []);

  const pubsByRoot = React.useMemo(() => {
    const m = new Map();
    for (const p of pubsQ.data ?? []) m.set(lc(p.publisherRootIp), p);
    return m;
  }, [pubsQ.data]);

  if (!session?.token) {
    return <div className="view"><div className="mast"><span className="mast-eyebrow"><I.Timer size={13} /> Incubation Chamber</span><h1 className="c-d1">Sign in to see your queue.</h1></div></div>;
  }

  const items = (queueQ.data ?? []).map((q) => ({ ...q, revealAtMs: new Date(q.revealAt).getTime() }));
  const sorted = items.sort((a, b) => a.revealAtMs - b.revealAtMs);
  const featured = sorted[0];
  const rest = sorted.slice(1);
  const fpub = featured ? pubsByRoot.get(lc(featured.publisherRootIp)) : null;

  const order = ["Today", "Tomorrow", "This Week", "Later"];
  const groups = {};
  rest.forEach((q) => { const b = bucketFor(q.revealAtMs - Date.now()); (groups[b] = groups[b] || []).push(q); });

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Timer size={13} /> Incubation Chamber</span>
        <h1 className="c-d1">What you're waiting on.</h1>
        <div className="mast-summary">
          <b>{items.length} hatch{items.length === 1 ? "" : "es"}</b> incubating
        </div>
      </div>

      {queueQ.isLoading && <div className="body-md ink-soft" style={{ padding: 32 }}>Loading…</div>}
      {!queueQ.isLoading && !featured && (
        <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <div className="body-md ink-soft">You're not waiting on any hatches yet. Subscribe to a publisher or buy a per-hatch license to populate your queue.</div>
          <a className="btn btn--primary btn--md" href="#/publishers" onClick={(e) => { e.preventDefault(); location.hash = "#/publishers"; }}>Browse publishers <I.ArrowRight size={14} /></a>
        </div>
      )}

      {featured && (
        <div className="incu-hero">
          <div>
            <div className="incu-hero-eyebrow">Next to hatch</div>
            <h2 className="c-d3">{featured.title ?? `Hatch #${featured.uuid}`}</h2>
            <div className="pub">
              <Avatar pub={pubDisplay(fpub)} size={24} />
              <span>{pubDisplay(fpub).handle}</span>
              <span style={{ color: "var(--rule-strong)" }}>·</span>
              <span className="incu-access" style={{ fontFamily: "IBM Plex Mono", fontSize: 12 }}>{featured.access.toUpperCase()}</span>
            </div>
            <div className="incu-hero-count"><BigCountdown revealAt={featured.revealAtMs} onState={(s) => onNearestState && onNearestState(s)} /></div>
          </div>
          <div className="incu-orb"><HatchOrb state="incubating" size={200} /></div>
        </div>
      )}

      {order.filter((b) => groups[b]).map((b) => (
        <div className="incu-group" key={b}>
          <div className="incu-group-head">
            <span className="ttl">{b}</span>
            <span className="cnt">{groups[b].length} HATCH{groups[b].length > 1 ? "ES" : ""}</span>
          </div>
          {groups[b].map((q) => {
            const p = pubsByRoot.get(lc(q.publisherRootIp));
            const disp = pubDisplay(p);
            return (
              <div className="incu-row" key={q.uuid}>
                <div className="incu-row-main">
                  <div className="incu-row-pub"><Avatar pub={disp} size={20} /> <span>{disp.handle}</span></div>
                  <div className="incu-row-title">{q.title ?? `Hatch #${q.uuid}`}</div>
                  <div className="incu-row-meta"><span className="incu-access">{q.access}</span> <span>·</span> <span>VAULT #{q.uuid}</span></div>
                </div>
                <div className="incu-row-count"><BigCountdown revealAt={q.revealAtMs} /></div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
export { Queue };
