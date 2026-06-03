import { CDRClient, uuidToLabel } from "@piplabs/cdr-sdk";
import { initWasm } from "@piplabs/cdr-crypto";
import { PILFlavor } from "@story-protocol/core-sdk";
import { encodeAbiParameters, parseEther, formatEther, bytesToHex, toHex, erc20Abi } from "viem";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { publicClient, wallet, storyClient, addr, API_URL, WIP, ADDR } from "./lib.mjs";

await initWasm();
const log = (...a) => console.log(...a);
const pubAddr = addr("PUBLISHER");
const subAddr = addr("SUBSCRIBER");

const pubStory = storyClient("PUBLISHER");
const subStory = storyClient("SUBSCRIBER");

const wipBal = (who) => publicClient.readContract({ address: WIP, abi: erc20Abi, functionName: "balanceOf", args: [who] });

// ---------- S3.1 register IP Asset ----------
log("=== S3.1 Register IP Asset ===");
const coll = await pubStory.nftClient.createNFTCollection({
  name: "Hatch Day0 Signals", symbol: "HATCH", isPublicMinting: true, mintOpen: true,
  mintFeeRecipient: "0x0000000000000000000000000000000000000000", contractURI: "",
});
log("SPG NFT collection:", coll.spgNftContract, "tx:", coll.txHash);

const terms = PILFlavor.commercialRemix({
  defaultMintingFee: parseEther("0.01"),
  currency: WIP,
  commercialRevShare: 10, // 10% -> SDK encodes 10_000_000
  royaltyPolicy: ADDR.ROYALTY_POLICY_LAP,
});

const reg = await pubStory.ipAsset.mintAndRegisterIpAssetWithPilTerms({
  spgNftContract: coll.spgNftContract,
  licenseTermsData: [{ terms }],
  ipMetadata: { ipMetadataURI: "", nftMetadataURI: "" },
});
const ipId = reg.ipId;
const licenseTermsId = reg.licenseTermsIds?.[0];
log("ipId:", ipId, "tokenId:", reg.tokenId?.toString(), "licenseTermsId:", licenseTermsId?.toString());
log("register tx:", reg.txHash);

// ---------- S3.2 license-gated CDR vault ----------
log("\n=== S3.2 License-gated CDR vault ===");
const dataKey = new Uint8Array(randomBytes(32));
log("original dataKey:", bytesToHex(dataKey));
const publisher = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("PUBLISHER"), apiUrl: API_URL });
const readConditionData = encodeAbiParameters([{ type: "address" }, { type: "address" }], [ADDR.LICENSE_TOKEN, ipId]);
const { uuid, txHash: allocTx } = await publisher.uploader.allocate({
  updatable: false,
  writeConditionAddr: ADDR.OWNER_WRITE_CONDITION,
  writeConditionData: encodeAbiParameters([{ type: "address" }], [pubAddr]),
  readConditionAddr: ADDR.LICENSE_READ_CONDITION,
  readConditionData,
  skipConditionValidation: true,
});
const ct = await publisher.uploader.encryptDataKey({ dataKey, label: uuidToLabel(uuid) });
const { txHash: writeTx } = await publisher.uploader.write({ uuid, accessAuxData: "0x", encryptedData: toHex(ct.raw) });
log("vault UUID:", uuid, "alloc:", allocTx, "write:", writeTx);

// ---------- S3.3 subscriber read BEFORE minting license (must fail) ----------
log("\n=== S3.3 Subscriber read BEFORE license (expect FAIL) ===");
const subscriber = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("SUBSCRIBER"), apiUrl: API_URL });
let preMintError = null;
try {
  await subscriber.consumer.accessCDR({ uuid, accessAuxData: encodeAbiParameters([{ type: "uint256[]" }], [[]]) });
  log("UNEXPECTED: read succeeded without license");
} catch (e) {
  preMintError = e?.shortMessage || e?.message || String(e);
  log("Correctly failed:", preMintError.slice(0, 120));
}

// ---------- S3.4 mint license token ----------
log("\n=== S3.4 Subscriber mints License Token ===");
const subBalBefore = await publicClient.getBalance({ address: subAddr });
const vaultAddr = await pubStory.royalty.getRoyaltyVaultAddress(ipId);
const royaltyBefore = await wipBal(vaultAddr);
log("royalty vault:", vaultAddr, "WIP before:", formatEther(royaltyBefore));

const mint = await subStory.license.mintLicenseTokens({
  licensorIpId: ipId, licenseTermsId, amount: 1, maxMintingFee: parseEther("0.1"),
  receiver: subAddr,
});
const licenseTokenId = mint.licenseTokenIds?.[0];
log("licenseTokenId:", licenseTokenId?.toString(), "mint tx:", mint.txHash);
const subBalAfter = await publicClient.getBalance({ address: subAddr });
log("subscriber native IP spent (fee+wrap+gas):", formatEther(subBalBefore - subBalAfter), "IP");

// ---------- S3.5 royalty vault delta ----------
log("\n=== S3.5 Royalty vault delta ===");
const royaltyAfter = await wipBal(vaultAddr);
log("WIP after:", formatEther(royaltyAfter), "delta:", formatEther(royaltyAfter - royaltyBefore), "WIP");

// ---------- S3.6 subscriber read WITH license (hot) ----------
log("\n=== S3.6 Subscriber read WITH license (hot) ===");
const accessAux = encodeAbiParameters([{ type: "uint256[]" }], [[licenseTokenId]]);
const t0 = performance.now();
const { dataKey: got, txHash: readTx } = await subscriber.consumer.accessCDR({ uuid, accessAuxData: accessAux });
const hotLatency = performance.now() - t0;
log("read tx:", readTx, "latency:", (hotLatency / 1000).toFixed(1), "s");

// ---------- S3.7 verify ----------
const match = got.length === dataKey.length && got.every((b, i) => b === dataKey[i]);
log("dataKey MATCH:", match ? "YES" : "NO");

writeFileSync(new URL("../.section3-state.json", import.meta.url), JSON.stringify({
  spgNftContract: coll.spgNftContract, ipId, tokenId: reg.tokenId?.toString(), licenseTermsId: licenseTermsId?.toString(),
  vaultUuid: uuid, licenseTokenId: licenseTokenId?.toString(),
  txHashes: { collection: coll.txHash, register: reg.txHash, allocate: allocTx, write: writeTx, mint: mint.txHash, readHot: readTx },
  royaltyVault: vaultAddr, royaltyDelta: formatEther(royaltyAfter - royaltyBefore),
  subscriberSpent: formatEther(subBalBefore - subBalAfter),
  preMintError, hotLatencyS: (hotLatency / 1000).toFixed(1), dataKey: bytesToHex(dataKey), match,
}, null, 2));
log("\nstate written to .section3-state.json");
process.exit(match ? 0 : 1);
