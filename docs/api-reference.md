# API Reference

Backend HTTP routes served by [backend/src/api.ts](../backend/src/api.ts). All paths relative to the backend base URL (local dev `http://127.0.0.1:4011`, production whatever you deploy at).

Auth is SIWE Bearer. Sign in by calling `/siwe/nonce` then `/siwe/verify`, then attach the returned token as `Authorization: Bearer <token>` on every authed call.

## Auth

### `GET /siwe/me`

Returns the current session if a valid Bearer token is present.

Response: `{ wallet: Address }` or 401.

### `POST /siwe/nonce`

Body: `{ address: Address }`. Returns `{ nonce: string }`. Nonces expire in 10 minutes.

### `POST /siwe/verify`

Body: `{ message: string, signature: 0x-hex }`. Validates the signature against the previously issued nonce. Returns `{ token: string, wallet: Address }`. Tokens last 24 hours and persist in Postgres `siwe_sessions`.

### `POST /siwe/signout`

Auth required. Deletes the session row. Returns 204.

## Public reads

### `GET /publishers`

Returns the most recent 100 publishers ordered by creation. Stake amount is stringified.

Response: `{ publishers: PublisherSummary[] }`.

### `GET /publishers/:root`

Single publisher plus joined track record.

Response: `{ publisher: PublisherSummary, trackRecord: TrackRecord | null }` or 404.

### `GET /publishers/:root/resolutions`

Resolved hatches authored by the publisher. Joins `hatches` and `outcomes` where outcome status is `finalized`. Limit 50.

Response: `{ resolutions: ResolutionRow[] }`.

### `GET /publishers/:root/metrics`

Track record plus active subscriber count plus follower count.

Response: `{ trackRecord: TrackRecord | null, activeSubscribers: number, followerCount: number }`.

### `GET /publishers/:root/claimable`

Reads `RoyaltyModule.ipRoyaltyVaults(root)` for the IP's royalty vault, then queries the vault's `claimableRevenue(claimer, WIP)`. Zero vault returns `wip: "0"` cleanly. Optional query params: `claimer` (defaults to the root itself), `token` (defaults to WIP).

Response: `{ wip: string, vault: Address | null, claimer, token?, lastChecked: string }`.

### `GET /publishers/:root/dispute-status`

Aggregate dispute counts for a publisher.

Response: `{ publisherRootIp, active, judgedAgainst, total, counts: { raised, judgedTrue, judgedFalse, cancelled, resolved } }`.

### `GET /hatches`

Query params: `publisher`, `mode`, `status`, `limit` (max 200, default 50). Returns the most recent matching hatches.

Response: `{ hatches: HatchSummary[] }`.

### `GET /hatches/:uuid`

Single hatch with derived `status` and serialized big numbers.

Response: `{ hatch: HatchSummary }` or 404.

### `GET /hatches/:uuid/reveal`

Returns the decrypted body and media list for a revealed hatch. Populated by the reveal worker after the embargo timer hits zero.

Response: `{ revealedContent: { hatchUuid, text, media, revealedAt, revealedBy } }`.

### `GET /outcomes/:uuid`

Settled or pending outcome for a hatch.

Response: `{ outcome: { hatchUuid, status, outcomeValue, finalizedAt, operator } }`.

### `GET /disputes`

Query params: `targetIpId`, `publisher`, `hatchUuid`, `status`, `limit` (max 200).

Response: `{ disputes: Dispute[] }`.

### `GET /groups`

Query params: `publisher`, `owner`, `limit` (max 200).

Response: `{ groups: GroupSummary[] }`.

### `GET /groups/:groupId`

Single group with member list (cap 1000).

Response: `{ group: GroupSummary, members: GroupMember[] }`.

### `GET /follows/:wallet`

The publishers a wallet follows.

Response: `{ wallet, publishers: Address[] }`.

### `GET /followers/:root`

The wallets that follow a publisher root.

Response: `{ publisherRootIp, followers: Address[] }`.

## Authed reads

### `GET /subscriptions/:wallet`

Auth required. Active subscriptions for the wallet.

Response: `{ wallet, subscriptions: SubscriptionRow[] }`.

### `GET /licenses/:wallet`

Auth required. License tokens bought by the wallet.

Response: `{ wallet, licenses: LicenseRow[] }`.

### `GET /me/queue`

Auth required. Pending and live hatches accessible to the caller via author, subscription, or purchased license.

Response: `{ items: QueueItem[] }`.

### `GET /me/timeline`

Auth required. Chronological feed of reveal, upcoming, and outcome events relevant to the caller.

Response: `{ items: TimelineEvent[] }`.

## Authed mutations

### `POST /subscribe`

Two party subscribe. Client first mints the sub license token from its own wallet. This route then mints the paired `HatchSubscriptionPass` using the publisher minter key.

Body: `{ publisherRootIp, subLicenseTokenId, durationDays }`.

Response: `{ passId, mintPassTx }` or 503 if `PASS_MINTER_PK` is unset.

### `POST /hatches/:uuid/read`

Authed read path. Server runs the CDR entitlement check against the caller's wallet, leases an ephemeral pool slot if `via: "anonymous"`, decrypts in process, and returns the plaintext. Used as a fallback when the browser side wallet read is not available.

Body: `{ entitlement: object | "empty", via: "wallet" | "anonymous" }`.

Response: `{ text, media: [{ name, mime, bytesBase64 }], reader, txHash }`.

### `PATCH /hatches/:uuid/metadata`

Composer race ahead. Persists editorial title and summary right after `createHatch` so cards render the real headline before the indexer catches up. Caller wallet must own the referenced publisher root.

Body: `{ title?, summary?, publisherRootIp?, signalIpId?, mode?, embargoStart?, revealAt? }`.

Response: `{ ok: true, uuid, title?, summary?, upserted? }`.

### `PATCH /groups/:groupId/metadata`

Same race ahead pattern for groups. Caller wallet must own the referenced publisher root.

Body: `{ title?, description?, publisherRootIp?, licenseTermsId? }`.

Response: `{ ok: true, groupId }`.

### `POST /follow`

Auth required. Idempotent.

Body: `{ publisherRootIp }`.

### `DELETE /follow`

Auth required. Idempotent.

Body: `{ publisherRootIp }`.

### `POST /push/subscribe`

Auth required. Registers a Web Push subscription for the caller's wallet. Body is the browser `PushSubscriptionJSON` object.

Response: `{ ok: true, vapidPublicKey }`.

### `DELETE /push/subscribe`

Auth required. Body: `{ endpoint }`.

## Storage

### `POST /storage`

Auth required. Rate limited at 60 uploads per minute per wallet. Body: `{ dataBase64: string }` capped at 3 MiB. Uploads to the server's configured `HatchStorage` provider (Supabase in production).

Response: `{ cid }`.

### `GET /storage/:cid`

Public. Returns the raw bytes with `content-type: application/octet-stream` and `cache-control: private, max-age=300`.

## WebSocket

### `GET /ws`

Standard WebSocket upgrade. Server pushes events with `shouldRoute` filtering against the client's wallet, follow list, or subscription list. Event types include `hatch:allocated`, `hatch:status`, `oracle:submitted`, `oracle:finalized`, `dispute:raised`, `group:registered`, and `group:members-added`.

## Health

### `GET /healthz`

Probes Postgres, the RPC endpoint, and the storage provider. 200 with timings per probe, or 503 if any probe fails.

### `GET /livez`

Process liveness only. Always 200 unless the process is dead.

## Common types

See [frontend/src/api.ts](../frontend/src/api.ts) for the full TypeScript interface declarations. The shapes referenced above are stable and versioned with the SDK.
