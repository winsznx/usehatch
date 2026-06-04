import type { Address, Hash } from "viem";
import type { StoryClient } from "@story-protocol/core-sdk";
import { AccessPermission } from "@story-protocol/core-sdk";

/** Editor delegation scopes mapped to AccessController permissions.
 *
 *  - `all`    — delegate may call ANY function on ANY module on behalf of the IP
 *               (calls `setAllPermissions` with ALLOW). Highest trust level.
 *  - `none`   — revoke (clears the delegate; calls `setAllPermissions` with DENY).
 *  - `abstain`— resets to default (`ABSTAIN`). Permission falls back to upstream
 *               rules (typically the IP owner's wallet retains full access).
 *
 *  A "seal-only" scope would call `setPermission` scoped to LicensingModule +
 *  ipAsset module function selectors — left for a follow-up because the precise
 *  selector set depends on which Hatch flows you want the delegate to invoke. */
export type DelegateScope = "all" | "none" | "abstain";

const SCOPE_TO_PERMISSION: Record<DelegateScope, AccessPermission> = {
  all: AccessPermission.ALLOW,
  none: AccessPermission.DENY,
  abstain: AccessPermission.ABSTAIN,
};

/** Grant, revoke, or reset an editor wallet's permission to act on behalf of
 *  an IP. This is the canonical "add a team member" flow without sharing your
 *  signing key.
 *
 *  Permissions revoke automatically on IP ownership transfer — Story's
 *  AccessController checks the current owner at each call, so if you later
 *  transfer the publisher root to a new wallet, all delegates clear. */
export async function setDelegate(args: {
  storyClient: StoryClient;
  /** The IP being delegated (typically a publisher root or a signal IP). */
  ipId: Address;
  /** The wallet receiving the delegated permission. */
  signer: Address;
  scope: DelegateScope;
}): Promise<{ txHash: Hash }> {
  const r = await args.storyClient.permission.setAllPermissions({
    ipId: args.ipId,
    signer: args.signer,
    permission: SCOPE_TO_PERMISSION[args.scope],
  });
  if (!r.txHash) throw new Error("setDelegate: missing txHash in response");
  return { txHash: r.txHash };
}

/** Lower-level: scope a delegate to a specific module + function selector.
 *  Pass `func: "0x00000000"` to match all functions on `to`. */
export async function setDelegateScoped(args: {
  storyClient: StoryClient;
  ipId: Address;
  signer: Address;
  /** Module the delegate is allowed to call (e.g. LicensingModule address). */
  to: Address;
  /** 4-byte function selector — `0x00000000` allows all functions on `to`. */
  func: `0x${string}`;
  permission: AccessPermission;
}): Promise<{ txHash: Hash }> {
  const r = await args.storyClient.permission.setPermission({
    ipId: args.ipId,
    signer: args.signer,
    to: args.to,
    permission: args.permission,
    func: args.func,
  });
  if (!r.txHash) throw new Error("setDelegateScoped: missing txHash in response");
  return { txHash: r.txHash };
}

/** Re-export Story's AccessPermission enum so callers can build custom scoped
 *  permissions without depending on @story-protocol/core-sdk directly. */
export { AccessPermission } from "@story-protocol/core-sdk";
