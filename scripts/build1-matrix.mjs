import { CDRClient, uuidToLabel } from "@piplabs/cdr-sdk";
import { initWasm } from "@piplabs/cdr-crypto";
import { encodeAbiParameters, parseEther, bytesToHex, toHex } from "viem";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { publicClient, wallet, storyClient, addr, API_URL, ADDR } from "./lib.mjs";

await initWasm();
const st = JSON.parse(readFileSync(new URL("../.build1-state.json", import.meta.url)));
const { pass: PASS, hatchV2: HATCH_V2, IP_ROOT_1, IP_ROOT_2 } = st;
const LICENSE_TERMS_ID = BigInt(st.LICENSE_TERMS_ID);

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
const waitChain = async (ts) => {
  while ((await chainNow()) < ts) {
    log(`waiting chain ts ${ts} (now ${await chainNow()}, +${ts - (await chainNow())}s)`);
    await new Promise((r) => setTimeout(r, 12000));
  }
};

const pubAddr = addr("PUBLISHER");
const subAddr = addr("SUBSCRIBER");
const anonAddr = addr("ANON");

const pubW = wallet("PUBLISHER");
const subW = wallet("SUBSCRIBER");
const subStory = storyClient("SUBSCRIBER");

const cdrPub = new CDRClient({ network: "testnet", publicClient, walletClient: pubW, apiUrl: API_URL });
const cdrSub = new CDRClient({ network: "testnet", publicClient, walletClient: subW, apiUrl: API_URL });
const cdrAnon = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("ANON"), apiUrl: API_URL });

// ───────────────────────────────────────── PRE-SETUP: license tokens (subscriber)
log("=== minting license tokens ===");
const mintLic = async (ip) => {
  const m = await subStory.license.mintLicenseTokens({
    licensorIpId: ip, licenseTermsId: LICENSE_TERMS_ID, amount: 1, maxMintingFee: parseEther("0.1"), receiver: subAddr,
  });
  return BigInt(m.licenseTokenIds[0]);
};
const L_perHatch_root1 = await mintLic(IP_ROOT_1); log("L_perHatch_root1:", L_perHatch_root1);
const L_perHatch_root2 = await mintLic(IP_ROOT_2); log("L_perHatch_root2:", L_perHatch_root2);
const L_sub_valid_root1 = await mintLic(IP_ROOT_1); log("L_sub_valid_root1:", L_sub_valid_root1);
const L_sub_otherRoot_root2 = await mintLic(IP_ROOT_2); log("L_sub_otherRoot_root2:", L_sub_otherRoot_root2);
const L_sub_short_root1 = await mintLic(IP_ROOT_1); log("L_sub_short_root1:", L_sub_short_root1);

// ───────────────────────────────────────── PRE-SETUP: passes (publisher mints)
log("=== minting passes ===");
const passAbi = [{
  type: "function", name: "mint", stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" }, { name: "publisherRoot_", type: "address" },
    { name: "subLicenseTokenId_", type: "uint256" }, { name: "duration", type: "uint64" },
    { name: "subPriceWei_", type: "uint256" },
  ],
  outputs: [{ name: "tokenId", type: "uint256" }],
}];

const mintPass = async (to, root, subLic, duration, priceWei) => {
  const { request, result } = await publicClient.simulateContract({
    address: PASS, abi: passAbi, functionName: "mint",
    args: [to, root, subLic, BigInt(duration), priceWei],
    account: pubW.account,
  });
  const txHash = await pubW.writeContract(request);
  const rcpt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { tokenId: result, txHash, gasUsed: rcpt.gasUsed };
};

const pass_valid = await mintPass(subAddr, IP_ROOT_1, L_sub_valid_root1, 7 * 24 * 3600, parseEther("0.01"));
log("pass_valid (SUB, root1, 7d):", pass_valid.tokenId, "tx:", pass_valid.txHash);

const pass_otherRoot = await mintPass(subAddr, IP_ROOT_2, L_sub_otherRoot_root2, 7 * 24 * 3600, parseEther("0.01"));
log("pass_otherRoot (SUB, root2):", pass_otherRoot.tokenId);

const pass_short = await mintPass(subAddr, IP_ROOT_1, L_sub_short_root1, 20, parseEther("0.01"));
log("pass_short (SUB, root1, 20s):", pass_short.tokenId, "(expires at +20s)");

// ───────────────────────────────────────── VAULT SETUP
log("=== creating vaults ===");
const base = await chainNow();
log("base chain ts:", base);
const EMBARGO = base + 45;
const REVEAL = base + 200;
const EMBARGO_PAST = base - 30; // for grandfather test

const encodeCond = (mode, tokenOrPass, ipOrRoot, embStart, revAt) =>
  encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint64" }],
    [mode, tokenOrPass, ipOrRoot, BigInt(embStart), BigInt(revAt)],
  );
const writeCondData = encodeAbiParameters([{ type: "address" }], [pubAddr]);

const createVault = async (name, conditionData) => {
  const dataKey = new Uint8Array(randomBytes(32));
  const { uuid, txHash: allocTx } = await cdrPub.uploader.allocate({
    updatable: false,
    writeConditionAddr: HATCH_V2, writeConditionData: writeCondData,
    readConditionAddr: HATCH_V2, readConditionData: conditionData,
    skipConditionValidation: true,
  });
  const ct = await cdrPub.uploader.encryptDataKey({ dataKey, label: uuidToLabel(uuid) });
  const { txHash: writeTx } = await cdrPub.uploader.write({ uuid, accessAuxData: "0x", encryptedData: toHex(ct.raw) });
  log(`${name}: uuid=${uuid} alloc=${allocTx} write=${writeTx}`);
  return { name, uuid, dataKey, allocTx, writeTx };
};

const vaultA = await createVault("vaultA(per-hatch)", encodeCond(0, ADDR.LICENSE_TOKEN, IP_ROOT_1, EMBARGO, REVEAL));
const vaultB = await createVault("vaultB(sub)",        encodeCond(1, PASS,              IP_ROOT_1, EMBARGO, REVEAL));
const vaultC = await createVault("vaultC(grandfather)",encodeCond(1, PASS,              IP_ROOT_1, EMBARGO_PAST, REVEAL));
const vaultD = await createVault("vaultD(expired)",    encodeCond(1, PASS,              IP_ROOT_1, EMBARGO, REVEAL));
// Dual-mode vault encodes tokenOrPass = LICENSE_TOKEN; the subscription route
// uses the immutable PASS regardless of this slot. Subscription/per-hatch vaults
// keep their natural encoding (PASS / LICENSE_TOKEN respectively).
const vaultE = await createVault("vaultE(dual)",       encodeCond(2, ADDR.LICENSE_TOKEN, IP_ROOT_1, EMBARGO, REVEAL));

// ───────────────────────────────────────── MATRIX RUNNER
const matrix = {};
const aux_perHatch = (ids) => encodeAbiParameters(
  [{ type: "uint8" }, { type: "bytes" }],
  [0, encodeAbiParameters([{ type: "uint256[]" }], [ids])],
);
const aux_sub = (passId) => encodeAbiParameters(
  [{ type: "uint8" }, { type: "bytes" }],
  [1, encodeAbiParameters([{ type: "uint256" }], [passId])],
);
const aux_empty = "0x";

const attempt = async (key, client, vault, accessAuxData, expect) => {
  const t0 = performance.now();
  try {
    const { dataKey: got, txHash } = await client.consumer.accessCDR({ uuid: vault.uuid, accessAuxData });
    const lat = ((performance.now() - t0) / 1000).toFixed(1);
    const match = bytesToHex(got) === bytesToHex(vault.dataKey);
    let gas = null;
    try { const r = await publicClient.getTransactionReceipt({ hash: txHash }); gas = r.gasUsed.toString(); } catch {}
    matrix[key] = { result: "SUCCESS", expect, ok: expect === "SUCCESS", txHash, latencyS: lat, match, gas, chainTs: await chainNow() };
    log(`${key}: SUCCESS (expect ${expect}) lat=${lat}s match=${match} gas=${gas}`);
  } catch (e) {
    const msg = (e?.shortMessage || e?.message || String(e)).replace(/\s+/g, " ").slice(0, 160);
    matrix[key] = { result: "FAIL", expect, ok: expect === "FAIL", error: msg, chainTs: await chainNow() };
    log(`${key}: FAIL (expect ${expect}) err="${msg.slice(0, 90)}"`);
  }
};

// --- (a) per-hatch, pre-window, no license -> FAIL
await attempt("a_perHatch_preWindow_noLicense", cdrSub, vaultA, aux_perHatch([]), "FAIL");

// --- (c) per-hatch, in-window, license from DIFFERENT ipId -> FAIL (regression)
//     Can run before reaching window? No — condition checks pre-window first.
//     Must run after EMBARGO. Schedule with (b) and (d).
log("waiting for EMBARGO window...");
await waitChain(EMBARGO + 5);

// --- (b) per-hatch, in-window, license for CORRECT ipId -> SUCCESS
await attempt("b_perHatch_inWindow_correctIp", cdrSub, vaultA, aux_perHatch([L_perHatch_root1]), "SUCCESS");

// --- (c) per-hatch, in-window, license from DIFFERENT ipId -> FAIL
await attempt("c_perHatch_inWindow_wrongIp", cdrSub, vaultA, aux_perHatch([L_perHatch_root2]), "FAIL");

// --- subscription matrix (in-window)
// (e) valid pass, in-window -> SUCCESS
await attempt("e_sub_inWindow_validPass", cdrSub, vaultB, aux_sub(pass_valid.tokenId), "SUCCESS");

// (f) grandfather violation -> FAIL
//     vaultC has EMBARGO_PAST < pass_valid.mintedAt. Read in-window (chain now > EMBARGO_PAST).
await attempt("f_sub_grandfatherViolation", cdrSub, vaultC, aux_sub(pass_valid.tokenId), "FAIL");

// (h) pass for DIFFERENT publisherRoot -> FAIL
await attempt("h_sub_wrongPublisherRoot", cdrSub, vaultB, aux_sub(pass_otherRoot.tokenId), "FAIL");

// (i) ANON has no pass -> FAIL (uses subscriber's passId, ANON not owner)
await attempt("i_sub_anon_noPass", cdrAnon, vaultB, aux_sub(pass_valid.tokenId), "FAIL");

// (g) expired pass -> FAIL. pass_short minted ~30-60s before EMBARGO with 20s duration → already expired by now.
await attempt("g_sub_expiredPass", cdrSub, vaultD, aux_sub(pass_short.tokenId), "FAIL");

// --- dual mode (k, l, m)
// (k) dual + valid per-hatch payload -> SUCCESS
await attempt("k_dual_perHatchValid", cdrSub, vaultE, aux_perHatch([L_perHatch_root1]), "SUCCESS");

// (l) dual + valid subscription payload -> SUCCESS
await attempt("l_dual_subValid", cdrSub, vaultE, aux_sub(pass_valid.tokenId), "SUCCESS");

// (m) dual + neither -> FAIL (empty license list = kind 0, empty array → no match)
await attempt("m_dual_neither", cdrAnon, vaultE, aux_perHatch([]), "FAIL");

// --- (d) per-hatch post-reveal no aux -> SUCCESS  (j) sub post-reveal anon -> SUCCESS
log("waiting for REVEAL window...");
await waitChain(REVEAL + 5);

await attempt("d_perHatch_postReveal_noAux", cdrAnon, vaultA, aux_empty, "SUCCESS");
await attempt("j_sub_postReveal_anon",       cdrAnon, vaultB, aux_empty, "SUCCESS");

// ───────────────────────────────────────── RESULTS
const allOk = Object.values(matrix).every((m) => m.ok);
const passing = Object.values(matrix).filter((m) => m.ok).length;
log(`\nMATRIX: ${passing}/${Object.keys(matrix).length} pass; ALL OK: ${allOk ? "YES ✅" : "NO ❌"}`);

writeFileSync(new URL("../.build1-matrix.json", import.meta.url), JSON.stringify({
  contracts: { pass: PASS, hatchV2: HATCH_V2 },
  setup: {
    L_perHatch_root1: L_perHatch_root1.toString(), L_perHatch_root2: L_perHatch_root2.toString(),
    L_sub_valid_root1: L_sub_valid_root1.toString(), L_sub_otherRoot_root2: L_sub_otherRoot_root2.toString(),
    L_sub_short_root1: L_sub_short_root1.toString(),
    pass_valid: pass_valid.tokenId.toString(), pass_otherRoot: pass_otherRoot.tokenId.toString(), pass_short: pass_short.tokenId.toString(),
    vaults: { A: vaultA.uuid, B: vaultB.uuid, C: vaultC.uuid, D: vaultD.uuid, E: vaultE.uuid },
    base, EMBARGO, REVEAL, EMBARGO_PAST,
  },
  matrix, allOk, passing, total: Object.keys(matrix).length,
}, null, 2));
process.exit(allOk ? 0 : 1);
