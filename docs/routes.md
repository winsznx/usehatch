# Frontend Routes

Every page the user can navigate to, the file that renders it, what it does, and what wiring it needs.

## Landing

### `/`

[frontend/src/design/landing_a.jsx](../frontend/src/design/landing_a.jsx) plus [frontend/src/design/landing_b.jsx](../frontend/src/design/landing_b.jsx).

Single page split into Hero, Manifesto, Lifecycle chapters, LiveProof, Trust, Closing, and Footer. The LiveProof grid renders real hatches from `/hatches`. The Lifecycle ledger card uses the most recent publisher and their resolutions. No auth required to view. The Sign in button kicks off RainbowKit then SIWE.

Actions: sign in, follow a publisher, jump to console, open external links to GitHub, npm, Storyscan, Bluesky.

Mobile: hero CTAs stack under 420px. Lifecycle chapters collapse to single column under 900px. LiveProof grid collapses to single column under 980px. Footer columns step from 5 to 3 to 2 to 1 at 1000px, 700px, 480px. Long publisher addresses on the Lifecycle card truncate via `shortAddr`. See [responsiveness.md](./responsiveness.md) for breakpoints.

## Console shell

Every route under `/console` mounts inside [frontend/src/design/console_mount.jsx](../frontend/src/design/console_mount.jsx) which renders the persistent Rail navigation, TopBar, and the active view. On mobile under 900px the Rail collapses to a fixed bottom tab bar showing the four primary routes, with a hamburger button on the TopBar that opens the full vertical Rail in a slide in drawer.

Auth: any console route shows a sign in prompt instead of content when SIWE is missing. Most routes additionally require a wagmi wallet connected on chain 1315.

## Console routes

### `/console` (Timeline)

[frontend/src/design/view_timeline.jsx](../frontend/src/design/view_timeline.jsx).

Chronological feed: revealed hatches, upcoming reveals, settled outcomes. Pulls from `GET /me/timeline`. Filters by access (Author, Subscribed, Bought) via `GET /me/queue` for the side panel.

Actions: open a hatch detail, click through to a publisher, sign in if missing.

### `/console#/queue` (Incubation)

[frontend/src/design/view_queue.jsx](../frontend/src/design/view_queue.jsx).

The waiting room. Every hatch the caller has access to that has not yet revealed. Each row shows the publisher, the title, the live `BigCountdown`, and the access tag.

Actions: open a hatch detail, follow or unfollow publishers from the rail.

### `/console#/publishers` (Publishers list)

[frontend/src/design/view_publishers.jsx](../frontend/src/design/view_publishers.jsx).

Every publisher registered with `HatchPublisherRegistry`. Per row controls: Follow / Following, Tip, Dispute. The Tip control expands inline to take an amount; passes `txExecutor` from `useStoryWiring` so Privy smart wallet users get sponsored gas. The Dispute button opens [dispute_modal.jsx](../frontend/src/design/dispute_modal.jsx) targeting the publisher root IP. Publishers with at least one active dispute gain a red "disputed" tag.

When chain id equals 1514 the Tip control gains a `CrossChainSelector` letting the user pay from Base, Optimism, Arbitrum, or Ethereum via deBridge. The selector renders nothing on Aeneid.

### `/console#/publisher` (Command Center)

[frontend/src/design/view_publisher.jsx](../frontend/src/design/view_publisher.jsx).

The viewer's own publisher dashboard. Renders the onboarding form if the caller is not registered yet. Otherwise: statline (weighted accuracy, resolved hatches, active subscribers, followers), an active dispute notice if any are raised, an Earnings section with a Claim royalties button driven by `claimAllRevenue`, a Wrap IP to WIP widget, Pending reveals, Recent hatches, and the Delegates section that calls `setDelegate` against the `AccessController`.

Actions: register publisher, stake WIP, claim royalties, wrap IP, grant or revoke editor delegate, jump to compose.

### `/console#/compose` (Seal a hatch)

[frontend/src/design/view_compose.jsx](../frontend/src/design/view_compose.jsx).

The composer. Top toggle picks between Single hatch and Dataset (group). Single mode collects title, summary, body, media attachments, embargo, reveal, mode (per hatch, subscription, dual), price, PIL flavor, and optional IPA metadata. Submit runs `createHatch` end to end and patches metadata via `/hatches/:uuid/metadata`.

Dataset mode shares title, embargo, reveal, mode, and price across rows. Each row is one hatch within the group. Submit runs `createGroup`, then loops `createHatch` with `royaltyPolicy: LRP` so terms dedupe matches the group, then `addToGroup`. Capped at 1000 members.

Mobile: the embargo and reveal date inputs stack under 560px to avoid squeezing two `datetime-local` controls. Body textarea grows. PIL flavor radio uses full row layout.

### `/console#/record` (Track Record)

[frontend/src/design/view_publisher.jsx](../frontend/src/design/view_publisher.jsx) `TrackRecord` export.

Publisher's living resume. Statline plus a Prediction history table showing every resolved hatch with finalized outcome and operator address. Mobile collapses the table to row cards.

### `/console#/hatch/:uuid` (Hatch detail)

[frontend/src/design/view_hatch.jsx](../frontend/src/design/view_hatch.jsx).

Two states. Pre reveal renders the Gate: status pill, title, deck, big countdown, and the action row (Buy this hatch, Subscribe, Follow, Dispute). Buy uses `buyHatch` natively or `buyHatchCrossChain` when the `CrossChainSelector` picks a source chain. Post reveal renders the ReadingExperience: title, deck, byline, an inline Tip control targeting the signal IP, the decrypted body and media, and the receipt footer with a dispute this link.

The Read action tries the wallet side `readHatch({ via: "wallet" })` first. If the user is anonymous, the fallback button calls the server pool path.

### `/console#/dispute/:disputeId`

Currently not a standalone route; disputes surface as badges and counts on publisher pages. Future iteration will add a dedicated dispute detail view.

## Auxiliary

### `/__dev/`

Not a route. The `DevErrorBoundary` in [frontend/src/main.tsx](../frontend/src/main.tsx) catches render errors and prints the stack inline. Fires only in development.

## Auth and wiring

`useStoryWiring()` returns `null` until wagmi has a wallet on chain 1315. Any route that needs to write on chain disables its action buttons until the hook resolves. SIWE session lives in module level state and survives a soft reload via cookie. There is no `localStorage` or `sessionStorage` use anywhere in the app, per the design spec.
