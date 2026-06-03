import type { Account, PublicClient, WalletClient, Address } from "viem";
import { parseEther } from "viem";
import type { StoryClient } from "@story-protocol/core-sdk";
import type { HatchConfig } from "./config.js";

const PASS_MINT_ABI = [{
  type: "function", name: "mint", stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" }, { name: "publisherRoot_", type: "address" },
    { name: "subLicenseTokenId_", type: "uint256" }, { name: "duration", type: "uint64" },
    { name: "subPriceWei_", type: "uint256" },
  ],
  outputs: [{ name: "tokenId", type: "uint256" }],
}] as const;

/** Buy one per-hatch license. Fee → signal's royalty vault; LAP propagates the
 *  publisher-root's share automatically (claim is a separate registry-level flow). */
export async function buyHatch(args: {
  storyClient: StoryClient;
  signalIpId: Address;
  perHatchTermsId: bigint;
  receiver: Address;
  maxMintingFee?: bigint;
}): Promise<{ licenseTokenId: bigint; txHash: `0x${string}` }> {
  const mint = await args.storyClient.license.mintLicenseTokens({
    licensorIpId: args.signalIpId, licenseTermsId: args.perHatchTermsId,
    amount: 1, maxMintingFee: args.maxMintingFee ?? parseEther("1"),
    receiver: args.receiver,
  });
  return { licenseTokenId: BigInt(mint.licenseTokenIds![0]), txHash: mint.txHash! };
}

/** Subscribe: mint a sub License Token from the publisher root, then mint a
 *  paired HatchSubscriptionPass. `mintPass` is the address authorized to mint
 *  passes (Pass.minter — owner/manager of the Pass contract). */
export async function subscribe(args: {
  config: HatchConfig;
  publicClient: PublicClient;
  walletClient: WalletClient;        // the publisher / minter (calls Pass.mint)
  storyClient: StoryClient;          // the subscriber's StoryClient (mints the License)
  minterAccount: Account;            // wallet of Pass.minter (publisher)
  subscriber: Address;
  publisherRootIpId: Address;
  subscriptionTermsId: bigint;
  durationDays: number;
  subPriceWip: bigint;               // canonical sub price (basis for transfer fee)
}): Promise<{ subLicenseTokenId: bigint; passId: bigint; mintLicenseTx: `0x${string}`; mintPassTx: `0x${string}` }> {
  // (a) subscriber mints sub License Token from the root
  const lic = await args.storyClient.license.mintLicenseTokens({
    licensorIpId: args.publisherRootIpId, licenseTermsId: args.subscriptionTermsId,
    amount: 1, maxMintingFee: parseEther("1"),
    receiver: args.subscriber,
  });
  const subLicenseTokenId = BigInt(lic.licenseTokenIds![0]);

  // (b) Pass.minter mints the paired pass to the subscriber
  const duration = BigInt(args.durationDays) * 24n * 3600n;
  const sim = await args.publicClient.simulateContract({
    address: args.config.hatch.subscriptionPass, abi: PASS_MINT_ABI, functionName: "mint",
    args: [args.subscriber, args.publisherRootIpId, subLicenseTokenId, duration, args.subPriceWip],
    account: args.minterAccount,
  });
  const mintPassTx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: mintPassTx });

  return { subLicenseTokenId, passId: sim.result, mintLicenseTx: lic.txHash!, mintPassTx };
}
