import type { Address, Hash, Hex } from "viem";

export type { Address, Hash, Hex };

export type HatchMode = 0 | 1 | 2; // per-hatch | subscription | dual
export type EntitlementKind = 0 | 1;

/** Per-media entry in the manifest. AES key is base64url-encoded. */
export interface ManifestMedia {
  path: string;       // storage CID / path
  key: string;        // base64url AES-256-GCM key
  iv?: string;        // base64url IV (concatenated in ciphertext per cdr-crypto, kept here for forward compat)
  mime: string;
  name: string;
  size: number;       // plaintext bytes
}

export interface Manifest {
  v: 1;
  text: string;
  media: ManifestMedia[];
  createdAt: number;  // unix seconds
}

export interface PublisherDescriptor {
  publisher: Address;            // wallet
  publisherRootIpId: Address;    // IP id (also the IP Account address)
  spgNftContract: Address;
  subscriptionTermsId: bigint;   // PIL terms attached at root for subscriptions
  registryTxHash: Hash;
}

export interface HatchDescriptor {
  uuid: number;                  // CDR vault UUID
  signalIpId: Address;           // derivative IP for this signal
  perHatchTermsId: bigint;
  publisherRootIpId: Address;
  mode: HatchMode;
  embargoStart: bigint;
  revealAt: bigint;
  outcomeSpec?: OutcomeSpec;
}

export interface OutcomeSpec {
  kind: "price" | "binary" | "score";
  /** Off-chain hint to the operator for what to attest. Hashed into outcomeHash at attestation time. */
  description?: string;
}

export type Entitlement =
  | { kind: 0; licenseTokenIds: bigint[] }
  | { kind: 1; passId: bigint };

export type ReadVia = "wallet" | "anonymous";

export interface ReadResult {
  text: string;
  media: { name: string; mime: string; bytes: Uint8Array }[];
  txHash: Hash;
  reader: Address; // the address that actually sent the read tx (ephemeral for anonymous)
  latencyMs: number;
}

export interface AttestationInput {
  hatchId: Hex;          // bytes32
  outcomeHash: Hex;      // bytes32
  outcomeValue: bigint;  // int256
  observedAt: bigint;    // uint64
  nonce: bigint;         // uint256
}
