import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DISPUTE_TAGS, raiseDispute } from "@usehatch/sdk";
import { parseEther } from "viem";
import { Button } from "./primitives.jsx";
import { useStoryWiring } from "../lib/story.js";
import { useSiweSession } from "../lib/siwe.js";
import { api } from "../api.js";
import { qk } from "../lib/queries.js";

const TAG_LABELS = {
  IMPROPER_REGISTRATION: { label: "Improper registration", hint: "Duplicate / not the author's IP." },
  IMPROPER_USAGE: { label: "Improper usage", hint: "License terms violation." },
  IMPROPER_PAYMENT: { label: "Improper payment", hint: "Missing royalty payments associated with this IP." },
  CONTENT_STANDARDS_VIOLATION: { label: "Content standards violation", hint: "Hate / minors / weapons / pornography." },
};

/* DisputeModal — single component used by both publisher and hatch pages.
 *
 * Flow:
 *   1. User picks tag + writes evidence text (and optional bond override).
 *   2. POST evidence text to `/storage` → returns CID. Server hashes it; CID is
 *      the resolvable identifier that the protocol pins to disputeEvidenceHash.
 *   3. SDK `raiseDispute({ targetIpId, tag, evidenceCid, bond? })` signed from
 *      the user's wallet. Bond defaults to OOV3 minimum when omitted. Auto-wrap
 *      IP→WIP runs internally so users just need IP balance.
 *   4. Tx submits → modal shows tx link → indexer eventually inserts into
 *      `disputes` table → query refetches → "disputed" badge appears. */
export function DisputeModal({ open, onClose, targetIpId, targetLabel, publisherRootIp, hatchUuid }) {
  const qc = useQueryClient();
  const wiring = useStoryWiring();
  const { session } = useSiweSession();
  const [tag, setTag] = React.useState("IMPROPER_USAGE");
  const [evidence, setEvidence] = React.useState("");
  const [bondWip, setBondWip] = React.useState("");
  const [result, setResult] = React.useState(/** @type {null | { ok: boolean; msg: string; tx?: string }} */ (null));

  const disputeMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      if (!session?.token) throw new Error("Sign in first — evidence upload is authed");
      if (evidence.trim().length < 8) throw new Error("Evidence must be at least 8 characters");

      const { cid } = await api.uploadEvidence(evidence.trim(), session.token);

      let bondWei;
      if (bondWip.trim()) {
        try { bondWei = parseEther(bondWip.trim()); }
        catch { throw new Error("Invalid bond — use a decimal like 0.1"); }
      }

      return await raiseDispute({
        config: { ...wiring.hatchConfig, storage: /** @type {any} */ (null) },
        storyClient: wiring.storyClient,
        targetIpId,
        tag,
        evidenceCid: cid,
        bondWei,
        txExecutor: wiring.txExecutor ?? undefined,
      });
    },
    onSuccess: (r) => {
      setResult({ ok: true, msg: `Dispute raised — protocol id ${r.disputeId ?? "(pending indexer)"}`, tx: r.txHash });
      if (publisherRootIp) {
        qc.invalidateQueries({ queryKey: [...qk.publisher(publisherRootIp), "dispute-status"] });
        qc.invalidateQueries({ queryKey: ["disputes"] });
      }
    },
    onError: (e) => setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) }),
  });

  if (!open) return null;

  return (
    <div
      role="dialog" aria-modal="true"
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget && !disputeMut.isPending) onClose(); }}
    >
      <div className="modal-panel">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div className="mono-sm">RAISE DISPUTE</div>
            <h2 className="heading-md" style={{ margin: "4px 0 0" }}>{targetLabel || "Target IP"}</h2>
            <div className="ink-soft mono" style={{ fontSize: 11 }}>{targetIpId}</div>
          </div>
          <button onClick={onClose} disabled={disputeMut.isPending} aria-label="Close"
            style={{ background: "transparent", border: 0, fontSize: 22, color: "var(--ink-soft)", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="body-sm" style={{ marginBottom: 6 }}>Tag</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {DISPUTE_TAGS.map((t) => (
              <label key={t} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input type="radio" name="dispute-tag" value={t} checked={tag === t} onChange={() => setTag(t)} style={{ marginTop: 4 }} />
                <span>
                  <span className="body-sm">{TAG_LABELS[t].label}</span>
                  <span className="ink-soft" style={{ display: "block", fontSize: 11 }}>{TAG_LABELS[t].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="body-sm" style={{ display: "block", marginTop: 16 }}>
          Evidence
          <textarea
            className="input"
            style={{ width: "100%", marginTop: 4, minHeight: 120, resize: "vertical" }}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Explain why this IP violates the selected tag. Include links / hashes / counter-claims."
          />
        </label>

        <label className="body-sm" style={{ display: "block", marginTop: 12 }}>
          Bond override (WIP, optional)
          <input
            className="input"
            type="number" min="0" step="0.001"
            style={{ width: "100%", marginTop: 4 }}
            value={bondWip}
            onChange={(e) => setBondWip(e.target.value)}
            placeholder="Leave empty to use OOV3 minimum"
          />
        </label>

        <div className="ink-soft" style={{ fontSize: 11, marginTop: 8 }}>
          Bond pays into a UMA-style escrow. If the dispute is judged in your favor, you get
          your bond back + 50% of the loser's bond. If judged against you, you forfeit it.
          Liveness window is 30 days — anyone can counter-stake within that window.
        </div>

        <div className="modal-actions">
          <Button variant="outline" size="md" onClick={onClose} disabled={disputeMut.isPending}>Cancel</Button>
          <Button variant="primary" size="md"
            disabled={!wiring || !session?.token || disputeMut.isPending}
            onClick={() => { setResult(null); disputeMut.mutate(); }}
            title={!wiring ? "Connect wallet on Story Aeneid" : !session?.token ? "Sign in first" : ""}>
            {disputeMut.isPending ? "Submitting…" : "Raise dispute"}
          </Button>
        </div>

        {result && (
          <p className={result.ok ? "verdant" : "hot"} style={{ fontSize: 12, marginTop: 12 }}>
            {result.msg}
            {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
          </p>
        )}
      </div>
    </div>
  );
}
