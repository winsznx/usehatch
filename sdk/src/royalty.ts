import type { Address, Hash, Hex, TransactionReceipt } from "viem";
import { zeroAddress } from "viem";
import type { StoryClient } from "@story-protocol/core-sdk";
import type { HatchConfig } from "./config.js";

/** Minimal interface for sponsored / account-abstracted transaction submission.
 *  Implemented natively by Privy's `useSmartWallets()` client and trivially by any
 *  viem `walletClient.sendTransaction({ to, data, value })`. When a TxExecutor is
 *  passed to a Hatch SDK function, that function requests the underlying Story SDK
 *  call's *encoded* tx data and submits through the executor instead of letting the
 *  StoryClient's bound wallet sign — enabling Pimlico / paymaster sponsorship. */
export interface TxExecutor {
  sendTransaction(args: { to: Address; data: Hex; value?: bigint }): Promise<Hash>;
}

/** Claim every revenue stream that flows up to `ancestorIpId` from its derivative children.
 *  Defaults to LAP + WIP — the policy/currency Hatch uses for every signal we register.
 *  Auto-unwrap returns IP (native) instead of WIP; auto-transfer pulls from the IP Account
 *  to the calling wallet when it owns the ancestor.
 *
 *  Note: `txExecutor` (sponsored submission) is **not** supported here — Story SDK 1.4.4
 *  models `claimAllRevenue` as a multi-tx workflow (claim → transfer-from-IP → unwrap)
 *  without an encoded-tx path. The StoryClient submits all sub-txs through its bound
 *  wallet directly. For Privy email-login users, the bound wallet is Privy's embedded
 *  wallet — they still don't need MetaMask, but the txs are not paymaster-sponsored. */
export async function claimAllRevenue(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  ancestorIpId: Address;
  claimer: Address;
  childIpIds: Address[];
  royaltyPolicies?: Address[];
  currencyTokens?: Address[];
  autoTransfer?: boolean;
  autoUnwrap?: boolean;
}): Promise<{ txHashes: Hash[]; receipt: TransactionReceipt; claimed: Array<{ token: Address; claimer: Address; amount: bigint }> }> {
  const policies = args.royaltyPolicies ?? args.childIpIds.map(() => args.config.chain.royaltyPolicyLap);
  if (policies.length !== args.childIpIds.length) {
    throw new Error(`royaltyPolicies.length (${policies.length}) must equal childIpIds.length (${args.childIpIds.length})`);
  }
  const currencies = args.currencyTokens ?? [args.config.chain.wip];

  const r = await args.storyClient.royalty.claimAllRevenue({
    ancestorIpId: args.ancestorIpId,
    claimer: args.claimer,
    childIpIds: args.childIpIds,
    royaltyPolicies: policies,
    currencyTokens: currencies,
    claimOptions: {
      autoTransferAllClaimedTokensFromIp: args.autoTransfer ?? true,
      autoUnwrapIpTokens: args.autoUnwrap ?? true,
    },
  });

  const claimed = r.claimedTokens.map((c) => ({ token: c.token, claimer: c.claimer, amount: c.amount }));
  return { txHashes: r.txHashes, receipt: r.receipt, claimed };
}

/** Tip / pay royalties to an IP. Anyone can call; flow propagates up the IP graph via LAP.
 *  `txExecutor` (Phase B): sponsored submission path — encodes the tx and sends via the
 *  executor (Privy smart wallet, etc.) instead of the StoryClient's bound wallet. */
export async function payRoyaltyOnBehalf(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  receiverIpId: Address;
  payerIpId?: Address;
  amountWip: bigint;
  token?: Address;
  txExecutor?: TxExecutor;
}): Promise<{ txHash: Hash }> {
  if (args.txExecutor) {
    const encoded = await args.storyClient.royalty.payRoyaltyOnBehalf({
      receiverIpId: args.receiverIpId,
      payerIpId: args.payerIpId ?? zeroAddress,
      token: args.token ?? args.config.chain.wip,
      amount: args.amountWip,
      txOptions: { encodedTxDataOnly: true },
    });
    if (!encoded.encodedTxData) throw new Error("payRoyaltyOnBehalf: encodedTxData missing in executor mode");
    const hash = await args.txExecutor.sendTransaction({
      to: encoded.encodedTxData.to,
      data: encoded.encodedTxData.data,
    });
    return { txHash: hash };
  }

  const r = await args.storyClient.royalty.payRoyaltyOnBehalf({
    receiverIpId: args.receiverIpId,
    payerIpId: args.payerIpId ?? zeroAddress,
    token: args.token ?? args.config.chain.wip,
    amount: args.amountWip,
  });
  if (!r.txHash) throw new Error("payRoyaltyOnBehalf: missing txHash in response");
  return { txHash: r.txHash };
}

/** Read claimable amount (does not transact). Backend uses this for the
 *  publisher's "available to claim" banner. */
export async function getClaimableRevenue(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  ipId: Address;
  claimer: Address;
  token?: Address;
}): Promise<bigint> {
  return args.storyClient.royalty.claimableRevenue({
    ipId: args.ipId,
    claimer: args.claimer,
    token: args.token ?? args.config.chain.wip,
  });
}
