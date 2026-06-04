import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { payRoyaltyOnBehalf, tipCrossChain } from "@usehatch/sdk";
import { parseEther } from "viem";
import { CrossChainSelector, resolveCrossChainSource } from "./cross_chain_selector.jsx";
import { Icons } from "./icons.jsx";
import { Avatar, Button, lc, pubDisplay, shortAddr } from "./primitives.jsx";
import { useFollowsQuery, useDisputesQuery, usePublishersQuery } from "../lib/hooks.js";
import { useSiweSession } from "../lib/siwe.js";
import { useStoryWiring } from "../lib/story.js";
import { api } from "../api.js";
import { qk } from "../lib/queries.js";
import { DisputeModal } from "./dispute_modal.jsx";

/* Inline tip control. WIP is the canonical royalty token; the Story SDK
 * auto-wraps native IP → WIP when WIP balance is insufficient (default behavior
 * of WithWipOptions). The publisher root is the receiver so royalties flow up
 * the LAP graph regardless of which hatch is hot. */
function TipPublisher({ rootIp, sponsoredHint }) {
  const wiring = useStoryWiring();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("0.01");
  const [srcChain, setSrcChain] = React.useState("native");
  const [result, setResult] = React.useState(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));

  const tipMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story first");
      let amountWei;
      try { amountWei = parseEther(amount || "0"); }
      catch { throw new Error("Invalid amount — use a decimal like 0.01"); }
      if (amountWei <= 0n) throw new Error("Amount must be > 0");

      const src = resolveCrossChainSource(srcChain);
      if (src) {
        // Cross-chain tip via deBridge. 20% src-amount headroom (production
        // would call deBridge's /quote first for precise pricing).
        const srcAmount = amountWei * 120n / 100n;
        const r = await tipCrossChain({
          src,
          walletClient: wiring.walletClient,
          srcAmount,
          receiverIpId: rootIp,
          royaltyModule: wiring.hatchConfig.chain.royaltyModule,
          wipAddress: wiring.hatchConfig.chain.wip,
          dstAmountWip: amountWei,
        });
        return { txHash: r.srcTxHash, crossChain: true, orderId: r.dlnOrderId };
      }

      return await payRoyaltyOnBehalf({
        config: { ...wiring.hatchConfig, storage: /** @type {any} */ (null) },
        storyClient: wiring.storyClient,
        receiverIpId: rootIp,
        amountWip: amountWei,
        txExecutor: wiring.txExecutor ?? undefined,
      });
    },
    onSuccess: (r) => {
      const msg = r.crossChain
        ? `Bridge order ${r.orderId?.slice(0, 8)}… — tip lands on Story in a few minutes.`
        : `Tipped ${amount} WIP`;
      setResult({ ok: true, msg, tx: r.txHash });
      setOpen(false);
    },
    onError: (e) => setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  if (!open) {
    return (
      <Button variant="outline" size="md" disabled={!wiring} onClick={() => { setResult(null); setOpen(true); }}
        title={!wiring ? "Connect wallet on Story Aeneid" : sponsoredHint}>
        Tip
      </Button>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input className="input" type="number" min="0" step="0.001"
        value={amount} onChange={(e) => setAmount(e.target.value)}
        style={{ width: 80, padding: "6px 8px", fontSize: 12 }} placeholder="0.01" />
      <CrossChainSelector value={srcChain} onChange={setSrcChain} label="Pay from" />
      <Button variant="primary" size="sm"
        disabled={tipMut.isPending}
        onClick={() => { setResult(null); tipMut.mutate(); }}>
        {tipMut.isPending ? (srcChain === "native" ? "Tipping…" : "Bridging…") : "Send"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={tipMut.isPending}>×</Button>
      {result && (
        <span className={result.ok ? "verdant" : "hot"} style={{ fontSize: 11 }}>
          {result.msg}
          {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
        </span>
      )}
    </div>
  );
}

function Publishers({ onNearestState }) {
  const I = Icons;
  const qc = useQueryClient();
  const { session } = useSiweSession();
  const wiring = useStoryWiring();
  const pubsQ = usePublishersQuery();
  const followsQ = useFollowsQuery(session?.wallet);
  const disputesQ = useDisputesQuery({ status: "raised", limit: 200 });
  React.useEffect(() => { onNearestState && onNearestState("public"); }, []);
  const sponsoredHint = wiring?.txExecutor ? "Sponsored via Privy smart wallet" : undefined;

  /* Build a Set of publisher roots that have at least one active dispute. */
  const disputedRoots = React.useMemo(() => {
    const s = new Set();
    for (const d of disputesQ.data ?? []) if (d.publisherRootIp) s.add(lc(d.publisherRootIp));
    return s;
  }, [disputesQ.data]);

  const [disputeTarget, setDisputeTarget] = React.useState(/** @type {null | { ipId: string; label: string; publisherRootIp: string }} */ (null));

  const followedSet = React.useMemo(() => {
    const s = new Set();
    for (const r of followsQ.data ?? []) s.add(lc(r));
    return s;
  }, [followsQ.data]);

  const followMut = useMutation({
    mutationFn: async ({ root, currentlyFollowing }) => {
      if (!session?.token) throw new Error("Sign in required");
      if (currentlyFollowing) await api.unfollow(root, session.token);
      else await api.follow(root, session.token);
    },
    onSuccess: () => {
      if (session?.wallet) qc.invalidateQueries({ queryKey: qk.follows(session.wallet) });
    },
  });

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Users size={13} /> Publishers</span>
        <h1 className="c-d1">Everyone publishing on Hatch.</h1>
        <div className="mast-summary">{pubsQ.data?.length ?? 0} publisher{(pubsQ.data?.length ?? 0) === 1 ? "" : "s"} on the registry</div>
      </div>

      <div className="pending" style={{ marginTop: 12 }}>
        {pubsQ.isLoading && <div className="body-sm ink-soft" style={{ padding: 16 }}>Loading…</div>}
        {!pubsQ.isLoading && (pubsQ.data?.length ?? 0) === 0 && (
          <div className="body-sm ink-soft" style={{ padding: 16 }}>No publishers registered yet.</div>
        )}
        {(pubsQ.data ?? []).map((p) => {
          const disp = pubDisplay(p);
          const root = lc(p.publisherRootIp);
          const isFollowing = followedSet.has(root);
          const pending = followMut.isPending && followMut.variables?.root === root;
          const isDisputed = disputedRoots.has(root);
          const isSelf = !!session?.wallet && lc(p.wallet) === lc(session.wallet);
          return (
            <div className="pending-row" key={root}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <Avatar pub={disp} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {disp.handle}
                    {isDisputed && <span className="hot" style={{ fontSize: 11, marginLeft: 8 }} title="Active dispute on Story DisputeModule">· disputed</span>}
                  </div>
                  <div className="m mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortAddr(root)}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TipPublisher rootIp={p.publisherRootIp} sponsoredHint={sponsoredHint} />
                {!isSelf && (
                  <Button
                    variant="outline" size="md"
                    disabled={!session?.token || !wiring}
                    onClick={() => setDisputeTarget({ ipId: p.publisherRootIp, label: disp.handle, publisherRootIp: p.publisherRootIp })}
                    title={!session?.token ? "Sign in first" : !wiring ? "Connect wallet on Story Aeneid" : "Raise an on-chain dispute via UMA"}
                  >
                    Dispute
                  </Button>
                )}
                <Button
                  variant={isFollowing ? "outline" : "primary"}
                  size="md"
                  disabled={!session?.token || pending}
                  onClick={() => followMut.mutate({ root, currentlyFollowing: isFollowing })}
                >
                  {pending ? "…" : isFollowing ? "Following" : "Follow"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {!session?.token && (
        <div className="body-sm ink-soft" style={{ marginTop: 16, padding: 12 }}>
          Sign in to follow publishers.
        </div>
      )}

      <DisputeModal
        open={!!disputeTarget}
        onClose={() => setDisputeTarget(null)}
        targetIpId={disputeTarget?.ipId ?? ""}
        targetLabel={disputeTarget?.label ?? ""}
        publisherRootIp={disputeTarget?.publisherRootIp ?? ""}
      />
    </div>
  );
}
export { Publishers };
