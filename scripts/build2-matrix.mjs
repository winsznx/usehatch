import { readFileSync, writeFileSync } from "node:fs";
import { parseEther, formatEther, erc20Abi, keccak256, toBytes, encodePacked, hashTypedData } from "viem";
import { publicClient, wallet, addr, WIP, account } from "./lib.mjs";

const st = JSON.parse(readFileSync(new URL("../.build2-state.json", import.meta.url)));
const { oracle: ORACLE, registry: REG } = st;
const CHALLENGE_WINDOW = BigInt(st.CHALLENGE_WINDOW);
const CHALLENGE_BOND   = BigInt(st.CHALLENGE_BOND);
const SLASH_WINDOW     = BigInt(st.SLASH_WINDOW);

const oracleArt = JSON.parse(readFileSync("./contracts/out/HatchOracle.sol/HatchOracle.json", "utf8"));
const regArt    = JSON.parse(readFileSync("./contracts/out/HatchPublisherRegistry.sol/HatchPublisherRegistry.json", "utf8"));

const IP_ROOT_1 = "0x26eEda6e00d0044575D08ee23d0da9F2dd034Ff3";
const pubW = wallet("PUBLISHER");
const subW = wallet("SUBSCRIBER");
const pubAcct = account("PUBLISHER");
const subAcct = account("SUBSCRIBER");
const pubAddr = addr("PUBLISHER");
const subAddr = addr("SUBSCRIBER");

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
const wipAbi = [
  ...erc20Abi,
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
];

const writeAs = async (signer, address, abi, fn, args, value = 0n) => {
  const { request } = await publicClient.simulateContract({ address, abi, functionName: fn, args, account: signer.account, value });
  const tx = await signer.writeContract(request);
  const r = await publicClient.waitForTransactionReceipt({ hash: tx });
  return { tx, gas: r.gasUsed };
};

const wipBalance = (who) => publicClient.readContract({ address: WIP, abi: wipAbi, functionName: "balanceOf", args: [who] });

const results = {};
const record = (key, ok, detail) => { results[key] = { ok, ...detail }; log(`${key}: ${ok ? "PASS ✅" : "FAIL ❌"}  ${JSON.stringify(detail).slice(0, 140)}`); };
const expectRevert = async (fn, key, expectInError = "") => {
  try { await fn(); record(key, false, { unexpected: "no revert" }); }
  catch (e) {
    const full = (e?.message || String(e));
    const errorName =
      e?.cause?.data?.errorName ??
      e?.cause?.cause?.data?.errorName ??
      (expectInError && full.includes(expectInError) ? expectInError : null);
    const shortMessage = e?.shortMessage || full.slice(0, 180);
    record(key, true, { revertedAsExpected: true, errorName, shortMessage });
  }
};

// ─────────────────────────────────────── EIP-712 setup
const domain = { name: "HatchOracle", version: "1", chainId: 1315, verifyingContract: ORACLE };
const types = {
  Attestation: [
    { name: "hatchId", type: "bytes32" },
    { name: "outcomeHash", type: "bytes32" },
    { name: "outcomeValue", type: "int256" },
    { name: "observedAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};
const buildAtt = (label, value, nonce) => ({
  hatchId: keccak256(toBytes(label)),
  outcomeHash: keccak256(toBytes(label + "-payload")),
  outcomeValue: value,
  observedAt: BigInt(Math.floor(Date.now() / 1000)),
  nonce,
});
const sign = (signer, att) =>
  signer.signTypedData({ domain, types, primaryType: "Attestation", message: att });

// ─────────────────────────────────────── PRE-CHECK: EIP-712 digest matches off-chain
log("=== EIP-712 digest cross-check ===");
{
  const att = buildAtt("hatch-digest-check", 12345n, 9999n);
  const onChain = await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "attestationDigest", args: [att] });
  const offChain = hashTypedData({ domain, types, primaryType: "Attestation", message: att });
  record("eip712_digest_match", onChain.toLowerCase() === offChain.toLowerCase(), { onChain, offChain });
}

// ─────────────────────────────────────── PRE-SETUP: wrap WIP + register + approve
log("=== wrap WIP + register publisher + approve ===");
const subBalBefore = await publicClient.getBalance({ address: pubAddr });
await writeAs(pubW, WIP, wipAbi, "deposit", [], parseEther("0.5"));
log("PUB WIP after wrap:", formatEther(await wipBalance(pubAddr)));
await writeAs(pubW, WIP, wipAbi, "approve", [REG, parseEther("0.5")]);
await writeAs(pubW, REG, regArt.abi, "registerPublisher", [IP_ROOT_1]);

// ─────────────────────────────────────── REGISTRY matrix (j first, then i, then l, k via h, m last)
log("=== (j) stake below threshold -> not verified ===");
await writeAs(pubW, REG, regArt.abi, "stake", [parseEther("0.01")]);
{
  const v = await publicClient.readContract({ address: REG, abi: regArt.abi, functionName: "isVerified", args: [pubAddr] });
  record("j_stake_below_threshold_notVerified", v === false, { stake: "0.01 WIP", isVerified: v });
}

log("=== (i) top up to threshold -> verified ===");
await writeAs(pubW, REG, regArt.abi, "stake", [parseEther("0.04")]);
{
  const v = await publicClient.readContract({ address: REG, abi: regArt.abi, functionName: "isVerified", args: [pubAddr] });
  const p = await publicClient.readContract({ address: REG, abi: regArt.abi, functionName: "getPublisher", args: [pubAddr] });
  record("i_register_stake_above_threshold_verified", v === true, { stake: formatEther(p[1]), isVerified: v });
}

log("=== (l) unauthorized slash -> revert ===");
await expectRevert(
  () => writeAs(subW, REG, regArt.abi, "slash", [pubAddr, parseEther("0.01"), subAddr]),
  "l_unauthorized_slash_revert", "NotAuthorized",
);

// ─────────────────────────────────────── ORACLE matrix
log("=== (a) operator submits valid attestation ===");
const att1 = buildAtt("hatch-1", 1000n, 1n);
const sig1 = await sign(pubAcct, att1);
const { gas: gasA } = await writeAs(pubW, ORACLE, oracleArt.abi, "submitAttestation", [att1, sig1]);
{
  const o = await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "getOutcome", args: [att1.hatchId] });
  record("a_operator_submit_valid", o[4] === 1 && o[3].toLowerCase() === pubAddr.toLowerCase(), { status: o[4], operator: o[3], gas: gasA.toString() });
}

log("=== (b) non-operator submits -> revert ===");
const att2 = buildAtt("hatch-2", 2000n, 2n);
const sig2 = await sign(subAcct, att2); // signed by SUBSCRIBER (not operator)
await expectRevert(
  () => writeAs(pubW, ORACLE, oracleArt.abi, "submitAttestation", [att2, sig2]),
  "b_nonOperator_submit_revert", "NotOperator",
);

log("=== (c) replayed nonce -> revert ===");
const att3 = { ...buildAtt("hatch-3", 3000n, 1n) }; // nonce 1 reused from att1
const sig3 = await sign(pubAcct, att3);
await expectRevert(
  () => writeAs(pubW, ORACLE, oracleArt.abi, "submitAttestation", [att3, sig3]),
  "c_replayed_nonce_revert", "NonceUsed",
);

log("=== (d) finalize before window -> revert ===");
await expectRevert(
  () => writeAs(pubW, ORACLE, oracleArt.abi, "finalize", [att1.hatchId]),
  "d_finalize_preWindow_revert", "WindowOpen",
);

log("=== (f) challenge within window ===");
const att4 = buildAtt("hatch-4", 4000n, 4n);
const sig4 = await sign(pubAcct, att4);
await writeAs(pubW, ORACLE, oracleArt.abi, "submitAttestation", [att4, sig4]);
const pubBalBeforeG = await publicClient.getBalance({ address: pubAddr });
await writeAs(subW, ORACLE, oracleArt.abi, "challenge", [att4.hatchId], CHALLENGE_BOND);
{
  const o = await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "getOutcome", args: [att4.hatchId] });
  record("f_challenge_within_window_disputed", o[4] === 2, { status: o[4] });
}

log("=== (g) resolveChallenge operatorWins -> bond to operator ===");
await writeAs(pubW, ORACLE, oracleArt.abi, "resolveChallenge", [att4.hatchId, true, "0x0000000000000000000000000000000000000000", 0n]);
{
  const o = await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "getOutcome", args: [att4.hatchId] });
  const pubBalAfter = await publicClient.getBalance({ address: pubAddr });
  // PUB paid gas for resolveChallenge but received the bond. Net delta should be close to +CHALLENGE_BOND - gas.
  const netDelta = pubBalAfter - pubBalBeforeG;
  const ok = o[4] === 3 && netDelta > (CHALLENGE_BOND * 90n / 100n); // 90% of bond to allow for gas
  record("g_resolve_operatorWins_bondToOperator", ok, { status: o[4], netDeltaIP: formatEther(netDelta) });
}

log("=== (h) resolveChallenge challengerWins -> bond to challenger + slash ===");
const att5 = buildAtt("hatch-5", 5000n, 5n);
const sig5 = await sign(pubAcct, att5);
await writeAs(pubW, ORACLE, oracleArt.abi, "submitAttestation", [att5, sig5]);
await writeAs(subW, ORACLE, oracleArt.abi, "challenge", [att5.hatchId], CHALLENGE_BOND);
const subWipBeforeSlash = await wipBalance(subAddr);
const pubStakeBeforeSlash = (await publicClient.readContract({ address: REG, abi: regArt.abi, functionName: "getPublisher", args: [pubAddr] }))[1];
const subBalBeforeH = await publicClient.getBalance({ address: subAddr });
const SLASH_AMOUNT = parseEther("0.01");
await writeAs(pubW, ORACLE, oracleArt.abi, "resolveChallenge", [att5.hatchId, false, pubAddr, SLASH_AMOUNT]);
{
  const o = await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "getOutcome", args: [att5.hatchId] });
  const subBalAfterH = await publicClient.getBalance({ address: subAddr });
  const subBondDelta = subBalAfterH - subBalBeforeH;
  const subWipAfterSlash = await wipBalance(subAddr);
  const pubStakeAfterSlash = (await publicClient.readContract({ address: REG, abi: regArt.abi, functionName: "getPublisher", args: [pubAddr] }))[1];
  const ok = o[4] === 3
    && subBondDelta === CHALLENGE_BOND
    && (subWipAfterSlash - subWipBeforeSlash) === SLASH_AMOUNT
    && (pubStakeBeforeSlash - pubStakeAfterSlash) === SLASH_AMOUNT;
  record("h_resolve_challengerWins_slashed", ok, {
    status: o[4], bondToChallengerIP: formatEther(subBondDelta),
    subWipDelta: formatEther(subWipAfterSlash - subWipBeforeSlash),
    pubStakeDelta: formatEther(pubStakeBeforeSlash - pubStakeAfterSlash),
  });
}

log("=== (k) slash effects (post-h) ===");
{
  const p = await publicClient.readContract({ address: REG, abi: regArt.abi, functionName: "getPublisher", args: [pubAddr] });
  const ok = p[1] === parseEther("0.04") && p[3] !== 0n;
  record("k_slash_effects", ok, { stake: formatEther(p[1]), lastSlashAt: p[3].toString() });
}

log("=== (m) unstake during slash window -> revert ===");
await expectRevert(
  () => writeAs(pubW, REG, regArt.abi, "unstake", [parseEther("0.01")]),
  "m_unstake_inSlashWindow_revert", "InSlashWindow",
);

// (e) needs the original att1 to be finalize-able. Wait for window.
log("=== (e) waiting for challenge window to elapse to finalize att1 ===");
const target = Number((await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "getRecord", args: [att1.hatchId] })).submittedAt) + Number(CHALLENGE_WINDOW) + 5;
while ((await chainNow()) < target) {
  log(`waiting chain ts ${target} (now ${await chainNow()}, +${target - (await chainNow())}s)`);
  await new Promise((r) => setTimeout(r, 10000));
}
await writeAs(pubW, ORACLE, oracleArt.abi, "finalize", [att1.hatchId]);
{
  const o = await publicClient.readContract({ address: ORACLE, abi: oracleArt.abi, functionName: "getOutcome", args: [att1.hatchId] });
  record("e_finalize_postWindow_success", o[4] === 3, { status: o[4] });
}

// ─────────────────────────────────────── SUMMARY
const passing = Object.values(results).filter((r) => r.ok).length;
const total = Object.keys(results).length;
log(`\nBUILD 2 MATRIX: ${passing}/${total} pass; ALL OK: ${passing === total ? "YES ✅" : "NO ❌"}`);
writeFileSync(new URL("../.build2-matrix.json", import.meta.url), JSON.stringify({
  contracts: { oracle: ORACLE, registry: REG },
  domain, results, passing, total, allOk: passing === total,
}, null, 2));
process.exit(passing === total ? 0 : 1);
