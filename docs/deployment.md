# Deployment on Railway

Hatch deploys cleanly to Railway as a pnpm monorepo with three managed pieces: the frontend, the backend, and the Postgres and Redis plugins. Supabase storage stays as an external service.

This guide assumes you already authenticated `railway login` locally. If not, do that first.

## Project topology

One Railway project contains:

| Service | What runs | Notes |
|---|---|---|
| `frontend` | `pnpm --filter frontend build && pnpm --filter frontend preview --port $PORT --host 0.0.0.0` | Static Vite preview server. For production swap to a static host or serve `dist/` behind a caddy or nginx step. |
| `backend` | `pnpm --filter @usehatch/backend exec tsx src/runner.ts` | Hono API on `$PORT` plus indexer, reveal worker, oracle worker, notify worker, Bluesky bot, aggregator in one process. |
| `Postgres` | Railway plugin | Exposes `DATABASE_URL`. |
| `Redis` | Railway plugin | Exposes `REDIS_URL`. |

You can split the backend workers into a second service later if you want them on separate scaling rails. The current `runner.ts` keeps them in one process to simplify the demo.

## Initial setup

Run these from the repo root once.

```bash
railway init
railway add --plugin postgres
railway add --plugin redis
railway up --service backend
railway up --service frontend
```

`railway init` links the current directory to a new project. `railway add --plugin` provisions the managed Postgres and Redis. `railway up` deploys whichever service you point at.

## Railway config files

Each service has a `railway.json` at its package root. Railway picks them up automatically.

`backend/railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "buildCommand": "pnpm install --frozen-lockfile && pnpm --filter @usehatch/sdk build",
    "watchPatterns": ["backend/**", "sdk/**"]
  },
  "deploy": {
    "startCommand": "pnpm --filter @usehatch/backend exec tsx src/runner.ts",
    "healthcheckPath": "/healthz",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

`frontend/railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "buildCommand": "pnpm install --frozen-lockfile && pnpm --filter @usehatch/sdk build && pnpm --filter frontend build",
    "watchPatterns": ["frontend/**", "sdk/**"]
  },
  "deploy": {
    "startCommand": "pnpm --filter frontend exec vite preview --port $PORT --host 0.0.0.0",
    "restartPolicyType": "ALWAYS"
  }
}
```

Notes:

- `watchPatterns` lets Railway skip a rebuild when only the other service's files changed.
- `tsx` runs TypeScript without a precompile step. If you prefer a compiled drop, add a `pnpm --filter @usehatch/backend build` script that emits JS into `dist/` and update `startCommand` to `node dist/runner.js`.
- Healthcheck path on the backend hits `/healthz` which probes Postgres, RPC, and storage. Returns 503 on any probe failure so Railway can hold the deploy.

## Environment variables

Set these in the Railway dashboard under each service's Variables tab. The `${{Plugin.VAR}}` syntax pulls from a sibling plugin in the same project.

Backend service:

| Variable | Value | Source |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | reference |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | reference |
| `RPC_URL` | `https://aeneid.storyrpc.io` | hardcode |
| `RPC_URL_FALLBACKS` | empty or comma list | optional |
| `STORY_API_URL` | `http://172.192.41.96:1317` | hardcode for Aeneid |
| `INDEXER_START_BLOCK` | `18800000` | hardcode |
| `API_PORT` | `${{PORT}}` | Railway provides PORT automatically |
| `OPERATOR_PRIVATE_KEY` | redacted | secret |
| `PASS_MINTER_PK` | redacted | secret |
| `SERVER_TREASURY_PK` | redacted | secret |
| `SERVER_POOL_SIZE` | `4` | hardcode |
| `SUPABASE_URL` | redacted | secret |
| `SUPABASE_SERVICE_ROLE_KEY` | redacted | secret |
| `SUPABASE_BUCKET` | `UseHatch` | hardcode |
| `VAPID_PUBLIC_KEY` | redacted | secret |
| `VAPID_PRIVATE_KEY` | redacted | secret |
| `VAPID_SUBJECT` | `mailto:notifications@usehatch.xyz` | hardcode |
| `BSKY_HANDLE` | `usehatch.bsky.social` | hardcode |
| `BSKY_APP_PASSWORD` | redacted | secret |
| `RESEND_API_KEY` | redacted | secret |
| `COOKIE_SAMESITE` | `None` | for cross origin production |
| `COOKIE_SECURE` | `1` | HTTPS only |
| `COOKIE_DOMAIN` | `.usehatch.xyz` | once custom domain is live |
| `CORS_ORIGINS` | `https://usehatch.xyz,https://www.usehatch.xyz` | once custom domain is live |

Frontend service:

| Variable | Value |
|---|---|
| `VITE_BACKEND_URL` | `https://${{backend.RAILWAY_PUBLIC_DOMAIN}}` |
| `VITE_RPC_URL` | `https://aeneid.storyrpc.io` |
| `VITE_RPC_URL_FALLBACKS` | empty or comma list |
| `VITE_CHAIN_ID` | `1315` for testnet, `1514` once mainnet contracts deploy |
| `VITE_WALLETCONNECT_PROJECT_ID` | from Reown dashboard |
| `VITE_PRIVY_APP_ID` | from Privy dashboard |
| `VITE_PRIVY_SPONSORSHIP_POLICY_ID` | `sp_...` from Pimlico |
| `VITE_VAPID_PUBLIC_KEY` | matches backend keypair |
| `VITE_HATCH_PUBLIC_URL` | `https://usehatch.xyz` |
| `VITE_BLUESKY_HANDLE` | `usehatch.bsky.social` |

## Database migration

Schema lives in [backend/src/db/schema.ts](../backend/src/db/schema.ts) and drizzle pushes it with `db:push`. Run this once against the production Postgres after the first deploy.

```bash
railway run --service backend -- pnpm --filter @usehatch/backend run db:push
```

`railway run` injects the production `DATABASE_URL` into the local shell so drizzle pushes against the production database without leaking the URL into your environment.

## Custom domain

Railway dashboard, your project, Settings, Domains. Click Add Custom Domain. Railway gives you either a CNAME target like `xxxxx.up.railway.app` or, for apex domains, two A records.

At your registrar:

| Record | Type | Value |
|---|---|---|
| `usehatch.xyz` (apex) | A | the IP Railway provides |
| `usehatch.xyz` (apex) | A | the second IP Railway provides |
| `www.usehatch.xyz` | CNAME | the railway target |

After DNS propagates (under five minutes for most registrars), Railway provisions a Let's Encrypt cert and the domain goes live on HTTPS. Update `VITE_HATCH_PUBLIC_URL` and `CORS_ORIGINS` to match.

## CORS and cookies

The backend uses `hono/cors` with `CORS_ORIGINS` for the whitelist. In production set:

```
CORS_ORIGINS=https://usehatch.xyz,https://www.usehatch.xyz
COOKIE_SAMESITE=None
COOKIE_SECURE=1
COOKIE_DOMAIN=.usehatch.xyz
```

Without `SameSite=None` and `Secure=1` the SIWE session cookie will not ship cross origin, and the frontend on `usehatch.xyz` will fail to attach the bearer token to backend calls on `api.usehatch.xyz`.

## WebSocket support

Railway proxies WebSocket upgrade requests natively. No extra config. The backend exposes `/ws` and the frontend points at `wss://api.usehatch.xyz/ws` once the domain is set.

## Healthcheck

Backend `GET /healthz` probes Postgres, RPC, and storage. Returns 200 with timings on success, 503 on any failure. Railway uses this to decide whether a deploy is healthy.

Frontend has no equivalent. Railway treats the preview server's 200 response on `/` as healthy.

## Cost estimate

Railway's free tier ships $5 of credit per month and is enough to validate the deploy. For sustained production:

| Service | Plan tier | Approximate monthly cost |
|---|---|---|
| Backend (web + workers in one process) | Hobby | $5 to $20 |
| Frontend (vite preview) | Hobby | $5 |
| Postgres plugin | Hobby | $5 |
| Redis plugin | Hobby | $5 |

Roughly $20 to $35 per month at low traffic. Move the backend workers to a dedicated service when reveal volume grows.

## Rollback

Railway keeps every deploy in the Deployments tab. Click any prior successful deploy and Promote. Rollback is instant. The database is shared across deploys so a rollback does not undo schema changes; if a deploy includes a `db:push`, rolling back the code without rolling back the schema usually works since drizzle never drops columns. When in doubt restore the database from the Postgres plugin's automatic backups before rolling back.

## Promotion to mainnet

When the Hatch contracts redeploy on Story Mainnet, flip `VITE_CHAIN_ID` to `1514`, swap `RPC_URL` to `https://mainnet.storyrpc.io`, update `STORY_API_URL`, and redeploy. See [mainnet.md](./mainnet.md) for the full checklist.
