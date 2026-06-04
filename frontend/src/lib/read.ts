/* Browser-side hatch reads — true CDR fidelity.
 *
 * Per the CDR diagram, the reader generates the keypair and the validators
 * deliver partial decryptions to it. The SDK's `readHatch` encapsulates that
 * (Steps 1–4 of the diagram) — we just need to call it with the user's wagmi
 * wallet so the keypair on the wire is theirs, not the server's.
 *
 * That means the backend NEVER sees the decrypted manifest for `via: "wallet"`
 * reads. The previous /hatches/:uuid/read path leaked the plaintext to our
 * own process; this path keeps it browser-resident end-to-end.
 *
 * For media (the manifest references ciphertext blobs by cid), we still go
 * through BackendStorage — but those blobs are encrypted with per-file keys
 * that only the manifest holds. The backend's storage proxy sees only opaque
 * ciphertext. */
import { readHatch as sdkReadHatch } from "@usehatch/sdk";
import { AENEID, HATCH as HATCH_CONTRACTS } from "@usehatch/sdk";
import type { StoryWiring } from "./story.js";
import { BackendStorage } from "./storage.js";

export type Entitlement =
  | { kind: 0; licenseTokenIds: bigint[] }
  | { kind: 1; passId: bigint };

export interface BrowserReadResult {
  text: string;
  media: { name: string; mime: string; bytes: Uint8Array }[];
  txHash: `0x${string}`;
  reader: `0x${string}`;
  latencyMs: number;
}

/** `via: "wallet"` — caller signs the read with their wagmi wallet.
 *  Use for entitled reads (post-reveal "empty" OR pre-reveal kind=0/1 where
 *  the user's wallet owns the license/pass). Plaintext stays in the browser. */
export async function readHatchInBrowser(args: {
  wiring: StoryWiring;
  uuid: number;
  entitlement: Entitlement | "empty";
}): Promise<BrowserReadResult> {
  const { wiring, uuid, entitlement } = args;
  const storage = new BackendStorage();
  const result = await sdkReadHatch({
    config: { chain: AENEID, hatch: HATCH_CONTRACTS, storage },
    publicClient: wiring.publicClient as unknown as Parameters<typeof sdkReadHatch>[0]["publicClient"],
    uuid,
    entitlement,
    via: "wallet",
    walletClient: wiring.walletClient as unknown as Parameters<typeof sdkReadHatch>[0]["walletClient"],
    account: wiring.account as any,
  });
  return {
    text: result.text,
    media: result.media,
    txHash: result.txHash,
    reader: result.reader,
    latencyMs: result.latencyMs,
  };
}
