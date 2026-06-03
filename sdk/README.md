# @usehatch/sdk

Typed client for **Hatch** — programmable embargoes on Story Protocol's Confidential Data Rails. Wraps `@piplabs/cdr-sdk` and `@story-protocol/core-sdk` with a small, opinionated API for publishing, purchasing, and reading time-locked content on Story Aeneid.

```
npm install @usehatch/sdk
# or
pnpm add @usehatch/sdk
```

## Peer dependencies

The SDK does not pin Story or CDR — install the versions your app uses:

```
pnpm add viem @story-protocol/core-sdk @piplabs/cdr-sdk @piplabs/cdr-crypto @piplabs/cdr-contracts
```

| Peer | Required version |
|---|---|
| `viem` | `^2.21` |
| `@story-protocol/core-sdk` | `1.4.4` |
| `@piplabs/cdr-sdk` | `0.2.1` |
| `@piplabs/cdr-crypto` | `0.2.1` |
| `@piplabs/cdr-contracts` | `0.2.1` |

Node `>=22` required (CDR crypto uses WebAssembly).

## Entry points

```ts
import { createHatch, buyHatch, readHatch, AENEID, HATCH } from "@usehatch/sdk";

// Storage providers are Node-only — separate subpath so they don't get
// pulled into browser bundles by the barrel.
import { LocalDiskProvider, SupabaseProvider, FailoverStorage } from "@usehatch/sdk/storage";
```

## Quick start

### 1. Register as a publisher

Mints an SPG NFT collection, registers your publisher root IP with subscription PIL terms attached, and onboards you in `HatchPublisherRegistry`.

```ts
import { createPublisher, stake, parseEther } from "@usehatch/sdk";
import { AENEID, HATCH } from "@usehatch/sdk";

const descriptor = await createPublisher({
  config: { chain: AENEID, hatch: HATCH },
  publicClient, walletClient, storyClient, account,
  collection: { name: "Alpha Spike Research", symbol: "ALPHA" },
  subscription: {
    mintingFeeWip: parseEther("0.05"),  // per-subscription fee
    commercialRevSharePct: 10,
  },
});
// → { publisher, publisherRootIpId, spgNftContract, subscriptionTermsId, registryTxHash }

// Stake to enable slashing-backed reputation
await stake({
  config: { chain: AENEID, hatch: HATCH },
  publicClient, walletClient, account,
  amount: parseEther("0.1"),
});
```

### 2. Seal a hatch

Registers the content as a derivative of the publisher root, builds an encrypted manifest, allocates a CDR vault under `HatchCondition`, writes the ciphertext.

```ts
import { createHatch, parseEther } from "@usehatch/sdk";
import { LocalDiskProvider } from "@usehatch/sdk/storage";

const storage = new LocalDiskProvider("/tmp/hatch-storage");

const hatch = await createHatch({
  config: { chain: AENEID, hatch: HATCH, storage },
  publicClient, walletClient, storyClient, account,
  publisherRootIpId,
  spgNftContract,
  subscriptionTermsId,
  content: {
    text: "Full thesis: BTC reclaims 71K because ...",
    media: [
      { name: "chart.png", mime: "image/png", bytes: chartBytes },
    ],
  },
  mode: 2,                                          // 0 per-hatch · 1 sub · 2 dual
  perHatchPriceWip: parseEther("0.01"),
  embargoStart: BigInt(Math.floor(Date.now() / 1000) + 60),
  revealAt:     BigInt(Math.floor(Date.now() / 1000) + 3600),
});
// → { uuid, signalIpId, perHatchTermsId, txHashes: { derivative, allocate, write } }
```

### 3. Buy a per-hatch license

```ts
import { buyHatch, parseEther } from "@usehatch/sdk";

const { licenseTokenId, txHash } = await buyHatch({
  storyClient,
  signalIpId: hatch.signalIpId,
  perHatchTermsId: hatch.perHatchTermsId,
  receiver: buyerAddress,
  maxMintingFee: parseEther("0.01"),
});
```

### 4. Subscribe

Two-party flow: subscriber mints the sub License Token, then `HatchSubscriptionPass.minter` mints the paired Pass to the subscriber.

```ts
import { subscribe } from "@usehatch/sdk";

const { subLicenseTokenId, passId, mintLicenseTx, mintPassTx } = await subscribe({
  config: { chain: AENEID, hatch: HATCH },
  publicClient,
  walletClient: minterWalletClient,    // wallet that owns Pass.minter
  storyClient: subscriberStoryClient,  // subscriber's client (signs the license mint)
  minterAccount,
  subscriber: subscriberAddress,
  publisherRootIpId,
  subscriptionTermsId,
  durationDays: 30,
  subPriceWip: parseEther("0.05"),
});
```

### 5. Read a hatch

Three modes for three use cases.

```ts
import { readHatch, EphemeralPool } from "@usehatch/sdk";

// (a) Signed read — caller's wallet owns the license / pass.
//     Default. Plaintext stays in the caller's process.
const result = await readHatch({
  config: { chain: AENEID, hatch: HATCH, storage },
  publicClient, walletClient, account,
  uuid: hatch.uuid,
  entitlement: "empty",         // post-reveal · or { kind: 0, licenseTokenIds } · or { kind: 1, passId }
  via: "wallet",
});
// → { text, media: [{ name, mime, bytes }], txHash, reader, latencyMs }

// (b) Anonymous post-reveal — reads via an ephemeral pool wallet.
//     The pool address signs, not the user's; useful when the reader has no
//     persistent wallet.
const pool = new EphemeralPool({
  treasuryPk, chain: AENEID, rpcUrl: AENEID.rpcUrl, size: 4,
});
await readHatch({
  config: { chain: AENEID, hatch: HATCH, storage },
  publicClient,
  uuid: hatch.uuid,
  entitlement: "empty",
  via: "anonymous",
  pool,
});

// (c) Anonymous-lent — subscriber lends pass to an ephemeral wallet, that
//     wallet reads, pass is unlent on return. Pre-reveal anonymous read
//     without exposing the subscriber's identity.
await readHatch({
  config: { chain: AENEID, hatch: HATCH, storage },
  publicClient,
  uuid: hatch.uuid,
  entitlement: { kind: 1, passId },
  via: "anonymous-lent",
  pool,
  subscriberWallet, subscriberAccount,
});
```

## Storage providers

The SDK accepts any `HatchStorage` implementation:

```ts
interface HatchStorage {
  upload(data: Uint8Array, options?: { pin?: boolean }): Promise<string>;
  download(cid: string): Promise<Uint8Array>;
}
```

Built-in implementations (Node-only, importable from `@usehatch/sdk/storage`):

| Provider | Use |
|---|---|
| `LocalDiskProvider(root)` | Test / local dev. Content-addressed by SHA-256. |
| `SupabaseProvider(url, serviceRoleKey, bucket)` | Production. Bucket-scoped uploads. |
| `FailoverStorage(primary, secondary?)` | Reads fail over to a secondary on primary error. Writes mirror best-effort. |

Browser consumers should implement `HatchStorage` against their own backend storage endpoints — see the Hatch frontend's `BackendStorage` adapter for an example.

## Configuration

`AENEID` and `HATCH` are pinned constants for Story Aeneid testnet (chain 1315):

```ts
import { AENEID, HATCH } from "@usehatch/sdk";

AENEID.wip                   // 0x1514…0000 — wrapped IP token
AENEID.licenseToken          // 0xFe38…C6BC
AENEID.pilTemplate           // 0x2E89…D316
AENEID.royaltyPolicyLap      // 0xBe54…390E
AENEID.cdr                   // 0xcCcc…0005 (CDR precompile)
AENEID.dkg                   // 0xcCcc…0004 (DKG precompile)

HATCH.subscriptionPass       // 0x9fc7…09e1
HATCH.hatchCondition         // 0x9362…b474 — v2.1 split-slot read condition
HATCH.oracle                 // 0x5257…7a24
HATCH.publisherRegistry      // 0x3351…ddfa
```

`HatchConfig` collects these plus a storage provider:

```ts
interface HatchConfig {
  chain: typeof AENEID;
  hatch: typeof HATCH;
  storage: HatchStorage;
  fallbackStorage?: HatchStorage;
  ephemeralTreasuryPk?: `0x${string}`;
  ephemeralPoolSize?: number;
}
```

`defaultConfig({ storage })` returns a fully-populated `HatchConfig` with `AENEID` + `HATCH` + sensible defaults.

## Module reference

| Module | Exports |
|---|---|
| `publisher.ts` | `createPublisher`, `stake`, `unstake`, `getPublisher`, `wrapNativeToWip` |
| `hatch.ts` | `createHatch`, `getHatch`, `encodeConditionData`, `encodeOwnerWriteData` |
| `commerce.ts` | `buyHatch`, `subscribe` |
| `read.ts` | `readHatch`, `encodeAccessAux` |
| `manifest.ts` | `buildManifest`, `parseManifest`, `MediaInput` |
| `ephemeral-pool.ts` | `EphemeralPool`, `EphemeralPoolOpts`, `PoolStateStore` |
| `oracle.ts` | `signAttestation`, `submitAttestation`, `challenge`, `finalize`, `resolveChallenge`, `getOutcome` |
| `hatchid.ts` | `hatchIdFor`, `uuidFromHatchId` |
| `crypto.ts` | `ensureWasm` |
| `errors.ts` | `HatchError`, `translate` |
| `types.ts` | `HatchMode`, `OutcomeSpec`, `Entitlement`, `ReadVia`, `HatchDescriptor`, `PublisherDescriptor`, `Manifest`, `ManifestMedia` |
| `config.ts` | `AENEID`, `HATCH`, `defaultConfig`, `HatchConfig` |
| `storage` subpath | `HatchStorage` (type, also re-exported from root), `LocalDiskProvider`, `SupabaseProvider`, `FailoverStorage` |

## Errors

All thrown errors are `HatchError` instances with a stable `.code`:

```ts
import { HatchError } from "@usehatch/sdk";

try {
  await readHatch({ ... });
} catch (e) {
  if (e instanceof HatchError) {
    if (e.code === "NOT_ENTITLED") return showPaywall();
    if (e.code === "MANIFEST_TOO_LARGE") return showSizeError();
  }
  throw e;
}
```

Codes: `WALLET_REQUIRED`, `NOT_ENTITLED`, `EPHEMERAL_NO_LEASE`, `MANIFEST_TOO_LARGE`, `MEDIA_DECRYPT_FAILED`, `CDR_READ_FAILED`, `STORY_TX_FAILED`, `UNKNOWN`.

## Repository

Source, contracts, backend, and a reference frontend live at <https://github.com/winsznx/usehatch>. See [`ARCHITECTURE.md`](https://github.com/winsznx/usehatch/blob/main/ARCHITECTURE.md) for the full system view.

## License

MIT — see [LICENSE](https://github.com/winsznx/usehatch/blob/main/LICENSE).
