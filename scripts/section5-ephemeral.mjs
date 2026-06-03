import { CDRClient } from "@piplabs/cdr-sdk";
import { initWasm } from "@piplabs/cdr-crypto";
import { StoryClient } from "@story-protocol/core-sdk";
import { createWalletClient, http, parseEther, formatEther, encodeAbiParameters, bytesToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { publicClient, wallet, aeneid, RPC_URL, API_URL } from "./lib.mjs";

await initWasm();
const log = (...a) => console.log(...a);

// Reuse Section 3 license-gated vault
const VAULT_UUID = 3875;
const IP_ID = "0x26eEda6e00d0044575D08ee23d0da9F2dd034Ff3";
const LICENSE_TERMS_ID = 1203n;
const FUND = "0.2";

// 1. ephemeral key in memory
let ephPk = generatePrivateKey();
const ephAcct = privateKeyToAccount(ephPk);
log("ephemeral addr:", ephAcct.address);

// 2. fund from PUBLISHER
const pub = wallet("PUBLISHER");
const fundHash = await pub.sendTransaction({ to: ephAcct.address, value: parseEther(FUND) });
const fundRcpt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
const funded = await publicClient.getBalance({ address: ephAcct.address });
log(`funded ${FUND} IP (tx ${fundHash}, publisher gas ${fundRcpt.gasUsed})`);

// 3. mint License Token to ephemeral for IP_ID
const ephStory = StoryClient.newClient({ account: ephAcct, transport: http(RPC_URL), chainId: "aeneid" });
const mint = await ephStory.license.mintLicenseTokens({
  licensorIpId: IP_ID, licenseTermsId: LICENSE_TERMS_ID, amount: 1, maxMintingFee: parseEther("0.1"), receiver: ephAcct.address,
});
const tokenId = mint.licenseTokenIds?.[0];
log("minted licenseTokenId:", tokenId?.toString(), "tx:", mint.txHash);

// 4. accessCDR from ephemeral wallet
const ephWallet = createWalletClient({ account: ephAcct, chain: aeneid, transport: http(RPC_URL) });
const ephCdr = new CDRClient({ network: "testnet", publicClient, walletClient: ephWallet, apiUrl: API_URL });
const accessAux = encodeAbiParameters([{ type: "uint256[]" }], [[tokenId]]);
const t0 = performance.now();
const { dataKey, txHash: readTx } = await ephCdr.consumer.accessCDR({ uuid: VAULT_UUID, accessAuxData: accessAux });
const latency = ((performance.now() - t0) / 1000).toFixed(1);
log(`accessCDR ok (lat ${latency}s) tx ${readTx} dataKey ${bytesToHex(dataKey).slice(0, 18)}...`);

// 5. cost + discard
const remaining = await publicClient.getBalance({ address: ephAcct.address });
const consumed = parseEther(FUND) - remaining;
log(`\nephemeral consumed (mint fee+wrap+gas + read gas): ${formatEther(consumed)} IP`);
log(`leftover (would be stranded/swept): ${formatEther(remaining)} IP`);
log(`total cost to operator (funding incl. transfer): publisher sent ${FUND} IP + transfer gas`);

ephPk = null; // discard key reference
log("ephemeral key discarded.");
