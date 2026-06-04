import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimAllRevenue, createPublisher, setDelegate, stake, wrapNativeToWip } from "@usehatch/sdk";
import { formatEther, isAddress, parseEther } from "viem";
import { BigCountdown, Curve, HatchOrb, OrbPip } from "./console_orb.jsx";
import { Icons } from "./icons.jsx";
import { Avatar, Button, pubDisplay } from "./primitives.jsx";
import {
  useHatchesQuery,
  usePublisherClaimableQuery,
  usePublisherDisputeStatusQuery,
  usePublisherMetricsQuery,
  usePublisherQuery,
  usePublisherResolutionsQuery,
  usePublishersQuery,
} from "../lib/hooks.js";
import { useStoryWiring } from "../lib/story.js";
import { useSiweSession } from "../lib/siwe.js";
import { qk } from "../lib/queries.js";

/* Pretty-format a wei amount in WIP with up to 4 decimals. */
function fmtWip(wei) {
  if (wei == null) return "—";
  try {
    const n = Number(formatEther(BigInt(wei)));
    if (!Number.isFinite(n)) return "—";
    if (n === 0) return "0";
    if (n < 0.0001) return "< 0.0001";
    return n.toFixed(4).replace(/\.?0+$/, "");
  } catch { return "—"; }
}
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
        /* Reuse Story's public SPG collection — per-publisher createCollection reverts on Aeneid
           since 2026-05-29 (chain regression). Same fallback as view_compose. */
        spgNftContract: "0xc32A8a0FF3beDDDa58393d022aF433e78739FAbc",
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
  const qc = useQueryClient();
  const { session } = useSiweSession();
  const wiring = useStoryWiring();
  React.useEffect(() => { onNearestState && onNearestState("incubating"); }, []);
  const { pub, isLoading } = useViewerPublisher();
  const root = pub?.publisherRootIp;
  const metricsQ = usePublisherMetricsQuery(root);
  const myHatchesQ = useHatchesQuery(root ? { publisher: root, limit: 50 } : undefined);
  const claimableQ = usePublisherClaimableQuery(root, session?.wallet);
  const disputeStatusQ = usePublisherDisputeStatusQuery(root);
  const disp = pubDisplay(pub);
  const allMy = myHatchesQ.data ?? [];
  const pending = allMy.filter((h) => h.status === "sealed" || h.status === "active");
  const recent = allMy.slice(0, 5);
  const tr = metricsQ.data?.trackRecord;
  const acc = tr?.weightedAccuracy ? Math.round(Number(tr.weightedAccuracy) * 100) : null;

  const [claimResult, setClaimResult] = useStateP(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));
  const [wrapAmount, setWrapAmount] = useStateP("0.1");
  const [wrapResult, setWrapResult] = useStateP(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));
  const [delegateAddr, setDelegateAddr] = useStateP("");
  const [delegateScope, setDelegateScope] = useStateP(/** @type {"all" | "none"} */ ("all"));
  const [delegateResult, setDelegateResult] = useStateP(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));

  /* List of signal IPs (child IPs that route royalties up to publisher root via LAP).
   * claimAllRevenue requires the full set; we use every hatch the publisher has ever
   * sealed. Empty set is fine — the call still works for the ancestor's own vault. */
  const childIpIds = React.useMemo(() => {
    const set = new Set();
    for (const h of allMy) if (h.signalIpId) set.add(h.signalIpId.toLowerCase());
    return [...set];
  }, [allMy]);

  const claimMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      if (!root) throw new Error("No publisher root");
      return await claimAllRevenue({
        config: { ...wiring.hatchConfig, storage: /** @type {any} */(null) },
        storyClient: wiring.storyClient,
        ancestorIpId: root,
        claimer: wiring.account.address,
        childIpIds,
      });
    },
    onSuccess: (r) => {
      const total = r.claimed.reduce((acc, c) => acc + c.amount, 0n);
      const lastTx = r.txHashes[r.txHashes.length - 1];
      setClaimResult({
        ok: true,
        msg: total > 0n ? `Claimed ${fmtWip(total)} WIP` : "Claim sent — nothing to collect yet",
        tx: lastTx,
      });
      qc.invalidateQueries({ queryKey: qk.publisher(root) });
      claimableQ.refetch();
    },
    onError: (e) => setClaimResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  const claimable = claimableQ.data?.wip ?? "0";
  const claimableBig = claimable && claimable !== "0" ? BigInt(claimable) : 0n;
  const claimDisabled = !wiring || claimMut.isPending;

  /* Wrap IP → WIP. Subscribers need WIP for license minting fees + bond
   * deposits; publishers need WIP for staking. This widget kills the demo's
   * `cast send 0x1514…0000 'deposit()'` step. */
  const wrapMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      let amount;
      try { amount = parseEther(wrapAmount || "0"); }
      catch { throw new Error("Invalid amount — use a decimal like 0.1"); }
      if (amount <= 0n) throw new Error("Amount must be > 0");
      const tx = await wrapNativeToWip({
        config: { ...wiring.hatchConfig, storage: /** @type {any} */ (null) },
        publicClient: wiring.publicClient,
        walletClient: wiring.walletClient,
        account: wiring.account,
        amount,
      });
      return { txHash: tx };
    },
    onSuccess: (r) => setWrapResult({ ok: true, msg: `Wrapped ${wrapAmount} IP → WIP`, tx: r.txHash }),
    onError: (e) => setWrapResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  /* Delegate an editor wallet to act on behalf of the publisher root IP via
   * Story's AccessController. Permissions auto-revoke on IP ownership transfer.
   * `scope: "all"` = ALLOW all functions on all modules; `"none"` = DENY (revoke). */
  const delegateMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      if (!root) throw new Error("No publisher root");
      const trimmed = delegateAddr.trim();
      if (!isAddress(trimmed)) throw new Error("Invalid address — paste a 0x… EVM address");
      return await setDelegate({
        storyClient: wiring.storyClient,
        ipId: root,
        signer: trimmed,
        scope: delegateScope,
      });
    },
    onSuccess: (r) => {
      const verb = delegateScope === "all" ? "Granted" : "Revoked";
      setDelegateResult({ ok: true, msg: `${verb} delegate ${delegateAddr.slice(0,6)}…${delegateAddr.slice(-4)}`, tx: r.txHash });
      if (delegateScope === "none") setDelegateAddr("");
    },
    onError: (e) => setDelegateResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

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

      {(disputeStatusQ.data?.active ?? 0) > 0 && (
        <div className="pending-row" style={{ marginTop: 24, borderLeft: "3px solid var(--hot)" }}>
          <div>
            <div className="t hot">
              {disputeStatusQ.data.active} active dispute{disputeStatusQ.data.active === 1 ? "" : "s"} against your publisher
            </div>
            <div className="m">
              Subscribers can see this. While a dispute is live, you cannot mint licenses or claim royalties.
              {disputeStatusQ.data.judgedAgainst > 0 && <> · {disputeStatusQ.data.judgedAgainst} judged against you historically.</>}
            </div>
          </div>
        </div>
      )}

      <div className="section-rule" style={{ marginTop: 32 }}>
        <h2>Earnings</h2>
        <span className="meta">claimable from LAP</span>
      </div>
      <div className="pending-row" style={{ alignItems: "center" }}>
        <div>
          <div className="t">
            {claimableQ.isLoading ? "Checking…" : `${fmtWip(claimable)} WIP`}
            {claimableBig > 0n && <span className="verdant" style={{ marginLeft: 8, fontSize: 12 }}>available</span>}
          </div>
          <div className="m">
            Routes via RoyaltyPolicyLAP from every hatch under your root.
            {claimableQ.data?.vault ? <> Vault <span className="mono">{claimableQ.data.vault.slice(0, 8)}…</span></> : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <Button
            variant="primary" size="md"
            disabled={claimDisabled}
            onClick={() => { setClaimResult(null); claimMut.mutate(); }}
            title={!wiring ? "Connect wallet on Story Aeneid" : ""}
          >
            {claimMut.isPending ? "Claiming…" : "Claim royalties"}
          </Button>
          {claimResult && (
            <p className={claimResult.ok ? "verdant" : "hot"} style={{ fontSize: 12, margin: 0 }}>
              {claimResult.msg}
              {claimResult.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${claimResult.tx}`}>tx</a></>}
            </p>
          )}
        </div>
      </div>

      <div className="pending-row" style={{ alignItems: "center", marginTop: 12 }}>
        <div>
          <div className="t">Wrap IP → WIP</div>
          <div className="m">WIP is the canonical token for royalty payments, license fees, and registry stakes.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            className="input" type="number" min="0" step="0.01"
            value={wrapAmount} onChange={(e) => setWrapAmount(e.target.value)}
            style={{ width: 90, padding: "6px 8px", fontSize: 12 }} placeholder="0.1"
          />
          <span className="mono-sm ink-soft">IP</span>
          <Button
            variant="outline" size="md"
            disabled={!wiring || wrapMut.isPending}
            onClick={() => { setWrapResult(null); wrapMut.mutate(); }}
            title={!wiring ? "Connect wallet on Story Aeneid" : ""}
          >
            {wrapMut.isPending ? "Wrapping…" : "Wrap"}
          </Button>
        </div>
      </div>
      {wrapResult && (
        <p className={wrapResult.ok ? "verdant" : "hot"} style={{ fontSize: 12, margin: "4px 0 0 12px" }}>
          {wrapResult.msg}
          {wrapResult.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${wrapResult.tx}`}>tx</a></>}
        </p>
      )}

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

      <div className="section-rule" style={{ marginTop: 56 }}>
        <h2>Delegates</h2>
        <span className="meta">Story AccessController</span>
      </div>
      <div className="pending-row" style={{ alignItems: "stretch", flexDirection: "column", gap: 12, padding: 16 }}>
        <div className="body-md ink-soft">
          Grant an editor wallet permission to act on behalf of your publisher root IP — seal hatches, claim royalties, mint licenses — without sharing your key. Permissions auto-revoke if you transfer the IP.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            type="text"
            value={delegateAddr}
            onChange={(e) => setDelegateAddr(e.target.value)}
            placeholder="0xEditorAddress…"
            style={{ flex: "1 1 240px", minWidth: 240, padding: "6px 8px" }}
          />
          <select
            value={delegateScope}
            onChange={(e) => setDelegateScope(e.target.value)}
            className="input"
            style={{ padding: "6px 8px" }}
          >
            <option value="all">Grant — all actions</option>
            <option value="none">Revoke (DENY)</option>
          </select>
          <Button
            variant="primary" size="md"
            disabled={!wiring || delegateMut.isPending}
            onClick={() => { setDelegateResult(null); delegateMut.mutate(); }}
            title={!wiring ? "Connect wallet on Story Aeneid" : ""}
          >
            {delegateMut.isPending ? "Updating…" : delegateScope === "all" ? "Grant" : "Revoke"}
          </Button>
        </div>
        {delegateResult && (
          <p className={delegateResult.ok ? "verdant" : "hot"} style={{ fontSize: 12, margin: 0 }}>
            {delegateResult.msg}
            {delegateResult.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${delegateResult.tx}`}>tx</a></>}
          </p>
        )}
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
