import type { Address } from "viem";
import { PILFlavor, type LicenseTerms } from "@story-protocol/core-sdk";

export type PilFlavorName =
  | "commercialRemix"
  | "commercialUse"
  | "nonCommercialSocialRemixing"
  | "creativeCommonsAttribution";

export interface PilFlavorInput {
  defaultMintingFee: bigint;
  currency: Address;
  commercialRevSharePct: number;
  royaltyPolicy: Address;
}

/** Build PIL terms for a given flavor. Inputs that don't apply to a flavor are
 *  silently ignored (e.g. `defaultMintingFee` for `nonCommercialSocialRemixing`).
 *
 *  Note: `nonCommercialSocialRemixing` is pre-registered globally on Story as
 *  `licenseTermsId = 1`. Callers that pick this flavor can skip the per-IP
 *  attach step and reference id `1n` directly — building terms here returns
 *  the canonical struct for parity. */
export function pickPilTerms(flavor: PilFlavorName, input: PilFlavorInput): LicenseTerms {
  switch (flavor) {
    case "commercialRemix":
      return PILFlavor.commercialRemix({
        defaultMintingFee: input.defaultMintingFee,
        currency: input.currency,
        commercialRevShare: input.commercialRevSharePct,
        royaltyPolicy: input.royaltyPolicy,
      });
    case "commercialUse":
      return PILFlavor.commercialUse({
        defaultMintingFee: input.defaultMintingFee,
        currency: input.currency,
        royaltyPolicy: input.royaltyPolicy,
      });
    case "nonCommercialSocialRemixing":
      return PILFlavor.nonCommercialSocialRemixing();
    case "creativeCommonsAttribution":
      return PILFlavor.creativeCommonsAttribution({
        currency: input.currency,
        royaltyPolicy: input.royaltyPolicy,
      });
  }
}

/** Global pre-registered Story PIL terms id for nonCommercialSocialRemixing. */
export const NON_COMMERCIAL_SOCIAL_REMIXING_TERMS_ID = 1n;
