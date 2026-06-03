/* Browser-safe Hatch SDK surface.
 *
 * @usehatch/sdk ships with server-only modules (Node fs, vault key material,
 * RPC signer helpers) that must NEVER reach the client bundle. This module
 * is the single import path for client code; it re-exports only the
 * browser-safe subset and adds wagmi-bound write helpers (Phase 5).
 *
 * Until @usehatch/sdk publishes browser-conditional exports, this file holds
 * thin viem-based reads against the on-chain entities. The real read paths
 * already live in lib/api.ts (backend-indexed); these are escape hatches when
 * we need direct chain confirmation (e.g. license verification post-buy). */
import { createPublicClient, http } from "viem";
import type { Address } from "viem";

import { config } from "./config.js";
import { storyAeneid } from "./wagmi.js";

export const publicClient = createPublicClient({
  chain: storyAeneid,
  transport: http(config.rpcUrl),
});

export const contracts = config.contracts;

export type HatchUuid = number;

export interface SubscribePrep {
  to: Address;
  data: `0x${string}`;
  value: bigint;
}

export interface BuyHatchPrep extends SubscribePrep {
  uuid: HatchUuid;
}

/* Phase 5 will populate prepSubscribe / prepBuyHatch / prepCreateHatch from
 * @usehatch/sdk once we wire wagmi's useWriteContract through them. The
 * write surface is intentionally not exposed here yet — it would tempt
 * components to bypass the wagmi flow. */
