# Hatch demo — 3-minute script

## Before you record (60s)

- Browser windowed at 1440×900. Hide bookmarks bar.
- **Wallet A · Publisher** — MetaMask on Story Aeneid (chain 1315), ~0.5 IP for gas + ~0.2 WIP for stake. IP from <https://aeneid.faucet.story.foundation/>. Wrap IP→WIP: `cast send 0x1514000000000000000000000000000000000000 'deposit()' --rpc-url https://aeneid.storyrpc.io --private-key 0x... --value 0.3ether`.
- **Wallet B · Reader** — different MetaMask profile or browser, ~0.05 IP.
- Tabs ready: `localhost:5173`, <https://aeneid.storyscan.io>, <https://www.npmjs.com/package/@usehatch/sdk>.
- Servers up: `pnpm --filter @usehatch/backend api` and `pnpm --filter frontend dev`. Confirm: `curl http://127.0.0.1:4011/healthz` shows `ok: true`.
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

## 0:45 – 1:30 · Seal a hatch

**Do:** Click **Seal a hatch**. Fill: title, body, embargo `+1 min`, reveal `+3 min`, mode `Dual`, price `0.01`. Optionally attach a small image. Click **Seal this hatch**.

**Say (as the transactions fire):**

> Browser-side AES encrypts every media file. Ciphertext goes to our Supabase bucket — opaque to us. The SDK registers the hatch as a derivative of the publisher root, attaches per-hatch PIL terms, then allocates a CDR vault under our HatchCondition v2.1. The condition encodes a five-slot tuple — mode, signal IP, publisher root, embargo start, reveal at — which the validators evaluate at every read.

**Show the Storyscan tx link in the success toast.**

---

## 1:30 – 2:00 · Reader: browse, follow, queue

**Do:** Switch to **Wallet B** in a second browser profile. Sign in. Click **Publishers** → **Follow** Alpha Spike. Click **Incubation** — the hatch is there with a real countdown.

**Say:**

> Second wallet, different user. They're a reader. They follow Alpha Spike — a single Postgres row, WebSocket fan-out for reveal notifications, no transaction. Their queue shows the hatch with a countdown ticking against the on-chain reveal time.

---

## 2:00 – 2:40 · The read (browser-side, private)

**Do:** Wait for the timer to hit zero (cut in post). Click the hatch. The Reading Experience renders. Click **Read (private — browser-side)**. Wallet pops, sign. Text + media appear.

**Say:**

> This is the critical part. The reader's wagmi wallet — not our server — calls accessCDR. CDR validators check the HatchCondition on-chain against the wallet, license, pass, and live block timestamp. They deliver partial decryptions addressed to the reader's public key. The SDK combines them in the browser, parses the manifest, decrypts each media blob with its per-file AES key. Our server only ever holds ciphertext.

**Click the `tx ↗` link to show the `VaultRead` event on Storyscan.**

---

## 2:40 – 3:00 · The receipts

**Do:** Cmd+Tab to the npm tab. Show `@usehatch/sdk` on the registry. Cmd+Tab back, scroll to landing footer.

**Say:**

> Everything we used is in @usehatch/sdk on npm. Open source. MIT. Same library powers the app. Four Hatch contracts on Storyscan, live. No demoware.

End on the footer wordmark.

---

## Skip if time-tight

- Subscribe two-party mint (requires `PASS_MINTER_PK` env)
- Anonymous-lent read (SDK works; browser modal is the next slice)

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
| Storyscan (Aeneid) | https://aeneid.storyscan.io |
| IP Faucet | https://aeneid.faucet.story.foundation/ |
| X | https://x.com/usehatch_ |

## Mid-record troubleshooting

| Symptom | Fix |
|---|---|
| `/siwe/nonce` fails | `lsof -i :4011`; restart `pnpm api` in `backend/` |
| Subscribe → 503 | Expected — `PASS_MINTER_PK` unset. Skip, do Buy. |
| Read → `reveal_pending` | Use **Read (private — browser-side)** — bypasses the mirror |
| Stale Vite chunk | Cmd+Shift+R |
| Orb in wrong spot | Cmd+Shift+R |
