# Responsive Layout

Hatch ships a discrete set of breakpoints. Layout, navigation, modals, and form controls all step down at the same widths. The bar is industry grade mobile, not desktop shrunk.

## Breakpoints

| Width | Name | Applies to |
|---|---|---|
| 1440px and above | Wide desktop | Full max width on landing chapters and LiveProof grid |
| 1024px to 1439px | Desktop | Default layout, two column splits |
| 768px to 1023px | Tablet | Sidebar at full width, two column splits collapse to one |
| 600px to 767px | Mobile large | Rail collapses to bottom tab bar, statline becomes two columns |
| 480px to 599px | Mobile | Modals slide up from the bottom, datetime inputs stack |
| 360px to 479px | Mobile small | Pending row controls stack, hatch card padding tightens |
| Below 360px | Edge | Inner padding drops to 14px, footer columns to single |

## Root level overflow

Three rules on `html`, `body`, and `#root` use `overflow-x: hidden` paired with `overflow-x: clip` as a belt and suspenders pair. The hidden value is the iOS Safari fallback because `clip` alone does not catch transformed children. This kills the shift left dead space bug where the landing could be swiped horizontally to reveal blank space.

`body { overflow-x: hidden; overflow-x: clip; }`

The duplicate property is intentional. The first wins on older Safari, the second on modern browsers.

## Container padding

The shared `.container` class drops from 32px horizontal padding to 18px under 600px and 14px under 380px. Every landing inner section (`.lp-manifesto-inner`, `.lp-chapters`, `.lp-life-head`, `.lp-proof-*`, `.lp-trust-inner`, `.lp-closing-inner`, `.lp-hero-frame`) does the same.

## Long unbroken strings

Contract addresses, transaction hashes, and `mono` className elements wrap mid string under 600px:

```css
@media (max-width: 600px) {
  .mono { overflow-wrap: anywhere; word-break: break-all; }
}
```

Tables on Track Record and similar pages switch to `table-layout: fixed` so columns share width evenly instead of letting any single cell push the table wider than the viewport.

## Card handles

Long publisher display names like "Test Pub Build 7" truncate with ellipsis on cards:

```css
.card-handle {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Parent flex container `.card-pub` is `flex: 1; min-width: 0` so the handle can shrink past its content width without breaking the layout.

## Rail navigation on mobile

Under 900px the persistent Rail collapses to a fixed bottom tab bar showing only the four primary routes as icon plus label. The active route gets a small underline indicator above the tab. A hamburger button appears on the TopBar that opens the full vertical Rail in a slide in drawer with a backdrop and an Escape key handler. The drawer locks body scroll while open and closes automatically on route change.

See [frontend/src/design/console.css](../frontend/src/design/console.css) for the rail mobile rule starting at the `@media (max-width: 900px)` block.

## TopBar

Under 900px the TopBar shrinks to 56px high, hides the wallet balance, truncates the breadcrumb with ellipsis, and slims the state pill. Under 480px it hides the state pill entirely.

## Modals

`.modal-backdrop` and `.modal-panel` are reusable primitives in [frontend/src/design/styles.css](../frontend/src/design/styles.css). On mobile under 560px modals become a bottom sheet: stick to the bottom of the viewport, round only the top corners, and stack their buttons full width in reverse order so the primary action sits on top of Cancel.

[DisputeModal](../frontend/src/design/dispute_modal.jsx) uses these primitives directly.

## Forms

Inputs and textareas use `font-size: 16px` at and below 640px. This prevents iOS Safari from auto zooming when the input focuses.

The compose embargo plus reveal pair sits in a `.compose-row` class that flexes side by side on desktop and stacks under 560px. Two `datetime-local` inputs squeezed into one row look bad on mobile, so they break to one per row instead.

PIL flavor radio uses a vertical stack at every viewport so each option's hint text has room to breathe.

## Footer

`.footer-grid` is 5 column wide on desktop, 3 column under 1000px, 2 column under 700px, 1 column under 480px. The fifth column (Connect) spans full width on the 2 column breakpoint so the social links sit on their own row.

The big footer wordmark `font-size: clamp(72px, 22vw, 280px)` keeps it edge to edge without overflowing. Under 600px the clamp drops to `clamp(56px, 24vw, 130px)`.

## Statline and two column

`.statline` is a 4 column flex on desktop. Under 640px it becomes a 2 column grid with tightened gap. `.two-col` switches from `grid-template-columns: 1.05fr 0.95fr` to `1fr` under 640px and tightens its gap from 56px to 24px.

## Buttons and ConnectWallet

The ConnectWallet button shrinks to icon only width at 38px under 480px. Its dropdown menu shifts to a right anchored position that hugs the viewport edge.

A click outside handler attached to the menu listens on both `mousedown` and `touchstart` so the dropdown closes correctly on touch devices.

## Testing

Chrome DevTools Device Mode iterates through these sizes:

| Device | Width |
|---|---|
| iPhone SE | 375 |
| iPhone 12 | 390 |
| iPhone 12 Pro Max | 428 |
| iPhone 14 | 390 |
| Pixel 7 | 412 |
| iPad Mini | 768 |
| iPad Pro | 1024 |

Check every dashboard route at 360px, 414px, 768px, 1024px after any layout change.

## Known limitations

The Atmosphere background canvas and the OrbStage animation both render outside the document flow. They use `position: fixed` with `inset: 0`. They cannot push the document wider, but they also do not respect padding overrides.

Reading the same view in landscape orientation on a phone is not specifically optimized. The breakpoints above respond to viewport width only.
