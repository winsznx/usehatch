/* @usehatch/sdk round-trip test on live Aeneid.
 * 10 steps from createPublisher → finalized outcome. No mocks. */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { parseEther, formatEther, keccak256, toBytes, encodeAbiParameters, erc20Abi } from "viem";
import { initWasm } from "@piplabs/cdr-crypto";
import { publicClient, wallet, storyClient, account, addr, RPC_URL, aeneid } from "./lib.mjs";

import {
  defaultConfig, LocalDiskProvider, EphemeralPool,
  createPublisher, stake, wrapNativeToWip,
  createHatch,
  subscribe, buyHatch,
  readHatch,
  signAttestation, submitAttestation, finalize, getOutcome,
  ATTESTATION_TYPES, oracleDomain,
} from "../sdk/dist/index.js";

await initWasm();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const t = () => performance.now();
const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
const wait = async (untilTs) => {
  while ((await chainNow()) < untilTs) {
    log(`waiting chain ts ${untilTs} (now ${await chainNow()}, +${untilTs - (await chainNow())}s)`);
    await new Promise((r) => setTimeout(r, 12000));
  }
};

// ─── Config: LocalDisk storage (no Supabase creds available in this session) + EphemeralPool
const storage = new LocalDiskProvider("/tmp/hatch-roundtrip-storage");
const config = defaultConfig({
  storage,
  ephemeralTreasuryPk: process.env.PUBLISHER_PK,
  ephemeralPoolSize: 4,
});

const pool = new EphemeralPool({
  treasuryPk: process.env.PUBLISHER_PK, chain: aeneid, rpcUrl: RPC_URL, size: 4,
});

const PUB = { addr: addr("PUBLISHER"), wallet: wallet("PUBLISHER"), acct: account("PUBLISHER"), story: storyClient("PUBLISHER") };
const SUB = { addr: addr("SUBSCRIBER"), wallet: wallet("SUBSCRIBER"), acct: account("SUBSCRIBER"), story: storyClient("SUBSCRIBER") };
const SUB2= { addr: addr("ANON"),       wallet: wallet("ANON"),       acct: account("ANON"),       story: storyClient("ANON") };

const results = {};
const record = (key, ok, data) => { results[key] = { ok, ...data }; log(`${key}: ${ok ? "PASS ✅" : "FAIL ❌"} ${JSON.stringify(data).slice(0, 180)}`); };

// ─── Setup: fresh PublisherRegistry per run (one-shot register semantics)
log("=== Setup: deploy fresh PublisherRegistry, rewire Oracle ===");
{
  const { readFileSync } = await import("node:fs");
  const regArt = JSON.parse(readFileSync("./contracts/out/HatchPublisherRegistry.sol/HatchPublisherRegistry.json", "utf8"));
  const h = await PUB.wallet.deployContract({
    abi: regArt.abi, bytecode: regArt.bytecode.object,
    args: [config.chain.wip, PUB.addr, parseEther("0.05"), 60n],
  });
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  const FRESH_REG = r.contractAddress;
  // rewire Oracle.setRegistry and Registry.setOracle
  const oracleAbi = [{ type: "function", name: "setRegistry", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] }];
  const regAbi    = [{ type: "function", name: "setOracle",   stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] }];
  let sim = await publicClient.simulateContract({ address: config.hatch.oracle, abi: oracleAbi, functionName: "setRegistry", args: [FRESH_REG], account: PUB.acct });
  await PUB.wallet.writeContract(sim.request);
  sim = await publicClient.simulateContract({ address: FRESH_REG, abi: regAbi, functionName: "setOracle", args: [config.hatch.oracle], account: PUB.acct });
  await PUB.wallet.writeContract(sim.request);
  // patch in-memory config the test will use
  config.hatch = { ...config.hatch, publisherRegistry: FRESH_REG };
  log(`fresh Registry @ ${FRESH_REG}; rewired with existing Oracle @ ${config.hatch.oracle}`);
}

// ─── Step 1: createPublisher
log("=== Step 1: createPublisher ===");
let t0 = t();
const pubDesc = await createPublisher({
  config, publicClient, walletClient: PUB.wallet, storyClient: PUB.story, account: PUB.acct,
  collection: { name: "Hatch Round-Trip Pub", symbol: "HATCHRT" },
  subscription: { mintingFeeWip: parseEther("0.01"), commercialRevSharePct: 10 },
});
record("step1_createPublisher", true, { rootIp: pubDesc.publisherRootIpId, subTermsId: pubDesc.subscriptionTermsId.toString(), latencyS: ((t()-t0)/1000).toFixed(1), tx: pubDesc.registryTxHash });

// ─── Step 2: wrap native → WIP, stake above threshold (0.05 WIP)
log("=== Step 2: stake above threshold ===");
t0 = t();
await wrapNativeToWip({ config, publicClient, walletClient: PUB.wallet, account: PUB.acct, amount: parseEther("0.5") });
const stakeRes = await stake({ config, publicClient, walletClient: PUB.wallet, account: PUB.acct, amount: parseEther("0.06") });
const verified = await publicClient.readContract({
  address: config.hatch.publisherRegistry,
  abi: [{ type: "function", name: "isVerified", stateMutability: "view", inputs: [{ name: "p", type: "address" }], outputs: [{ type: "bool" }] }],
  functionName: "isVerified", args: [PUB.addr],
});
record("step2_stake_verified", verified === true, { stake: "0.06 WIP", verified, stakeTx: stakeRes.stakeTx, latencyS: ((t()-t0)/1000).toFixed(1) });

// ─── Step 3: SUBSCRIBER subscribes (BEFORE createHatch, so pass.mintedAt < embargoStart for grandfather rule)
log("=== Step 3: SUBSCRIBER subscribe(7d) ===");
t0 = t();
const sub = await subscribe({
  config, publicClient, walletClient: PUB.wallet, storyClient: SUB.story, minterAccount: PUB.acct,
  subscriber: SUB.addr, publisherRootIpId: pubDesc.publisherRootIpId,
  subscriptionTermsId: pubDesc.subscriptionTermsId,
  durationDays: 7, subPriceWip: parseEther("0.01"),
});
record("step3_subscribe", true, { subLicenseTokenId: sub.subLicenseTokenId.toString(), passId: sub.passId.toString(), tx: sub.mintPassTx, latencyS: ((t()-t0)/1000).toFixed(1) });

// ─── Step 4: createHatch (dual mode, text + 1 small image). embargoStart now > pass.mintedAt.
log("=== Step 4: createHatch dual ===");
t0 = t();
const base = await chainNow();
const embargoStart = BigInt(base + 30);
const revealAt = BigInt(base + 300);
const imgBytes = new Uint8Array(randomBytes(512)); // simulated 512-byte image
const imgSha = createHash("sha256").update(imgBytes).digest("hex");
const hatchText = "Day 4 round-trip — dual hatch unlocks at revealAt.";
const hatchDesc = await createHatch({
  config, publicClient, walletClient: PUB.wallet, storyClient: PUB.story, account: PUB.acct,
  publisherRootIpId: pubDesc.publisherRootIpId, spgNftContract: pubDesc.spgNftContract,
  subscriptionTermsId: pubDesc.subscriptionTermsId,
  content: { text: hatchText, media: [{ bytes: imgBytes, name: "preview.bin", mime: "application/octet-stream" }] },
  mode: 2, // dual
  perHatchPriceWip: parseEther("0.01"),
  embargoStart, revealAt,
  outcomeSpec: { kind: "price", description: "Day 4 outcome — example price target hit?" },
});
record("step4_createHatch", true, { uuid: hatchDesc.uuid, signalIp: hatchDesc.signalIpId, perHatchTermsId: hatchDesc.perHatchTermsId.toString(), tx: hatchDesc.txHashes.write, latencyS: ((t()-t0)/1000).toFixed(1) });

// Wait for embargoStart before in-window reads
await wait(Number(embargoStart) + 5);

// ─── Step 5: SUBSCRIBER reads via wallet (subscription)
log("=== Step 5: SUBSCRIBER readHatch via wallet (subscription) ===");
t0 = t();
const r5 = await readHatch({
  config, publicClient, uuid: hatchDesc.uuid,
  entitlement: { kind: 1, passId: sub.passId }, via: "wallet",
  walletClient: SUB.wallet, account: SUB.acct,
});
const r5sha = createHash("sha256").update(r5.media[0].bytes).digest("hex");
const r5ok = r5.text === hatchText && r5sha === imgSha && r5.media[0].bytes.byteLength === 512;
record("step5_read_wallet_subscription", r5ok, { text: r5.text.slice(0, 40), byteExact: r5sha === imgSha, reader: r5.reader, lat: (r5.latencyMs/1000).toFixed(1), tx: r5.txHash });

// ─── Step 6: SUBSCRIBER reads via anonymous (ephemeral pool buys + reads inside the lease)
// Canonical anonymous-reader pattern: ephemeral wallet mints a fresh per-hatch license
// in its own name, reads with kind=0, then is sweept. SUBSCRIBER's address never appears.
log("=== Step 6: anonymous in-window read via ephemeral pool (buy+read+sweep) ===");
const poolAddrs = pool.addresses();
log(`pool addresses (4): ${poolAddrs.join(", ")}`);
t0 = t();
const r6 = await pool.withLease(parseEther("0.1"), async ({ address: ephAddr, wallet: ephWallet }) => {
  const { CDRClient } = await import("@piplabs/cdr-sdk");
  const { StoryClient } = await import("@story-protocol/core-sdk");
  const { privateKeyToAccount } = await import("viem/accounts");
  const ephAcct = ephWallet.account;
  const ephStory = StoryClient.newClient({ account: ephAcct, transport: (await import("viem")).http(RPC_URL), chainId: "aeneid" });
  const mint = await ephStory.license.mintLicenseTokens({
    licensorIpId: hatchDesc.signalIpId, licenseTermsId: hatchDesc.perHatchTermsId,
    amount: 1, maxMintingFee: parseEther("0.1"), receiver: ephAddr,
  });
  const licId = BigInt(mint.licenseTokenIds[0]);
  const cdr = new CDRClient({ network: "testnet", publicClient, walletClient: ephWallet, apiUrl: config.chain.storyApiUrl });
  const aux = encodeAbiParameters(
    [{ type: "uint8" }, { type: "bytes" }],
    [0, encodeAbiParameters([{ type: "uint256[]" }], [[licId]])],
  );
  const tStart = performance.now();
  const { dataKey, txHash } = await cdr.consumer.accessCDR({ uuid: hatchDesc.uuid, accessAuxData: aux });
  const { parseManifest } = await import("../sdk/dist/manifest.js");
  const parsed = await parseManifest({ storage, manifestBytes: dataKey });
  return { ...parsed, reader: ephAddr, txHash, latencyMs: performance.now() - tStart, licenseTokenId: licId };
});
const r6sha = createHash("sha256").update(r6.media[0].bytes).digest("hex");
const r6Ephemeral = poolAddrs.map((a) => a.toLowerCase()).includes(r6.reader.toLowerCase());
const r6HidesSub = r6.reader.toLowerCase() !== SUB.addr.toLowerCase();
record("step6_read_anonymous", r6.text === hatchText && r6sha === imgSha && r6Ephemeral && r6HidesSub, {
  reader: r6.reader, fromEphemeralPool: r6Ephemeral, hidesSubscriber: r6HidesSub,
  ephemeralLicense: r6.licenseTokenId.toString(),
  lat: (r6.latencyMs/1000).toFixed(1), tx: r6.txHash,
});

// ─── Step 7: SUBSCRIBER2 (ANON wallet) buys per-hatch + reads kind 0
log("=== Step 7: SUBSCRIBER2 buyHatch + readHatch kind 0 ===");
t0 = t();
const buy = await buyHatch({
  storyClient: SUB2.story, signalIpId: hatchDesc.signalIpId,
  perHatchTermsId: hatchDesc.perHatchTermsId, receiver: SUB2.addr,
});
const r7 = await readHatch({
  config, publicClient, uuid: hatchDesc.uuid,
  entitlement: { kind: 0, licenseTokenIds: [buy.licenseTokenId] }, via: "wallet",
  walletClient: SUB2.wallet, account: SUB2.acct,
});
const r7sha = createHash("sha256").update(r7.media[0].bytes).digest("hex");
record("step7_buyHatch_perHatch_read", r7.text === hatchText && r7sha === imgSha, {
  licenseTokenId: buy.licenseTokenId.toString(), reader: r7.reader, lat: (r7.latencyMs/1000).toFixed(1), tx: r7.txHash,
});

// ─── Step 8: operator signs + submits attestation
log("=== Step 8: signAttestation + submitAttestation ===");
t0 = t();
const hatchId = keccak256(toBytes(`hatch-${hatchDesc.uuid}`));
const outcomeHash = keccak256(toBytes(`outcome-payload-${hatchDesc.uuid}`));
const att = {
  hatchId, outcomeHash, outcomeValue: 12345n,
  observedAt: BigInt(Math.floor(Date.now() / 1000)),
  nonce: BigInt(Date.now()),
};
const sig = await signAttestation({ config, walletClient: PUB.wallet, account: PUB.acct, att });
const onChainDigest = await publicClient.readContract({
  address: config.hatch.oracle,
  abi: [{ type: "function", name: "attestationDigest", stateMutability: "view",
    inputs: [{ type: "tuple", components: [
      { name: "hatchId", type: "bytes32" }, { name: "outcomeHash", type: "bytes32" },
      { name: "outcomeValue", type: "int256" }, { name: "observedAt", type: "uint64" }, { name: "nonce", type: "uint256" },
    ]}], outputs: [{ type: "bytes32" }] }],
  functionName: "attestationDigest", args: [att],
});
const submitTx = await submitAttestation({ config, publicClient, walletClient: PUB.wallet, account: PUB.acct, att, signature: sig });
record("step8_attestation_submit", true, { hatchId, onChainDigest, submitTx, latencyS: ((t()-t0)/1000).toFixed(1) });

// ─── Step 9: wait revealAt, anonymous post-reveal read with empty aux
log("=== Step 9: wait revealAt + anonymous post-reveal read ===");
await wait(Number(revealAt) + 5);
t0 = t();
const r9 = await readHatch({
  config, publicClient, uuid: hatchDesc.uuid,
  entitlement: "empty", via: "anonymous", pool,
});
const r9sha = createHash("sha256").update(r9.media[0].bytes).digest("hex");
const r9Ephemeral = poolAddrs.map((a) => a.toLowerCase()).includes(r9.reader.toLowerCase());
record("step9_postReveal_anonymous", r9.text === hatchText && r9sha === imgSha && r9Ephemeral, {
  reader: r9.reader, fromEphemeralPool: r9Ephemeral, lat: (r9.latencyMs/1000).toFixed(1), tx: r9.txHash,
});

// ─── Step 10: finalize attestation (challenge window has long since passed)
log("=== Step 10: finalize + getOutcome ===");
t0 = t();
const finTx = await finalize({ config, publicClient, walletClient: PUB.wallet, account: PUB.acct, hatchId });
const outcome = await getOutcome({ config, publicClient, hatchId });
record("step10_finalize_getOutcome", outcome.status === 3, {
  status: outcome.status, outcomeValue: outcome.outcomeValue.toString(), operator: outcome.operator, finTx, latencyS: ((t()-t0)/1000).toFixed(1),
});

// ─── Summary
const passing = Object.values(results).filter((r) => r.ok).length;
const total = Object.keys(results).length;
log(`\nROUND-TRIP: ${passing}/${total} steps PASS · ${passing === total ? "✅ ALL OK" : "❌"}`);
const finalBalances = {
  PUBLISHER: formatEther(await publicClient.getBalance({ address: PUB.addr })),
  SUBSCRIBER: formatEther(await publicClient.getBalance({ address: SUB.addr })),
  SUBSCRIBER2: formatEther(await publicClient.getBalance({ address: SUB2.addr })),
};
log("final balances:", finalBalances);
writeFileSync(new URL("../.build3-roundtrip.json", import.meta.url), JSON.stringify({
  hatchDesc: { ...hatchDesc, embargoStart: hatchDesc.embargoStart.toString(), revealAt: hatchDesc.revealAt.toString(), perHatchTermsId: hatchDesc.perHatchTermsId.toString() },
  pubDesc: { ...pubDesc, subscriptionTermsId: pubDesc.subscriptionTermsId.toString() },
  results, passing, total, finalBalances,
}, null, 2));
process.exit(passing === total ? 0 : 1);
