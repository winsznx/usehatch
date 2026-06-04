import React from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "./icons.jsx";
import { Lifecycle } from "./landing_a.jsx";
import { Button, HatchCard, Reveal, TrustStrip, lc } from "./primitives.jsx";
import { useHatchesQuery, usePublishersQuery } from "../lib/hooks.js";
import { config as appConfig } from "../lib/config.js";

function shortHex(v) { return v && v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-6)}` : (v ?? "—"); }
/* Hatch — landing redesign · sections B
   LiveProof, Trust, Closing, Footer */
const { useState: useStateB, useEffect: useEffectB } = React;

/* ============================================================
   LIVE PROOF — the product is the proof
   ============================================================ */
function LiveProof() {
  const navigate = useNavigate();
  const I = Icons;
  const activeQ = useHatchesQuery({ status: "active", limit: 3 });
  const resolvedQ = useHatchesQuery({ status: "resolved", limit: 2 });
  const pubsQ = usePublishersQuery();
  const pubsByRoot = React.useMemo(() => {
    const m = new Map();
    for (const p of pubsQ.data ?? []) m.set(lc(p.publisherRootIp), p);
    return m;
  }, [pubsQ.data]);
  const active = activeQ.data ?? [];
  const resolved = resolvedQ.data ?? [];

  return (
    <section className="lp-proof" id="live">
      <div className="lp-proof-head">
        <h2 className="lp-d2">No testimonials.<br />Just what's sealed right now.</h2>
        <div className="mono-sm lp-proof-ticker">
          <span className="lp-livedot"></span>
          LIVE · ON-CHAIN
        </div>
      </div>
      <p className="body-lg lp-proof-sub">
        {active.length > 0
          ? "Hatches currently in their embargo window. The timers below are real — they tick whether you're watching or not."
          : "No active hatches right now. Reveals happen exactly on schedule — when one's sealed, you'll see it tick here."}
      </p>
      <div className="lp-proof-grid">
        {activeQ.isLoading && <p className="body-sm ink-soft">Loading…</p>}
        {!activeQ.isLoading && active.length === 0 && (
          <p className="body-sm ink-soft" style={{ gridColumn: "1 / -1" }}>None sealed at this moment.</p>
        )}
        {active.map((h) => (
          <Reveal as="div" key={h.uuid}><HatchCard hatch={h} pub={pubsByRoot.get(lc(h.publisherRootIp))} /></Reveal>
        ))}
      </div>

      <div className="lp-proof-resolved">
        <h3 className="heading-lg">Already hatched — and on the record.</h3>
        <div className="lp-resolved-row">
          {resolvedQ.isLoading && <p className="body-sm ink-soft">Loading…</p>}
          {!resolvedQ.isLoading && resolved.length === 0 && (
            <p className="body-sm ink-soft" style={{ gridColumn: "1 / -1" }}>No resolved hatches yet.</p>
          )}
          {resolved.map((h) => (
            <Reveal as="div" key={h.uuid}><HatchCard hatch={h} pub={pubsByRoot.get(lc(h.publisherRootIp))} /></Reveal>
          ))}
        </div>
      </div>

      <div className="lp-proof-foot">
        <Button variant="outline" size="lg" onClick={() => navigate("/console")}>Read the full feed <I.ArrowRight size={16} /></Button>
      </div>
    </section>
  );
}
export { LiveProof };

/* ============================================================
   TRUST — editorial transparency
   ============================================================ */
function Trust() {
  const [copied, setCopied] = useStateB(null);
  const I = Icons;
  const addrs = [
    ["ORACLE", shortHex(appConfig.contracts.oracle)],
    ["CONDITION", shortHex(appConfig.contracts.condition)],
    ["SUB PASS", shortHex(appConfig.contracts.subscriptionPass)],
  ];
  const copy = (k, v) => { try { navigator.clipboard.writeText(v); } catch (e) {} setCopied(k); setTimeout(() => setCopied(null), 1200); };
  return (
    <section className="lp-trust" id="trust">
      <div className="lp-trust-inner">
        <Reveal className="lp-trust-top">
          <div className="mono-sm">THE TRUST MODEL</div>
          <h2 className="lp-d3">Nobody can pre-open a hatch. Not even us.</h2>
          <p className="body-lg">
            Hatch is built on Story Protocol's Confidential Data Rails. Every sealed hatch lives in a
            CDR vault enforced by the chain — not by a server we control. Every license fee routes to
            the publisher's royalty vault. Every reveal is verifiable on Storyscan. The trust is
            explicit, never hidden.
          </p>
        </Reveal>
        <div className="lp-trust-grid">
          <Reveal className="lp-trust-col">
            <h3 className="heading-md">How reveals work</h3>
            <p className="body-md">The CDR vault stores the encrypted manifest. A HatchCondition enforces the embargo. When the reveal timestamp passes, anyone can call <code>accessCDR</code> with an empty entitlement and read.</p>
            <div className="code-block">{`HatchCondition.checkReadCondition(
  uuid, accessAuxData, conditionData, caller
) returns bool`}</div>
          </Reveal>
          <Reveal className="lp-trust-col" delay={80}>
            <h3 className="heading-md">Who resolves outcomes</h3>
            <p className="body-md">V1 outcomes are attested by a single operator signing EIP-712 payloads from CoinGecko and The Odds API. A 7-day challenge window lets anyone bond-stake to dispute. V2 moves to a TEE-attested multi-operator quorum.</p>
            <div className="addr-pills">
              {addrs.map(([k, v]) => (
                <button className="addr-pill" key={k} onClick={() => copy(k, v)}>
                  <span>{k} {v}</span>
                  <span className="copy">{copied === k ? <I.Check size={14} /> : <I.Copy size={14} />}</span>
                </button>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
export { Trust };

/* ============================================================
   CLOSING — editorial CTA
   ============================================================ */
function Closing() {
  const I = Icons;
  const navigate = useNavigate();
  return (
    <section className="lp-closing">
      <div className="lp-closing-echo" aria-hidden="true"></div>
      <div className="lp-closing-inner">
        <div className="mono-sm">THE EGG CRACKS ON SCHEDULE</div>
        <h2 className="lp-d2">Seal something worth waiting for.</h2>
        <p className="body-lg">Read sealed alpha before it's public, or publish a call the chain will remember. Both take under two minutes.</p>
        <div className="lp-closing-ctas">
          <Button variant="primary" size="xl" onClick={() => navigate("/console")}>See what's sealed</Button>
          <Button variant="outline" size="xl" onClick={() => navigate("/console#/publisher")}>Become a publisher</Button>
        </div>
      </div>
    </section>
  );
}
export { Closing };

/* ============================================================
   FOOTER
   ============================================================ */
const GH_REPO = "https://github.com/winsznx/usehatch";
const SC_BASE = "https://aeneid.storyscan.io/address";
const CONTRACT_LINKS = [
  { label: "HatchCondition", href: `${SC_BASE}/0x9362bf2874c17ebe2d977a16861ee51bfbb0b474` },
  { label: "SubscriptionPass", href: `${SC_BASE}/0x9fc74922a10ad962570eb9692e66b0f6cb6909e1` },
  { label: "OutcomeOracle", href: `${SC_BASE}/0x5257eabbf0297ca6073ad0d7aba09c980d708a24` },
  { label: "PublisherRegistry", href: `${SC_BASE}/0x33519cf182bf9830046352150f4e03a5592bddfa` },
];

function Footer() {
  const navigate = useNavigate();
  const ext = (href, label) => (
    <a key={label} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
  );
  const internal = (path, label) => (
    <a key={label} href={path} onClick={(e) => { e.preventDefault(); navigate(path); }}>{label}</a>
  );
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="wordmark">
              <img className="egg-mark" src="/hatch-logo.jpg" alt="" aria-hidden="true" />
              <span className="wordmark-text">Hatch</span>
            </div>
            <div className="mono-sm footer-brand-tag">SEALED ALPHA · PUBLIC ON TIMER</div>
          </div>

          <div>
            <div className="label-sm footer-col-h">Product</div>
            <div className="footer-links label-md">
              {internal("/console", "Feed")}
              {internal("/console#/publishers", "Publishers")}
              {internal("/#ch-lifecycle", "Lifecycle")}
              {internal("/#trust", "Trust")}
            </div>
          </div>

          <div>
            <div className="label-sm footer-col-h">Build</div>
            <div className="footer-links label-md">
              {internal("/docs", "Docs")}
              {ext(GH_REPO, "GitHub")}
              {ext("https://www.npmjs.com/package/@usehatch/sdk", "SDK on npm")}
              {ext(`${GH_REPO}/blob/main/ARCHITECTURE.md`, "Architecture")}
            </div>
          </div>

          <div>
            <div className="label-sm footer-col-h">Contracts</div>
            <div className="footer-links label-md">
              {CONTRACT_LINKS.map((c) => ext(c.href, c.label))}
            </div>
          </div>

          <div>
            <div className="label-sm footer-col-h">Connect</div>
            <div className="footer-links label-md">
              {ext("https://x.com/usehatch_", "X · @usehatch_")}
              {ext("https://bsky.app/profile/usehatch.bsky.social", "Bluesky")}
            </div>
          </div>
        </div>

        <div className="footer-trust">
          <TrustStrip items={[
            { label: "Auto-revealed by Story CDR" },
            { label: "Contracts on Storyscan", href: "https://aeneid.storyscan.io", ext: true },
            { label: "Built for the CDR Hackathon 2026" },
          ]} />
        </div>
      </div>

      {/* Edge-to-edge brand mark. Quiet, monumental, hint of the gold seam
       *  from the logo via the gradient fill on the H's. */}
      <div className="footer-wordmark-wrap" aria-hidden="true">
        <div className="footer-wordmark">
          <span className="fw-h">H</span>
          <span className="fw-letter">A</span>
          <span className="fw-letter">T</span>
          <span className="fw-letter">C</span>
          <span className="fw-h">H</span>
        </div>
      </div>
    </footer>
  );
}
export { Footer };