import type { Account, PublicClient, WalletClient } from "viem";
import { parseEther } from "viem";
import { StoryClient } from "@story-protocol/core-sdk";
import type { HatchConfig } from "./config.js";
import type { PublisherDescriptor } from "./types.js";
import { type IpaMetadataInput, uploadIpaMetadata } from "./ipa-metadata.js";
import { type PilFlavorName, pickPilTerms } from "./pil.js";

const REGISTRY_ABI = [
  { type: "function", name: "registerPublisher", stateMutability: "nonpayable", inputs: [{ name: "rootIp", type: "address" }], outputs: [] },
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "getPublisher", stateMutability: "view",
    inputs: [{ name: "p", type: "address" }],
    outputs: [
      { name: "rootIp", type: "address" }, { name: "stake", type: "uint256" },
      { name: "verified", type: "bool" }, { name: "lastSlashAt", type: "uint64" },
    ] },
  { type: "function", name: "isVerified", stateMutability: "view", inputs: [{ name: "p", type: "address" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

export async function createPublisher(args: {
  config: HatchConfig;
  publicClient: PublicClient;
  walletClient: WalletClient;
  storyClient: StoryClient;
  account: Account;
  collection: { name: string; symbol: string };
  subscription: { mintingFeeWip: bigint; commercialRevSharePct: number };
  /** Optional: reuse an existing SPG NFT contract instead of creating a new one.
   *  Defaults to Story's public collection (0xc32A8a0FF3beDDDa58393d022aF433e78739FAbc on Aeneid)
   *  when the per-publisher createCollection path is blocked (Aeneid 2026-05-29 regression). */
  spgNftContract?: `0x${string}`;
  /** PIL flavor for the subscription tier. Defaults to `commercialRemix` (the only flavor
   *  that supports subscription minting fees with a positive revShare). */
  pilFlavor?: PilFlavorName;
  /** IPA metadata; when provided, JSON is built + hashed + uploaded to `config.storage`
   *  and the URIs/hashes are passed to Story's mintAndRegisterIpAssetWithPilTerms. */
  metadata?: IpaMetadataInput;
  publicMetadataUrlBase?: string;
}): Promise<PublisherDescriptor> {
  const { config, publicClient, walletClient, storyClient, account, collection, subscription } = args;

  // 1. SPG NFT collection — reuse if provided, else create new.
  // Aeneid's `createCollection` started reverting on `eth_estimateGas` 2026-05-29 morning while
  // `eth_call` still succeeds — chain-side regression. Passing an existing spgNftContract bypasses
  // this; Story's public collection 0xc32A8a0FF3beDDDa58393d022aF433e78739FAbc accepts any minter.
  let spgNftContract: `0x${string}`;
  if (args.spgNftContract) {
    spgNftContract = args.spgNftContract;
  } else {
    // mintFeeRecipient must be non-zero (newer SPG workflows reject zero address even with mintFee=0).
    const coll = await storyClient.nftClient.createNFTCollection({
      name: collection.name, symbol: collection.symbol, isPublicMinting: true, mintOpen: true,
      mintFeeRecipient: account.address, contractURI: "",
    });
    spgNftContract = coll.spgNftContract!;
  }

  // 2. Subscription-tier PIL terms attached to the publisher's root IP.
  const subTerms = pickPilTerms(args.pilFlavor ?? "commercialRemix", {
    defaultMintingFee: subscription.mintingFeeWip,
    currency: config.chain.wip,
    commercialRevSharePct: subscription.commercialRevSharePct,
    royaltyPolicy: config.chain.royaltyPolicyLap,
  });

  const ipMetadata = args.metadata
    ? await uploadIpaMetadata({
        storage: config.storage,
        metadata: args.metadata,
        publicUrlBase: args.publicMetadataUrlBase,
      })
    : { ipMetadataURI: "", nftMetadataURI: "" };

  const reg = await storyClient.ipAsset.mintAndRegisterIpAssetWithPilTerms({
    spgNftContract,
    licenseTermsData: [{ terms: subTerms }],
    ipMetadata,
  });
  const publisherRootIpId = reg.ipId!;
  const subscriptionTermsId = BigInt(reg.licenseTermsIds![0]);

  // 3. Register in HatchPublisherRegistry (IIPAccount.owner() check enforces caller controls the root).
  const { request } = await publicClient.simulateContract({
    address: config.hatch.publisherRegistry, abi: REGISTRY_ABI,
    functionName: "registerPublisher", args: [publisherRootIpId], account,
  });
  const registryTxHash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: registryTxHash });

  return {
    publisher: account.address, publisherRootIpId, spgNftContract,
    subscriptionTermsId, registryTxHash,
  };
}

/** Stake WIP into the registry. Caller must hold WIP and pre-approve the registry. */
export async function stake(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account; amount: bigint;
}): Promise<{ approveTx?: `0x${string}`; stakeTx: `0x${string}` }> {
  const { config, publicClient, walletClient, account, amount } = args;
  // Approve WIP to registry
  const a = await publicClient.simulateContract({
    address: config.chain.wip, abi: ERC20_ABI, functionName: "approve",
    args: [config.hatch.publisherRegistry, amount], account,
  });
  const approveTx = await walletClient.writeContract(a.request);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const s = await publicClient.simulateContract({
    address: config.hatch.publisherRegistry, abi: REGISTRY_ABI, functionName: "stake", args: [amount], account,
  });
  const stakeTx = await walletClient.writeContract(s.request);
  await publicClient.waitForTransactionReceipt({ hash: stakeTx });
  return { approveTx, stakeTx };
}

export async function unstake(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account; amount: bigint;
}): Promise<`0x${string}`> {
  const { request } = await args.publicClient.simulateContract({
    address: args.config.hatch.publisherRegistry, abi: REGISTRY_ABI,
    functionName: "unstake", args: [args.amount], account: args.account,
  });
  const tx = await args.walletClient.writeContract(request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

export async function getPublisher(args: {
  config: HatchConfig; publicClient: PublicClient; publisher: `0x${string}`;
}): Promise<{ rootIp: `0x${string}`; stake: bigint; verified: boolean; lastSlashAt: bigint }> {
  const out = await args.publicClient.readContract({
    address: args.config.hatch.publisherRegistry, abi: REGISTRY_ABI, functionName: "getPublisher", args: [args.publisher],
  });
  return { rootIp: out[0], stake: out[1], verified: out[2], lastSlashAt: out[3] };
}

const WIP_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

/** Wrap native IP → WIP (deposit). Same call across testnet + mainnet (WIP address is identical). */
export async function wrapNativeToWip(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account; amount: bigint;
}): Promise<`0x${string}`> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.chain.wip, abi: WIP_ABI, functionName: "deposit",
    args: [], account: args.account, value: args.amount,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

/** Unwrap WIP → native IP. Mirror of `wrapNativeToWip`. */
export async function unwrapWipToNative(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account; amount: bigint;
}): Promise<`0x${string}`> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.chain.wip, abi: WIP_ABI, functionName: "withdraw",
    args: [args.amount], account: args.account,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

/** ERC-20 approve on the WIP token. Used before flows that pull WIP (subscribe minting fee,
 *  registry stake, royalty payRoyaltyOnBehalf when called through periphery contracts). */
export async function approveWip(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account;
  spender: `0x${string}`; amount: bigint;
}): Promise<`0x${string}`> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.chain.wip, abi: WIP_ABI, functionName: "approve",
    args: [args.spender, args.amount], account: args.account,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

/** Read WIP balance for an address. View call — no signing required. */
export async function getWipBalance(args: {
  config: HatchConfig; publicClient: PublicClient; owner: `0x${string}`;
}): Promise<bigint> {
  return args.publicClient.readContract({
    address: args.config.chain.wip, abi: WIP_ABI, functionName: "balanceOf", args: [args.owner],
  });
}

/** Read WIP allowance: how much `spender` can pull from `owner`. */
export async function getWipAllowance(args: {
  config: HatchConfig; publicClient: PublicClient; owner: `0x${string}`; spender: `0x${string}`;
}): Promise<bigint> {
  return args.publicClient.readContract({
    address: args.config.chain.wip, abi: WIP_ABI, functionName: "allowance", args: [args.owner, args.spender],
  });
}

// keep parseEther accessible to consumers of this module
export { parseEther };
