import { pad, toHex, type Hex } from "viem";

/** Canonical Hatch hatchId derivation. The HatchOracle's Attestation.hatchId
 *  field is bytes32. We use the *padded uint32 vault uuid* as the canonical id
 *  — deterministic, collision-free, decodable without lookup. Every service
 *  imports from here; NO inline derivation anywhere else.
 *
 *  Examples:
 *    hatchIdFor(4097) === "0x0000000000000000000000000000000000000000000000000000000000001001"
 */
export function hatchIdFor(uuid: number | bigint): Hex {
  return pad(toHex(BigInt(uuid)), { size: 32 });
}

/** Inverse: parse a hatchId back to uuid (returns BigInt; cast to Number for u32). */
export function uuidFromHatchId(hatchId: Hex): number {
  return Number(BigInt(hatchId));
}
