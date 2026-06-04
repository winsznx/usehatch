import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { buyHatch, buyHatchCrossChain, payRoyaltyOnBehalf } from "@usehatch/sdk";
import { parseEther } from "viem";
import { CrossChainSelector, resolveCrossChainSource } from "./cross_chain_selector.jsx";
import { BigCountdown, HatchOrb } from "./console_orb.jsx";
import { Icons } from "./icons.jsx";
import { Avatar, Button, StatusPill, WaxSealCracked, formatPrice, hatchModeLabel, lc, pubDisplay } from "./primitives.jsx";
import {
  useFollowsQuery,
  useHatchQuery,
  useHatchRevealQuery,
  usePublisherQuery,
} from "../lib/hooks.js";
import { useStoryWiring } from "../lib/story.js";
import { useSiweSession } from "../lib/siwe.js";
import { readHatchInBrowser } from "../lib/read.js";
import { api } from "../api.js";
import { qk } from "../lib/queries.js";
import { DisputeModal } from "./dispute_modal.jsx";
/* Hatch Console — Hatch Detail. The product. */
const { useState: useStateH, useEffect: useEffectH } = React;

/** Read the hatch uuid from the hash route — supports `#/hatch/<uuid>`. */
function useHashHatchUuid() {
  const get = () => {
    const m = (typeof window !== "undefined" ? window.location.hash : "").match(/^#\/hatch\/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const [uuid, setUuid] = useStateH(get);
  useEffectH(() => {
    const on = () => setUuid(get());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return uuid;
}

function HatchDetail({ onNearestState }) {
  const I = Icons;
  const uuid = useHashHatchUuid();
  const hatchQ = useHatchQuery(uuid ?? undefined);
  const hatch = hatchQ.data;
  const publisherQ = usePublisherQuery(hatch?.publisherRootIp);
  const pub = publisherQ.data?.publisher;
  const status = hatch?.status;
  const isPostReveal = status === "revealed" || status === "resolved";
  const revealQ = useHatchRevealQuery(hatch?.uuid, isPostReveal);

  useEffectH(() => {
    if (!status) return;
    const orbState = status === "sealed" ? "sealed" : status === "active" ? "incubating" : status === "revealed" ? "hatching" : "public";
    onNearestState && onNearestState(orbState);
  }, [status]);

  if (!uuid) {
    return <div className="hatch"><div className="view view-read"><div className="body-md ink-soft" style={{ padding: 32 }}>No hatch selected. Navigate from a card or the queue.</div></div></div>;
  }
  if (hatchQ.isLoading) {
    return <div className="hatch"><div className="view view-read"><div className="body-md ink-soft" style={{ padding: 32 }}>Loading hatch #{uuid}…</div></div></div>;
  }
  if (hatchQ.isError || !hatch) {
    return <div className="hatch"><div className="view view-read"><div className="body-md ink-soft" style={{ padding: 32 }}>Hatch #{uuid} not found.</div></div></div>;
  }

  return (
    <div className="hatch">
      <div className="view view-read">
        <div className="state-fade">
          {(status === "sealed" || status === "active") && <Gate hatch={hatch} pub={pub} />}
          {status === "revealed" || status === "resolved"
            ? <ReadingExperience hatch={hatch} pub={pub} reveal={revealQ.data} revealLoading={revealQ.isLoading} revealError={revealQ.error} />
            : null}
        </div>
      </div>
    </div>
  );
}
export { HatchDetail };

/* ---------- SEALED / INCUBATING gate ---------- */
function Gate({ hatch, pub }) {
  const I = Icons;
  const qc = useQueryClient();
  const { session } = useSiweSession();
  const wiring = useStoryWiring();
  const followsQ = useFollowsQuery(session?.wallet);
  const [disputeOpen, setDisputeOpen] = useStateH(false);
  const revealMs = new Date(hatch.revealAt).getTime();
  const disp = pubDisplay(pub);
  const priceLabel = formatPrice(hatch.perHatchPriceWei);
  const modeLabel = hatchModeLabel(hatch.mode);
  const isFollowing = (followsQ.data ?? []).some((r) => lc(r) === lc(hatch.publisherRootIp));
  const [buyResult, setBuyResult] = React.useState(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));
  const [subResult, setSubResult] = React.useState(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));
  const [buySrcChain, setBuySrcChain] = useStateH("native");

  const followMut = useMutation({
    mutationFn: async () => {
      if (!session?.token) throw new Error("Sign in required");
      if (isFollowing) await api.unfollow(hatch.publisherRootIp, session.token);
      else await api.follow(hatch.publisherRootIp, session.token);
    },
    onSuccess: () => {
      if (session?.wallet) qc.invalidateQueries({ queryKey: qk.follows(session.wallet) });
    },
  });

  const buyMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story first");
      if (!hatch.perHatchTermsId) throw new Error("This hatch has no per-hatch terms");

      // Cross-chain path (mainnet only — CrossChainSelector hides on testnet).
      const src = resolveCrossChainSource(buySrcChain);
      if (src) {
        const priceWip = hatch.perHatchPriceWei ? BigInt(hatch.perHatchPriceWei) : parseEther("0.01");
        // Quote a rough src amount with 20% headroom. Production would call
        // deBridge's `/quote` endpoint first to get a precise figure.
        const srcAmount = priceWip * 120n / 100n;
        const r = await buyHatchCrossChain({
          src,
          walletClient: wiring.walletClient,
          srcAmount,
          signalIpId: hatch.signalIpId,
          licenseTermsId: BigInt(hatch.perHatchTermsId),
          receiver: wiring.account.address,
          licensingModule: wiring.hatchConfig.chain.licensingModule,
          licenseTemplate: wiring.hatchConfig.chain.pilTemplate,
          wipAddress: wiring.hatchConfig.chain.wip,
          dstAmountWip: priceWip,
        });
        return { licenseTokenId: 0n, txHash: r.srcTxHash, crossChain: true, orderId: r.dlnOrderId };
      }

      // Native Story path.
      return await buyHatch({
        storyClient: wiring.storyClient,
        signalIpId: hatch.signalIpId,
        perHatchTermsId: BigInt(hatch.perHatchTermsId),
        receiver: wiring.account.address,
        maxMintingFee: hatch.perHatchPriceWei ? BigInt(hatch.perHatchPriceWei) : undefined,
      });
    },
    onSuccess: (r) => {
      const msg = r.crossChain
        ? `Bridge order submitted (${r.orderId?.slice(0, 8)}…) — License lands on Story in a few minutes.`
        : `License minted (#${r.licenseTokenId.toString()})`;
      setBuyResult({ ok: true, msg, tx: r.txHash });
      if (session?.wallet) qc.invalidateQueries({ queryKey: qk.myLicenses(session.wallet) });
    },
    onError: (e) => setBuyResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  /* Subscribe pulls WIP via storyClient.license.mintLicenseTokens, which routes through
     Story's contractCallWithFees → handleIpWrapping. Auto-wrap from native IP is on by
     default (enableAutoWrapIp). No manual wrap step needed here. */
  const subscribeMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      if (!session?.token) throw new Error("Sign in required");
      const r = await api.subscribe(hatch.publisherRootIp, session.token, wiring.storyClient);
      return r;
    },
    onSuccess: (r) => {
      setSubResult({ ok: true, msg: `Subscribed (pass #${r.passId})`, tx: r.mintPassTx });
      if (session?.wallet) qc.invalidateQueries({ queryKey: qk.mySubscriptions(session.wallet) });
    },
    onError: (e) => setSubResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  const canSubscribe = hatch.mode === 1 || hatch.mode === 2;     // sub-only or dual
  const canBuy = hatch.mode === 0 || hatch.mode === 2;            // per-hatch or dual
  const buyDisabled = !wiring || !hatch.perHatchTermsId || buyMut.isPending;
  const subDisabled = !wiring || !session?.token || subscribeMut.isPending;

  return (
    <>
      <div className="hatch-byline">
        <a className="hatch-meta-mono" href="#/queue" onClick={(e) => { e.preventDefault(); location.hash = "#/queue"; }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><I.ArrowLeft size={13} /> INCUBATION</a>
        <span className="sep">·</span>
        <span className="hatch-meta-mono">VAULT #{hatch.uuid} · {modeLabel.toUpperCase()}</span>
      </div>

      <div className="gate">
        <div className="gate-copy">
          <StatusPill status={hatch.status} />
          <h1 className="c-d2">{hatch.title ?? `Hatch #${hatch.uuid}`}</h1>
          {hatch.summary && <p className="gate-deck">{hatch.summary}</p>}

          <div className="gate-count">
            <div className="gate-count-lbl">{hatch.status === "sealed" ? "Reveals in" : "Reveal imminent — opens in"}</div>
            <BigCountdown revealAt={revealMs} />
          </div>

          <div className="gate-ctas">
            {canBuy && (
              <>
                <Button
                  variant="primary" size="lg"
                  disabled={buyDisabled}
                  onClick={() => { setBuyResult(null); buyMut.mutate(); }}
                  title={!wiring ? "Connect wallet on Story" : !hatch.perHatchTermsId ? "No per-hatch terms registered for this hatch" : ""}
                >
                  {buyMut.isPending ? (buySrcChain === "native" ? "Minting…" : "Bridging…") : "Buy this hatch"}
                  {priceLabel && <span className="hatch-meta-mono" style={{ color: "inherit" }}>{priceLabel}</span>}
                </Button>
                <CrossChainSelector value={buySrcChain} onChange={setBuySrcChain} label="Pay from" />
              </>
            )}
            {canSubscribe && (
              <Button
                variant="outline" size="lg"
                disabled={subDisabled}
                onClick={() => { setSubResult(null); subscribeMut.mutate(); }}
                title={!wiring ? "Connect wallet on Story Aeneid" : !session?.token ? "Sign in first" : ""}
              >
                {subscribeMut.isPending ? "Subscribing…" : `Subscribe to ${disp.handle}`}
              </Button>
            )}
            <Button
              variant="outline" size="lg"
              disabled={!session?.token || followMut.isPending}
              onClick={() => followMut.mutate()}
              title={!session?.token ? "Sign in first" : isFollowing ? "Unfollow" : "Follow publisher"}
            >
              {followMut.isPending ? "…" : isFollowing ? "Following" : "Follow"}
            </Button>
            <Button
              variant="outline" size="lg"
              disabled={!session?.token || !wiring}
              onClick={() => setDisputeOpen(true)}
              title={!session?.token ? "Sign in first" : !wiring ? "Connect wallet on Story Aeneid" : "Raise an on-chain dispute via UMA"}
            >
              Dispute
            </Button>
          </div>

          {buyResult && (
            <p className={buyResult.ok ? "verdant" : "hot"} style={{ fontSize: 12, marginTop: 8 }}>
              {buyResult.msg}
              {buyResult.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${buyResult.tx}`}>tx</a></>}
            </p>
          )}
          {subResult && (
            <p className={subResult.ok ? "verdant" : "hot"} style={{ fontSize: 12, marginTop: 8 }}>
              {subResult.msg}
              {subResult.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${subResult.tx}`}>tx</a></>}
            </p>
          )}

          <p className="gate-note ink-soft" style={{ fontSize: 12 }}>
            Buy mints a per-hatch license from your wallet. Subscribe mints a license + paired Pass through the publisher's minter (server-orchestrated). Both settle on Story Aeneid; transactions show up on Storyscan.
          </p>
        </div>
        <div className="gate-orb">
          <HatchOrb state={hatch.status === "sealed" ? "sealed" : "incubating"} size={300} />
        </div>
      </div>

      <div className="read-foot" style={{ marginTop: 8 }}>
        <div className="read-foot-attest">
          <I.Lock size={13} /> Encrypted on Story CDR <span className="trust-sep">·</span> Auto-reveals at {new Date(hatch.revealAt).toLocaleString()} <span className="trust-sep">·</span> nobody can pre-open
        </div>
      </div>

      <DisputeModal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        targetIpId={hatch.signalIpId}
        targetLabel={hatch.title ?? `Hatch #${hatch.uuid}`}
        publisherRootIp={hatch.publisherRootIp}
        hatchUuid={hatch.uuid}
      />
    </>
  );
}

/* ---------- PUBLIC reading experience ---------- */
function ReadingExperience({ hatch, pub, reveal, revealLoading, revealError }) {
  const I = Icons;
  const { session } = useSiweSession();
  const wiring = useStoryWiring();
  const disp = pubDisplay(pub);
  const revealedLabel = new Date(hatch.revealAt).toLocaleString();
  const [browserRead, setBrowserRead] = React.useState(/** @type {null | { text: string; media: any[]; reader: string; txHash: string }} */ (null));
  const [poolRead, setPoolRead] = React.useState(/** @type {null | { text: string; media: any[]; reader: string; txHash: string }} */ (null));
  const [readError, setReadError] = React.useState(/** @type {string | null} */ (null));
  const [disputeOpen, setDisputeOpen] = React.useState(false);

  // Browser-side read with the user's wagmi wallet. Per the CDR diagram, the
  // reader's keypair is on the wire and validators deliver partial decryptions
  // to it — server never sees plaintext.
  const browserReadMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      return await readHatchInBrowser({ wiring, uuid: hatch.uuid, entitlement: "empty" });
    },
    onSuccess: (r) => { setBrowserRead(r); setReadError(null); },
    onError: (e) => setReadError(e instanceof Error ? e.message : String(e)),
  });

  // Server-pool fallback. Used only when wagmi isn't connected (i.e., the
  // reader has no wallet at all). Server sees plaintext in this path —
  // documented honestly in the UI so users know the privacy tradeoff.
  const poolReadMut = useMutation({
    mutationFn: async () => {
      if (!session?.token) throw new Error("Sign in required");
      return await api.readHatch(hatch.uuid, { entitlement: "empty", via: "anonymous" }, session.token);
    },
    onSuccess: (r) => { setPoolRead(r); setReadError(null); },
    onError: (e) => setReadError(e instanceof Error ? e.message : String(e)),
  });

  const finalText = browserRead?.text ?? poolRead?.text ?? reveal?.text ?? null;
  const finalMedia = (browserRead?.media ?? poolRead?.media ?? reveal?.media) || [];
  const finalReader = browserRead?.reader ?? poolRead?.reader ?? null;
  const finalTx = browserRead?.txHash ?? poolRead?.txHash ?? null;
  const finalSource = browserRead ? "browser" : poolRead ? "pool" : null;

  return (
    <article className="read">
      <span className="read-kicker"><WaxSealCracked size={16} /> Unsealed {revealedLabel} · now public</span>
      <h1 className="read-title">{hatch.title ?? `Hatch #${hatch.uuid}`}</h1>
      {hatch.summary && <p className="read-deck">{hatch.summary}</p>}

      <div className="read-byline">
        <div className="pub">
          <Avatar pub={disp} size={34} />
          <div>
            <div className="name">{pub?.displayName ?? "—"}</div>
            <div className="h">{disp.handle}</div>
          </div>
        </div>
        <span className="dot">·</span>
        <span className="rt">VAULT #{hatch.uuid}</span>
      </div>

      <TipHatchSignal hatch={hatch} wiring={wiring} />


      <div className="read-body">
        {revealLoading && <p className="ink-soft">Decrypting content…</p>}
        {revealError && !browserRead && !poolRead && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <p className="ink-soft">Reveal worker hasn't mirrored this hatch into Postgres yet — but post-reveal CDR is open. Read it directly:</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                variant="primary" size="md"
                disabled={!wiring || browserReadMut.isPending}
                onClick={() => { setReadError(null); browserReadMut.mutate(); }}
                title={!wiring ? "Connect wallet on Aeneid for private read" : "Decrypts in your browser; server sees no plaintext."}
              >
                {browserReadMut.isPending ? "Reading in your browser…" : "Read (private — browser-side)"}
              </Button>
              <Button
                variant="outline" size="md"
                disabled={!session?.token || poolReadMut.isPending}
                onClick={() => { setReadError(null); poolReadMut.mutate(); }}
                title={!session?.token ? "Sign in first" : "Server reads on your behalf; plaintext briefly visible to server."}
              >
                {poolReadMut.isPending ? "Reading via pool…" : "Read via server pool"}
              </Button>
            </div>
            {readError && <p className="hot" style={{ fontSize: 12 }}>{readError}</p>}
          </div>
        )}
        {finalText && <p className="lead">{finalText}</p>}
        {finalMedia?.length ? (
          <div style={{ marginTop: 16 }}>
            <h3>Attached media</h3>
            <ul>{finalMedia.map((m, i) => <li key={i}>{m.name} <span className="ink-soft">({m.mime})</span></li>)}</ul>
          </div>
        ) : null}
        {!revealLoading && !revealError && !finalText && !finalMedia?.length && (
          <p className="ink-soft">No content body — this hatch is on-chain only.</p>
        )}
        {finalSource && finalReader && (
          <p className="ink-soft" style={{ fontSize: 12, marginTop: 12 }}>
            {finalSource === "browser" ? "Decrypted in your browser by " : "Decrypted by ephemeral pool wallet "}
            <span className="mono">{finalReader.slice(0,8)}…</span>
            {finalTx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${finalTx}`}>tx</a></>}
          </p>
        )}
      </div>

      <div className="read-foot">
        <div className="read-foot-attest">
          <I.Hash size={13} /> Vault #{hatch.uuid} <span className="trust-sep">·</span> sealed {new Date(hatch.embargoStart).toLocaleString()}
          <span className="trust-sep">·</span> auto-revealed by Story CDR <span className="trust-sep">·</span>
          <a href={`https://aeneid.storyscan.io/address/${hatch.publisherRootIp}`} target="_blank" rel="noreferrer" style={{ color: "var(--hot)", display: "inline-flex", alignItems: "center", gap: 4 }}>view on Storyscan <I.ExternalLink size={11} /></a>
          <span className="trust-sep">·</span>
          <button
            onClick={() => setDisputeOpen(true)}
            disabled={!session?.token || !wiring}
            style={{ background: "transparent", border: 0, padding: 0, color: "var(--hot)", cursor: !session?.token || !wiring ? "not-allowed" : "pointer" }}
            title={!session?.token ? "Sign in first" : !wiring ? "Connect wallet on Story Aeneid" : "Raise an on-chain dispute via UMA"}
          >
            dispute this
          </button>
        </div>
      </div>

      <DisputeModal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        targetIpId={hatch.signalIpId}
        targetLabel={hatch.title ?? `Hatch #${hatch.uuid}`}
        publisherRootIp={hatch.publisherRootIp}
        hatchUuid={hatch.uuid}
      />
    </article>
  );
}

/* Tip the hatch's signal IP. Story SDK auto-wraps IP→WIP and auto-approves
 * the RoyaltyModule, so a connected wallet with native IP balance can tip
 * without any other setup. Tips propagate to the publisher root via LAP. */
function TipHatchSignal({ hatch, wiring }) {
  const [amount, setAmount] = useStateH("0.01");
  const [result, setResult] = useStateH(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));

  const tipMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      let amountWei;
      try { amountWei = parseEther(amount || "0"); }
      catch { throw new Error("Invalid amount — use a decimal like 0.01"); }
      if (amountWei <= 0n) throw new Error("Amount must be > 0");
      return await payRoyaltyOnBehalf({
        config: { ...wiring.hatchConfig, storage: /** @type {any} */ (null) },
        storyClient: wiring.storyClient,
        receiverIpId: hatch.signalIpId,
        amountWip: amountWei,
        txExecutor: wiring.txExecutor ?? undefined,
      });
    },
    onSuccess: (r) => setResult({ ok: true, msg: `Tipped ${amount} WIP — routes to publisher via LAP`, tx: r.txHash }),
    onError: (e) => setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
      <span className="body-sm ink-soft">Tip the author</span>
      <input className="input" type="number" min="0" step="0.001"
        value={amount} onChange={(e) => setAmount(e.target.value)}
        style={{ width: 90, padding: "6px 8px", fontSize: 12 }} placeholder="0.01" />
      <span className="mono-sm ink-soft">WIP</span>
      <Button variant="outline" size="sm"
        disabled={!wiring || tipMut.isPending}
        onClick={() => { setResult(null); tipMut.mutate(); }}
        title={!wiring ? "Connect wallet on Story Aeneid" : wiring.txExecutor ? "Sponsored via Privy smart wallet" : ""}>
        {tipMut.isPending ? "Tipping…" : "Send tip"}
      </Button>
      {result && (
        <span className={result.ok ? "verdant" : "hot"} style={{ fontSize: 12 }}>
          {result.msg}
          {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
        </span>
      )}
    </div>
  );
}
