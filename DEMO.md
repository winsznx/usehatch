# Hatch demo — 3:30 script

## Before you record (60s)

- Browser windowed at 1440×900. Hide bookmarks bar.
- **Wallet A · Publisher** — MetaMask on Story Aeneid (chain 1315), ~0.5 IP for gas + ~0.2 WIP for stake. IP from <https://aeneid.faucet.story.foundation/>. Wrap IP→WIP in-app: visit **Command Center** → **Wrap IP → WIP** widget, enter `0.3`, click **Wrap**. (The `cast send` step is no longer needed — the SDK's `wrapNativeToWip` helper handles it.)
- **Wallet B · Reader** — different MetaMask profile or browser, ~0.05 IP.
- Tabs ready: `localhost:5173`, <https://aeneid.storyscan.io>, <https://bsky.app/profile/usehatch.bsky.social>, <https://www.npmjs.com/package/@usehatch/sdk>.
- **Boot the full stack** (not just the API — this turns on the indexer, reveal worker, oracle worker, notify worker, aggregator, and the Bluesky auto-poster all at once):

  ```bash
  pnpm --filter @usehatch/backend exec tsx src/runner.ts
  pnpm --filter frontend dev
  ```

  In a third terminal: `tail -f /tmp/hatch-api.log` if you want the runner's stdout as a side-window during the demo — the indexer's `[idx]` lines + the Bluesky bot's `[bsky] login OK` are strong receipts on screen.
- Confirm: `curl http://127.0.0.1:4011/healthz` shows `ok: true` with all three probes (db/rpc/storage) green.
- QuickTime / Loom armed. Cut wait-for-reveal dead time in post.

---

## 0:00 – 0:25 · Landing (the value prop)

**Do:** Open `http://localhost:5173`. Pause on the Hero. Scroll past LiveProof. End on the Closing.

**Say:**

> Hatch is a programmable embargo platform on Story Protocol's Confidential Data Rails. Publishers seal predictions inside encrypted vaults with a public reveal timer. Subscribers pay for early access. The vault auto-unseals exactly when the timer hits zero — not before, not by us, not by them. Every reveal is forced, every record on-chain.

---

## 0:25 – 0:45 · Sign in + become a publisher

**Do:** Click **Sign in** top-right. RainbowKit → MetaMask → SIWE signature. Click **Command Center** in the rail. Onboarding form is auto-shown. Fill: `Alpha Spike`, `ALPHA`, `0.05`, `10`, `0.1`. Click **Register publisher**.

**Say (over the wallet popups):**

> SIWE auth. Then in one form: the SDK mints an SPG NFT collection, registers an IP asset with Story's PIL framework, attaches subscription license terms, registers in HatchPublisherRegistry, and stakes WIP. Every transaction signs from the user's wallet — we never hold keys.

---

## 0:45 – 1:25 · Seal a hatch

**Do:** Click **Seal a hatch**. Fill: title, body, embargo `+1 min`, reveal `+2 min`, mode `Dual`, price `0.01`. Optionally attach a small image. Click **Seal this hatch**.

**Say (as the transactions fire):**

> Browser-side AES encrypts every media file. Ciphertext goes to our Supabase bucket — opaque to us. The SDK registers the hatch as a derivative of the publisher root, attaches per-hatch PIL terms, then allocates a CDR vault under our HatchCondition v2.1. The condition encodes a five-slot tuple — mode, signal IP, publisher root, embargo start, reveal at — which the validators evaluate at every read.

**Show the Storyscan tx link in the success toast.**

---

## 1:25 – 2:00 · Reader: subscribe + queue

**Do:** Switch to **Wallet B** in a second browser profile. Sign in. Click **Publishers** → **Follow** Alpha Spike → click into the publisher → click **Subscribe**. Two wallet pops:

1. Subscriber mints a sub License Token (from the publisher root, paying the subscription minting fee in WIP).
2. The server (with `PASS_MINTER_PK` set) mints the paired `HatchSubscriptionPass` to the subscriber.

Then click **Incubation** in the rail — the hatch is there with a real countdown, marked `SUBSCRIBED`.

**Say:**

> Subscribe is a two-party mint. The subscriber signs the license mint client-side, then our server signs the Pass mint with the publisher's minter key — pass.mint is owner-only by design. End-state: they hold both a Story License Token and a HatchSubscriptionPass NFT, valid for thirty days. Royalties propagate up the IP graph automatically via Story's LAP.

---

## 2:00 – 2:35 · The read (browser-side, private)

**Do:** Wait for the timer to hit zero (cut in post). Click the hatch. Click **Read (private — browser-side)**. Wallet pops, sign. Text + media appear.

**Say:**

> The critical part. The reader's wagmi wallet — not our server — calls accessCDR. CDR validators check the HatchCondition on-chain against the wallet, the License Token they minted at subscribe, the Pass, and the live block timestamp. They deliver partial decryptions addressed to the reader's public key. The SDK combines them in the browser, parses the manifest, decrypts each media blob with its per-file AES key. Our server only ever holds ciphertext.

**Click the `tx ↗` link to show the `VaultRead` event on Storyscan.**

---

## 2:35 – 2:50 · The Bluesky receipt

**Do:** Cmd+Tab to <https://bsky.app/profile/usehatch.bsky.social>. The post for the reveal is already there.

**Say:**

> Every reveal auto-posts to Bluesky. The reveal worker enqueues a job, the bot picks it up, posts, stores the AT-URI back in the database for idempotency. No human in the loop. Followers see reveals the moment the chain enforces them.

---

## 2:50 – 3:20 · The protocol surface (new in 0.2.0)

**Do:** Switch back to **Wallet A · Publisher**. Open **Command Center**.

1. Scroll to **Earnings** — point at the live "Claim royalties" button.
2. Click it. Wallet pops, sign. Toast: "Claimed N WIP" with a Storyscan link.
3. Below: **Wrap IP → WIP** widget. Wrap `0.1` to show the SDK helper replacing the old `cast send`.
4. Scroll further to **Delegates**. Paste another address, click **Grant**. One AccessController tx — that wallet can now seal hatches on behalf of this publisher.

**Say (over the clicks):**

> Tier-1 protocol surface — all live, all on-chain, all behind the same SDK:
> claim royalties via Story's LAP, tip publishers via `payRoyaltyOnBehalf`,
> dispute bad publishers via the UMA-backed DisputeModule, bundle hatches
> into datasets via the GroupingModule, delegate editor wallets via the
> AccessController. No custom contracts for any of it — Hatch is a thin
> programmable-embargo layer on Story's primitives.

**Cmd+Tab to a second browser profile.** Open **Publishers** list. Click **Tip** next to a publisher row, type `0.001`, click **Send**. Wallet pops, sign, royalties flow up the LAP graph.

Then click **Dispute** on the same row. Modal: pick a tag, paste evidence ("test dispute"), click **Raise dispute**. Tx fires — UMA bond pays out the optimistic oracle. The publisher row gains a red "· disputed" badge within ~5s once the indexer catches the `DisputeRaised` event.

---

## 3:20 – 3:30 · The receipts

**Do:** Cmd+Tab to the npm tab. Show `@usehatch/sdk@0.2.0`. Cmd+Tab back, scroll to landing footer.

**Say:**

> Everything we used is in @usehatch/sdk on npm. Open source. MIT. Same library powers the app. Four Hatch contracts on Storyscan, the GitHub repo, the architecture doc — every receipt linked.

End on the footer wordmark.

---

## After recording

- Trim wait-for-reveal dead time.
- Add captions. Judges watch muted.
- Upload to YouTube unlisted, paste link into the form's demo field.

---

## URLs

| | |
|---|---|
| App (local) | http://localhost:5173 |
| API (local) | http://127.0.0.1:4011 |
| Healthz | http://127.0.0.1:4011/healthz |
| SDK on npm | https://www.npmjs.com/package/@usehatch/sdk |
| GitHub | https://github.com/winsznx/usehatch |
| Storyscan (Aeneid) | https://aeneid.storyscan.io |
| IP Faucet | https://aeneid.faucet.story.foundation/ |
| Bluesky | https://bsky.app/profile/usehatch.bsky.social |
| X | https://x.com/usehatch_ |

## Backend stack — what runs

When you launch `pnpm --filter @usehatch/backend exec tsx src/runner.ts`, the runner boots **everything**:

```
[runner] starting indexer from block 18800000
[runner] starting reveal worker (Redis @ redis://127.0.0.1:55379)
[runner] starting Bluesky bot (handle: usehatch.bsky.social)
[runner] starting notify worker (Resend + Web Push)
[runner] starting oracle worker + finalize worker
[runner] starting track-record aggregator (event-driven + 5m sweep)
[runner] starting API on :4011
[runner] ready
```

Every chain event the indexer sees can trigger a downstream worker. Reveals → Bluesky + email + push. Resolutions → aggregator updates the track records.

## Mid-record troubleshooting

| Symptom | Fix |
|---|---|
| `/siwe/nonce` fails | Backend down. Restart with `pnpm exec tsx src/runner.ts` from `backend/` |
| Read → `reveal_pending` | Use **Read (private — browser-side)** — bypasses the mirror |
| Subscribe doesn't kick off the Pass mint | Check `PASS_MINTER_PK` is set in `backend/.env` and matches `SubscriptionPass.minter()` on chain |
| Bluesky post didn't appear | Check `tail /tmp/hatch-api.log \| grep bsky` — login errors surface immediately |
| Stale Vite chunk | Cmd+Shift+R |
| Orb in wrong spot | Cmd+Shift+R |
