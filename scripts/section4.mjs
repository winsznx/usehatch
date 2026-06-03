import { CDRClient, uuidToLabel } from "@piplabs/cdr-sdk";
import { initWasm } from "@piplabs/cdr-crypto";
import { encodeAbiParameters, parseEther, bytesToHex, toHex } from "viem";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { publicClient, wallet, storyClient, addr, API_URL, ADDR } from "./lib.mjs";

await initWasm();
const HATCH = "0x142b0a3ac1275c6b0d1dcb0caf67dd59df958e7d";
const IP_ID = "0x26eEda6e00d0044575D08ee23d0da9F2dd034Ff3"; // reuse Section 3 IP
const LICENSE_TERMS_ID = 1203n;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
const waitChain = async (ts) => {
  while ((await chainNow()) < ts) {
    log(`waiting for chain ts ${ts} (now ${await chainNow()}, +${ts - (await chainNow())}s)...`);
    await new Promise((r) => setTimeout(r, 15000));
  }
};

const pubAddr = addr("PUBLISHER");
const publisher = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("PUBLISHER"), apiUrl: API_URL });
const subscriber = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("SUBSCRIBER"), apiUrl: API_URL });
const anon = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("ANON"), apiUrl: API_URL });
const subStory = storyClient("SUBSCRIBER");

const base = await chainNow();
const embargoStart = base + 60;
const revealAt = base + 300;
log(`base=${base} embargoStart=+60 revealAt=+300`);

const dataKey = new Uint8Array(randomBytes(32));
const conditionData = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint64" }],
  [ADDR.LICENSE_TOKEN, IP_ID, BigInt(embargoStart), BigInt(revealAt)],
);
const writeConditionData = encodeAbiParameters([{ type: "address" }], [pubAddr]);

const { uuid, txHash: allocTx } = await publisher.uploader.allocate({
  updatable: false,
  writeConditionAddr: HATCH, writeConditionData,
  readConditionAddr: HATCH, readConditionData: conditionData,
  skipConditionValidation: true,
});
const ct = await publisher.uploader.encryptDataKey({ dataKey, label: uuidToLabel(uuid) });
const { txHash: writeTx } = await publisher.uploader.write({ uuid, accessAuxData: "0x", encryptedData: toHex(ct.raw) });
log(`vault UUID=${uuid} alloc=${allocTx} write=${writeTx}`);

const emptyAux = encodeAbiParameters([{ type: "uint256[]" }], [[]]);
const matrix = {};
const attempt = async (key, client, accessAuxData, expect) => {
  const t0 = performance.now();
  try {
    const { dataKey: got, txHash } = await client.consumer.accessCDR({ uuid, accessAuxData });
    const lat = ((performance.now() - t0) / 1000).toFixed(1);
    const match = bytesToHex(got) === bytesToHex(dataKey);
    matrix[key] = { result: "SUCCESS", expect, ok: expect === "SUCCESS", txHash, latencyS: lat, match, chainTs: await chainNow() };
    log(`${key}: SUCCESS (expect ${expect}) lat=${lat}s match=${match} tx=${txHash}`);
  } catch (e) {
    const msg = (e?.shortMessage || e?.message || String(e)).replace(/\s+/g, " ").slice(0, 140);
    matrix[key] = { result: "FAIL", expect, ok: expect === "FAIL", error: msg, chainTs: await chainNow() };
    log(`${key}: FAIL (expect ${expect}) err="${msg}"`);
  }
};

// (a) SUBSCRIBER, no license, before embargoStart -> FAIL
await attempt("a_sub_pre_window_no_license", subscriber, emptyAux, "FAIL");

// mint license to SUBSCRIBER
const mint = await subStory.license.mintLicenseTokens({
  licensorIpId: IP_ID, licenseTermsId: LICENSE_TERMS_ID, amount: 1, maxMintingFee: parseEther("0.1"), receiver: addr("SUBSCRIBER"),
});
const licenseTokenId = mint.licenseTokenIds?.[0];
log(`minted licenseTokenId=${licenseTokenId} tx=${mint.txHash}`);
const licAux = encodeAbiParameters([{ type: "uint256[]" }], [[licenseTokenId]]);

// (b) SUBSCRIBER, with license, inside window -> SUCCESS
await waitChain(embargoStart + 5);
await attempt("b_sub_in_window_with_license", subscriber, licAux, "SUCCESS");

// (c) ANON, no license, inside window -> FAIL
await attempt("c_anon_in_window_no_license", anon, emptyAux, "FAIL");

// (d) ANON, after revealAt, empty aux -> SUCCESS
await waitChain(revealAt + 5);
await attempt("d_anon_post_reveal_open", anon, emptyAux, "SUCCESS");

const allOk = Object.values(matrix).every((m) => m.ok);
writeFileSync(new URL("../.section4-state.json", import.meta.url), JSON.stringify({
  hatchCondition: HATCH, vaultUuid: uuid, ipId: IP_ID, licenseTokenId: licenseTokenId?.toString(),
  embargoStart, revealAt, allocTx, writeTx, mintTx: mint.txHash, matrix, allOk,
}, null, 2));
log(`\nMATRIX ALL PASS: ${allOk ? "YES ✅ GO" : "NO ❌ NO-GO"}`);
process.exit(allOk ? 0 : 1);
