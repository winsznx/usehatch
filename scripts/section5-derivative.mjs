import { PILFlavor } from "@story-protocol/core-sdk";
import { parseEther, formatEther, erc20Abi } from "viem";
import { writeFileSync } from "node:fs";
import { publicClient, storyClient, addr, WIP, ADDR } from "./lib.mjs";

const log = (...a) => console.log(...a);
const pub = storyClient("PUBLISHER");
const sub = storyClient("SUBSCRIBER");
const wip = (w) => publicClient.readContract({ address: WIP, abi: erc20Abi, functionName: "balanceOf", args: [w] });
const vaultOf = (ip) => pub.royalty.getRoyaltyVaultAddress(ip);
const vaultWip = async (ip) => { const v = await vaultOf(ip); return { v, bal: v && v !== "0x0000000000000000000000000000000000000000" ? await wip(v) : 0n }; };

const coll = await pub.nftClient.createNFTCollection({
  name: "Hatch IP Graph", symbol: "HATCHG", isPublicMinting: true, mintOpen: true,
  mintFeeRecipient: "0x0000000000000000000000000000000000000000", contractURI: "",
});
const terms = PILFlavor.commercialRemix({ defaultMintingFee: parseEther("0.01"), currency: WIP, commercialRevShare: 10, royaltyPolicy: ADDR.ROYALTY_POLICY_LAP });

// --- Publisher_Root ---
const root = await pub.ipAsset.mintAndRegisterIpAssetWithPilTerms({
  spgNftContract: coll.spgNftContract, licenseTermsData: [{ terms }], ipMetadata: { ipMetadataURI: "", nftMetadataURI: "" },
});
const rootIp = root.ipId, rootTerms = root.licenseTermsIds[0];
log("Publisher_Root:", rootIp, "terms:", rootTerms.toString(), "tx:", root.txHash);

// --- Signal_001 as derivative of Publisher_Root (publisher pays parent license fee = propagation #1) ---
const rootVaultBefore = await vaultWip(rootIp);
const deriv = await pub.ipAsset.mintAndRegisterIpAndMakeDerivative({
  spgNftContract: coll.spgNftContract,
  derivData: { parentIpIds: [rootIp], licenseTermsIds: [rootTerms], maxMintingFee: parseEther("0.1"), maxRts: 100_000_000, maxRevenueShare: 100 },
  ipMetadata: { ipMetadataURI: "", nftMetadataURI: "" },
});
const signalIp = deriv.ipId;
log("Signal_001 (derivative):", signalIp, "tx:", deriv.txHash);
const rootVaultAfterDeriv = await vaultWip(rootIp);
log(`Root vault after derivative reg: ${rootVaultAfterDeriv.v} bal ${formatEther(rootVaultAfterDeriv.bal)} (delta ${formatEther(rootVaultAfterDeriv.bal - rootVaultBefore.bal)} WIP)`);

// --- Subscriber mints a license on Signal_001 (fee -> Signal_001 vault) ---
const signalVaultBefore = await vaultWip(signalIp);
const mint = await sub.license.mintLicenseTokens({
  licensorIpId: signalIp, licenseTermsId: rootTerms, amount: 1, maxMintingFee: parseEther("0.1"), receiver: addr("SUBSCRIBER"),
});
log("license on Signal_001:", mint.licenseTokenIds?.[0]?.toString(), "tx:", mint.txHash);
const signalVaultAfter = await vaultWip(signalIp);
log(`Signal vault after mint: ${signalVaultAfter.v} bal ${formatEther(signalVaultAfter.bal)} (delta ${formatEther(signalVaultAfter.bal - signalVaultBefore.bal)} WIP)`);

// --- Propagate UP: claim Publisher_Root's share of Signal_001 revenue (LAP) ---
const rootVaultBeforeClaim = await vaultWip(rootIp);
let claimTx = null, claimErr = null, claimed = null;
try {
  const res = await pub.royalty.claimAllRevenue({ ancestorIpId: rootIp, claimer: rootIp, childIpIds: [signalIp], currencyTokens: [WIP] });
  claimTx = res.txHashes ?? res.txHash ?? res;
  claimed = res.claimedTokens ?? null;
  log("claimAllRevenue tx:", JSON.stringify(claimTx));
} catch (e) { claimErr = (e?.shortMessage || e?.message || String(e)).slice(0, 180); log("claim err:", claimErr); }
const rootVaultAfterClaim = await vaultWip(rootIp);
log(`Root vault after claim: bal ${formatEther(rootVaultAfterClaim.bal)} (delta from pre-claim ${formatEther(rootVaultAfterClaim.bal - rootVaultBeforeClaim.bal)} WIP)`);

writeFileSync(new URL("../.section5-derivative.json", import.meta.url), JSON.stringify({
  spgNftContract: coll.spgNftContract, rootIp, rootTerms: rootTerms.toString(), signalIp,
  rootVault: rootVaultAfterClaim.v, signalVault: signalVaultAfter.v,
  rootVaultAfterDerivReg: formatEther(rootVaultAfterDeriv.bal),
  derivRegPropagationDelta: formatEther(rootVaultAfterDeriv.bal - rootVaultBefore.bal),
  signalVaultAfterMint: formatEther(signalVaultAfter.bal),
  signalMintDelta: formatEther(signalVaultAfter.bal - signalVaultBefore.bal),
  rootVaultClaimDelta: formatEther(rootVaultAfterClaim.bal - rootVaultBeforeClaim.bal),
  rootVaultFinal: formatEther(rootVaultAfterClaim.bal),
  txHashes: { collection: coll.txHash, root: root.txHash, derivative: deriv.txHash, mint: mint.txHash, claim: claimTx },
  claimErr,
}, null, 2));
log("\nstate -> .section5-derivative.json");
