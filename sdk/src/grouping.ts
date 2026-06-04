import type { Address, Hash } from "viem";
import type { StoryClient } from "@story-protocol/core-sdk";
import { PILFlavor } from "@story-protocol/core-sdk";
import type { HatchConfig } from "./config.js";

/** Register a Group IPA + attach license terms in one logical flow.
 *
 *  The group's reward pool defaults to Story's EvenSplitGroupPool which
 *  distributes collected royalties evenly across all members.
 *
 *  Critical constraint (Story docs): GroupingModule rejects LAP royalty policy.
 *  We force LRP via `config.chain.royaltyPolicyLrp` regardless of caller input.
 *  Every hatch added to this group must also use LRP — pass the same
 *  `mintingFeeWip` / `commercialRevSharePct` values to `createHatch` and the
 *  Story SDK's terms dedup will resolve them to the same termsId. */
export async function createGroup(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  /** Optional override; defaults to EvenSplitGroupPool. */
  groupPool?: Address;
  /** Subscription-style PIL terms attached to the group itself. */
  license: {
    mintingFeeWip: bigint;
    commercialRevSharePct: number;     // 0-100
  };
}): Promise<{ groupId: Address; licenseTermsId: bigint; txHashes: { registerTerms?: Hash; registerGroup: Hash } }> {
  const pool = args.groupPool ?? args.config.chain.evenSplitGroupPool;
  const terms = PILFlavor.commercialRemix({
    defaultMintingFee: args.license.mintingFeeWip,
    currency: args.config.chain.wip,
    commercialRevShare: args.license.commercialRevSharePct,
    royaltyPolicy: args.config.chain.royaltyPolicyLrp,
  });

  // 1. Register the PIL terms standalone so the group + every member can
  //    reference the same `licenseTermsId`. Story SDK dedupes identical terms.
  const t = await args.storyClient.license.registerPILTerms(terms);
  if (!t.licenseTermsId) throw new Error("createGroup: registerPILTerms missing licenseTermsId");

  // 2. Register the Group + attach the terms.
  const g = await args.storyClient.groupClient.registerGroupAndAttachLicense({
    groupPool: pool,
    licenseData: { licenseTermsId: t.licenseTermsId },
  });
  if (!g.txHash || !g.groupId) throw new Error("createGroup: missing txHash or groupId");

  return {
    groupId: g.groupId,
    licenseTermsId: t.licenseTermsId,
    txHashes: { registerTerms: t.txHash, registerGroup: g.txHash },
  };
}

/** Add existing IPs to a group. The caller must own the group. Members must
 *  have license terms compatible with the group (same LRP, same minting fee,
 *  same rev-share) — Story's terms dedup ensures the ids match if the inputs do.
 *
 *  Hard limits: 1000 members max; once a derivative of the group exists, only
 *  additions are allowed (removals blocked). */
export async function addToGroup(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  groupId: Address;
  ipIds: Address[];
  /** Per-member maximum reward share. Default 100 (no cap). */
  maxAllowedRewardSharePct?: number;
}): Promise<{ txHash: Hash }> {
  if (args.ipIds.length === 0) throw new Error("addToGroup: ipIds is empty");
  if (args.ipIds.length > GROUP_MEMBER_CAP) throw new Error(`addToGroup: group member cap is ${GROUP_MEMBER_CAP}`);
  const r = await args.storyClient.groupClient.addIpsToGroup({
    groupIpId: args.groupId,
    ipIds: args.ipIds,
    maxAllowedRewardSharePercentage: args.maxAllowedRewardSharePct ?? 100,
  });
  if (!r.txHash) throw new Error("addToGroup: missing txHash in response");
  return { txHash: r.txHash };
}

/** Remove members from a group. Owner-only. Blocked by the protocol once any
 *  derivative of the group exists. */
export async function removeFromGroup(args: {
  config: HatchConfig;
  storyClient: StoryClient;
  groupId: Address;
  ipIds: Address[];
}): Promise<{ txHash: Hash }> {
  const r = await args.storyClient.groupClient.removeIpsFromGroup({
    groupIpId: args.groupId,
    ipIds: args.ipIds,
  });
  if (!r.txHash) throw new Error("removeFromGroup: missing txHash in response");
  return { txHash: r.txHash };
}

/** Hard limit per Story docs. Surface as a constant so frontend can cap row
 *  counts and disable "Add another" past it. */
export const GROUP_MEMBER_CAP = 1000;
