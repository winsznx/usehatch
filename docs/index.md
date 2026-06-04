# Hatch Docs

Hatch is programmable embargoes on Story Protocol's Confidential Data Registry (CDR). A publisher writes a piece of content, encrypts it client side, and locks it behind an on-chain reveal time. Buyers pay for early access through a per-hatch license or a recurring subscription pass. After the reveal time, the content opens to anyone with a manifest key. Outcomes are attested by an off-chain oracle and finalized after a challenge window, which feeds the publisher's track record.

These docs are written for the engineer who will inherit the repo. They cover every public route, every SDK export, every backend endpoint, the data flow that ties them together, the responsive rules that govern the UI, and the path from a fresh git clone to a Railway production deployment.

## Quick navigation

| Doc | Read this when |
|---|---|
| [getting-started.md](./getting-started.md) | You just cloned the repo and need to boot the full stack locally |
| [architecture.md](./architecture.md) | You want the system map: frontend, backend, SDK, on-chain pieces, workers |
| [sdk-reference.md](./sdk-reference.md) | You are calling `@usehatch/sdk` from a frontend or backend file |
| [api-reference.md](./api-reference.md) | You are calling the Hatch HTTP API from any client |
| [routes.md](./routes.md) | You need to know what every frontend route does and where its source lives |
| [responsiveness.md](./responsiveness.md) | You are adding UI and need to know the breakpoint rules |
| [deployment.md](./deployment.md) | You are shipping the app to Railway production |
| [troubleshooting.md](./troubleshooting.md) | A symptom is in the dev console or production logs and you need a fix |

## Repo layout

```
/usehatch
├── backend/      Hono API + indexer + workers (single process via runner.ts)
├── frontend/     Vite + React SPA (landing + console)
├── sdk/          @usehatch/sdk, published to npm, used by both backend and frontend
├── contracts/    HatchCondition v2.1, SubscriptionPass, HatchOracle, PublisherRegistry
├── scripts/      Local dev orchestration helpers
└── docs/         This directory
```

Source of truth for product behavior lives in three places. The SDK defines the on-chain envelope (manifest format, condition encoding, transaction sequencing). The backend's indexer and workers project that envelope into Postgres rows. The frontend renders those rows. When the three disagree, the SDK wins.

## Versions

| Component | Version |
|---|---|
| `@usehatch/sdk` | 0.2.0 |
| Node | 22+ |
| pnpm | 10+ |
| Postgres | 16+ |
| Redis | 7+ |
| Story chain (default) | Aeneid testnet (chain id 1315) |
| Story chain (optional) | Mainnet (chain id 1514) |

For the Railway plan, see [deployment.md](./deployment.md). For component-level architecture, see [architecture.md](./architecture.md) and the longer root [ARCHITECTURE.md](../ARCHITECTURE.md).
