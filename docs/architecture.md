# Architecture

The high level system map. For deeper sequence diagrams of the stage flow (publisher registry, vault allocate, vault write, settle), see [ARCHITECTURE.md](../ARCHITECTURE.md) at the repo root.

## System map

```
┌────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                   │
│                                                                        │
│  Landing  ─────►  Console (Compose, Queue, Timeline, Publisher, Hatch) │
│     ▲                  ▲                                               │
│     │                  │                                               │
│     │           ┌──────┴──────┐                                        │
│     │           │  RainbowKit │   ┌──────────────┐                     │
│     │           │  Privy      │──►│  Pimlico AA  │ (optional, mainnet) │
│     │           └──────┬──────┘   └──────────────┘                     │
│     │                  │                                               │
│     │           ┌──────▼──────┐                                        │
│     │           │ @usehatch/  │                                        │
│     │           │ sdk         │                                        │
│     │           └──────┬──────┘                                        │
└─────┼──────────────────┼───────────────────────────────────────────────┘
      │                  │
      │ HTTP             │ HTTPS + WSS
      │ + WSS            │
┌─────▼──────────────────▼───────────────────────────────────────────────┐
│                          BACKEND (single process)                      │
│                                                                        │
│   Hono API   ◄─►  Indexer  ◄─►  Reveal worker (BullMQ)                 │
│       │                ▲              │                                │
│       │                │              │                                │
│       │           Oracle worker   Notify worker (Resend + Web Push)    │
│       │                              │                                 │
│       │           Aggregator          Bluesky bot                      │
│       │                                                                │
│   Postgres (drizzle)            Redis (BullMQ)                         │
└────────────────────────────────────────────────────────────────────────┘
                       │                            │
                       │ JSON RPC                   │ deBridge (mainnet only)
                       ▼                            ▼
            ┌────────────────────┐         ┌────────────────────┐
            │ Story Aeneid       │         │ Source chains      │
            │ (chain id 1315)    │         │ (Ethereum, Base,   │
            │                    │         │ Optimism, etc.)    │
            │ HatchCondition v2.1│         └────────────────────┘
            │ SubscriptionPass   │
            │ HatchOracle        │
            │ PublisherRegistry  │
            │ CDR + DKG          │
            │ DisputeModule      │
            │ GroupingModule     │
            │ RoyaltyModule      │
            │ LicensingModule    │
            │ AccessController   │
            └────────────────────┘
```

## Frontend

The frontend is a Vite SPA. Two top level routes are defined in `frontend/src/main.tsx`: `/` mounts the landing app and `/console` mounts the console. Every other path falls through to the landing app.

The console is a single React component (`ConsoleApp`) that runs a tiny in-process router driven by `window.location.hash`. The route keys are `timeline`, `queue`, `publishers`, `publisher`, `record`, `hatch`, and `compose`. Route transitions are framer-motion clip-path slits, kept short (500ms) because users navigate the console frequently.

State that lives across the app:

- `AppProviders` configures Wagmi + RainbowKit + Privy.
- `SiweProvider` owns the session token and exposes login, logout, and `me`.
- `WebSocketProvider` opens a single WS to `/ws` and fans out events to subscribers.
- `LenisProvider` wraps the landing in a smooth scroll context. The console opts out.

## Backend

The backend is one Node process. `backend/src/runner.ts` is the entry point. It starts:

| Subsystem | File | Responsibility |
|---|---|---|
| Indexer | `backend/src/indexer.ts` | Polls Aeneid every 5s, emits typed events on `indexerBus`, upserts Postgres rows |
| API | `backend/src/api.ts` | Hono routes + WebSocket upgrade for `/ws` |
| Reveal worker | `backend/src/reveal.ts` | BullMQ consumer that decrypts hatches at reveal time and writes `revealed_content` |
| Notify worker | `backend/src/notify.ts` | Resend email and Web Push fan out from indexer events |
| Oracle worker | `backend/src/oracle-worker.ts` | Signs attestations + finalizes outcomes after the challenge window (only if `OPERATOR_PRIVATE_KEY` is set) |
| Aggregator | `backend/src/aggregator.ts` | Maintains the `track_records` projection from `outcomes` |
| Bluesky bot | `backend/src/bluesky-bot.ts` | Posts reveal announcements (only if `BSKY_HANDLE` is set) |

All workers share one Postgres connection pool and one Redis client. Splitting them into separate Railway services is possible later but not necessary for launch traffic.

## SDK

`@usehatch/sdk` is published to npm and consumed by both the backend and frontend via the workspace `link:` during development. For production, both packages pin a real semver. Module map:

| File | Domain |
|---|---|
| `publisher.ts` | Publisher registration, stake, WIP wrap and approve helpers |
| `hatch.ts` | Mint a hatch (derivative IP, register PIL, vault allocate, vault write) |
| `commerce.ts` | Buy a per hatch license, subscribe to a publisher |
| `read.ts` | Decrypt and download a hatch via CDR, including the anonymous lent pass flow |
| `manifest.ts` | Build and parse the encrypted manifest |
| `oracle.ts` | Sign attestations, submit, challenge, finalize, read outcomes |
| `royalty.ts` | Claim revenue, pay on behalf, read claimable balance |
| `dispute.ts` | Raise and cancel disputes via DisputeModule |
| `grouping.ts` | Create groups, add and remove members, cap helpers |
| `crossChain.ts` | Mainnet cross chain buy and tip via deBridge |
| `access.ts` | Set delegate permissions via AccessController |
| `pil.ts` | Four PIL flavors with helpful defaults |
| `ipa-metadata.ts` | Build, hash, upload IPA metadata JSON |
| `cdr-runtime.ts` | Retry wrapper for CDR validator timeouts |
| `ephemeral-pool.ts` | Treasury managed wallet pool for anonymous reads |
| `oracle.ts` | EIP 712 attestation helpers |
| `storage.ts` | `HatchStorage` interface; `LocalDiskProvider` and `SupabaseProvider` ship from `@usehatch/sdk/storage` |
| `errors.ts` | Typed error codes for upstream UI routing |
| `config.ts` | `AENEID`, `MAINNET`, `HATCH` address books |

A full export by export reference lives in [sdk-reference.md](./sdk-reference.md).

## Data flow: posting a hatch

```
Compose view
    │
    │ 1. Encrypt media client side, derive manifest key
    ▼
SDK createHatch
    │
    │ 2. POST /storage for each media blob (returns cid)
    ▼
Backend API
    │
    │ 3. SDK builds manifest, uploads via HatchStorage, writes vault
    ▼
HatchCondition v2.1 on Aeneid
    │
    │ 4. emit VaultAllocated + VaultWritten
    ▼
Indexer
    │
    │ 5. UPSERT hatches row, emit hatch:new on indexerBus
    ▼
WebSocket /ws
    │
    │ 6. Push to every connected client filtered by channel + follow
    ▼
Console timeline
```

The composer's `PATCH /hatches/:uuid/metadata` races ahead so cards show the real title without waiting for the indexer. The indexer's UPSERT later merges the rest of the on-chain fields.

## Data flow: reading a hatch

After the reveal time:

1. Frontend posts to `POST /hatches/:uuid/read` with the user's entitlement (per hatch license token id, or subscription pass id).
2. The API checks entitlement on chain. Per hatch reads verify `ownerOf` + `isLicenseTokenRevoked` + `licensorIpId`. Subscription reads verify `ownerOf` + `isValidFor` + the pass `mintedAt` was before the hatch `embargoStart` (anti grandfather).
3. The API calls SDK `readHatch` through a server side `EphemeralPool`. The pool rotates a small set of treasury funded EOAs so the read tx is not linkable to the subscriber wallet.
4. CDR decrypts the manifest, the API streams the plaintext + media back to the client.

## Indexer event coverage

| Source contract | Event | Effect |
|---|---|---|
| HatchCondition | `VaultAllocated(uuid, signalIpId, publisherRoot, mode, embargoStart, revealAt)` | INSERT into `hatches` |
| HatchCondition | `VaultWritten(uuid, ...)` | UPDATE `hatches`, status hint |
| HatchCondition | `HatchRead(uuid, reader, kind)` | INSERT into `reads` |
| SubscriptionPass | `Minted(passId, owner, publisherRoot, expiresAt)` | INSERT into `subscriptions` |
| LicenseRegistry | `LicenseTokenMinted(...)` | INSERT into `licenses` |
| HatchOracle | `OutcomeSubmitted` / `OutcomeChallenged` / `OutcomeFinalized` | UPSERT `outcomes` |
| DisputeModule | `DisputeRaised` / `DisputeJudgementSet` / `DisputeCancelled` / `DisputeResolved` | UPSERT `disputes` |
| GroupingModule | `IPGroupRegistered` | UPSERT `groups` |
| GroupingModule | `AddedIpToGroup` / `RemovedIpFromGroup` | UPSERT `group_members` |

The indexer keeps a cursor in `indexer_cursor` and idempotency tokens in `processed_logs`. Replaying from any block is safe.

## On-chain contracts

| Contract | Address (Aeneid) | Owner |
|---|---|---|
| HatchCondition v2.1 | `0x9362bf2874c17ebe2d977a16861ee51bfbb0b474` | Hatch |
| SubscriptionPass | `0x9fc74922a10ad962570eb9692e66b0f6cb6909e1` | Hatch |
| HatchOracle | `0x5257eabbf0297ca6073ad0d7aba09c980d708a24` | Hatch |
| PublisherRegistry | `0x33519cf182bf9830046352150f4e03a5592bddfa` | Hatch |
| LicenseToken | `0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC` | Story |
| RoyaltyModule | `0xD2f60c40fEbccf6311f8B47c4f2Ec6b040400086` | Story |
| RoyaltyPolicyLAP | `0xBe54FB168b3c982b7AaE60dB6CF75Bd8447b390E` | Story |
| RoyaltyPolicyLRP | `0x9156e603C949481883B1d3355c6f1132D191fC41` | Story |
| GroupingModule | `0x69D3a7aa9edb72Bc226E745A7cCdd50D947b69Ac` | Story |
| EvenSplitGroupPool | `0xf96f2c30b41Cb6e0290de43C8528ae83d4f33F89` | Story |
| LicensingModule | `0x04fbd8a2e56dd85CFD5500A4A4DfA955B9f1dE6f` | Story |
| WIP | `0x1514000000000000000000000000000000000000` | Story |
| CDR | `0xCcCcCC0000000000000000000000000000000005` | Story |

Most Story protocol addresses are identical on mainnet (1514). Hatch's own four contracts are not yet redeployed on mainnet.
