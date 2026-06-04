/* Cross-chain Buy + Tip via deBridge DLN.
 *
 * Strategy:
 *   1. User on a non-Story chain (Base / Optimism / Arbitrum) wants to buy a
 *      hatch or tip a publisher on Story Mainnet.
 *   2. deBridge's DLN handles the bridge + token swap. A `dlnHook` rides along
 *      that triggers a follow-up call on Story Mainnet — minting the License
 *      Token or calling `payRoyaltyOnBehalf`.
 *   3. From the user's perspective: one signed tx on the source chain. Minutes
 *      later, the License/royalty lands on Story Mainnet.
 *
 * Constraint: deBridge supports Story Mainnet (1514) — NOT Aeneid (1315). Per
 * deBridge's live API (https://api.dln.trade/v1.0/supported-chains-info), Story
 * is listed with their internal id 100000013 mapped to originalChainId 1514.
 *
 * Phase F ships these helpers but the Hatch contracts themselves are Aeneid-
 * only as of today. The UI layer auto-hides the cross-chain selector when
 * `wiring.hatchConfig.chain.chainId !== 1514` to avoid surfacing a path that
 * cannot complete. Once Hatch redeploys on mainnet, this lights up unchanged.
 */

import type { Address, Hash, Hex, WalletClient } from "viem";
import { encodeFunctionData, parseAbi, zeroAddress } from "viem";

/** deBridge's internal chainId for Story Mainnet. The `originalChainId` is 1514
 *  but their API requires this synthetic id for Story-targeted orders. */
export const DEBRIDGE_STORY_MAINNET_ID = 100000013;

/** Source-chain configs deBridge supports for buying/tipping on Story. */
export interface CrossChainSource {
  chainId: number;
  name: string;
  /** ERC-20 token address used for payment on the source chain. `zeroAddress`
   *  if the source-chain native asset is being used directly. */
  paymentToken: Address;
  /** Display symbol of `paymentToken`. */
  paymentSymbol: string;
}

/** Curated set of source chains deBridge supports. Extend as needed. */
export const CROSS_CHAIN_SOURCES: ReadonlyArray<CrossChainSource> = [
  { chainId: 8453,  name: "Base",      paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address, paymentSymbol: "USDC" },
  { chainId: 10,    name: "Optimism",  paymentToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Address, paymentSymbol: "USDC" },
  { chainId: 42161, name: "Arbitrum",  paymentToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address, paymentSymbol: "USDC" },
  { chainId: 1,     name: "Ethereum",  paymentToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, paymentSymbol: "USDC" },
];

/** deBridge's create-tx REST endpoint. Returns the source-chain transaction
 *  data the client must sign + submit. */
const DEBRIDGE_CREATE_TX = "https://api.dln.trade/v1.0/dln/order/create-tx";

/** Story-side ABIs we encode into the dlnHook. Pulled from @story-protocol/core-sdk
 *  ABI generated.d.ts — kept inline so this module has zero hard dependency on
 *  the core SDK's runtime imports. */
const licensingAbi = parseAbi([
  "function mintLicenseTokens(address licensorIpId, address licenseTemplate, uint256 licenseTermsId, uint256 amount, address minter, address receiver, uint32 maxRevenueShare) returns (uint256)",
]);
const royaltyAbi = parseAbi([
  "function payRoyaltyOnBehalf(address receiverIpId, address payerIpId, address token, uint256 amount)",
]);

interface DlnHookCall {
  to: Address;
  calldata: Hex;
  /** Whether deBridge should treat the hook's revert as fatal (true) or
   *  proceed with delivery (false). True for our hooks — if the License mint
   *  fails the bridge should refund. */
  fallbackAddress?: Address;
}

function buildDlnHook(call: DlnHookCall): string {
  return JSON.stringify({
    type: "evm_transaction_call",
    data: {
      to: call.to,
      calldata: call.calldata,
      gas: 500_000,
      fallback_address: call.fallbackAddress ?? zeroAddress,
    },
  });
}

interface DeBridgeResponse {
  estimation: unknown;
  tx?: {
    to: Address;
    data: Hex;
    value: string;          // hex or decimal string
    gasLimit?: string;
  };
  orderId?: string;
  errorMessage?: string;
}

async function callDeBridge(params: Record<string, string>): Promise<DeBridgeResponse> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${DEBRIDGE_CREATE_TX}?${qs}`);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`deBridge create-tx failed: ${r.status} ${text.slice(0, 200)}`);
  }
  return (await r.json()) as DeBridgeResponse;
}

/** Buy a hatch via cross-chain bridge.
 *
 *  User pays in `srcToken` on `srcChainId`. deBridge bridges to Story Mainnet,
 *  swaps to WIP, then triggers `LicensingModule.mintLicenseTokens` so the License
 *  Token lands in `receiver`'s wallet on Story.
 *
 *  Requires the user's wallet on the source chain to sign the returned tx. */
export async function buyHatchCrossChain(args: {
  /** Source chain configuration (one of `CROSS_CHAIN_SOURCES`). */
  src: CrossChainSource;
  /** User's wallet, chain-switched to the source. */
  walletClient: WalletClient;
  /** Approximate source-chain token amount the user authorizes to spend. */
  srcAmount: bigint;
  /** Story-side targets. */
  signalIpId: Address;
  licenseTermsId: bigint;
  receiver: Address;
  /** Address that owns the resulting License Token; usually `receiver`. */
  minter?: Address;
  /** Story protocol LicensingModule address. Identical on Aeneid + Mainnet,
   *  but we pass it as a parameter so callers can override on testnet forks. */
  licensingModule: Address;
  /** Story protocol License template (PIL). Identical on Aeneid + Mainnet. */
  licenseTemplate: Address;
  /** Story-side WIP token address — the destination token deBridge will deliver. */
  wipAddress: Address;
  /** Output amount deBridge should land on Story (in WIP). Should be ≥ the
   *  hatch's minting fee. */
  dstAmountWip: bigint;
  /** Max source-side slippage in bps (default 50 = 0.5%). */
  slippageBps?: number;
}): Promise<{ srcTxHash: Hash; dlnOrderId?: string }> {
  const calldata = encodeFunctionData({
    abi: licensingAbi,
    functionName: "mintLicenseTokens",
    args: [
      args.signalIpId,
      args.licenseTemplate,
      args.licenseTermsId,
      1n,                                  // amount: one license
      args.minter ?? args.receiver,
      args.receiver,
      0,                                   // maxRevenueShare: accept any
    ],
  });

  const hook = buildDlnHook({
    to: args.licensingModule,
    calldata,
    fallbackAddress: args.receiver,
  });

  const params: Record<string, string> = {
    srcChainId: String(args.src.chainId),
    srcChainTokenIn: args.src.paymentToken,
    srcChainTokenInAmount: args.srcAmount.toString(),
    dstChainId: String(DEBRIDGE_STORY_MAINNET_ID),
    dstChainTokenOut: args.wipAddress,
    dstChainTokenOutAmount: args.dstAmountWip.toString(),
    dstChainTokenOutRecipient: args.receiver,
    senderAddress: args.walletClient.account?.address ?? args.receiver,
    srcChainOrderAuthorityAddress: args.walletClient.account?.address ?? args.receiver,
    dstChainOrderAuthorityAddress: args.receiver,
    dlnHook: hook,
  };

  const res = await callDeBridge(params);
  if (res.errorMessage || !res.tx) {
    throw new Error(`deBridge response invalid: ${res.errorMessage ?? "no tx returned"}`);
  }

  const srcTxHash = await args.walletClient.sendTransaction({
    to: res.tx.to,
    data: res.tx.data,
    value: BigInt(res.tx.value || "0"),
  } as Parameters<WalletClient["sendTransaction"]>[0]);

  return { srcTxHash, dlnOrderId: res.orderId };
}

/** Tip an IP via cross-chain bridge. Same pattern as `buyHatchCrossChain` but
 *  the dlnHook targets `RoyaltyModule.payRoyaltyOnBehalf` instead. */
export async function tipCrossChain(args: {
  src: CrossChainSource;
  walletClient: WalletClient;
  srcAmount: bigint;
  receiverIpId: Address;
  /** Anonymous tip = zeroAddress (default). */
  payerIpId?: Address;
  /** Story protocol RoyaltyModule address. */
  royaltyModule: Address;
  /** Story-side WIP token. */
  wipAddress: Address;
  /** Output WIP amount to deliver to the royalty vault. */
  dstAmountWip: bigint;
}): Promise<{ srcTxHash: Hash; dlnOrderId?: string }> {
  const calldata = encodeFunctionData({
    abi: royaltyAbi,
    functionName: "payRoyaltyOnBehalf",
    args: [
      args.receiverIpId,
      args.payerIpId ?? zeroAddress,
      args.wipAddress,
      args.dstAmountWip,
    ],
  });

  const hook = buildDlnHook({
    to: args.royaltyModule,
    calldata,
    fallbackAddress: args.receiverIpId,
  });

  const params: Record<string, string> = {
    srcChainId: String(args.src.chainId),
    srcChainTokenIn: args.src.paymentToken,
    srcChainTokenInAmount: args.srcAmount.toString(),
    dstChainId: String(DEBRIDGE_STORY_MAINNET_ID),
    dstChainTokenOut: args.wipAddress,
    dstChainTokenOutAmount: args.dstAmountWip.toString(),
    dstChainTokenOutRecipient: args.receiverIpId,
    senderAddress: args.walletClient.account?.address ?? args.receiverIpId,
    srcChainOrderAuthorityAddress: args.walletClient.account?.address ?? args.receiverIpId,
    dstChainOrderAuthorityAddress: args.receiverIpId,
    dlnHook: hook,
  };

  const res = await callDeBridge(params);
  if (res.errorMessage || !res.tx) {
    throw new Error(`deBridge response invalid: ${res.errorMessage ?? "no tx returned"}`);
  }

  const srcTxHash = await args.walletClient.sendTransaction({
    to: res.tx.to,
    data: res.tx.data,
    value: BigInt(res.tx.value || "0"),
  } as Parameters<WalletClient["sendTransaction"]>[0]);

  return { srcTxHash, dlnOrderId: res.orderId };
}
