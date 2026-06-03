import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createHatch } from "@usehatch/sdk";
import { parseEther } from "viem";
import { Icons } from "./icons.jsx";
import { Button, pubDisplay } from "./primitives.jsx";
import { useSiweSession } from "../lib/siwe.js";
import { useStoryWiring } from "../lib/story.js";
import { usePublishersQuery } from "../lib/hooks.js";
import { BackendStorage } from "../lib/storage.js";
import { qk } from "../lib/queries.js";
import { api } from "../api.js";

/* Hatch Console — Seal a new hatch (composer).
 * Single-page form: title/summary/body, mode, per-hatch price, embargo + reveal,
 * optional media attachments. Submit runs SDK createHatch end-to-end from the
 * user's wallet, posting ciphertext to /storage and the manifest into a CDR vault. */

const { useState: useStateC, useMemo } = React;
const MODES = [
  { v: 0, label: "Per-hatch only", hint: "Buyers mint a one-shot license at the per-hatch price." },
  { v: 1, label: "Subscription only", hint: "Only active subscribers of your publisher root can read." },
  { v: 2, label: "Dual", hint: "Subscribers read for free; per-hatch buyers pay the listed price." },
];

function toIsoLocal(date) {
  // Format Date as 'YYYY-MM-DDTHH:mm' for input[type=datetime-local].
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function parseIsoLocal(s) {
  // input[type=datetime-local] yields 'YYYY-MM-DDTHH:mm' in LOCAL time.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function Compose({ onNearestState }) {
  const I = Icons;
  const qc = useQueryClient();
  const { session } = useSiweSession();
  const wiring = useStoryWiring();
  const pubsQ = usePublishersQuery();
  React.useEffect(() => { onNearestState && onNearestState("sealed"); }, []);

  const myPub = useMemo(() => {
    if (!session?.wallet) return null;
    return (pubsQ.data ?? []).find((p) => p.wallet.toLowerCase() === session.wallet.toLowerCase()) ?? null;
  }, [pubsQ.data, session?.wallet]);

  const now = new Date();
  const defaultEmbargo = new Date(now.getTime() + 60 * 1000);
  const defaultReveal = new Date(now.getTime() + 30 * 60 * 1000);

  const [title, setTitle] = useStateC("");
  const [summary, setSummary] = useStateC("");
  const [body, setBody] = useStateC("");
  const [mode, setMode] = useStateC(0);
  const [priceWip, setPriceWip] = useStateC("0.01");
  const [embargoStart, setEmbargoStart] = useStateC(toIsoLocal(defaultEmbargo));
  const [revealAt, setRevealAt] = useStateC(toIsoLocal(defaultReveal));
  const [files, setFiles] = useStateC(/** @type {File[]} */([]));
  const [phase, setPhase] = useStateC("idle");
  const [error, setError] = useStateC(/** @type {null | string} */(null));
  const [result, setResult] = useStateC(/** @type {null | { uuid: number; tx: string }} */(null));

  const composeMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      if (!myPub) throw new Error("You're not registered as a publisher yet — visit Command Center first");
      if (!myPub.subscriptionTermsId) throw new Error("Your publisher has no subscriptionTermsId — re-register or wait for indexer to populate");
      const embargoDate = parseIsoLocal(embargoStart);
      const revealDate = parseIsoLocal(revealAt);
      if (!embargoDate || !revealDate) throw new Error("Invalid date — use YYYY-MM-DD HH:mm");
      if (revealDate.getTime() <= embargoDate.getTime()) throw new Error("Reveal must be after embargo start");
      if (revealDate.getTime() <= Date.now()) throw new Error("Reveal must be in the future");
      if (title.trim().length === 0) throw new Error("Title required");
      let priceBig;
      try { priceBig = mode === 1 ? 0n : parseEther(priceWip || "0"); }
      catch { throw new Error("Invalid price — use a decimal like 0.01"); }

      // Read media files into Uint8Array
      setPhase("uploading");
      const media = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        media.push({ bytes: new Uint8Array(buf), name: f.name, mime: f.type || "application/octet-stream" });
      }

      const storage = new BackendStorage();
      setPhase("sealing");
      const descriptor = await createHatch({
        config: { ...wiring.hatchConfig, storage },
        publicClient: wiring.publicClient,
        walletClient: wiring.walletClient,
        storyClient: wiring.storyClient,
        account: wiring.account,
        publisherRootIpId: myPub.publisherRootIp,
        spgNftContract: /** Reuse Story public collection for v1 — same as createPublisher fallback. */ "0xc32A8a0FF3beDDDa58393d022aF433e78739FAbc",
        subscriptionTermsId: BigInt(myPub.subscriptionTermsId),
        content: { text: body, media },
        mode,
        perHatchPriceWip: priceBig,
        embargoStart: BigInt(Math.floor(embargoDate.getTime() / 1000)),
        revealAt: BigInt(Math.floor(revealDate.getTime() / 1000)),
      });

      // Persist public title/summary so cards render the real headline
      // instead of "Hatch #<uuid>". The indexer eventually picks up the row
      // from on-chain events; this PATCH races ahead so the publisher's own
      // queue shows the real title immediately.
      if (session?.token && (title.trim() || summary.trim())) {
        try {
          await api.setHatchMetadata(descriptor.uuid, {
            title: title.trim(),
            summary: summary.trim(),
            publisherRootIp: myPub.publisherRootIp,
            signalIpId: descriptor.signalIpId,
            mode,
            embargoStart: Number(descriptor.embargoStart),
            revealAt: Number(descriptor.revealAt),
          }, session.token);
        } catch (e) {
          console.warn("[compose] metadata patch failed; indexer will recover when it sees the on-chain row", e);
        }
      }
      return descriptor;
    },
    onSuccess: (d) => {
      setPhase("done");
      setResult({ uuid: d.uuid, tx: d.txHashes.write });
      qc.invalidateQueries({ queryKey: qk.hatches() });
      qc.invalidateQueries({ queryKey: qk.publisher(myPub.publisherRootIp) });
    },
    onError: (e) => { setPhase("idle"); setError(e instanceof Error ? e.message : String(e)); },
  });

  if (!session?.token) {
    return <div className="view"><div className="mast"><span className="mast-eyebrow"><I.Plus size={13} /> Seal a hatch</span><h1 className="c-d1">Sign in to seal.</h1></div></div>;
  }
  if (pubsQ.isLoading) {
    return <div className="view"><div className="mast"><h1 className="c-d1">Loading…</h1></div></div>;
  }
  if (!myPub) {
    return <div className="view"><div className="mast"><span className="mast-eyebrow"><I.Plus size={13} /> Seal a hatch</span><h1 className="c-d1">Register as a publisher first.</h1><div className="mast-summary ink-soft">Go to Command Center to onboard, then come back to seal.</div><div style={{ marginTop: 12 }}><Button variant="primary" size="md" onClick={() => { location.hash = "#/publisher"; }}>Open Command Center →</Button></div></div></div>;
  }

  const disp = pubDisplay(myPub);

  return (
    <div className="view">
      <div className="mast">
        <span className="mast-eyebrow"><I.Plus size={13} /> Seal a new hatch</span>
        <h1 className="c-d1">Compose the embargo.</h1>
        <div className="mast-summary ink-soft">Publishing as {disp.handle} · {myPub.publisherRootIp}</div>
      </div>

      <div className="two-col" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label className="body-sm">Title
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One-line headline" />
          </label>
          <label className="body-sm">Summary (optional preview shown post-reveal)
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One sentence" />
          </label>
          <label className="body-sm">Body (encrypted, revealed on timer)
            <textarea className="input" style={{ width: "100%", marginTop: 4, minHeight: 160, resize: "vertical" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Full text. Long bodies spill into encrypted media; manifest stays ≤1KB." />
          </label>
          <label className="body-sm">Attachments (encrypted before upload)
            <input type="file" multiple style={{ display: "block", marginTop: 4 }} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            {files.length > 0 && <div className="ink-soft" style={{ fontSize: 11, marginTop: 4 }}>{files.length} file{files.length === 1 ? "" : "s"} · {(files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1)} KB total</div>}
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label className="body-sm" style={{ flex: 1 }}>Embargo start
              <input className="input" style={{ width: "100%", marginTop: 4 }} type="datetime-local" value={embargoStart} onChange={(e) => setEmbargoStart(e.target.value)} />
            </label>
            <label className="body-sm" style={{ flex: 1 }}>Reveal at
              <input className="input" style={{ width: "100%", marginTop: 4 }} type="datetime-local" value={revealAt} onChange={(e) => setRevealAt(e.target.value)} />
            </label>
          </div>
          <div>
            <div className="body-sm" style={{ marginBottom: 6 }}>Mode</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MODES.map((m) => (
                <label key={m.v} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input type="radio" name="mode" value={m.v} checked={mode === m.v} onChange={() => setMode(m.v)} style={{ marginTop: 4 }} />
                  <span>
                    <span className="body-sm">{m.label}</span>
                    <span className="ink-soft" style={{ display: "block", fontSize: 11 }}>{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {mode !== 1 && (
            <label className="body-sm">Per-hatch price (WIP)
              <input className="input" style={{ width: "100%", marginTop: 4 }} value={priceWip} onChange={(e) => setPriceWip(e.target.value)} placeholder="0.01" />
            </label>
          )}
          <Button
            variant="primary" size="lg"
            disabled={!wiring || composeMut.isPending}
            onClick={() => { setError(null); setResult(null); composeMut.mutate(); }}
            title={!wiring ? "Connect wallet on Story Aeneid" : ""}
          >
            {phase === "uploading" ? "Encrypting + uploading…" : phase === "sealing" ? "Sealing on-chain…" : "Seal this hatch"}
          </Button>
          {result && (
            <p className="verdant" style={{ fontSize: 12 }}>
              Sealed as vault #{result.uuid}
              {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
            </p>
          )}
          {error && <p className="hot" style={{ fontSize: 12 }}>{error}</p>}
        </div>

        <div>
          <div className="section-rule"><h2>What this does</h2></div>
          <p className="body-md ink-soft" style={{ marginTop: 12 }}>
            1. Registers the hatch as a derivative IP of your publisher root, inheriting the subscription PIL.<br />
            2. Attaches per-hatch PIL terms with your minting fee.<br />
            3. Encrypts the manifest and writes ciphertext to a Story CDR vault under the HatchCondition.<br />
            4. After <span className="mono">reveal at</span>, anyone can read via the CDR's empty-entitlement path.
          </p>
          <p className="body-sm ink-soft" style={{ marginTop: 12 }}>
            Bodies up to ~900 chars stay inline in the ≤1KB manifest. Longer bodies spill into an encrypted blob upload. Media is always uploaded as ciphertext via your wallet's session.
          </p>
        </div>
      </div>
    </div>
  );
}
export { Compose };
