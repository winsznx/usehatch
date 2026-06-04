# Hatch

> Sealed alpha. Public on timer. On-chain track records you can't fake.

## The Problem

Information asymmetry rewards leakers, not creators. Predictions, research, and scoops get screenshot-leaked the moment a paywall cracks, and there is no neutral way to prove who knew what, when. Existing paywalls gate access but cannot enforce embargo: anyone with a key can copy, paste, and steal credit. Publishers need a way to seal claims now, prove authorship cryptographically, and force-reveal on a deterministic schedule. See [`PROBLEM_STATEMENT.md`](PROBLEM_STATEMENT.md) for the full version.

Hatch is a programmable embargo platform on [Story Protocol](https://story.foundation/)'s Confidential Data Rails. Publishers seal predictions, research, and scoops inside encrypted CDR vaults. Subscribers pay for early access via on-chain license tokens. The vault auto-unseals when the timer hits zero — not before, not by us, not by them. Every reveal is forced and verifiable. Every prediction can be resolved by an oracle. Every publisher accumulates an immutable on-chain track record.

**One-pager:** [`ARCHITECTURE.md`](ARCHITECTURE.md) — A→Z, components, flows, trust model, deployment topology. Includes the full **[submission-to-settlement pipeline](ARCHITECTURE.md#pipeline--submission-to-settlement)** mapped stage-by-stage to the code that runs it: submit → protect → register → compose → purchase → gate → decrypt → settle.

## `@usehatch/sdk`

**Live on npm:** [`@usehatch/sdk@0.2.0`](https://www.npmjs.com/package/@usehatch/sdk) · `pnpm add @usehatch/sdk`

> **What is new in 0.2.0:** royalty claims, disputes, IP grouping, delegation, cross-chain buy/tip, and Privy + Pimlico smart wallet auth. See [`sdk/CHANGELOG.md`](sdk/CHANGELOG.md).

We built **[@usehatch/sdk](sdk/README.md)** — a typed, reusable TypeScript client for the CDR + Story stack. It is the same library the Hatch app uses to publish, purchase, and read sealed content, packaged so anyone building on CDR can drop it in:

```ts
import { createHatch, buyHatch, readHatch, AENEID, HATCH } from "@usehatch/sdk";
import { SupabaseProvider } from "@usehatch/sdk/storage";
import {
  claimAllRevenue,
  payRoyaltyOnBehalf,
  getClaimableRevenue,
  raiseDispute,
  cancelDispute,
  createGroup,
  addToGroup,
  setDelegate,
  buyHatchCrossChain,
  tipCrossChain,
  TxExecutor,
} from "@usehatch/sdk";
```

What it gives you:

- **Publisher lifecycle** — `createPublisher`, `stake`, `unstake`, `wrapNativeToWip`. Mints SPG NFT, registers IPA with subscription PIL, onboards to `HatchPublisherRegistry`.
- **Sealing** — `createHatch` builds the encrypted manifest, allocates a CDR vault with `HatchConditionV2.1` slot encoding, writes ciphertext, returns `{ uuid, signalIpId, perHatchTermsId, txHashes }`.
- **Commerce** — `buyHatch` (per-hatch License mint) and `subscribe` (two-party License + Pass mint).
- **Reads — three modes** — `via: "wallet"` (signed, plaintext stays with the caller), `via: "anonymous"` (post-reveal via ephemeral pool), `via: "anonymous-lent"` (pre-reveal subscriber lends pass to ephemeral, reads, unlends).
- **Royalty** — `claimAllRevenue`, `payRoyaltyOnBehalf`, `getClaimableRevenue`. Pull-based settlement against the Royalty Module.
- **Disputes** — `raiseDispute`, `cancelDispute` via `DisputeModule`. Bond, evidence URI, tag-based resolution.
- **Grouping** — `createGroup`, `addToGroup` via `GroupingModule`. Compose IPAs into a single licensable group.
- **Delegation** — `setDelegate` via `AccessController`. Grant scoped write permission to a backend or session signer.
- **Cross-chain** — `buyHatchCrossChain`, `tipCrossChain` via deBridge. Mainnet only. Pay from any supported source chain, settle on Story.
- **Auth** — `TxExecutor` wraps Privy embedded wallets and Pimlico smart accounts. Gasless UX, sponsored bundles, one signer abstraction for every write path.
- **Storage** — pluggable `HatchStorage` interface; `LocalDiskProvider`, `SupabaseProvider`, `FailoverStorage` shipped on the `@usehatch/sdk/storage` subpath (Node-only — kept out of browser bundles).
- **Oracle attestations** — `signAttestation`, `submitAttestation`, `challenge`, `finalize`, `resolveChallenge`, `getOutcome`. EIP-712 typed.
- **Pinned chain config** — `AENEID` (Story Aeneid testnet, chain 1315) and `HATCH` (deployed Hatch contract addresses) as named exports.

The SDK has its own [README](sdk/README.md) with installation, peer-deps, and a code-first walkthrough of every export.

## Repo

```
contracts/   Solidity — HatchCondition · HatchSubscriptionPass · HatchOutcomeOracle · HatchPublisherRegistry
sdk/         @usehatch/sdk — reusable typed client for CDR + Story (publishable to npm)
backend/     Hono API · indexer · reveal worker · oracle worker · notify worker · aggregator
frontend/    React + Vite app (landing + console)
```

## Running locally

You need **Node 22+**, **pnpm 10+**, a Postgres + Redis (Docker is fine), and an [Aeneid RPC](https://aeneid.storyrpc.io) connection.

```bash
pnpm install
pnpm --filter @usehatch/sdk build

# Postgres + Redis (one-time)
docker compose -f scripts/dev-compose.yml up -d   # or your own postgres/redis

# Apply schema
pnpm --filter @usehatch/backend db:push

# Backend (port 4011)
pnpm --filter @usehatch/backend api

# Frontend (port 5173)
pnpm --filter frontend dev
```

Open <http://localhost:5173>. Click **Sign in** → RainbowKit modal → pick a wallet → sign the SIWE message. Browse publishers, follow, subscribe, buy, seal, read — every action settles on Story Aeneid testnet.

## Required env

[`backend/.env`](backend/.env):
- `DATABASE_URL` — Postgres connection string
- `RPC_URL` — `https://aeneid.storyrpc.io`
- `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_BUCKET` — encrypted ciphertext sink
- `OPERATOR_PRIVATE_KEY` — oracle attestation key
- `PASS_MINTER_PK` — server-side `SubscriptionPass.mint` for the Subscribe two-party flow
- `COOKIE_SAMESITE=None` + `COOKIE_SECURE=1` (prod HTTPS cross-origin)
- `CORS_ORIGINS` — comma-separated browser origin whitelist

[`frontend/.env.local`](frontend/.env.local):
- `VITE_BACKEND_URL` — backend base URL
- `VITE_WALLETCONNECT_PROJECT_ID` — Reown project ID (enables WalletConnect QR + mobile wallets)
- `VITE_VAPID_PUBLIC_KEY` — Web Push public key (must match backend's keypair)

## Deploy

- **Frontend** → Vercel. `pnpm --filter frontend build` outputs `frontend/dist/`.
- **Backend + workers** → Railway. Single image runs Hono API + indexer + reveal worker + oracle worker via `backend/src/runner.ts`. Postgres + Redis as Railway plugins.
- **Storage** → Supabase (private bucket). Ciphertext only.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the production topology diagram + failure-mode table.

## Health

- `GET /healthz` — probes Postgres, RPC, and Storage with per-probe latency; 503 on any failure.
- `GET /livez` — process liveness only.

## License

[MIT](LICENSE) — © 2026 Hatch contributors.
