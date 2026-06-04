# Troubleshooting

The patterns below cover every recurring failure we have seen during the build. Symptoms first, then the actual fix.

## SIWE returns 401

Symptom: `POST /siwe/verify` returns 401 even though the user signed.

Causes and fixes:

- The nonce expired. Nonces live for 10 minutes. Reissue with `POST /siwe/nonce` and resign.
- The SIWE message contains a non ASCII character. `siwe@3` rejects em dashes and other Unicode in the `statement` field. The Hatch frontend uses a plain ASCII statement. If you edit the message template, only use ASCII.
- The signature is being sent against the wrong domain or chain id. Confirm the wagmi chain id is 1315 on Aeneid before signing.

## Reveal worker is stuck

Symptom: A hatch hit its `revealAt` timestamp but never moved to `revealed` status.

Causes and fixes:

- `SERVER_TREASURY_PK` is unset. The reveal worker reads from the CDR via an ephemeral pool which needs a funded treasury. Logs print `[runner] SERVER_TREASURY_PK unset, reveal worker SKIPPED`. Set the env, restart `runner.ts`.
- The ephemeral pool is out of gas. Visit the Storyscan page for the treasury wallet, confirm balance, and top it up if needed. The pool watchdog refills slots every 30 seconds when treasury has balance.
- The CDR validators are slow. The SDK wraps every CDR call in `withCdrRetry` for two attempts. If both fail, the job is retried by BullMQ.

## CDR validator timeout

Symptom: `accessCDR` throws with a timeout error in the browser or worker logs.

Causes and fixes:

- The validator quorum is degraded. Wait two minutes and retry. The retry wrapper handles transient timeouts automatically.
- The `apiUrl` points at the shared Story API node which is rate limited under load. Run your own node and set `STORY_API_URL` on the backend to your node's REST endpoint.

## Pimlico bundler 4001

Symptom: `eth_sendUserOperation` fails with `User rejected request` even though the user did not see a prompt.

Causes and fixes:

- The Pimlico sponsorship policy id is missing. Privy passes the policy id via `paymasterContext`. Confirm `VITE_PRIVY_SPONSORSHIP_POLICY_ID` is set in `.env.local` and reread by `lib/privy.tsx`.
- The policy hit its monthly cap. Pimlico dashboard shows usage. Top up or raise the cap.
- The Privy app does not have Smart Wallets enabled on chain 1315. Privy dashboard, Smart Wallets section, add Story Aeneid.

## Bluesky login fails

Symptom: Logs show `[bsky] login failed: AuthInvalidIdentifier`.

Causes and fixes:

- The `BSKY_HANDLE` includes the `@` prefix. Drop it. Use `usehatch.bsky.social`, not `@usehatch.bsky.social`.
- The `BSKY_APP_PASSWORD` was revoked. Generate a new one at `bsky.app` Settings, App Passwords, and update the env.
- Two factor auth is on for the account. App passwords bypass 2FA but you must use the app password not the account password.

## Indexer is behind head

Symptom: Storyscan shows a transaction confirmed but the API has not picked it up.

Causes and fixes:

- The indexer polls every 5 seconds. Give it 10 seconds before assuming a bug.
- The reorg safety window keeps the indexer 12 blocks behind head. Cosmetic, not a bug.
- The indexer hit a handler error. Logs print `[<contract>] handler error:` lines with the error message. Most are transient (RPC blip). If they recur, the event signature in [backend/src/indexer.ts](../backend/src/indexer.ts) may have drifted from the deployed contract ABI.

## Claimable returns 0

Symptom: `GET /publishers/:root/claimable` returns `wip: "0"` even though licenses have been minted.

Causes and fixes:

- The IP royalty vault has not been deployed yet. Story deploys per IP vaults lazily on first claimable revenue. The `vault` field in the response will be `null`. Mint at least one license at a paid PIL flavor to trigger vault deployment.
- Revenue settled to a different claimer. Pass `?claimer=<address>` to the endpoint to check a specific claimer. Default is the publisher root.
- The token differs from WIP. Pass `?token=<address>` to check a non WIP token.

## Frontend shows stale Vite chunks

Symptom: Routes render blank or with old JSX after a code change.

Causes and fixes:

- Hard refresh. Cmd+Shift+R on macOS, Ctrl+Shift+R elsewhere.
- Delete the `node_modules/.vite` cache directory and restart `pnpm dev`.
- The dev server is bound to an old port. Kill any stray `vite` processes with `pkill -f vite`, restart.

## Landing has horizontal scroll on mobile

Symptom: Swiping left on the landing reveals empty space.

Fixed in 0.2.0. If you still see it after pulling latest, confirm:

- `body { overflow-x: hidden; overflow-x: clip; }` is present in [frontend/src/design/styles.css](../frontend/src/design/styles.css).
- The Lifecycle ledger card calls `shortAddr(pub.publisherRootIp)`, not the raw 42 character address.
- Container padding drops to 18px under 600px and 14px under 380px.

## Dispute does not appear in the publisher list

Symptom: User raised a dispute on chain but the publisher row does not show the disputed badge.

Causes and fixes:

- The indexer needs to see the `DisputeRaised` event. Logs print `dispute:raised` when picked up. Allow 5 to 10 seconds.
- The `targetIpId` resolved to neither a publisher root nor a known signal IP. The dispute row is still stored but `publisher_root_ip` is null so the badge query does not match. Confirm the dispute targets a known publisher root.

## Group composer fails with "license terms mismatch"

Symptom: `addToGroup` reverts with a terms mismatch error.

Causes and fixes:

- The member hatch was sealed with LAP royalty. Group hatches must use LRP. The composer passes `royaltyPolicy: AENEID.royaltyPolicyLrp` to `createHatch` automatically. If you call `createHatch` manually for a group member, do the same.
- The fee or rev share differs between the group and the member. Story dedupes terms only when every input field matches exactly. The group composer keeps them in sync; manual flows must do the same.

## Cross chain buy stays pending

Symptom: User signed the deBridge tx on Base but the License Token never lands on Story.

Causes and fixes:

- deBridge solver delay. Two to five minutes is normal. Check the `dlnOrderId` at `https://app.debridge.finance/order/<orderId>`.
- The dlnHook reverted on destination. Common cause: the destination wallet lacks WIP allowance to `LicensingModule`. The current SDK does not pre approve. A production path would batch (deposit, approve, mint) via a helper contract. For now manually approve WIP before retrying.
- Pull more diagnostic from deBridge: `https://stats-api.dln.trade/api/Orders/<orderId>`.

## When to nuke the database

Drop and recreate Postgres only when:

- A migration changed a primary key. Drizzle does not migrate PKs in place.
- You upgraded the indexer to handle a new event type and want a clean re index from `INDEXER_START_BLOCK`.

Use `pnpm --filter @usehatch/backend run db:push --force` to overwrite the schema. Back up first.

## Surgical fix is usually better

Most production bugs are env or RPC issues, not code bugs. Before changing code, confirm:

- All env vars listed in [deployment.md](./deployment.md) are set
- `/healthz` returns 200 with all three probes green
- The wagmi chain id matches the deployed contracts' chain
- The wallet has IP for gas and WIP for fees

If those four pass and the issue persists, then look at code.
