# Mainnet Readiness

Hatch is mainnet ready by design. The SDK ships a `MAINNET` chain config with every Story protocol address pinned. The cross chain helpers target mainnet because deBridge does not support Aeneid. The Privy and Pimlico integrations work on mainnet as soon as the dashboard adds Story Mainnet as a supported network. The frontend chain selector and tip widgets light up automatically when `chainId === 1514`.

What stops the flip from being trivial is the four Hatch owned contracts. Those must be redeployed.

## Address parity

Story Protocol publishes the same address on Aeneid (1315) and Mainnet (1514) for almost every contract the SDK references.

| Contract | Aeneid | Mainnet | Same? |
|---|---|---|---|
| WIP token | `0x1514000000000000000000000000000000000000` | same | yes |
| LicenseToken | `0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC` | same | yes |
| PILicenseTemplate | `0x2E896b0b2Fdb7457499B56AAaA4AE55BCB4Cd316` | same | yes |
| RoyaltyPolicyLAP | `0xBe54FB168b3c982b7AaE60dB6CF75Bd8447b390E` | same | yes |
| RoyaltyPolicyLRP | `0x9156e603C949481883B1d3355c6f1132D191fC41` | same | yes |
| GroupingModule | `0x69D3a7aa9edb72Bc226E745A7cCdd50D947b69Ac` | same | yes |
| EvenSplitGroupPool | `0xf96f2c30b41Cb6e0290de43C8528ae83d4f33F89` | same | yes |
| LicensingModule | `0x04fbd8a2e56dd85CFD5500A4A4DfA955B9f1dE6f` | same | yes |
| RoyaltyModule | `0xD2f60c40fEbccf6311f8B47c4f2Ec6b040400086` | same | yes |
| AccessController | `0xcCF37d0a503Ee1D4C11208672e622ed3DFB2275a` | same | yes |
| DisputeModule | `0x9b7A9c70AFF961C799110954fc06F3093aeb94C5` | same | yes |
| CDR | `0xCcCcCC0000000000000000000000000000000005` | same | yes |
| DKG | `0xCcCcCC0000000000000000000000000000000004` | same | yes |
| IpRoyaltyVaultImpl | `0xbd0f3c...50Dc` | `0x63cC76...0298` | different |
| IPAccountImpl | `0xdeC03e...Bf79` | `0x7343646...1C77` | different |
| SPGNFTImpl | `0x5266215a...4e37` | `0x6Cfa03Bc...49F5` | different |

The SDK references the three "different" contracts only by name. The Story SDK resolves them internally per chain id. Our code never reads their addresses directly, so the parity gap is invisible at the SDK boundary.

## What needs redeploy

Four Hatch owned contracts. All in [contracts/](../contracts/).

| Contract | What it does | Deploy from |
|---|---|---|
| HatchCondition v2.1 | CDR read condition that gates by mode, signal IP, publisher root, embargo, reveal | Operator wallet |
| HatchSubscriptionPass | ERC 721 pass minted to subscribers, mintable only by the publisher's minter wallet | Operator wallet |
| HatchOutcomeOracle | EIP 712 attestation oracle for outcome resolution | Operator wallet |
| HatchPublisherRegistry | Publisher onboarding plus WIP staking | Operator wallet |

The operator wallet is the same address that deployed on Aeneid. Use forge or the deploy scripts in [contracts/script/](../contracts/script/) and record the deployed addresses.

## Flip checklist

The checklist below assumes contracts are already redeployed on mainnet.

### 1. SDK chain config

Edit [sdk/src/config.ts](../sdk/src/config.ts). Update `MAINNET` with the four new Hatch contract addresses. They live under the `HATCH` const today and reference Aeneid only. Add a `HATCH_MAINNET` const with the new addresses, exported alongside `MAINNET`.

```ts
export const HATCH_MAINNET = {
  subscriptionPass: "0x...",
  hatchCondition:   "0x...",
  oracle:           "0x...",
  publisherRegistry:"0x...",
} as const;
```

Rebuild and republish the SDK at 0.3.0. Bump the changelog.

### 2. Frontend env

[frontend/.env.production](../frontend/.env.production):

```
VITE_CHAIN_ID=1514
VITE_RPC_URL=https://mainnet.storyrpc.io
VITE_RPC_URL_FALLBACKS=
VITE_HATCH_PUBLIC_URL=https://usehatch.xyz
```

In [frontend/src/lib/wagmi.ts](../frontend/src/lib/wagmi.ts), swap the `storyAeneid` chain config for a `storyMainnet` config that references `MAINNET` from `@usehatch/sdk`. Update the `chains` array passed to `createConfig`.

In [frontend/src/lib/story.ts](../frontend/src/lib/story.ts), change `chainId: "aeneid"` to `chainId: "storyMainnet"` in the StoryConfig passed to `StoryClient.newClient`.

In [frontend/src/lib/config.ts](../frontend/src/lib/config.ts) and component files, replace `HATCH` imports with `HATCH_MAINNET` where the mainnet build needs the new contract addresses. Keep both available behind a build flag so testnet and mainnet builds can share a codebase.

### 3. Backend env

`backend/.env.production`:

```
RPC_URL=https://mainnet.storyrpc.io
RPC_URL_FALLBACKS=
STORY_API_URL=https://mainnet-api.storyrpc.io
INDEXER_START_BLOCK=<mainnet deploy block>
REGISTRY_ADDR=<HatchPublisherRegistry on mainnet>
```

In [backend/src/indexer.ts](../backend/src/indexer.ts) update `CONTRACTS` to read mainnet addresses for `hatchCondition`, `pass`, `oracle`. Either hardcode the mainnet addresses or read from env (cleaner).

### 4. Privy dashboard

Privy console, your app, Configuration, Networks. Add a custom network with chain id 1514, RPC `https://mainnet.storyrpc.io`, name Story Mainnet. Smart Wallets section, enable the network. Bundler and Paymaster URLs from Pimlico for mainnet (different from Aeneid). Sponsorship policy id from Pimlico for the mainnet policy.

Update `VITE_PRIVY_SPONSORSHIP_POLICY_ID` to the mainnet policy.

### 5. Pimlico

Pimlico dashboard, create a new sponsorship policy on chain 1514. Bundler URL: `https://api.pimlico.io/v2/1514/rpc?apikey=YOUR_KEY`. Paymaster URL: same. Policy id ends up in `VITE_PRIVY_SPONSORSHIP_POLICY_ID`.

### 6. Cross chain selector

No code change needed. The selector in [frontend/src/design/cross_chain_selector.jsx](../frontend/src/design/cross_chain_selector.jsx) reads `wiring.hatchConfig.chain.chainId` and renders only when it equals 1514. When the mainnet build ships, the Buy and Tip widgets gain a "Pay from" dropdown showing Base, Optimism, Arbitrum, and Ethereum, all paying in USDC via deBridge.

### 7. Database

The Postgres schema is chain agnostic. The same tables work on mainnet. The indexer reads `INDEXER_START_BLOCK` and walks forward. Set it to the block of the first Hatch contract deploy on mainnet.

### 8. Bluesky and operational env

Same bot account works on mainnet. No change.

### 9. Supabase storage

Same bucket works. Update CORS allowed origins in Supabase to include the mainnet domain.

### 10. Custom domain and CORS

Update `CORS_ORIGINS` and `COOKIE_DOMAIN` on the backend service to match the mainnet domain. See [deployment.md](./deployment.md) for the Railway runbook.

## What lights up automatically on flip

- The `CrossChainSelector` component appears on the Buy and Tip widgets because its mount gate is `chainId === 1514`.
- The Story Aeneid RPC fallback transport carries over with whatever URLs you set in `RPC_URL_FALLBACKS`.
- The `setDelegate` helper works without change. AccessController is identical on both chains.
- Disputes, groups, royalty claims, and tips all keep working. Story SDK resolves the per chain implementations behind the same interface.
- Privy email login works as soon as the dashboard adds the mainnet network.

## What you must do by hand on flip

- Redeploy the four Hatch contracts.
- Run `db:push` against the production Postgres.
- Update the SDK chain config with the new Hatch addresses.
- Republish the SDK at a new minor version.
- Update Pimlico and Privy dashboards.
- Update backend `CONTRACTS` and `INDEXER_START_BLOCK`.
- Update CORS and domain config.

## Pre flight check

Before flipping production:

- Wallet `0x62b4AFbE...` (or whichever the operator uses) has at least 5 IP on mainnet for gas during contract deploy.
- Pimlico billing tier covers expected sponsorship volume.
- Bluesky account remains usehatch.bsky.social or update env.
- Reown WalletConnect project id allows the mainnet domain in its Origins list.

## Rollback to testnet

If something breaks after the flip, set `VITE_CHAIN_ID` back to 1315 and redeploy the frontend only. The backend keeps running against mainnet but the frontend will not be able to write to it because wagmi will refuse the chain mismatch. This is a safe partial rollback that prevents bad writes without rolling the database back.

For a full rollback, point env vars back to Aeneid values and redeploy both services. The mainnet contracts stay deployed; they just go quiet.
