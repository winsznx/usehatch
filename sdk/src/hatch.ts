import { CDRClient, uuidToLabel } from "@piplabs/cdr-sdk";
import { ensureWasm } from "./crypto.js";
import { PILFlavor, type StoryClient } from "@story-protocol/core-sdk";
import { encodeAbiParameters, parseEther, toHex } from "viem";
import type { Account, PublicClient, WalletClient } from "viem";
import type { HatchConfig } from "./config.js";
import type { HatchDescriptor, HatchMode, OutcomeSpec } from "./types.js";
import { buildManifest, type MediaInput } from "./manifest.js";

/** Encode HatchCondition v2.1 conditionData. Critical: per Day-0 canon the slot
 *  ordering is (mode, ipId, publisherRoot, embargoStart, revealAt). The LicenseToken
 *  and Pass are immutables on the contract and are NOT encoded here. */
function encodeConditionData(args: {
  mode: HatchMode; signalIpId: `0x${string}`; publisherRootIpId: `0x${string}`;
  embargoStart: bigint; revealAt: bigint;
}): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint64" }],
    [args.mode, args.signalIpId, args.publisherRootIpId, args.embargoStart, args.revealAt],
  );
}

/** Owner-write conditionData = abi.encode(address owner). */
function encodeOwnerWriteData(owner: `0x${string}`): `0x${string}` {
  return encodeAbiParameters([{ type: "address" }], [owner]);
}

export async function createHatch(args: {
  config: HatchConfig;
  publicClient: PublicClient;
  walletClient: WalletClient;
  storyClient: StoryClient;
  account: Account;
  publisherRootIpId: `0x${string}`;
  spgNftContract: `0x${string}`;
  subscriptionTermsId: bigint;     // root's subscription tier (for inheriting via derivative)
  content: { text: string; media: MediaInput[] };
  mode: HatchMode;
  perHatchPriceWip: bigint;        // 0 for subscription-only
  perHatchRevSharePct?: number;    // default 10
  embargoStart: bigint;
  revealAt: bigint;
  outcomeSpec?: OutcomeSpec;
}): Promise<HatchDescriptor & { txHashes: { collection?: string; derivative: string; allocate: string; write: string } }> {
  const { config, publicClient, walletClient, storyClient, account } = args;
  await ensureWasm();

  // 1. Register the signal as a derivative of the publisher root, attaching per-hatch PIL terms.
  //    We use mintAndRegisterIpAndMakeDerivative + ipAsset.registerPilTermsAndAttach in two steps for clarity.
  const deriv = await storyClient.ipAsset.mintAndRegisterIpAndMakeDerivative({
    spgNftContract: args.spgNftContract,
    derivData: {
      parentIpIds: [args.publisherRootIpId],
      licenseTermsIds: [args.subscriptionTermsId],
      maxMintingFee: parseEther("0.1"),
      maxRts: 100_000_000,
      maxRevenueShare: 100,
    },
    ipMetadata: { ipMetadataURI: "", nftMetadataURI: "" },
  });
  const signalIpId = deriv.ipId!;

  // Per-hatch terms (commercial-remix with custom mintingFee). Attach to the signal.
  const perHatchTerms = PILFlavor.commercialRemix({
    defaultMintingFee: args.perHatchPriceWip,
    currency: config.chain.wip,
    commercialRevShare: args.perHatchRevSharePct ?? 10,
    royaltyPolicy: config.chain.royaltyPolicyLap,
  });
  const attach = await storyClient.license.registerPilTermsAndAttach({
    ipId: signalIpId, licenseTermsData: [{ terms: perHatchTerms }],
  });
  const perHatchTermsId = BigInt(attach.licenseTermsIds![0]);

  // 2. Build manifest (encrypts + uploads media) and produce ≤1024-byte JSON bytes
  //    that we pass to the CDR vault as the dataKey.
  const { manifestBytes } = await buildManifest({
    storage: config.storage, text: args.content.text, media: args.content.media,
  });

  // 3. CDR vault: allocate(skipConditionValidation:true) + encryptDataKey(manifest) + write.
  const cdr = new CDRClient({
    network: "testnet", publicClient, walletClient, apiUrl: config.chain.storyApiUrl,
  });

  const conditionData = encodeConditionData({
    mode: args.mode, signalIpId, publisherRootIpId: args.publisherRootIpId,
    embargoStart: args.embargoStart, revealAt: args.revealAt,
  });

  const alloc = await cdr.uploader.allocate({
    updatable: false,
    writeConditionAddr: config.hatch.hatchCondition,
    writeConditionData: encodeOwnerWriteData(account.address),
    readConditionAddr: config.hatch.hatchCondition,
    readConditionData: conditionData,
    skipConditionValidation: true,
  });

  const ct = await cdr.uploader.encryptDataKey({ dataKey: manifestBytes, label: uuidToLabel(alloc.uuid) });
  const write = await cdr.uploader.write({ uuid: alloc.uuid, accessAuxData: "0x", encryptedData: toHex(ct.raw) });

  return {
    uuid: alloc.uuid, signalIpId, perHatchTermsId, publisherRootIpId: args.publisherRootIpId,
    mode: args.mode, embargoStart: args.embargoStart, revealAt: args.revealAt,
    outcomeSpec: args.outcomeSpec,
    txHashes: { derivative: deriv.txHash!, allocate: alloc.txHash, write: write.txHash },
  };
}

/** Read raw vault metadata (does not decrypt). Useful for indexers / UI cards. */
export async function getHatch(args: {
  config: HatchConfig; publicClient: PublicClient; uuid: number;
}): Promise<{ uuid: number; readConditionData: `0x${string}`; encryptedData: `0x${string}` }> {
  const cdr = new CDRClient({
    network: "testnet", publicClient: args.publicClient, apiUrl: args.config.chain.storyApiUrl,
  });
  const v = await cdr.observer.getVault(args.uuid);
  return { uuid: args.uuid, readConditionData: v.readConditionData, encryptedData: v.encryptedData };
}

export { encodeConditionData, encodeOwnerWriteData };
