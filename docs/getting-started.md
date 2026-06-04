# Getting started

This is the path from a fresh git clone to a publisher posting their first sealed hatch on a local stack. The full loop takes about 20 minutes on a developer laptop.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node | 22 or later | The SDK and backend both use top level await and node:crypto subtle |
| pnpm | 10 or later | The repo is a workspace, npm and yarn will not link `@usehatch/sdk` correctly |
| Postgres | 16 or later | Indexer, sessions, hatch state |
| Redis | 7 or later | BullMQ broker for reveal, oracle, notify, aggregator workers |
| Aeneid wallet | Any EOA with test IP | Publisher onboarding stakes 0.1 IP, hatch mint costs gas |
| Foundry (optional) | latest | Required only if you want to redeploy the Hatch contracts |

A wallet that already has Aeneid test IP works out of the box. To fund a new wallet, request from the Story faucet at `https://aeneid.story.foundation/faucet`.

## Clone and install

```bash
git clone git@github.com:winsznx/usehatch.git
cd usehatch
pnpm install
pnpm --filter @usehatch/sdk build
```

The SDK build step is non optional. Backend and frontend both import from `@usehatch/sdk/dist/...`, and `pnpm install` will not run the SDK's `tsc` automatically.

## Bring up Postgres and Redis

The repo expects Postgres on `127.0.0.1:5432` and Redis on `127.0.0.1:55379` by default. The easiest way is Docker.

```bash
docker run -d --name hatch-pg \
  -e POSTGRES_PASSWORD=hatch -e POSTGRES_DB=hatch \
  -p 5432:5432 postgres:16
docker run -d --name hatch-redis \
  -p 55379:6379 redis:7
```

Apply the schema once Postgres is up.

```bash
pnpm --filter @usehatch/backend db:push
```

This runs `drizzle-kit push` against `DATABASE_URL` and creates every table in `backend/src/db/schema.ts`.

## Environment files

There are two env files. Both have working defaults checked in as `.env.example`.

### `backend/.env`

```bash
DATABASE_URL=postgres://postgres:hatch@127.0.0.1:5432/hatch
REDIS_URL=redis://127.0.0.1:55379
API_PORT=4011
RPC_URL=https://aeneid.storyrpc.io
STORY_API_URL=http://172.192.41.96:1317
INDEXER_START_BLOCK=18800000

# Optional, but most flows need them
PASS_MINTER_PK=0x...                # publisher minter for /subscribe
OPERATOR_PRIVATE_KEY=0x...          # oracle attestation key
SERVER_TREASURY_PK=0x...            # treasury for the server side ephemeral pool

# Optional integrations
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=
BSKY_HANDLE=
BSKY_APP_PASSWORD=
RESEND_API_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:ops@usehatch.xyz

# Cookies and CORS (dev defaults)
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
COOKIE_SAMESITE=Lax
COOKIE_SECURE=0
```

### `frontend/.env.local`

```bash
VITE_API_URL=http://localhost:4011
VITE_WS_URL=ws://localhost:4011/ws
VITE_VAPID_PUBLIC_KEY=                  # match backend VAPID_PUBLIC_KEY
VITE_PRIVY_APP_ID=                      # optional, enables email login
VITE_PIMLICO_BUNDLER_URL=               # optional, enables sponsored AA
```

Vite inlines every `VITE_*` at build time. If you change one, restart `pnpm dev`.

## First run

In one terminal:

```bash
pnpm --filter @usehatch/backend dev
```

This boots `runner.ts`, which starts the indexer from `INDEXER_START_BLOCK`, the reveal worker, the notify worker, the oracle worker (only if `OPERATOR_PRIVATE_KEY` is set), the track record aggregator, and the API on `:4011`. You should see `[runner] ready` within a few seconds.

In a second terminal:

```bash
pnpm --filter frontend dev
```

Vite serves on `http://localhost:5173`. Open it. The landing page renders the orb animation. Click "Open Console" to hit the `/console` route.

## First publisher onboarding

The console has a Compose view that drives the full publisher loop end to end. The flow is:

1. Connect a wallet. The login modal offers RainbowKit for a self custody EOA and, if `VITE_PRIVY_APP_ID` is set, an email login through Privy with a sponsored AA wallet via Pimlico.
2. Sign in with Ethereum. The frontend hits `POST /siwe/nonce`, signs the message, and `POST /siwe/verify` returns a session token. The token persists in an httpOnly cookie (`hatch_session`) and as a Bearer header fallback.
3. Open the Compose view. If the wallet is not a registered publisher, the composer prompts for a handle and a subscription tier price, then calls `createPublisher` from the SDK. This registers a root IP on Story, mints a SPGNFT collection, and stakes 0.1 IP in `PublisherRegistry`.
4. Write a hatch. Pick a PIL flavor (default `commercialRemix`), an embargo start, a reveal time, and per hatch and subscription prices. Drop in text and up to a few MB of media. The composer calls `createHatch`, which encrypts media with a freshly derived manifest key, uploads ciphertext to the backend `/storage` endpoint, mints the per hatch terms, registers the IP, and writes the manifest into the CDR vault under a hatch UUID.
5. Wait for the indexer. Within five seconds the indexer's `VaultAllocated` and `VaultWritten` handlers insert a row into `hatches`. The console's WebSocket subscription delivers a `hatch:new` event and the new card appears in the timeline.

At this point you have a sealed hatch. Subscribe from a second wallet, or mint a per hatch license, then call `POST /hatches/:uuid/read` after the reveal time to fetch the decrypted manifest. The full demo loop is documented in [DEMO.md](../DEMO.md).

## What to read next

- [architecture.md](./architecture.md) explains how the indexer, reveal worker, and API stay consistent.
- [sdk-reference.md](./sdk-reference.md) lists every SDK export with a typed signature.
- [troubleshooting.md](./troubleshooting.md) covers the common failures (SIWE 401, reveal worker stuck, CDR validator timeout).
