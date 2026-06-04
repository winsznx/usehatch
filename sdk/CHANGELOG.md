# Changelog

## 0.2.0 — 2026-06-04
Major feature drop covering every Tier-0 to Tier-3 capability from the integration plan.

### Added
- Royalty
  - claimAllRevenue: wraps Story RoyaltyClient.claimAllRevenue with LAP and WIP defaults; returns aggregated claimed amounts
  - payRoyaltyOnBehalf: tip an IP; auto wraps IP to WIP when needed (Story SDK default behaviour); supports TxExecutor for sponsored gas
  - getClaimableRevenue: read claimable amount without transacting (used by /publishers/:root/claimable backend probe)
- WIP helpers
  - unwrapWipToNative, approveWip, getWipBalance, getWipAllowance
- IPA metadata
  - uploadIpaMetadata builds Story compliant IPA + NFT JSON, SHA-256 hashes, uploads to HatchStorage, returns URIs + hashes
  - createHatch + createPublisher now accept optional metadata + publicMetadataUrlBase params
- PIL flavors
  - pickPilTerms helper switches commercialRemix / commercialUse / nonCommercialSocialRemixing / creativeCommonsAttribution
  - createHatch + createPublisher accept pilFlavor option (default commercialRemix)
  - createHatch accepts optional royaltyPolicy override (required for LRP-based group hatches)
- CDR runtime
  - withCdrRetry: 2-attempt jittered backoff for accessCDR / allocate / write / encryptDataKey / getVault
  - CDR_DEFAULT_TIMEOUT_MS: forward-compat constant (cdr-sdk 0.2.1 constructor does not yet accept it)
- RPC fallback
  - EphemeralPool accepts optional rpcUrlFallbacks string array; uses viem fallback transport with rank + retry
- Auth + sponsored gas
  - TxExecutor interface: minimal { sendTransaction({ to, data, value }) } shape for Privy smart wallets or custom relays
  - payRoyaltyOnBehalf accepts optional txExecutor; raiseDispute too
- DisputeModule
  - raiseDispute, cancelDispute helpers
  - DISPUTE_TAGS, DISPUTE_DEFAULT_LIVENESS constants
  - DisputeTag type union
- GroupingModule
  - createGroup: registers PIL terms then registers group with EvenSplitGroupPool and attaches; forces LRP royalty (LAP is rejected by the module)
  - addToGroup, removeFromGroup
  - GROUP_MEMBER_CAP = 1000
- Cross-chain (deBridge)
  - buyHatchCrossChain, tipCrossChain: build a dlnHook calling Story LicensingModule.mintLicenseTokens or RoyaltyModule.payRoyaltyOnBehalf; POST to https://api.dln.trade/v1.0/dln/order/create-tx; submit returned tx via walletClient
  - CROSS_CHAIN_SOURCES curated array (Base, Optimism, Arbitrum, Ethereum with USDC token addresses)
  - DEBRIDGE_STORY_MAINNET_ID = 100000013 (deBridge's internal id for Story Mainnet)
  - CrossChainSource type
- AccessController
  - setDelegate: ALLOW or DENY a signer wallet on behalf of an IP (Story PermissionClient.setAllPermissions wrap)
  - setDelegateScoped: scope to a specific module + 4-byte function selector
  - AccessPermission enum re-export; DelegateScope union
- Chain config
  - AENEID + MAINNET both gained: royaltyPolicyLrp, groupingModule, evenSplitGroupPool, licensingModule, royaltyModule

### Changed
- createHatch signature gained optional pilFlavor, royaltyPolicy, metadata, publicMetadataUrlBase
- createPublisher signature gained optional pilFlavor, metadata, publicMetadataUrlBase
- Every CDR client call site wrapped in withCdrRetry

### Notes
- claimAllRevenue does not accept TxExecutor: Story SDK 1.4.4 models it as a multi-tx workflow without an encoded-tx path. Privy smart wallet users still benefit from email login but pay gas from the smart wallet balance.
- deBridge does not support Story Aeneid (1315) at time of publish. The cross-chain helpers in the SDK are functional but the frontend selector auto hides until chainId equals 1514 (Story Mainnet).
- @usehatch/sdk/storage subpath is unchanged.
