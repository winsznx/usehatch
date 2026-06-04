import type { Address } from "viem";
import { toHex } from "viem";
import type { HatchStorage } from "./storage.js";

export interface IpaCreator {
  name: string;
  address: Address;
  contributionPercent: number;
  socialMedia?: Array<{ platform: string; url: string }>;
}

export interface IpaMetadataInput {
  title: string;
  description: string;
  image?: string;
  imageHash?: `0x${string}`;
  mediaUrl?: string;
  mediaHash?: `0x${string}`;
  mediaType?: string;
  creators?: IpaCreator[];
}

export interface UploadedMetadata {
  ipMetadataURI: string;
  ipMetadataHash: `0x${string}`;
  nftMetadataURI: string;
  nftMetadataHash: `0x${string}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<`0x${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

function buildIpJson(input: IpaMetadataInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    createdAt: Math.floor(Date.now() / 1000).toString(),
  };
  if (input.image) out.image = input.image;
  if (input.imageHash) out.imageHash = input.imageHash;
  if (input.mediaUrl) out.mediaUrl = input.mediaUrl;
  if (input.mediaHash) out.mediaHash = input.mediaHash;
  if (input.mediaType) out.mediaType = input.mediaType;
  if (input.creators?.length) out.creators = input.creators;
  return out;
}

function buildNftJson(input: IpaMetadataInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: input.title,
    description: input.description,
  };
  if (input.image) out.image = input.image;
  const attributes: Array<{ trait_type: string; value: string }> = [];
  if (input.mediaType) attributes.push({ trait_type: "Media Type", value: input.mediaType });
  if (input.creators?.length) {
    attributes.push({ trait_type: "Creator", value: input.creators[0].name });
  }
  if (attributes.length) out.attributes = attributes;
  return out;
}

/** Build, hash, and upload Story-compliant IPA + NFT metadata JSON.
 *  Returns URIs (resolvable URLs if `publicUrlBase` is set; otherwise the raw storage CID)
 *  and SHA-256 hashes the caller passes to `mintAndRegisterIpAssetWithPilTerms` /
 *  `mintAndRegisterIpAndMakeDerivative`.
 *
 *  See https://docs.story.foundation/concepts/ip-asset/ipa-metadata-standard for the
 *  required fields per use case. */
export async function uploadIpaMetadata(args: {
  storage: HatchStorage;
  metadata: IpaMetadataInput;
  /** If set, returned URIs are `${publicUrlBase}/${cid}`. If unset, the raw CID is
   *  returned — callers that route through their own metadata endpoint can prepend
   *  the base themselves. */
  publicUrlBase?: string;
}): Promise<UploadedMetadata> {
  const enc = new TextEncoder();
  const ipBytes = enc.encode(JSON.stringify(buildIpJson(args.metadata)));
  const nftBytes = enc.encode(JSON.stringify(buildNftJson(args.metadata)));

  const [ipCid, nftCid] = await Promise.all([
    args.storage.upload(ipBytes),
    args.storage.upload(nftBytes),
  ]);
  const [ipHash, nftHash] = await Promise.all([sha256Hex(ipBytes), sha256Hex(nftBytes)]);

  const join = (cid: string) => args.publicUrlBase ? `${args.publicUrlBase.replace(/\/$/, "")}/${cid}` : cid;
  return {
    ipMetadataURI: join(ipCid),
    ipMetadataHash: ipHash,
    nftMetadataURI: join(nftCid),
    nftMetadataHash: nftHash,
  };
}
