# SDK Reference

`@usehatch/sdk@0.2.0`. Typed client for the Hatch protocol on Story Aeneid and Story Mainnet. Every export documented below is real, lives in [sdk/src](../sdk/src/), and ships in the published npm package.

## Install

```bash
pnpm add @usehatch/sdk
```

Peer dependencies:

```
@piplabs/cdr-contracts 0.2.1
@piplabs/cdr-crypto    0.2.1
@piplabs/cdr-sdk       0.2.1
@story-protocol/core-sdk 1.4.4
viem ^2.21
```

`@usehatch/sdk/storage` is a Node only subpath. Importing `SupabaseProvider`, `LocalDiskProvider`, or `FailoverStorage` in browser code will fail at bundle time.

## Chain config

Two pinned constants. Identical address surfaces in both, except `royaltyPolicyLap`, `royaltyPolicyLrp`, `groupingModule`, `evenSplitGroupPool`, `licensingModule`, `royaltyModule`, `wip`, `pilTemplate` are the same on both chains. Only `chainId`, `rpcUrl`, and the CDR `storyApiUrl` differ.

```ts
import { AENEID, MAINNET, HATCH } from "@usehatch/sdk";

AENEID.chainId        // 1315
MAINNET.chainId       // 1514
AENEID.wip            // 0x1514000000000000000000000000000000000000
AENEID.royaltyPolicyLap
AENEID.royaltyPolicyLrp
AENEID.groupingModule
AENEID.evenSplitGroupPool
AENEID.licensingModule
AENEID.royaltyModule
HATCH.subscriptionPass
HATCH.hatchCondition
HATCH.oracle
HATCH.publisherRegistry
```

Build a config with `defaultConfig({ storage })` or assemble one manually:

```ts
const config = {
  chain: AENEID,
  hatch: HATCH,
  storage: new BackendStorage(),
};
```

## Publisher lifecycle

Source: [sdk/src/publisher.ts](../sdk/src/publisher.ts).

`createPublisher({ config, publicClient, walletClient, storyClient, account, collection, subscription, pilFlavor?, metadata?, publicMetadataUrlBase?, spgNftContract? })`

Registers an SPG NFT collection, mints + registers an IP asset as the publisher root with subscription PIL terms attached, then registers the publisher in `HatchPublisherRegistry`. Returns `{ publisher, publisherRootIpId, spgNftContract, subscriptionTermsId, registryTxHash }`. The `pilFlavor` parameter switches the license terms attached at the root. The `metadata` parameter, when provided, uploads a Story IPA + NFT JSON pair to `config.storage` and references the resolved URIs in the registration call.

`stake({ config, publicClient, walletClient, account, amount })` approves WIP and stakes into the registry. `unstake` is the inverse. `getPublisher({ config, publicClient, publisher })` returns `{ rootIp, stake, verified, lastSlashAt }`.

WIP helpers (all view or transactional):

```ts
wrapNativeToWip({ config, publicClient, walletClient, account, amount })   // IP -> WIP
unwrapWipToNative({ config, publicClient, walletClient, account, amount }) // WIP -> IP
approveWip({ config, publicClient, walletClient, account, spender, amount })
getWipBalance({ config, publicClient, owner })
getWipAllowance({ config, publicClient, owner, spender })
```

## Sealing a hatch

Source: [sdk/src/hatch.ts](../sdk/src/hatch.ts).

`createHatch({ ... })` accepts:

```
config, publicClient, walletClient, storyClient, account
publisherRootIpId
spgNftContract
subscriptionTermsId
content: { text, media: MediaInput[] }
mode: 0 | 1 | 2                  // per-hatch | subscription | dual
perHatchPriceWip
perHatchRevSharePct              // default 10
embargoStart, revealAt           // unix seconds, bigint
outcomeSpec
pilFlavor                        // default commercialRemix
royaltyPolicy                    // default LAP; pass LRP for group members
metadata, publicMetadataUrlBase  // IPA metadata
```

Returns `{ uuid, signalIpId, perHatchTermsId, publisherRootIpId, mode, embargoStart, revealAt, outcomeSpec, txHashes: { derivative, allocate, write } }`.

`getHatch({ config, publicClient, uuid })` reads raw vault metadata. Useful for indexers and UI cards.

`encodeConditionData` and `encodeOwnerWriteData` are exposed for callers that need to build HatchCondition v2.1 slot encoding by hand. They are the same primitives `createHatch` calls internally.

## Commerce

Source: [sdk/src/commerce.ts](../sdk/src/commerce.ts).

`buyHatch({ storyClient, signalIpId, perHatchTermsId, receiver, maxMintingFee? })` mints one per hatch license. Fee routes to the signal's royalty vault. Returns `{ licenseTokenId, txHash }`.

`subscribe({ ... })` is the two party flow. The subscriber's wallet signs the sub license mint, then the publisher's minter wallet signs the paired `HatchSubscriptionPass.mint`. Returns `{ subLicenseTokenId, passId, mintLicenseTx, mintPassTx }`.

Cross chain (source: [sdk/src/crossChain.ts](../sdk/src/crossChain.ts)). Mainnet only. The frontend selector auto hides on Aeneid.

`buyHatchCrossChain({ src, walletClient, srcAmount, signalIpId, licenseTermsId, receiver, licensingModule, licenseTemplate, wipAddress, dstAmountWip })` builds a deBridge `dlnHook` calling `LicensingModule.mintLicenseTokens` on Story Mainnet, POSTs to `https://api.dln.trade/v1.0/dln/order/create-tx`, and submits the returned source chain tx via `walletClient`. Returns `{ srcTxHash, dlnOrderId }`.

`tipCrossChain({ ... })` is the same pattern targeting `RoyaltyModule.payRoyaltyOnBehalf`.

`CROSS_CHAIN_SOURCES` is a curated array of supported source chains with their USDC addresses. `DEBRIDGE_STORY_MAINNET_ID = 100000013` is deBridge's internal id for Story Mainnet.

## Reading

Source: [sdk/src/read.ts](../sdk/src/read.ts).

`readHatch({ config, publicClient, uuid, entitlement, via, ...args })` supports three modes:

| via | What happens |
|---|---|
| `wallet` | The reader's wagmi wallet calls `accessCDR`. Validators check HatchCondition against the wallet, License Token, Pass, and block timestamp. Partial decryptions arrive addressed to the reader's public key. Server sees no plaintext. |
| `anonymous` | Post reveal only. Reader leases a slot from an `EphemeralPool` and reads with kind 0 anonymous. |
| `anonymous-lent` | Pre reveal kind 1. Subscriber lends their pass to an ephemeral wallet via `lend(tokenId, borrower)`, the ephemeral reads, then the subscriber `unlend`s. |

Returns `{ text, media, txHash, reader, latencyMs }`. Every CDR call site is wrapped in `withCdrRetry` for two attempts with jittered backoff.

## Royalty

Source: [sdk/src/royalty.ts](../sdk/src/royalty.ts).

`claimAllRevenue({ config, storyClient, ancestorIpId, claimer, childIpIds, royaltyPolicies?, currencyTokens?, autoTransfer?, autoUnwrap? })` aggregates revenue from every derivative child up to `ancestorIpId`. Defaults to LAP + WIP. Returns `{ txHashes, receipt, claimed: [{ token, claimer, amount }] }`. Does not accept `txExecutor` because Story SDK 1.4.4 models claim as a multi tx workflow without an encoded path.

`payRoyaltyOnBehalf({ config, storyClient, receiverIpId, payerIpId?, amountWip, token?, txExecutor? })` tips an IP. The Story SDK auto wraps IP to WIP via `WipOptions.enableAutoWrapIp: true` and auto approves the RoyaltyModule. `txExecutor` enables sponsored submission through Privy smart wallets.

`getClaimableRevenue({ config, storyClient, ipId, claimer, token? })` is a view call used by the backend `/publishers/:root/claimable` endpoint.

## Disputes

Source: [sdk/src/dispute.ts](../sdk/src/dispute.ts).

`raiseDispute({ config, storyClient, targetIpId, tag, evidenceCid, liveness?, bondWei?, txExecutor? })` calls Story's `DisputeModule.raiseDispute`. Bond defaults to OOV3 minimum. Liveness defaults to 30 days. Returns `{ disputeId, txHash }`.

`cancelDispute({ storyClient, disputeId })` is the inverse.

`DISPUTE_TAGS` is the whitelisted tag union: `IMPROPER_REGISTRATION`, `IMPROPER_USAGE`, `IMPROPER_PAYMENT`, `CONTENT_STANDARDS_VIOLATION`. `IN_DISPUTE` is excluded because the protocol sets it automatically during an active dispute.

## Grouping

Source: [sdk/src/grouping.ts](../sdk/src/grouping.ts).

`createGroup({ config, storyClient, groupPool?, license })` registers PIL terms with LRP royalty then calls `registerGroupAndAttachLicense`. Defaults the group pool to `EvenSplitGroupPool`. Returns `{ groupId, licenseTermsId, txHashes }`.

`addToGroup({ config, storyClient, groupId, ipIds, maxAllowedRewardSharePct? })` adds members. Caller must own the group. `removeFromGroup` is the inverse.

`GROUP_MEMBER_CAP = 1000` is the hard limit enforced by the protocol. The frontend composer caps the "Add item" button at this value.

## Access control

Source: [sdk/src/access.ts](../sdk/src/access.ts).

`setDelegate({ storyClient, ipId, signer, scope })` grants or revokes editor permission via `AccessController.setAllPermissions`. Scope is `all`, `none`, or `abstain` mapped to `AccessPermission.ALLOW`, `DENY`, `ABSTAIN`. Permissions auto revoke on IP ownership transfer.

`setDelegateScoped({ storyClient, ipId, signer, to, func, permission })` is the lower level variant. Pass `func: "0x00000000"` to allow every function on `to`.

`AccessPermission` enum is re exported from `@story-protocol/core-sdk` for callers building custom scoped permissions.

## IPA metadata

Source: [sdk/src/ipa-metadata.ts](../sdk/src/ipa-metadata.ts).

`uploadIpaMetadata({ storage, metadata, publicUrlBase? })` builds Story compliant IPA + NFT JSON, computes SHA 256 hashes, uploads to a `HatchStorage` provider, and returns `{ ipMetadataURI, ipMetadataHash, nftMetadataURI, nftMetadataHash }`. Used internally by `createPublisher` and `createHatch` when their `metadata` parameter is supplied.

The IPA JSON includes `title`, `description`, `createdAt`, optional `image`, `imageHash`, `mediaUrl`, `mediaHash`, `mediaType`, and a `creators` array of `{ name, address, contributionPercent, socialMedia? }`. The NFT JSON is OpenSea style.

## PIL flavors

Source: [sdk/src/pil.ts](../sdk/src/pil.ts).

`pickPilTerms(flavor, input)` returns a `LicenseTerms` struct for one of four flavors:

| Flavor | Description |
|---|---|
| `commercialRemix` | Paid mint with revenue share. Derivatives allowed. Default for monetized hatches. |
| `commercialUse` | Paid mint, no derivatives allowed. |
| `nonCommercialSocialRemixing` | Free, attribution only. Pre registered globally as license terms id 1. |
| `creativeCommonsAttribution` | Open and derivative friendly. Commercial use allowed with attribution. |

`NON_COMMERCIAL_SOCIAL_REMIXING_TERMS_ID = 1n` is exported so `createHatch` can short circuit the per hatch attach step when the flavor matches.

## CDR runtime

Source: [sdk/src/cdr-runtime.ts](../sdk/src/cdr-runtime.ts).

`withCdrRetry(fn, opts?)` wraps a CDR validator call with two attempts, jittered backoff, and a permanent error skip filter. Used internally by every `accessCDR`, `allocate`, `write`, `encryptDataKey`, and `getVault` call in this SDK.

`CDR_DEFAULT_TIMEOUT_MS = 120_000` is exported for forward compat. `@piplabs/cdr-sdk@0.2.1` does not yet accept a `timeoutMs` constructor option; this constant lights up automatically when it does.

## Ephemeral pool

Source: [sdk/src/ephemeral-pool.ts](../sdk/src/ephemeral-pool.ts).

`EphemeralPool` is a treasury funded hot wallet pool for anonymous reads. New in 0.2.0: an `rpcUrlFallbacks: string[]` option that wires a viem `fallback` transport with rank ordering and retry.

```ts
new EphemeralPool({
  treasuryPk,
  chain: AENEID,
  rpcUrl: "https://aeneid.storyrpc.io",
  rpcUrlFallbacks: ["https://other.rpc/example"],
  size: 4,
});
```

## TxExecutor

Source: [sdk/src/royalty.ts](../sdk/src/royalty.ts).

The minimal interface for sponsored or account abstracted submission:

```ts
interface TxExecutor {
  sendTransaction(args: { to: Address; data: Hex; value?: bigint }): Promise<Hash>;
}
```

Implemented natively by Privy's `useSmartWallets()` client. Any function below accepts an optional `txExecutor` that, when present, requests the encoded tx data from the Story SDK and submits through the executor instead of the bound wallet:

| Function | Sponsored mode |
|---|---|
| `payRoyaltyOnBehalf` | yes |
| `raiseDispute` | yes |
| `claimAllRevenue` | no, multi tx workflow |

## Storage

Source: [sdk/src/storage.ts](../sdk/src/storage.ts) (Node only, import via `@usehatch/sdk/storage`).

`HatchStorage` is the canonical interface. Three providers ship:

- `SupabaseProvider(url, serviceRoleKey, bucket)` for production.
- `LocalDiskProvider(rootDir)` for local development and tests.
- `FailoverStorage(primary, secondary)` chains read failover across two providers.

The browser facing `BackendStorage` lives in [frontend/src/lib/storage.ts](../frontend/src/lib/storage.ts) and posts to the backend `/storage` endpoint.

## Oracle

Source: [sdk/src/oracle.ts](../sdk/src/oracle.ts).

EIP 712 attestation helpers for the `HatchOutcomeOracle`. Operators use `signAttestation` and `submitAttestation`. Challengers use `challenge`, `finalize`, `resolveChallenge`. Anyone can call `getOutcome` to read settled outcomes.

```ts
import {
  signAttestation, submitAttestation,
  challenge, finalize, resolveChallenge,
  getOutcome,
  oracleDomain, ATTESTATION_TYPES,
  type Outcome,
} from "@usehatch/sdk";
```

## See also

- [Backend API reference](./api-reference.md) for every HTTP route the SDK can talk to.
- [Architecture](./architecture.md) for the end to end pipeline.
- [Mainnet readiness](./mainnet.md) for the flip checklist.
- [Troubleshooting](./troubleshooting.md) for the common errors.
