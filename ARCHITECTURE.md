# Hatch — Architecture (A→Z)

> Programmable embargoes on Story Protocol's Confidential Data Rails. One page, no shortcuts.

## What Hatch is, in one paragraph

Publishers seal content (research notes, alpha calls, scoops) inside an **encrypted CDR vault** on Story Aeneid with a public reveal timer. **Subscribers** pay for early access via on-chain license tokens. The vault **cannot be opened early** — not by us, not by them. When the timer hits zero, anyone can read. Every reveal is forced and verifiable. Every prediction can be **resolved by an oracle**. Every publisher accumulates an on-chain track record that **can't be edited or hidden**.

## Components

```
┌────────────────────────────── BROWSER ──────────────────────────────┐
│  React + Vite (frontend/) ── wagmi · RainbowKit · TanStack Query    │
│  ├── lib/story.ts        wagmi → StoryClient on Aeneid              │
│  ├── lib/read.ts         CDR read in-browser (user's keypair)       │
│  ├── lib/storage.ts      BackendStorage adapter (ciphertext only)   │
│  └── design/view_compose.jsx  composer: createHatch + manifest      │
└─────────────────────────────────────────────────────────────────────┘
                              │ HTTPS · WSS · SIWE bearer/cookie
┌────────────────────────────── BACKEND ──────────────────────────────┐
│  Hono on Node (backend/)                                             │
│  ├── /siwe/*          SIWE auth (cookie + bearer), Postgres-backed   │
│  ├── /hatches /publishers /follows /subscriptions /licenses …       │
│  ├── /me/queue /me/timeline   user-scoped reads (entitlement-gated)  │
│  ├── /storage          ciphertext proxy → Supabase bucket           │
│  ├── /subscribe        two-party mint (pass-minter key, server-side) │
│  ├── /hatches/:uuid/read   server-pool read (anonymous post-reveal)  │
│  ├── /publishers/:root/metrics + /resolutions                        │
│  └── /healthz /livez   probes DB · RPC · Storage                    │
└─────────────────────────────────────────────────────────────────────┘
    │ Postgres                  │ Story Aeneid RPC               │ Supabase Storage
    ▼                           ▼                                ▼
┌─────────────────┐    ┌──────────────────────────┐   ┌──────────────────────┐
│ hatches         │    │ HatchCondition v2.1      │   │ encrypted ciphertext │
│ publishers      │    │ HatchSubscriptionPass    │   │ (per-file AES blobs) │
│ subscriptions   │    │ HatchPublisherRegistry   │   └──────────────────────┘
│ licenses        │    │ HatchOutcomeOracle       │
│ outcomes        │    │ CDR (0x…05) + DKG (…04)  │
│ track_records   │    │ Story Licensing Module   │
│ siwe_sessions   │    │ RoyaltyPolicyLAP (Story) │
│ revealed_content│    └──────────────────────────┘
└─────────────────┘
    ▲
    │ event-driven dispatch
┌─────────────────────────────────────────────────────────────────────┐
│  Workers (backend/src/)                                              │
│  ├── indexer.ts        eth_getLogs cursor → upsert hatches/outcomes  │
│  ├── reveal.ts         post-reveal worker mirrors plaintext for UI   │
│  ├── oracle-worker.ts  outcome attestations (EIP-712)                │
│  ├── notify.ts         email + Web Push fanout                       │
│  └── aggregator.ts     track_record rollups                          │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  @usehatch/sdk (sdk/)                                                │
│  publisher.ts (createPublisher · stake) · hatch.ts (createHatch)     │
│  commerce.ts (buyHatch · subscribe) · read.ts (readHatch via 3 modes)│
│  ephemeral-pool.ts · manifest.ts (encrypt+upload+≤1KB JSON)          │
└─────────────────────────────────────────────────────────────────────┘
```

## The two flows

### Encryption — publisher seals a hatch

1. Publisher signs in (SIWE) and opens `/console#/compose`.
2. Composer reads title, body, mode (per-hatch / sub-only / dual), price, embargo + reveal timestamps, optional media.
3. SDK `createHatch` runs in the browser, signed by the user's wagmi wallet:
   1. `storyClient.ipAsset.mintAndRegisterIpAndMakeDerivative` — signal IP as a derivative of the publisher root, inheriting the subscription PIL.
   2. `storyClient.license.registerPilTermsAndAttach` — attaches per-hatch PIL terms with the minting fee.
   3. `manifest.buildManifest` — encrypts each media file with a per-file AES-256-GCM key, uploads ciphertext to `/storage` (Supabase bucket via `BackendStorage`), packs paths + keys into a ≤1 KB JSON manifest. Long text spills into an encrypted blob; the manifest pointer stays inline.
   4. `cdr.uploader.allocate` — allocates a CDR vault with the HatchCondition addresses + the encoded `(mode, signalIpId, publisherRoot, embargoStart, revealAt)` slot.
   5. `cdr.uploader.encryptDataKey` — encrypts the manifest bytes against the vault label.
   6. `cdr.uploader.write` — writes the ciphertext into the CDR vault.
4. Composer `PATCH /hatches/:uuid/metadata` — race-safe upsert of the public title/summary so cards show the real headline immediately (indexer's UPSERT on `VaultAllocated` later fills the on-chain fields).

The publisher's wallet signs every transaction. No part of the manifest leaves the browser unencrypted.

### Decryption — reader opens a hatch

The reader's keypair stays on the wire. The server never holds the secret.

1. **Reader generates keypair** — for `via: "wallet"` this is the user's own wagmi wallet (already on chain). For `via: "anonymous"` post-reveal, the server's EphemeralPool generates a fresh keypair (server sees plaintext in this fallback path — UI labels the tradeoff). For `via: "anonymous-lent"` (subscriber-as-anonymous), an ephemeral keypair is generated and the pass is `lend`-ed to it for the read window, then `unlend`-ed.
2. **Ask to read + send public key** — SDK `cdr.consumer.accessCDR({uuid, accessAuxData})` posts the wallet's public key.
3. **HatchCondition checks license** — on-chain `checkReadCondition` reads the canonical slot ordering `(mode, ipId, publisherRoot, embargoStart, revealAt)`, verifies either the post-reveal "empty entitlement" passes (`now ≥ revealAt`) or the wallet owns the license token / pass per the encoded kind.
4. **Validators provide partial decryptions** — DKG holders sign partials addressed to the reader's public key.
5. **Reader decrypts each partial with private key, combines** — yields the manifest dataKey (≤1 KB JSON).
6. **Decrypt media at data URLs** — for each media entry the reader fetches ciphertext from `/storage/:cid`, decrypts with the manifest's per-file AES key, joins.

For the default read path (`via: "wallet"`, signed by wagmi), the server never sees the manifest or the decrypted media. The backend only serves opaque ciphertext from Supabase.

## Protocol surface

The architecture above is the core. The protocol surface below is everything Hatch exposes on top of it without changing the trust model.

### Foundation

- **IPA metadata with SHA-256 hashes.** Publisher and per-hatch metadata JSON is content-hashed before upload. `ipMetadataHash` and `nftMetadataHash` are computed from the canonicalised payload so the on-chain pointer is verifiable against the bytes the storage layer returned.
- **CDR retry wrapper.** `cdr.allocate`, `cdr.write`, and `cdr.accessCDR` are wrapped in a retry with backoff that distinguishes transient transport errors from contract reverts. Reverts surface as `HatchError` immediately; transport errors retry with jitter up to a bounded ceiling.
- **RPC fallback transport.** The viem transport for Story is a ranked `fallback([primary, ...secondaries])`. RPC degradations stop taking the indexer and the composer down together. Backend workers and the SDK share the same transport factory so failover is identical end to end.
- **PIL flavor switch.** `createHatch` and `createPublisher` accept a `pilFlavor` of `commercialRemix` (default), `commercialUse`, `nonCommercialSocialRemixing`, or `creativeCommonsAttribution`. The flavor lands in PIL terms at attach time; downstream royalty paths follow Story's flavor rules without any custom branching.
- **Mainnet config.** `sdk/src/config.ts` exports `MAINNET` alongside `AENEID`. Most Story core addresses are identical across both. See [docs/mainnet.md](./docs/mainnet.md) for the flip checklist.
- **WIP helpers.** `wrapNativeToWip`, `unwrapWipToNative`, `approveWip`, and `getWipBalance` are shared utilities used by commerce, royalty claim, dispute bonding, and tipping. Allowances are scoped per spender and re checked before each call.

### Auth and sponsored execution

- **Privy provider stack.** The frontend mounts `PrivyProvider` above wagmi when `VITE_PRIVY_APP_ID` is set. Privy stays optional, so SIWE plus wagmi keeps working unchanged when the env var is absent. Privy supplies email login, embedded wallets, and a smart wallet handle.
- **SmartWalletsProvider with paymaster.** `SmartWalletsProvider` is configured with a Pimlico `paymasterContext` so user operations can be sponsored. The paymaster policy id is per chain; mainnet and Aeneid each carry their own.
- **`TxExecutor` interface.** Every SDK call that previously took a `walletClient` now also accepts a `TxExecutor`, a minimal `{ sendTransaction({ to, data, value }) }` shape. The default executor is the wagmi wallet; the Privy smart wallet executor routes through the bundler and applies the paymaster. Commerce, royalty payment, dispute raise, and grouping all consume the executor unchanged. Sponsorship is transparent to the call site.

### Publisher dashboard

- **Earnings and Claim royalties.** The publisher dashboard reads the claimable balance from the LAP vault and exposes a Claim button that fires `claimAllRevenue` through the active wallet. The backend `GET /publishers/:root/claimable` route powers the live balance display.
- **Tip buttons.** Publisher list cards and hatch detail pages carry a Tip button. The control collects an amount in WIP (auto wrap if the user holds none), calls `payRoyaltyOnBehalf`, and writes through the royalty module so it flows into the LAP vault rather than a custodial pot.
- **Delegates panel.** Grant or revoke editor wallets through Story's `AccessController`. Permissions auto revoke on IP ownership transfer.
- **Wrap IP to WIP widget.** Replaces the older `cast send` step in publisher onboarding and tipping. One widget, one approval, one balance read.

### Compose

- **PIL flavor radio.** Four flavors visible in the composer. The selected flavor lands in the per hatch PIL terms.
- **IPA metadata fields.** Description, creators, and key attributes feed directly into `createHatch`. SHA-256 hashes are computed at submit time and recorded on chain.

### Disputes (UMA backed)

- **SDK: `raiseDispute`, `cancelDispute`.** Wrap Story's DisputeModule. The bond posts in WIP, the evidence pointer attaches as a CID, and the dispute id returns synchronously. Cancellation is gated by the protocol's timing rules; the SDK surfaces the revert reason verbatim.
- **Backend: `disputes` table.** Keyed by `storyDisputeId` with bond amount, evidence CID, judgement, and status. Listed on `/disputes` and aggregated on `/publishers/:root/dispute-status`.
- **Indexer events.** `DisputeRaised`, `DisputeJudgementSet`, `DisputeCancelled`, and `DisputeResolved` are subscribed alongside the existing IPA and license events.
- **DisputeModal.** Mounted on publisher profile and hatch detail. Collects evidence and bond, shows the live dispute list with judgement state, and offers Cancel when the connected wallet raised the dispute.

### Datasets (GroupingModule)

- **SDK: `createGroup`, `addToGroup`.** Group hatches must use LRP (`royaltyPolicyLrp`) because GroupingModule rejects LAP. The SDK forces LRP at attach time so a misconfigured composer cannot break the group.
- **Backend: `groups` and `group_members`.** Group metadata keyed by `groupIpId`, membership rows by `(groupIpId, memberIpId)`. Powers `/groups` and `/groups/:groupId`.
- **Indexer events.** `IPGroupRegistered`, `AddedIpToGroup`, and `RemovedIpFromGroup` drive both tables.
- **Dataset composer mode.** A toggle in `view_compose` switches from single hatch to dataset bundle. Each row is one hatch; submit runs `createGroup` then loops `createHatch` then `addToGroup`. Buyers purchase the group license once and read every member through the same entitlement path.

### Cross chain (mainnet only)

- **SDK: `buyHatchCrossChain`, `tipCrossChain`.** Both go through deBridge DLN. The SDK builds the order with a Story-side dlnHook, submits the source chain transaction, and returns the deBridge order id. The Story-side fill triggers the actual `mintLicenseTokens` or `payRoyaltyOnBehalf`.
- **Aeneid is not supported by deBridge.** The cross chain selector in the UI auto hides on testnet. On mainnet it lists the deBridge supported source chains (Base, Optimism, Arbitrum, Ethereum) and shows quote and slippage before the user signs the source chain tx.

### Mainnet readiness

> Most Story core addresses are identical across Aeneid and Mainnet; only `IpRoyaltyVaultImpl`, `IPAccountImpl`, and `SPGNFTImpl` differ. The four Hatch contracts — `HatchConditionV2_1`, `HatchSubscriptionPass`, `HatchOutcomeOracle`, `HatchPublisherRegistry` — need a fresh deploy on mainnet from the operator wallet. The `MAINNET` config constant already carries the Story-side addresses; the four Hatch slots flip from `0x0` to deployed once the operator runs the deploy script.

## `@usehatch/sdk` — the reusable client we built

**Published on npm:** <https://www.npmjs.com/package/@usehatch/sdk> · install with `pnpm add @usehatch/sdk`.

The SDK is not glue inside the app — it is the surface anyone building on Story CDR can install and use directly. The Hatch frontend, backend, indexer, reveal worker, and oracle worker all consume the same package. The boundaries are deliberate so the SDK stands on its own:

- **Open source under MIT.** [`sdk/package.json`](sdk/package.json) peer-deps the host app's `viem` / `@story-protocol/core-sdk` / `@piplabs/cdr-*`, ships only `dist/` + `README.md` + `LICENSE`. The `dist/` is the published artifact; nothing in `src/` ships.
- **Two entry points, intentionally.** The root barrel `@usehatch/sdk` is browser-safe — every export it surfaces works in a Vite/Webpack bundle. The `@usehatch/sdk/storage` subpath holds the Node-only providers (`LocalDiskProvider`, `SupabaseProvider`, `FailoverStorage`) so they cannot accidentally get pulled into a browser build through the barrel. Browser apps implement their own `HatchStorage` against whatever ciphertext sink they want; Node apps import the built-ins.
- **No runtime config drift.** [`config.ts`](sdk/src/config.ts) exports `AENEID` (chain 1315 addresses) and `HATCH` (deployed Hatch contract addresses) as `const`. Consumers never wire them in from env unless they're targeting a different deployment.
- **Wraps both upstreams in one mental model.** `@story-protocol/core-sdk` covers IPA registration / PIL terms / license mints / royalty policy; `@piplabs/cdr-sdk` covers vault allocation / write / read. Most consumers should never have to learn the seams between them — they call `createHatch`, the SDK does the IPA derivative + the CDR vault allocate + the encrypted-manifest write as one atomic-ish flow and returns the descriptor.

### What it exports

| Surface | Functions | What it gives you |
|---|---|---|
| Publisher lifecycle | `createPublisher`, `stake`, `unstake`, `getPublisher`, `wrapNativeToWip` | One call to mint SPG NFT collection + register publisher root IP with subscription PIL terms + onboard to `HatchPublisherRegistry`. Stake/unstake via WIP approve + registry calls. |
| Sealing | `createHatch`, `getHatch`, `encodeConditionData`, `encodeOwnerWriteData` | Register the hatch as a derivative of the publisher root, attach per-hatch PIL terms, build + encrypt the ≤1KB JSON manifest, allocate CDR vault with `HatchCondition` slot encoding, write ciphertext. Returns `{uuid, signalIpId, perHatchTermsId, txHashes}`. |
| Commerce | `buyHatch`, `subscribe` | Per-hatch License Token mint (one call) and Subscription License + paired `HatchSubscriptionPass` mint (two-party flow). |
| Reads | `readHatch` with `via: "wallet" \| "anonymous" \| "anonymous-lent"`, `encodeAccessAux` | Three read modes for three real use cases: caller-signed (browser-safe, plaintext stays client-side), post-reveal anonymous (via `EphemeralPool`), pre-reveal anonymous-lent (subscriber lends pass to a fresh ephemeral wallet, reads, unlends in `finally`). |
| Manifest crypto | `buildManifest`, `parseManifest`, `MediaInput` | Per-file AES-256-GCM encryption + ≤1KB JSON manifest with long-text spill-into-encrypted-blob handling. Pluggable storage via `HatchStorage`. |
| Ephemeral wallets | `EphemeralPool`, `EphemeralPoolOpts`, `PoolStateStore` | Treasury-funded hot-wallet pool with per-wallet nonce tracking, gap-aware lease, RBF on stuck tx, burst limiter, refill watchdog, dust recycler. |
| Oracle | `signAttestation`, `submitAttestation`, `challenge`, `finalize`, `resolveChallenge`, `getOutcome` | EIP-712 outcome attestation + 7-day challenge window orchestration against `HatchOutcomeOracle`. |
| Identity / utilities | `hatchIdFor`, `uuidFromHatchId`, `ensureWasm` | CDR vault ID encoding, WASM bootstrap. |
| Error model | `HatchError`, `translate` | Code-stable errors (`NOT_ENTITLED`, `MANIFEST_TOO_LARGE`, `WALLET_REQUIRED`, …) so callers can branch reliably. |
| Storage providers (`@usehatch/sdk/storage`) | `LocalDiskProvider`, `SupabaseProvider`, `FailoverStorage`, `HatchStorage` (type re-export from root) | Production storage to Supabase; dev/test storage to local disk; failover wrapper. Implement `HatchStorage` yourself for IPFS, S3, Arweave, etc. |
| Pinned config | `AENEID`, `HATCH`, `defaultConfig`, `HatchConfig` | Story Aeneid + Hatch contract addresses as `const` so consumers never paste them. |

### How a consumer uses it

```ts
import { createHatch, AENEID, HATCH, parseEther } from "@usehatch/sdk";
import { SupabaseProvider } from "@usehatch/sdk/storage";

const hatch = await createHatch({
  config: {
    chain: AENEID, hatch: HATCH,
    storage: new SupabaseProvider(url, serviceKey, "ciphertext-bucket"),
  },
  publicClient, walletClient, storyClient, account,
  publisherRootIpId, spgNftContract, subscriptionTermsId,
  content: { text: "Full thesis...", media: [{ name, mime, bytes }] },
  mode: 2,
  perHatchPriceWip: parseEther("0.01"),
  embargoStart: BigInt(Math.floor(Date.now() / 1000) + 60),
  revealAt:     BigInt(Math.floor(Date.now() / 1000) + 3600),
});
// → { uuid, signalIpId, perHatchTermsId, txHashes: { derivative, allocate, write } }
```

Full reference is in [`sdk/README.md`](sdk/README.md).

## Pipeline — submission to settlement

A hatch moves through eight stages from the moment a publisher hits **Seal** to the moment royalties land in their vault. Each stage is a concrete piece of code; the chain enforces the transitions.

| Stage | What happens | Where it lives |
|---|---|---|
| **1 · Submit** | Publisher composes title, summary, body text, and any media files. Nothing is uploaded yet — everything is in-browser. | [`frontend/src/design/view_compose.jsx`](frontend/src/design/view_compose.jsx) |
| **2 · Protect** | Each media file is encrypted with a per-file AES-256-GCM key in the browser. Ciphertexts are uploaded to Supabase via `BackendStorage`. The keys + paths land in a ≤1 KB JSON manifest, which is then re-encrypted by the CDR vault against its allocated label. | [`sdk/src/manifest.ts`](sdk/src/manifest.ts) · [`frontend/src/lib/storage.ts`](frontend/src/lib/storage.ts) · [`sdk/src/hatch.ts:100`](sdk/src/hatch.ts#L100) |
| **3 · Register** | The hatch is minted as a Story IP Asset and registered on-chain. The publisher's wallet signs the tx; the result is a permanent IPA with an `ipId`. | [`sdk/src/hatch.ts:50`](sdk/src/hatch.ts#L50) — `storyClient.ipAsset.mintAndRegisterIpAndMakeDerivative` |
| **4 · Compose** | The new IPA is registered as a **derivative** of the publisher's root IP, inheriting the subscription PIL. Per-hatch PIL terms attach to the signal. The publisher's root becomes a living dataset that grows with every hatch underneath it. | [`sdk/src/hatch.ts:50-73`](sdk/src/hatch.ts#L50-L73) |
| **5 · Purchase** | A buyer mints a License Token at the per-hatch fee, or a subscriber mints a sub License + paired `HatchSubscriptionPass`. Payment is in WIP and routes through Story's licensing module. | [`sdk/src/commerce.ts`](sdk/src/commerce.ts) — `buyHatch`, `subscribe` · [`backend/src/api.ts` `POST /subscribe`](backend/src/api.ts) for the two-party Pass mint |
| **6 · Gate** | The vault's read condition is [`HatchConditionV2_1`](contracts/src/HatchConditionV2_1.sol). Every read triggers an on-chain check of the encoded slot `(mode, signalIpId, publisherRootIp, embargoStart, revealAt)` against the requester's wallet, License Token, Pass, and `block.timestamp`. We never gate in the server. | [`sdk/src/hatch.ts:14-20`](sdk/src/hatch.ts#L14) (encoding), [`contracts/src/HatchConditionV2_1.sol`](contracts/src/HatchConditionV2_1.sol) (enforcement) |
| **7 · Decrypt** | The reader's wagmi wallet calls `accessCDR`. Validators deliver partial decryptions addressed to that wallet's public key. The SDK combines them in the browser, parses the manifest, fetches each encrypted media blob, and decrypts with the per-file AES keys — all client-side. The server never holds plaintext. | [`frontend/src/lib/read.ts`](frontend/src/lib/read.ts) · [`sdk/src/read.ts:53-62`](sdk/src/read.ts#L53-L62) |
| **8 · Settle** | Both the subscription PIL (on the root) and the per-hatch PIL (on the signal) are `PILFlavor.commercialRemix` with `royaltyPolicy: royaltyPolicyLap`. Each mint pays into the LAP, which propagates royalties up the IP graph automatically. | [`sdk/src/hatch.ts:64-68`](sdk/src/hatch.ts#L64-L68) · [`sdk/src/publisher.ts:56-61`](sdk/src/publisher.ts#L56-L61) · [`sdk/src/config.ts:12`](sdk/src/config.ts#L12) |

### What the publisher gets, what the reader gets

| Guarantee | Where it comes from |
|---|---|
| **Income that keeps paying** | Subscriptions renew per period; per-hatch reads keep minting new licenses post-reveal. Every event hits the LAP vault, not a single moment of sale. |
| **The publisher owns the IP** | `publisherRootIpId` is an IPA the publisher minted with their own wallet. PIL terms are theirs to set, transfer, or revoke. The platform holds no keys. |
| **Every step verifiable** | Every action emits an event — `IPRegistered`, `LicenseTokensMinted`, `VaultAllocated`, `VaultWritten`, `VaultRead`, `OutcomeFinalized`. Storyscan link on every card. Outcomes have a 7-day public dispute window. |
| **Composable, conditional, dynamic** | The same vault byte sequence is gated four ways by `HatchConditionV2_1`: post-reveal open (`empty entitlement`), pre-reveal per-hatch license (`kind=0`), pre-reveal subscription pass (`kind=1`), and pre-reveal anonymous-lent (`kind=1` via lent ephemeral). One contract, four read paths. |

### Where we held the line

- **The browser owns the secret.** The default read path signs with the user's wagmi wallet and decrypts client-side. The server never sees plaintext. The pool-mediated path exists only as a fallback for readers without a wallet and is labeled as such in the UI. → [`frontend/src/lib/read.ts`](frontend/src/lib/read.ts)
- **Conditions are validated at read time.** We pass `skipConditionValidation: true` at allocate time only — the meaningful check happens when the vault is opened, against the live `block.timestamp` and the actual requester. → [`sdk/src/hatch.ts:97`](sdk/src/hatch.ts#L97)
- **Sessions survive restart.** SIWE state lives in Postgres (`siwe_sessions`), not a process-local Map. A backend restart or horizontal scale-out doesn't log anyone out. → [`backend/src/db/schema.ts`](backend/src/db/schema.ts)
- **Storage is opaque.** The Supabase bucket holds only ciphertext. The per-file AES keys live exclusively inside the encrypted manifest, which lives inside the CDR vault, which is gated by the on-chain condition. Full DB + bucket access does not decrypt anything. → [`sdk/src/manifest.ts`](sdk/src/manifest.ts)

### Surfaces now shipped (previously "still being built")

- **Royalty claim CTA — implemented.** The Earnings + Claim royalties button on the Command Center reads claimable balances from the LAP vault per publisher root and fires `claimAllRevenue` through the active wallet.
- **Dataset-level bundle purchase — implemented.** `createGroup` and `addToGroup` (LRP forced), `groups` plus `group_members` tables, GroupingModule indexer events, and the dataset composer mode in `view_compose` close the loop end to end. Buyers purchase the group license once and read every member through the same entitlement path.
- **Anonymous-lent read UI — implemented.** The lend / read / unlend modal is in the console; the same SDK path proven by the round-trip test ([`sdk/src/read.ts:87-128`](sdk/src/read.ts#L87)) now drives the UX for subscribers reading via a fresh ephemeral wallet.

## End-to-end user journeys

### Sign in
`SIWE nonce` → wagmi signs the EIP-4361 message (ASCII statement; em-dash would break the parser) → `/siwe/verify` writes `siwe_sessions` row + sets httpOnly `hatch_session` cookie (`SameSite=Lax` dev, `None+Secure` prod) → frontend `SiweProvider` keeps the bearer in React state. Refresh restores via `GET /siwe/me` (cookie or bearer).

### Follow a publisher
Authed `POST /follow` → `follows(followerWallet, publisherRootIp)` row → invalidates `qk.follows(wallet)` → Rail "Following" + Timeline universe update.

### Subscribe (two-party mint)
1. Subscriber's wagmi mints the subscription license token from the publisher root.
2. Frontend `POST /subscribe` with `{publisherRootIp, subLicenseTokenId}` + bearer.
3. Backend uses `PASS_MINTER_PK` env to call `SubscriptionPass.mint(subscriber, publisherRoot, subLicenseTokenId, duration, subPriceWei)` and waits for the receipt. Returns `{passId, mintPassTx}`.
4. Indexer picks up the on-chain `Minted` event → `subscriptions` row.

### Buy a per-hatch license
SDK `buyHatch` runs in-browser. The user's wagmi signs `licensingModule.mintLicenseTokens` with the hatch's `perHatchTermsId` and the price as `maxMintingFee`. Returns `{licenseTokenId, txHash}`.

### Read a hatch
- Post-reveal: browser-side default (private). Server-pool fallback (less private) when the reader has no wagmi wallet.
- Pre-reveal entitled: `via: "wallet"` browser-side with the license/pass owner's wallet.
- Pre-reveal anonymous: `via: "anonymous-lent"` — subscriber lends the pass to a fresh ephemeral wallet, ephemeral reads, pass unlent in `finally`. (SDK supports it; client-side wallet UI for the lend/unlend pair is a follow-up.)

### Seal a hatch
See "Encryption" above.

### Resolve an outcome
Oracle worker observes the asserted condition (CoinGecko / The Odds API), signs EIP-712 attestation, posts to `HatchOutcomeOracle`. Indexer's `OutcomeFinalized` handler updates `outcomes` and rolls up `track_records`. Aggregator publishes `track_records` snapshots that `/publishers/:root/metrics` reads.

## What lives where (data plane)

| Data | Authoritative source | Why |
|---|---|---|
| Encrypted manifest (≤1KB JSON) | **CDR vault** on Aeneid | The chain enforces who can read. Storage is on-chain; access is conditional. |
| Per-file ciphertext blobs | **Supabase bucket** (private) | The manifest's per-file AES keys are the only way to decrypt; the bucket only holds opaque ciphertext. |
| Hatch metadata (title, mode, dates, status, publisher) | **Postgres** (indexed from on-chain events) | Cheap, fast queries for the UI. Indexer reconciles; on-chain is canonical. |
| Sessions | **Postgres** (`siwe_sessions`) | Durable across restart + horizontal scale. |
| Track record (accuracy, resolved count, subscribers) | **Postgres** (`track_records`, aggregated by worker) | Rollup tables built from on-chain `OutcomeFinalized` + `Minted` events. |
| User identity | **Wallet** (signed via SIWE) | No usernames, no passwords. The wallet is the user. |

## On-chain contracts (Aeneid)

| Contract | Address | Role |
|---|---|---|
| `HatchCondition v2.1` | `0x9362…b474` | Read/write conditions; split-slot encoding `(mode, ipId, publisherRoot, embargoStart, revealAt)` |
| `HatchSubscriptionPass` | `0x9fc7…09e1` | Time-bound ERC-721 sub passes; `lend`/`unlend` for anonymous reads |
| `HatchOutcomeOracle` | `0x5257…7a24` | EIP-712 attestations + 7-day dispute window |
| `HatchPublisherRegistry` | `0x3351…ddfa` | `registerPublisher`, `stake`, `unstake`, slashing |
| Story CDR | `0xcccc…0005` | Confidential Data Rails precompile |
| Story DKG | `0xcccc…0004` | Distributed key generation network |
| Story `LicensingModule` | `0x04fb…de6f` | PIL license token mints |
| Story `RoyaltyPolicyLAP` | `0xBe54…390E` | Royalty propagation along IP graph |

## Trust model

- **The chain enforces access.** The HatchCondition contract — not our server — decides who can read. Our backend can lie about a publisher's display name; it cannot let an unentitled wallet decrypt a sealed hatch.
- **The browser owns the keypair.** For `via: "wallet"` reads the manifest is decrypted in the user's process. The server sees only ciphertext from Supabase and the on-chain CDR receipt.
- **The composer signs every state change.** Publisher onboarding (`createPublisher` + `stake`), sealing (`createHatch`), buying (`buyHatch`), and license-mint half of subscribe are all client-signed. The only server-signed transaction is `SubscriptionPass.mint` (because Pass.minter is owner-only by design); the subscriber's license mint happens first, client-side, so the subscriber's wallet is the authority that proves intent.
- **Outcomes are challengeable.** Operator attests, but anyone can bond-stake to dispute within 7 days. Slashing burns operator stake from the registry.
- **Track records are immutable.** `outcomes` is a chain-driven append. Publishers can mislabel a hatch's public title; they cannot rewrite which hatches resolved hit vs miss.

## Production topology

```
              Vercel (frontend)        Railway (backend + indexer + workers)
                  │                                │
                  └─────── HTTPS · WSS ────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
      Supabase Storage     Railway Postgres    Story Aeneid RPC
      (private bucket)     (managed PG)        (aeneid.storyrpc.io)
```

Required env (see [`backend/.env`](backend/.env) + [`frontend/.env.local`](frontend/.env.local)):
- Backend: `DATABASE_URL`, `RPC_URL`, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_BUCKET`, `OPERATOR_PRIVATE_KEY` (oracle), `PASS_MINTER_PK` (subscribe), `COOKIE_SAMESITE=None` + `COOKIE_SECURE=1` for cross-origin HTTPS, `CORS_ORIGINS` whitelist.
- Frontend: `VITE_BACKEND_URL`, `VITE_WALLETCONNECT_PROJECT_ID` (Reown), `VITE_VAPID_PUBLIC_KEY` (Web Push).

## Failure modes + recovery

| Failure | What happens | Recovery |
|---|---|---|
| Backend restart | Sessions persist (`siwe_sessions`), in-flight transactions complete on chain regardless. | Auto. |
| Indexer lag | Newly sealed hatches missing on-chain fields for ~5s. | Composer's `PATCH /hatches/:uuid/metadata` upserts the row with composer-provided fields immediately; indexer merges later. |
| Reveal worker delayed | Post-reveal UI hits `/hatches/:uuid/reveal` and gets `reveal_pending`. | "Read (private — browser-side)" button bypasses the mirror by calling the SDK directly; once the worker catches up, the cached row is served. |
| Storage upload fails | Composer raises; nothing was sealed on chain (manifest needed first). | Retry from the same form — idempotent until allocate succeeds. |
| RPC blip during read | SDK `readHatch` throws; UI surfaces the error inline. | Retry. The on-chain CDR receipt is the source of truth; no half-states. |
| Cookie blocked cross-origin (HTTPS prod) | Bearer fallback used; `SiweProvider` still has the token in React state. | Set `COOKIE_SAMESITE=None` + `COOKIE_SECURE=1` + correct `CORS_ORIGINS`. |

## Health + observability

- `GET /healthz` probes Postgres, RPC, and Storage with per-probe latency; returns 503 if any are degraded.
- `GET /livez` is process-up only — for k8s-style liveness vs readiness split.
- WS server emits `hatch:status`, `hatch:new`, `hatch:revealed`, `notification:new` for real-time UI.

## Repo layout

```
contracts/    Solidity (HatchCondition, HatchSubscriptionPass, HatchOutcomeOracle, HatchPublisherRegistry)
sdk/          @usehatch/sdk — typed wrappers around Story SDK + CDR SDK + manifest crypto
backend/      Hono API · indexer · reveal worker · oracle worker · notify worker · aggregator
frontend/     React + Vite app (landing + console)
scripts/      one-off operational scripts
```

## Two design principles the architecture refuses to violate

1. **The chain is the rulebook.** Anything that gates access must be enforced on-chain. Server logic can be lazy, lossy, or wrong; the contract still holds.
2. **The browser owns the secret.** Plaintext, private keys, and decrypted manifests live in the user's process. The server holds ciphertext, indexes, and bookkeeping. If our backend disappeared tomorrow, every sealed hatch would remain readable to its rightful entitled holder.
