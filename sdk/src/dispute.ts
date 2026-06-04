import type { Address, Hash, Hex } from "viem";
import { type StoryClient } from "@story-protocol/core-sdk";
import { DisputeTargetTag } from "@story-protocol/core-sdk";
import type { HatchConfig } from "./config.js";
import type { TxExecutor } from "./royalty.js";

/** Whitelisted Story Protocol dispute tags. Excludes `IN_DISPUTE` (transient,
 *  internal — protocol sets this automatically during a live dispute). */
export const DISPUTE_TAGS = [
  "IMPROPER_REGISTRATION",
  "IMPROPER_USAGE",
  "IMPROPER_PAYMENT",
  "CONTENT_STANDARDS_VIOLATION",
] as const;
export type DisputeTag = (typeof DISPUTE_TAGS)[number];

/** Default liveness window per Story docs (30 days in seconds). */
export const DISPUTE_DEFAULT_LIVENESS = 30n * 24n * 3600n;

/** Raise a dispute against an IP (publisher root OR signal/hatch IP). Bond is
 *  paid in WIP; the Story SDK auto-wraps from native IP if WIP is short and
 *  auto-approves the DisputeModule (`WipOptions.enableAutoWrapIp` + auto-approve
 *  defaults to true). `evidenceCid` is any storage identifier the verifier can
 *  resolve — IPFS CID or, in our case, our backend `/storage/:cid` path.
 *
 *  Bond is optional; when omitted, Story SDK uses the OOV3 minimum. */
export async function raiseDispute(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  targetIpId: Address;
  tag: DisputeTag;
  evidenceCid: string;
  liveness?: bigint;
  bondWei?: bigint;
  txExecutor?: TxExecutor;
}): Promise<{ disputeId: bigint | null; txHash: Hash }> {
  const liveness = args.liveness ?? DISPUTE_DEFAULT_LIVENESS;

  if (args.txExecutor) {
    const encoded = await args.storyClient.dispute.raiseDispute({
      targetIpId: args.targetIpId,
      cid: args.evidenceCid,
      targetTag: DisputeTargetTag[args.tag],
      liveness,
      bond: args.bondWei,
      txOptions: { encodedTxDataOnly: true },
    });
    if (!encoded.encodedTxData) throw new Error("raiseDispute: encodedTxData missing in executor mode");
    const hash = await args.txExecutor.sendTransaction({
      to: encoded.encodedTxData.to as Address,
      data: encoded.encodedTxData.data as Hex,
    });
    return { disputeId: null, txHash: hash };
  }

  const r = await args.storyClient.dispute.raiseDispute({
    targetIpId: args.targetIpId,
    cid: args.evidenceCid,
    targetTag: DisputeTargetTag[args.tag],
    liveness,
    bond: args.bondWei,
  });
  if (!r.txHash) throw new Error("raiseDispute: missing txHash in response");
  return { disputeId: r.disputeId ?? null, txHash: r.txHash };
}

/** Cancel a dispute you raised before the liveness window closes. */
export async function cancelDispute(args: {
  storyClient: StoryClient;
  disputeId: bigint;
}): Promise<{ txHash: Hash }> {
  const r = await args.storyClient.dispute.cancelDispute({ disputeId: args.disputeId });
  if (!r.txHash) throw new Error("cancelDispute: missing txHash in response");
  return { txHash: r.txHash };
}
