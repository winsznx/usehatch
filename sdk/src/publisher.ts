import type { Account, PublicClient, WalletClient } from "viem";
import { parseEther } from "viem";
import { PILFlavor, StoryClient } from "@story-protocol/core-sdk";
import type { HatchConfig } from "./config.js";
import type { PublisherDescriptor } from "./types.js";

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
  const subTerms = PILFlavor.commercialRemix({
    defaultMintingFee: subscription.mintingFeeWip,
    currency: config.chain.wip,
    commercialRevShare: subscription.commercialRevSharePct,
    royaltyPolicy: config.chain.royaltyPolicyLap,
  });

  const reg = await storyClient.ipAsset.mintAndRegisterIpAssetWithPilTerms({
    spgNftContract,
    licenseTermsData: [{ terms: subTerms }],
    ipMetadata: { ipMetadataURI: "", nftMetadataURI: "" },
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

/** Helper: subscriber-side, wrap native IP to WIP. Used by the round-trip test
 *  before staking or paying minting fees in WIP. */
export async function wrapNativeToWip(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account; amount: bigint;
}): Promise<`0x${string}`> {
  const WIP_DEPOSIT_ABI = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const;
  const sim = await args.publicClient.simulateContract({
    address: args.config.chain.wip, abi: WIP_DEPOSIT_ABI, functionName: "deposit",
    args: [], account: args.account, value: args.amount,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

// keep parseEther accessible to consumers of this module
export { parseEther };
