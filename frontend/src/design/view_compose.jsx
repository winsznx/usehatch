import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addToGroup, createGroup, createHatch, GROUP_MEMBER_CAP } from "@usehatch/sdk";
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

/* PIL flavors — which Story license terms attach to the signal IP.
 * `commercialRemix` is the default and supports our LAP royalty flow.
 * `commercialUse` is paid but doesn't allow derivatives.
 * `nonCommercialSocialRemixing` skips the per-hatch attach entirely
 * (Story's global terms id=1 — no fee, attribution-only).
 * `creativeCommonsAttribution` is open + free + derivative-friendly. */
const PIL_FLAVORS = [
  { v: "commercialRemix", label: "Commercial · remix", hint: "Paid mint + rev-share; derivatives allowed. Default for monetized hatches.", commercial: true },
  { v: "commercialUse", label: "Commercial · no derivatives", hint: "Paid mint; readers cannot remix or fork. Use for one-shot scoops.", commercial: true },
  { v: "nonCommercialSocialRemixing", label: "Free preview · attribution only", hint: "Anyone reads for free, must credit you. Mint is gas-only.", commercial: false },
  { v: "creativeCommonsAttribution", label: "Creative Commons (CC BY)", hint: "Open + derivative-friendly. Commercial use allowed with attribution.", commercial: false },
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

  const [composeKind, setComposeKind] = useStateC(/** @type {"single" | "group"} */ ("single"));
  const [title, setTitle] = useStateC("");
  const [summary, setSummary] = useStateC("");
  const [body, setBody] = useStateC("");
  const [mode, setMode] = useStateC(0);
  const [priceWip, setPriceWip] = useStateC("0.01");
  const [pilFlavor, setPilFlavor] = useStateC("commercialRemix");
  const [imageUrl, setImageUrl] = useStateC("");
  const [creatorName, setCreatorName] = useStateC("");
  const [embargoStart, setEmbargoStart] = useStateC(toIsoLocal(defaultEmbargo));
  const [revealAt, setRevealAt] = useStateC(toIsoLocal(defaultReveal));
  const [files, setFiles] = useStateC(/** @type {File[]} */([]));
  // Group composer rows. Each row = one hatch within the dataset bundle.
  const [groupItems, setGroupItems] = useStateC([{ id: 0, title: "", body: "" }]);
  const [groupNextId, setGroupNextId] = useStateC(1);
  const pilFlavorMeta = PIL_FLAVORS.find((f) => f.v === pilFlavor);
  const isCommercialFlavor = pilFlavorMeta?.commercial ?? true;
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
      try {
        priceBig = (mode === 1 || !isCommercialFlavor) ? 0n : parseEther(priceWip || "0");
      } catch { throw new Error("Invalid price — use a decimal like 0.01"); }

      // Read media files into Uint8Array
      setPhase("uploading");
      const media = [];
      for (const f of files) {
        const buf = await f.arrayBuffer();
        media.push({ bytes: new Uint8Array(buf), name: f.name, mime: f.type || "application/octet-stream" });
      }

      const storage = new BackendStorage();
      setPhase("sealing");

      /* Build metadata only when at least one field is filled. Empty fields
       * fall through to the SDK's pass-empty-URI default — same as before. */
      const metadata = (title.trim() || summary.trim() || imageUrl.trim() || creatorName.trim())
        ? {
            title: title.trim() || "Untitled hatch",
            description: summary.trim() || "",
            image: imageUrl.trim() || undefined,
            creators: [{
              name: creatorName.trim() || pubDisplay(myPub).handle || "Anonymous",
              address: wiring.account.address,
              contributionPercent: 100,
            }],
          }
        : undefined;

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
        pilFlavor,
        metadata,
        publicMetadataUrlBase: `${import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:4011"}/storage`,
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

  /* Group composer mutation.
   *
   * One on-chain group + N hatches sealed together. The group is registered
   * with LRP royalty (GroupingModule rejects LAP), and every member hatch is
   * created with the same LRP terms so the protocol-side dedup matches them.
   *
   * Members reveal-all-or-none: the form takes a single embargo/reveal pair
   * and every hatch within the group inherits it. The dataset feels like one
   * publication, not N separate posts.
   *
   * Flow:
   *   1. createGroup({ groupPool, license })           — register group + attach LRP terms
   *   2. PATCH /groups/{groupId}/metadata               — race-ahead editorial save
   *   3. for each row: createHatch({..., royaltyPolicy: LRP, pilFlavor: commercialRemix})
   *   4. addToGroup({ groupId, ipIds: signalIpIds })   — bind members to group
   *
   * If any step fails after group registration, the group is still created
   * on-chain — callers should retry with the same group title to fold in
   * partial successes (the indexer dedups via groupIpId PK). */
  const groupComposeMut = useMutation({
    mutationFn: async () => {
      if (!wiring) throw new Error("Connect wallet on Story Aeneid first");
      if (!myPub) throw new Error("You're not registered as a publisher yet — visit Command Center first");
      if (!myPub.subscriptionTermsId) throw new Error("Your publisher has no subscriptionTermsId — re-register or wait for indexer to populate");
      const embargoDate = parseIsoLocal(embargoStart);
      const revealDate = parseIsoLocal(revealAt);
      if (!embargoDate || !revealDate) throw new Error("Invalid date — use YYYY-MM-DD HH:mm");
      if (revealDate.getTime() <= embargoDate.getTime()) throw new Error("Reveal must be after embargo start");
      if (revealDate.getTime() <= Date.now()) throw new Error("Reveal must be in the future");
      if (title.trim().length === 0) throw new Error("Dataset title required");
      const validRows = groupItems.filter((r) => r.title.trim().length > 0 || r.body.trim().length > 0);
      if (validRows.length === 0) throw new Error("Add at least one hatch row to the dataset");
      if (validRows.length > GROUP_MEMBER_CAP) throw new Error(`Datasets cap at ${GROUP_MEMBER_CAP} members`);
      let priceBig;
      try { priceBig = mode === 1 ? 0n : parseEther(priceWip || "0"); }
      catch { throw new Error("Invalid price — use a decimal like 0.01"); }

      const storage = new BackendStorage();
      const hatchConfig = { ...wiring.hatchConfig, storage };
      const lrp = wiring.hatchConfig.chain.royaltyPolicyLrp;
      const revSharePct = 10;

      // 1. Register Group + LRP license.
      setPhase("uploading"); // reuses spinner state — actual labels handled in button copy
      const group = await createGroup({
        config: hatchConfig,
        storyClient: wiring.storyClient,
        license: { mintingFeeWip: priceBig, commercialRevSharePct: revSharePct },
      });

      // 2. Race-ahead editorial metadata.
      if (session?.token) {
        try {
          await api.setGroupMetadata(group.groupId, {
            title: title.trim(),
            description: summary.trim(),
            publisherRootIp: myPub.publisherRootIp,
            licenseTermsId: group.licenseTermsId.toString(),
          }, session.token);
        } catch (e) { console.warn("[compose] group metadata patch failed; indexer will fill in", e); }
      }

      // 3. Seal each member hatch — LRP-rooted, so the protocol's terms dedup
      //    matches them against the group's terms id automatically.
      setPhase("sealing");
      const descriptors = [];
      for (const row of validRows) {
        const desc = await createHatch({
          config: hatchConfig,
          publicClient: wiring.publicClient,
          walletClient: wiring.walletClient,
          storyClient: wiring.storyClient,
          account: wiring.account,
          publisherRootIpId: myPub.publisherRootIp,
          spgNftContract: "0xc32A8a0FF3beDDDa58393d022aF433e78739FAbc",
          subscriptionTermsId: BigInt(myPub.subscriptionTermsId),
          content: { text: row.body, media: [] },
          mode,
          perHatchPriceWip: priceBig,
          perHatchRevSharePct: revSharePct,
          embargoStart: BigInt(Math.floor(embargoDate.getTime() / 1000)),
          revealAt: BigInt(Math.floor(revealDate.getTime() / 1000)),
          pilFlavor: "commercialRemix",
          royaltyPolicy: lrp,
        });
        descriptors.push(desc);

        // Persist title/summary per-row so cards render the real headline.
        if (session?.token && row.title.trim()) {
          try {
            await api.setHatchMetadata(desc.uuid, {
              title: row.title.trim(),
              publisherRootIp: myPub.publisherRootIp,
              signalIpId: desc.signalIpId,
              mode,
              embargoStart: Number(desc.embargoStart),
              revealAt: Number(desc.revealAt),
            }, session.token);
          } catch (e) { /* indexer recovers */ }
        }
      }

      // 4. Add every member to the group.
      const addRes = await addToGroup({
        config: hatchConfig,
        storyClient: wiring.storyClient,
        groupId: group.groupId,
        ipIds: descriptors.map((d) => d.signalIpId),
      });

      return { group, descriptors, addTx: addRes.txHash };
    },
    onSuccess: ({ group, descriptors, addTx }) => {
      setPhase("done");
      setResult({ uuid: -1, tx: addTx, groupId: group.groupId, memberCount: descriptors.length });
      qc.invalidateQueries({ queryKey: qk.hatches() });
      qc.invalidateQueries({ queryKey: qk.publisher(myPub.publisherRootIp) });
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e) => { setPhase("idle"); setError(e instanceof Error ? e.message : String(e)); },
  });

  function addGroupRow() {
    if (groupItems.length >= GROUP_MEMBER_CAP) return;
    setGroupItems([...groupItems, { id: groupNextId, title: "", body: "" }]);
    setGroupNextId(groupNextId + 1);
  }
  function removeGroupRow(id) {
    if (groupItems.length <= 1) return;
    setGroupItems(groupItems.filter((r) => r.id !== id));
  }
  function setGroupRow(id, patch) {
    setGroupItems(groupItems.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

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
        <h1 className="c-d1">{composeKind === "group" ? "Compose a dataset." : "Compose the embargo."}</h1>
        <div className="mast-summary ink-soft">Publishing as {disp.handle} · {myPub.publisherRootIp}</div>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <button
          className="btn-connect"
          onClick={() => setComposeKind("single")}
          aria-pressed={composeKind === "single"}
          style={{ borderColor: composeKind === "single" ? "var(--hot)" : "var(--rule)", color: composeKind === "single" ? "var(--hot)" : "var(--ink)" }}
        >
          Single hatch
        </button>
        <button
          className="btn-connect"
          onClick={() => setComposeKind("group")}
          aria-pressed={composeKind === "group"}
          style={{ borderColor: composeKind === "group" ? "var(--hot)" : "var(--rule)", color: composeKind === "group" ? "var(--hot)" : "var(--ink)" }}
        >
          Dataset (group)
        </button>
      </div>

      <div className="two-col" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label className="body-sm">{composeKind === "group" ? "Dataset title" : "Title"}
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One-line headline" />
          </label>
          <label className="body-sm">{composeKind === "group" ? "Dataset description" : "Summary (optional preview shown post-reveal)"}
            <input className="input" style={{ width: "100%", marginTop: 4 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One sentence" />
          </label>
          {composeKind === "single" && (
            <>
              <label className="body-sm">Body (encrypted, revealed on timer)
                <textarea className="input" style={{ width: "100%", marginTop: 4, minHeight: 160, resize: "vertical" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Full text. Long bodies spill into encrypted media; manifest stays ≤1KB." />
              </label>
              <label className="body-sm">Attachments (encrypted before upload)
                <input type="file" multiple style={{ display: "block", marginTop: 4 }} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                {files.length > 0 && <div className="ink-soft" style={{ fontSize: 11, marginTop: 4 }}>{files.length} file{files.length === 1 ? "" : "s"} · {(files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1)} KB total</div>}
              </label>
            </>
          )}
          {composeKind === "group" && (
            <div>
              <div className="body-sm" style={{ marginBottom: 6 }}>Dataset items ({groupItems.length} / {GROUP_MEMBER_CAP})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {groupItems.map((row, idx) => (
                  <div key={row.id} className="pending-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span className="mono-sm">ITEM {idx + 1}</span>
                      <button
                        onClick={() => removeGroupRow(row.id)}
                        disabled={groupItems.length <= 1}
                        style={{ background: "transparent", border: 0, color: "var(--ink-soft)", cursor: groupItems.length <= 1 ? "not-allowed" : "pointer", fontSize: 12 }}
                      >
                        Remove
                      </button>
                    </div>
                    <input className="input" style={{ width: "100%" }} value={row.title} onChange={(e) => setGroupRow(row.id, { title: e.target.value })} placeholder={`Item ${idx + 1} title`} />
                    <textarea
                      className="input"
                      style={{ width: "100%", minHeight: 80, resize: "vertical" }}
                      value={row.body}
                      onChange={(e) => setGroupRow(row.id, { body: e.target.value })}
                      placeholder="Item body (encrypted, revealed on the shared timer)"
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <Button variant="outline" size="sm" onClick={addGroupRow} disabled={groupItems.length >= GROUP_MEMBER_CAP}>
                  + Add another item
                </Button>
                <span className="ink-soft" style={{ fontSize: 11 }}>
                  Members reveal all-or-none on the shared timer. Royalties split evenly via EvenSplitGroupPool.
                </span>
              </div>
            </div>
          )}
          <div className="compose-row">
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
          <div>
            <div className="body-sm" style={{ marginBottom: 6 }}>License flavor</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PIL_FLAVORS.map((f) => (
                <label key={f.v} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input type="radio" name="pilFlavor" value={f.v} checked={pilFlavor === f.v} onChange={() => setPilFlavor(f.v)} style={{ marginTop: 4 }} />
                  <span>
                    <span className="body-sm">{f.label}</span>
                    <span className="ink-soft" style={{ display: "block", fontSize: 11 }}>{f.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {mode !== 1 && isCommercialFlavor && (
            <label className="body-sm">Per-hatch price (WIP)
              <input className="input" style={{ width: "100%", marginTop: 4 }} value={priceWip} onChange={(e) => setPriceWip(e.target.value)} placeholder="0.01" />
            </label>
          )}
          {!isCommercialFlavor && (
            <div className="ink-soft" style={{ fontSize: 11 }}>
              Non-commercial flavor — no per-hatch price (minting is gas-only).
            </div>
          )}
          <div>
            <div className="body-sm" style={{ marginBottom: 6 }}>IPA metadata (optional — surfaces on Story Explorer)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="body-sm">Cover image URL
                <input className="input" style={{ width: "100%", marginTop: 4 }} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://… (PNG/JPG)" />
              </label>
              <label className="body-sm">Creator name
                <input className="input" style={{ width: "100%", marginTop: 4 }} value={creatorName} onChange={(e) => setCreatorName(e.target.value)} placeholder={pubDisplay(myPub).handle || "Anonymous"} />
              </label>
              <div className="ink-soft" style={{ fontSize: 11 }}>
                Leave empty to skip the metadata upload (signal IP registers with empty URIs — same as today).
                Title + summary above are reused. SHA-256 hashes are computed locally.
              </div>
            </div>
          </div>
          <Button
            variant="primary" size="lg"
            disabled={!wiring || composeMut.isPending || groupComposeMut.isPending}
            onClick={() => {
              setError(null); setResult(null);
              if (composeKind === "group") groupComposeMut.mutate();
              else composeMut.mutate();
            }}
            title={
              !wiring ? "Connect wallet on Story Aeneid (chain 1315)" :
              composeMut.isPending ? "Seal in progress — wait for the current transactions to finish" :
              groupComposeMut.isPending ? "Dataset seal in progress" :
              ""
            }
          >
            {phase === "uploading" ? "Encrypting + uploading…"
              : phase === "sealing" ? "Sealing on-chain…"
              : composeKind === "group" ? "Seal this dataset"
              : "Seal this hatch"}
          </Button>
          {result && composeKind === "group" && result.groupId && (
            <p className="verdant" style={{ fontSize: 12 }}>
              Dataset sealed · {result.memberCount} hatch{result.memberCount === 1 ? "" : "es"} in group <span className="mono">{result.groupId.slice(0,8)}…</span>
              {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
            </p>
          )}
          {result && composeKind === "single" && (
            <p className="verdant" style={{ fontSize: 12 }}>
              Sealed as vault #{result.uuid}
              {result.tx && <> · <a target="_blank" rel="noreferrer" style={{ color: "var(--hot)" }} href={`https://aeneid.storyscan.io/tx/${result.tx}`}>tx</a></>}
            </p>
          )}
          {error && <p className="hot" style={{ fontSize: 12 }}>{error}</p>}
        </div>

        <div>
          <div className="section-rule"><h2>What this does</h2></div>
          {composeKind === "single" ? (
            <>
              <p className="body-md ink-soft" style={{ marginTop: 12 }}>
                1. Registers the hatch as a derivative IP of your publisher root, inheriting the subscription PIL.<br />
                2. Attaches per-hatch PIL terms with your minting fee.<br />
                3. Encrypts the manifest and writes ciphertext to a Story CDR vault under the HatchCondition.<br />
                4. After <span className="mono">reveal at</span>, anyone can read via the CDR's empty-entitlement path.
              </p>
              <p className="body-sm ink-soft" style={{ marginTop: 12 }}>
                Bodies up to ~900 chars stay inline in the ≤1KB manifest. Longer bodies spill into an encrypted blob upload. Media is always uploaded as ciphertext via your wallet's session.
              </p>
            </>
          ) : (
            <>
              <p className="body-md ink-soft" style={{ marginTop: 12 }}>
                1. Registers a Group IPA on Story's GroupingModule with LRP royalty.<br />
                2. Attaches one shared PIL terms id to the group.<br />
                3. Seals each item as its own CDR vault hatch — same embargo + reveal as the rest.<br />
                4. Adds every item to the group so the whole dataset reveals + earns together.
              </p>
              <p className="body-sm ink-soft" style={{ marginTop: 12 }}>
                Royalties from any member flow to <span className="mono">EvenSplitGroupPool</span> and split evenly across members. LRP is enforced — Story rejects LAP for groups. mintingFee + licensingHook lock after the first member; cap is {GROUP_MEMBER_CAP} members.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
export { Compose };
