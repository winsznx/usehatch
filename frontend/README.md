# @usehatch/frontend

Vite + React + TypeScript port of the Landing + Console designs, wired with
typed primitives for the `@usehatch/backend` REST/WS, SIWE wallet connect,
and Web Push subscription.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173/   Landing
                # http://localhost:5173/console   Console
pnpm build      # → dist/  (deployable static SPA)
```

## What ships now

- **Pixel-correct design ports** of Landing and Console from the Anthropic
  Design bundle. JSX/CSS files live in [src/design/](src/design/); the bundle
  is **295 KB JS / 58 KB CSS** (gzipped 90 / 11 KB).
- **Routing**: `/` → Landing, `/console` (+ `/console/*` for hash sub-routes) → Console.
- **Backend primitives** (ready to use; not yet wired into the design components):
  - [`src/api.ts`](src/api.ts) — typed fetch client for every REST endpoint in
    `@usehatch/backend` (publishers, hatches, outcomes, subscriptions,
    licenses, follow/unfollow, push subscribe, hatch read, WS open).
  - [`src/wallet.ts`](src/wallet.ts) — `connect`, `ensureAeneid`,
    `signInWithEthereum` (full SIWE flow over EIP-1193, no wagmi).
  - [`src/siwe.ts`](src/siwe.ts) — 30-line EIP-4361 message builder
    (bundle-light substitute for the `siwe` npm package).
  - [`src/push.ts`](src/push.ts) — VAPID-based push subscribe + service worker
    registration ([public/sw.js](public/sw.js)).

## Env

```bash
cp .env.example .env.local
```

| Var | Purpose |
|-----|---------|
| `VITE_API_URL` | Backend base URL. Dev: `http://127.0.0.1:4011`. Prod: Railway/Vercel URL. |
| `VITE_VAPID_PUBLIC_KEY` | Same VAPID public key as the backend's `VAPID_PUBLIC_KEY`. |

## Integration points (next-iteration TODOs)

The design components in `src/design/` currently render off the in-bundle
`data.js` mock. To wire real data, edit each component:

| Component | Replace mock with… |
|-----------|---------------------|
| `landing_a.jsx` Hero/LiveProof | `api.hatches({ status: "active" })` |
| `landing_b.jsx` Trust/Closing | `api.publishers()` |
| `view_timeline.jsx` Timeline | `api.hatches({ publisher: ... })` |
| `view_publisher.jsx` Publisher | `api.publisher(rootIp)` + `api.followers(rootIp)` |
| `view_hatch.jsx` HatchDetail | `api.hatch(uuid)` + `api.hatchReveal(uuid)` post-reveal |
| Header / Avatar | `wallet.signInWithEthereum()` on click; show `localStorage["hatch.siwe.token"]` state |
| Subscribe button | `wallet.viemWallet()` → `storyClient.license.mintLicenseTokens` (SDK) |
| Notifications setting | `push.enablePush()` / `disablePush()` |
| Live feed updates | `openWs({ channel: "my-publishers", token })` push hatch:new/revealed into state |

The design files are already typed as `any` via [src/design/design.d.ts](src/design/design.d.ts)
so consuming TS code stays clean; iteration 3 would port .jsx → .tsx with proper props.

## Static fallback

The pre-build v1 (self-contained ~2MB HTML files, no build step) is preserved at
[`../frontend-v1-static/`](../frontend-v1-static/) for emergency rendering of
the designs without Node.

## Deploy

```bash
vercel --prod   # picks up vite output; no extra config needed
```
