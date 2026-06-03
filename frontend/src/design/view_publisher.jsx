import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPublisher, stake } from "@usehatch/sdk";
import { parseEther } from "viem";
import { BigCountdown, Curve, HatchOrb, OrbPip } from "./console_orb.jsx";
import { Icons } from "./icons.jsx";
import { Avatar, Button, pubDisplay } from "./primitives.jsx";
import {
  useHatchesQuery,
  usePublisherMetricsQuery,
  usePublisherQuery,
  usePublisherResolutionsQuery,
  usePublishersQuery,
} from "../lib/hooks.js";
import { useStoryWiring } from "../lib/story.js";
import { useSiweSession } from "../lib/siwe.js";
import { qk } from "../lib/queries.js";
/* Hatch Console — Publisher (Command Center) + Track Record (investor report).
   Identity-dominant. Content → reputation → outcomes → metrics. */
const { useState: useStateP } = React;

/* Strictly the viewer's own publisher — no fallback to other publishers,
 * because viewing the Publisher dashboard as someone else is misleading. */
function useViewerPublisher() {
  const { session } = useSiweSession();
  const pubsQ = usePublishersQuery();
  const all = pubsQ.data ?? [];
  const mine = session?.wallet
    ? all.find((p) => p.wallet.toLowerCase() === session.wallet.toLowerCase())
    : null;
  return { isLoading: pubsQ.isLoading, pub: mine ?? null };
}

/* ---------- Become-a-publisher inline form ---------- */
function PublisherOnboard() {
  const I = Icons;
  const qc = useQueryClient();
  const wiring = useStoryWiring();
  const { session } = useSiweSession();
  const [name, setName] = useStateP("");
  const [symbol, setSymbol] = useStateP("");
  const [mintingFee, setMintingFee] = useStateP("0.05");
  const [revShare, setRevShare] = useStateP("10");
  const [stakeWip, setStakeWip] = useStateP("0.1");
  const [phase, setPhase] = useStateP(/** @type {"idle"|"registering"|"staking"} */("idle"));
  const [result, setResult] = useStateP(/** @type {null | { msg: string; tx?: string }} */(null));
  const [error, setError] = useStateP(/** @type {null | string} */(null));

  const onboardMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      setPhase("registering");
      setError(null);
      const desc = await createPublisher({
        config: { ...wiring.hatchConfig, storage: /** @type {any} */(null) },
        publicClient: wiring.publicClient,
        walletClient: wiring.walletClient,
        storyClient: wiring.storyClient,
        account: wiring.account,
        collection: { name: name || "Untitled", symbol: symbol || "PUB" },
        subscription: { mintingFeeWip: parseEther(mintingFee || "0"), commercialRevSharePct: Number(revShare || "0") },
      });
      setPhase("staking");
      const stakeAmt = parseEther(stakeWip || "0");
      let stakeTx = null;
      if (stakeAmt > 0n) {
        const s = await stake({ config: { ...wiring.hatchConfig, storage: /** @type {any} */(null) }, publicClient: wiring.publicClient, walletClient: wiring.walletClient, account: wiring.account, amount: stakeAmt });
        stakeTx = s.stakeTx;
      }
      return { desc, stakeTx };
    },
    onSuccess: ({ desc, stakeTx }) => {
      setPhase("idle");
      setResult({ msg: `Registered as ${desc.publisherRootIpId}${stakeTx ? " + staked" : ""}`, tx: stakeTx ?? desc.registryTxHash });
      qc.invalidateQueries({ queryKey: qk.publishers() });
    },
    onError: (e) => { setPhase("idle"); setError(e instanceof Error ? e.message : String(e)); },
  });

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Feather size={13} /> Become a publisher</span>
        <h1 className="c-d1">You haven't registered yet.</h1>
        <div className="mast-summary ink-soft">Mint an IP root, attach subscription terms, and stake WIP — all from your wallet.</div>
      </div>

      <div className="two-col" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label className="body-sm">Collection name
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AlphaSpike Research" />
          </label>
          <label className="body-sm">Symbol
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. ALPHA" />
          </label>
          <label className="body-sm">Subscription minting fee (WIP per sub)
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={mintingFee} onChange={(e) => setMintingFee(e.target.value)} placeholder="0.05" />
          </label>
          <label className="body-sm">Commercial rev-share %
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={revShare} onChange={(e) => setRevShare(e.target.value)} placeholder="10" />
          </label>
          <label className="body-sm">Stake amount (WIP)
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={stakeWip} onChange={(e) => setStakeWip(e.target.value)} placeholder="0.1" />
          </label>
          <Button variant="primary" size="lg" disabled={!session?.token || !wiring || onboardMut.isPending || !name || !symbol} onClick={() => onboardMut.mutate()}>
            {phase === "registering" ? "Registering on-chain…" : phase === "staking" ? "Staking WIP…" : "Register publisher"}
          </Button>
          {result && (
            <p className="verdant" style={{ fontSize: 12 }}>
              {result.msg}
              {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
            </p>
          )}
          {error && <p className="hot" style={{ fontSize: 12 }}>{error}</p>}
        </div>
        <div>
          <div className="section-rule"><h2>What this does</h2></div>
          <p className="body-md ink-soft" style={{ marginTop: 12 }}>
            1. Mints an SPG NFT collection from Story's public collection contract.<br />
            2. Mints + registers an IP asset as your <span className="mono">publisherRootIp</span> with the subscription PIL terms attached.<br />
            3. Registers you in <span className="mono">HatchPublisherRegistry</span>.<br />
            4. (Optional) Stakes WIP via approve + stake.
          </p>
          <p className="body-sm ink-soft" style={{ marginTop: 12 }}>
            You need WIP in your wallet to stake. Wrap native IP via the wrapper contract first if needed.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PUBLISHER — Publishing Command Center
   ============================================================ */
function Publisher({ onNearestState }) {
  const I = Icons;
  const { session } = useSiweSession();
  React.useEffect(() => { onNearestState && onNearestState("incubating"); }, []);
  const { pub, isLoading } = useViewerPublisher();
  const root = pub?.publisherRootIp;
  const metricsQ = usePublisherMetricsQuery(root);
  const myHatchesQ = useHatchesQuery(root ? { publisher: root, limit: 50 } : undefined);
  const disp = pubDisplay(pub);
  const allMy = myHatchesQ.data ?? [];
  const pending = allMy.filter((h) => h.status === "sealed" || h.status === "active");
  const recent = allMy.slice(0, 5);
  const tr = metricsQ.data?.trackRecord;
  const acc = tr?.weightedAccuracy ? Math.round(Number(tr.weightedAccuracy) * 100) : null;

  if (!session?.token) {
    return <div className="view"><div className="mast"><span className="mast-eyebrow"><I.Feather size={13} /> Publishing Command Center</span><h1 className="c-d1">Sign in to view your publisher dashboard.</h1></div></div>;
  }
  if (!isLoading && !pub) {
    return <PublisherOnboard />;
  }

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Feather size={13} /> Publishing Command Center</span>
      </div>

      <div className="pub-mast" style={{ marginTop: 20 }}>
        <div>
          <div className="pub-mast-id">
            <Avatar pub={disp} size={28} />
            <span>{disp.handle}</span>
            {disp.verified && <span className="verified-dot" title="Verified"></span>}
          </div>
          <h1 className="c-d1">{pub?.displayName ?? "Untitled publisher"}</h1>
          <p className="bio">{pub?.publisherRootIp ?? ""} — You publish into time-locked vaults. The chain keeps your record.</p>
        </div>
        <div className="pub-mast-orb"><HatchOrb state="incubating" size={180} /></div>
      </div>

      <div className="statline">
        <div className="s"><span className="v verdant">{acc !== null ? `${acc}%` : "—"}</span><span className="l">Weighted accuracy</span></div>
        <div className="s"><span className="v">{tr?.resolvedHatches ?? 0}</span><span className="l">Resolved hatches</span></div>
        <div className="s"><span className="v">{metricsQ.data?.activeSubscribers ?? 0}</span><span className="l">Active subscribers</span></div>
        <div className="s"><span className="v">{metricsQ.data?.followerCount ?? 0}</span><span className="l">Followers</span></div>
      </div>

      <div className="two-col">
        <div>
          <div className="section-rule"><h2>Pending reveals</h2><span className="meta">In their embargo window</span></div>
          <div className="pending">
            {myHatchesQ.isLoading && <div className="body-sm ink-soft" style={{ padding: 12 }}>Loading…</div>}
            {!myHatchesQ.isLoading && pending.length === 0 && (
              <div className="body-sm ink-soft" style={{ padding: 12 }}>No pending hatches.</div>
            )}
            {pending.map((q) => (
              <div className="pending-row" key={q.uuid}>
                <div>
                  <div className="t">{q.title ?? `Hatch #${q.uuid}`}</div>
                  <div className="m">VAULT #{q.uuid} · MODE {q.mode}</div>
                </div>
                <BigCountdown revealAt={new Date(q.revealAt).getTime()} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 28 }}>
            <Button variant="primary" size="lg" onClick={() => { location.hash = "#/compose"; }}>
              <I.Plus size={16} /> Seal a new hatch
            </Button>
          </div>
        </div>

        <div>
          <div className="section-rule"><h2>Publisher metrics</h2><span className="meta">live</span></div>
          <div className="curve-wrap" style={{ padding: 20 }}>
            <div className="body-md ink-soft">Subscriber growth and reputation curves require historical metrics — once the aggregator publishes time-series data they'll render here.</div>
            <div className="mono-sm ink-soft" style={{ marginTop: 16 }}>
              CURRENT · {metricsQ.data?.activeSubscribers ?? 0} ACTIVE SUBS · {metricsQ.data?.followerCount ?? 0} FOLLOWERS
            </div>
          </div>
        </div>
      </div>

      <div className="section-rule" style={{ marginTop: 56 }}>
        <h2>Recent hatches</h2>
        <a className="meta" href="#/record" onClick={(e)=>{e.preventDefault(); location.hash="#/record";}} style={{ color: "var(--hot)" }}>Full track record →</a>
      </div>
      <div className="pending">
        {recent.length === 0 && <div className="body-sm ink-soft" style={{ padding: 12 }}>No hatches authored yet.</div>}
        {recent.map((h) => (
          <div className="pending-row" key={h.uuid}>
            <div>
              <div className="t">{h.title ?? `Hatch #${h.uuid}`}</div>
              <div className="m">{h.status === "resolved" ? "Resolved" : h.status === "revealed" ? "Unsealed" : h.status === "active" ? "In embargo" : "Sealed"}</div>
            </div>
            <OrbPip state={h.status === "sealed" ? "sealed" : h.status === "active" ? "incubating" : h.status === "revealed" ? "hatching" : "public"} size={24} />
          </div>
        ))}
      </div>
    </div>
  );
}
export { Publisher };

/* ============================================================
   TRACK RECORD — living résumé / investor report
   ============================================================ */
function TrackRecord({ onNearestState }) {
  const I = Icons;
  React.useEffect(() => { onNearestState && onNearestState("public"); }, []);
  const { session } = useSiweSession();
  const pubsQ = usePublishersQuery();
  const all = pubsQ.data ?? [];
  const mine = session?.wallet ? all.find((p) => p.wallet.toLowerCase() === session.wallet.toLowerCase()) : null;
  const pub = mine ?? all[0] ?? null;
  const isLoading = pubsQ.isLoading;
  const root = pub?.publisherRootIp;
  const metricsQ = usePublisherMetricsQuery(root);
  const resolutionsQ = usePublisherResolutionsQuery(root);
  const tr = metricsQ.data?.trackRecord;
  const resolutions = resolutionsQ.data ?? [];
  const acc = tr?.weightedAccuracy ? Math.round(Number(tr.weightedAccuracy) * 100) : null;
  const disp = pubDisplay(pub);

  if (!isLoading && !pub) {
    return <div className="view"><div className="mast"><span className="mast-eyebrow"><I.LineChart size={13} /> Track Record</span><h1 className="c-d1">No publishers on the ledger yet.</h1></div></div>;
  }

  return (
    <div className="view view-narrow">
      <div className="mast">
        <span className="mast-eyebrow"><I.LineChart size={13} /> Track Record · attested on-chain</span>
      </div>

      <div className="pub-mast" style={{ marginTop: 20 }}>
        <div>
          <div className="pub-mast-id">
            <Avatar pub={disp} size={28} />
            <span>{disp.handle}</span>
            {disp.verified && <span className="verified-dot"></span>}
          </div>
          <h1 className="c-d1">A record nobody can edit.</h1>
          <p className="bio">Every prediction below was sealed before its outcome was knowable, then resolved by oracle. Price-weighted, immutable, public.</p>
        </div>
        <div className="pub-mast-orb"><HatchOrb state="public" size={180} /></div>
      </div>

      <div className="statline">
        <div className="s"><span className="v verdant">{acc !== null ? `${acc}%` : "—"}</span><span className="l">Weighted accuracy</span></div>
        <div className="s"><span className="v">{tr?.resolvedHatches ?? 0}/{tr?.totalHatches ?? 0}</span><span className="l">Resolved · total</span></div>
        <div className="s"><span className="v">{tr?.disputeCount ?? 0}</span><span className="l">Disputes</span></div>
        <div className="s"><span className="v">{metricsQ.data?.activeSubscribers ?? 0}</span><span className="l">Active subscribers</span></div>
      </div>

      <div className="section-rule" style={{ marginTop: 56 }}><h2>Prediction history</h2><span className="meta">Sealed → resolved</span></div>
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Prediction</th>
            <th className="ledger-hide">Resolved against</th>
            <th>Outcome</th>
            <th className="num">Value</th>
          </tr>
        </thead>
        <tbody>
          {resolutionsQ.isLoading && (
            <tr><td colSpan={4} className="body-sm ink-soft" style={{ padding: 16 }}>Loading…</td></tr>
          )}
          {!resolutionsQ.isLoading && resolutions.length === 0 && (
            <tr><td colSpan={4} className="body-sm ink-soft" style={{ padding: 16 }}>No resolutions finalized yet.</td></tr>
          )}
          {resolutions.map((r) => (
            <tr key={r.uuid}>
              <td>
                <div className="ledger-title">{r.title ?? `Hatch #${r.uuid}`}</div>
                {r.summary && <div className="ledger-call">{r.summary}</div>}
                <div className="ledger-date" style={{ marginTop: 6 }}>Revealed {new Date(r.revealAt).toLocaleString()}</div>
              </td>
              <td className="ledger-hide">
                <div className="ledger-result">{r.finalizedAt ? `Finalized ${new Date(r.finalizedAt).toLocaleString()}` : "—"}</div>
                {r.operator && <div className="ledger-date" style={{ marginTop: 6 }}>operator {r.operator.slice(0, 8)}…</div>}
              </td>
              <td>
                <span className="ledger-verdict hit"><I.Check size={13} /> Finalized</span>
              </td>
              <td className="num"><span className="ledger-weight">{r.outcomeValue ?? "—"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="read-foot" style={{ marginTop: 32 }}>
        <div className="read-foot-attest">
          <I.Shield size={13} /> Outcomes attested by Hatch's oracle operator <span className="trust-sep">·</span>
          7-day challenge window <span className="trust-sep">·</span>
          <a href={pub?.publisherRootIp ? `https://aeneid.storyscan.io/address/${pub.publisherRootIp}` : "https://aeneid.storyscan.io"} target="_blank" rel="noreferrer" style={{ color: "var(--hot)", display: "inline-flex", alignItems: "center", gap: 4 }}>view publisher on Storyscan <I.ExternalLink size={11} /></a>
        </div>
      </div>
    </div>
  );
}
export { TrackRecord };
