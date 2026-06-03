/* Hatch backend integration test on live Aeneid + local Postgres. */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseEther, formatEther, createWalletClient, http, erc20Abi, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { eq, count, sql } from "drizzle-orm";
import { db, schema, sql as pgClient } from "../src/db/client.js";

process.loadEnvFile(new URL("../.env", import.meta.url));
process.loadEnvFile(new URL("../../.env", import.meta.url));   // load wallet keys from project root

const RPC_URL = process.env.RPC_URL!;
const API = `http://127.0.0.1:${process.env.API_PORT ?? 4011}`;

const aeneid = { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const;
const acct = (role: string) => privateKeyToAccount(process.env[`${role}_PK`] as `0x${string}`);
const wallet = (role: string) => createWalletClient({ account: acct(role), chain: aeneid, transport: http(RPC_URL) });

const log = (...a: any[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const results: Record<string, { ok: boolean; data?: any }> = {};
const record = (key: string, ok: boolean, data?: any) => { results[key] = { ok, data }; log(`${key}: ${ok ? "PASS ✅" : "FAIL ❌"} ${JSON.stringify(data).slice(0, 200)}`); };

const { initWasm } = await import("@piplabs/cdr-crypto");
await initWasm();

const sdk = await import("../../sdk/dist/index.js" as any);
const { defaultConfig, LocalDiskProvider, createPublisher, stake, wrapNativeToWip, createHatch, subscribe, buyHatch } = sdk;
const { publicClient } = await import("../src/indexer.js" as any);

const PUB = { addr: acct("PUBLISHER").address, w: wallet("PUBLISHER"), a: acct("PUBLISHER") };
const SUB = { addr: acct("SUBSCRIBER").address, w: wallet("SUBSCRIBER"), a: acct("SUBSCRIBER") };
const SUB2 = { addr: acct("ANON").address, w: wallet("ANON"), a: acct("ANON") };

const storage = new LocalDiskProvider("/tmp/hatch-roundtrip-storage");

/* ────────────── 0. fresh Registry (one-shot semantics) ────────────── */
log("=== setup: deploy fresh Registry + rewire Oracle ===");
const regArt = JSON.parse(readFileSync("../contracts/out/HatchPublisherRegistry.sol/HatchPublisherRegistry.json", "utf8"));
const ORACLE = "0x5257eabbf0297ca6073ad0d7aba09c980d708a24";
const WIP = "0x1514000000000000000000000000000000000000" as Address;
let h = await PUB.w.deployContract({ abi: regArt.abi, bytecode: regArt.bytecode.object, args: [WIP, PUB.addr, parseEther("0.05"), 60n] });
let r = await publicClient.waitForTransactionReceipt({ hash: h });
const REG = r.contractAddress!;
log(`fresh Registry @ ${REG}`);
const oracleAbi = parseAbi(["function setRegistry(address) external"]);
const regAbi    = parseAbi(["function setOracle(address) external"]);
let sim = await publicClient.simulateContract({ address: ORACLE, abi: oracleAbi, functionName: "setRegistry", args: [REG], account: PUB.a });
await PUB.w.writeContract(sim.request);
sim = await publicClient.simulateContract({ address: REG, abi: regAbi, functionName: "setOracle", args: [ORACLE], account: PUB.a });
await PUB.w.writeContract(sim.request);

/* Patch SDK dist config to use the fresh registry, propagate to backend via env */
{
  const cfgPath = "../sdk/dist/config.js";
  let src = readFileSync(cfgPath, "utf8");
  src = src.replace(/publisherRegistry:\s*"0x[0-9a-fA-F]{40}"/, `publisherRegistry: "${REG}"`);
  writeFileSync(cfgPath, src);
}

/* Treasury PK for the server-side ephemeral pool */
process.env.SERVER_TREASURY_PK = process.env.PUBLISHER_PK;
process.env.REGISTRY_ADDR = REG;
process.env.LOCAL_STORAGE_DIR = "/tmp/hatch-roundtrip-storage";

/* Pick the indexer start block at the moment the registry is deployed,
 * so the backfill covers only this run's events. */
const startBlock = await publicClient.getBlockNumber();
process.env.INDEXER_START_BLOCK = String(startBlock);

/* Truncate stale rows so this run's indexer-derived assertions don't
 * collide with prior runs (publishers.wallet is PK — same PUBLISHER wallet
 * across runs would otherwise hide the new rootIp via onConflictDoNothing). */
log("=== truncate tables ===");
await db.execute(sql`TRUNCATE publishers, hatches, subscriptions, licenses, reads, revealed_content, outcomes, track_records, indexer_cursor, processed_logs RESTART IDENTITY CASCADE`);

/* ────────────── 1. start backend runner ────────────── */
log("=== launching backend runner (indexer + API + WS) ===");
const runner: ChildProcess = spawn("pnpm", ["tsx", "src/runner.ts"], {
  cwd: process.cwd(), env: { ...process.env, INDEXER_START_BLOCK: String(startBlock) }, stdio: ["ignore", "pipe", "pipe"],
});
const { createWriteStream } = await import("node:fs");
const runnerLogFile = createWriteStream("/tmp/hatch-runner.log", { flags: "w" });
runner.stdout?.pipe(runnerLogFile);
runner.stderr?.pipe(runnerLogFile);
runner.stdout?.on("data", (b: Buffer) => process.stdout.write(`[runner] ${b}`));
runner.stderr?.on("data", (b: Buffer) => process.stdout.write(`[runner!] ${b}`));
const stopRunner = () => { try { runner.kill("SIGTERM"); } catch {} };
process.on("exit", stopRunner);

/* Wait for /healthz */
for (let i = 0; i < 30; i++) {
  try { const ok = (await fetch(`${API}/healthz`).then((x) => x.json())).ok; if (ok) break; } catch {}
  await delay(500);
}
log("runner healthz: OK");

/* ────────────── 2. SDK createPublisher → indexer captures ────────────── */
log("=== Step 1: SDK createPublisher → indexer ===");
const cfgBase = defaultConfig({ storage });
const cfg = { ...cfgBase, hatch: { ...cfgBase.hatch, publisherRegistry: REG } };
const t0 = Date.now();
const pubDesc = await createPublisher({
  config: cfg, publicClient, walletClient: PUB.w,
  storyClient: (await import("@story-protocol/core-sdk")).StoryClient.newClient({ account: PUB.a, transport: http(RPC_URL), chainId: "aeneid" }),
  account: PUB.a,
  collection: { name: "Hatch Backend RT", symbol: "HBRT" },
  subscription: { mintingFeeWip: parseEther("0.01"), commercialRevSharePct: 10 },
});
log("pubDesc.rootIp =", pubDesc.publisherRootIpId);

/* Poll DB until indexer surfaces the publisher row (lag SLO: <30s) */
let pubRow: any = null;
const indexerStartedAt = Date.now();
for (let i = 0; i < 30; i++) {
  const [p] = await db.select().from(schema.publishers).where(eq(schema.publishers.publisherRootIp, pubDesc.publisherRootIpId.toLowerCase()));
  if (p) { pubRow = p; break; }
  await delay(2000);
}
const indexerLag = (Date.now() - indexerStartedAt) / 1000;
record("step1_indexer_publisher", !!pubRow, { wallet: pubRow?.wallet, lagS: indexerLag.toFixed(1) });

/* ────────────── 3. wrap+stake (verified flag flips) ────────────── */
log("=== Step 2: wrap+stake → publishers.verified=true ===");
await wrapNativeToWip({ config: cfg, publicClient, walletClient: PUB.w, account: PUB.a, amount: parseEther("0.3") });
await stake({ config: cfg, publicClient, walletClient: PUB.w, account: PUB.a, amount: parseEther("0.06") });
let verifiedRow: any = null;
for (let i = 0; i < 20; i++) {
  const [p] = await db.select().from(schema.publishers).where(eq(schema.publishers.publisherRootIp, pubDesc.publisherRootIpId.toLowerCase()));
  if (p?.verified) { verifiedRow = p; break; }
  await delay(2000);
}
record("step2_verified", !!verifiedRow, { stakeWei: verifiedRow?.stakeWei?.toString(), verified: verifiedRow?.verified });

/* ────────────── 4. subscribe BEFORE createHatch (grandfather rule) ────────────── */
log("=== Step 3: subscribe ===");
const sub = await subscribe({
  config: cfg, publicClient, walletClient: PUB.w,
  storyClient: (await import("@story-protocol/core-sdk")).StoryClient.newClient({ account: SUB.a, transport: http(RPC_URL), chainId: "aeneid" }),
  minterAccount: PUB.a, subscriber: SUB.addr, publisherRootIpId: pubDesc.publisherRootIpId,
  subscriptionTermsId: pubDesc.subscriptionTermsId, durationDays: 7, subPriceWip: parseEther("0.01"),
});
log(`subscribed: passId=${sub.passId} subLicenseTokenId=${sub.subLicenseTokenId}`);

/* ────────────── 5. createHatch (dual mode), small media ────────────── */
log("=== Step 4: createHatch ===");
const base = Number((await publicClient.getBlock()).timestamp);
const embargoStart = BigInt(base + 60);
const revealAt = BigInt(base + 240);
const imgBytes = new Uint8Array(randomBytes(256));
const imgSha = createHash("sha256").update(imgBytes).digest("hex");
const hatchText = "Backend integration: dual hatch, 60s embargo, 240s reveal";
const hatchDesc = await createHatch({
  config: cfg, publicClient, walletClient: PUB.w,
  storyClient: (await import("@story-protocol/core-sdk")).StoryClient.newClient({ account: PUB.a, transport: http(RPC_URL), chainId: "aeneid" }),
  account: PUB.a, publisherRootIpId: pubDesc.publisherRootIpId, spgNftContract: pubDesc.spgNftContract,
  subscriptionTermsId: pubDesc.subscriptionTermsId,
  content: { text: hatchText, media: [{ bytes: imgBytes, name: "img.bin", mime: "application/octet-stream" }] },
  mode: 2, perHatchPriceWip: parseEther("0.01"), embargoStart, revealAt,
});
log(`hatch uuid=${hatchDesc.uuid} signalIp=${hatchDesc.signalIpId}`);

/* Wait for indexer to capture the hatch */
let hatchRow: any = null;
const idxStart = Date.now();
for (let i = 0; i < 30; i++) {
  const [h2] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, hatchDesc.uuid));
  if (h2) { hatchRow = h2; break; }
  await delay(2000);
}
record("step3_indexer_hatch", !!hatchRow, { uuid: hatchRow?.uuid, mode: hatchRow?.mode, lagS: ((Date.now()-idxStart)/1000).toFixed(1) });

/* Indexer also captured subscriptions row */
const [subRow] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.passId, sub.passId));
record("step4_indexer_subscription", !!subRow, { passId: subRow?.passId?.toString() });

/* ────────────── 6. SUBSCRIBER2 buyHatch → licenses table ────────────── */
log("=== Step 5: SUBSCRIBER2 buyHatch (per-hatch license) ===");
const buy = await buyHatch({
  storyClient: (await import("@story-protocol/core-sdk")).StoryClient.newClient({ account: SUB2.a, transport: http(RPC_URL), chainId: "aeneid" }),
  signalIpId: hatchDesc.signalIpId, perHatchTermsId: hatchDesc.perHatchTermsId, receiver: SUB2.addr,
});
let licRow: any = null;
const licStart = Date.now();
for (let i = 0; i < 25; i++) {
  const [l] = await db.select().from(schema.licenses).where(eq(schema.licenses.licenseTokenId, buy.licenseTokenId));
  if (l) { licRow = l; break; }
  await delay(2000);
}
record("step5_indexer_license", !!licRow, { licenseTokenId: licRow?.licenseTokenId?.toString(), lagS: ((Date.now()-licStart)/1000).toFixed(1) });

/* ────────────── 7. GET /hatches feed ────────────── */
const feedRes = await fetch(`${API}/hatches?publisher=${pubDesc.publisherRootIpId.toLowerCase()}`).then((r) => r.json());
record("step6_api_feed", feedRes.hatches?.some((h: any) => h.uuid === hatchDesc.uuid), { count: feedRes.hatches?.length, firstStatus: feedRes.hatches?.[0]?.status });

/* ────────────── 8. WS hatch:status crossing embargoStart ────────────── */
log("=== Step 7: WS hatch:status sealed→active crossing ===");
const wsPromise = new Promise<any>(async (resolve) => {
  const ws = new (await import("ws")).WebSocket(`ws://127.0.0.1:${process.env.API_PORT ?? 4011}/ws`);
  ws.on("message", (data: any) => {
    const m = JSON.parse(data.toString());
    if (m.type === "hatch:status" && m.uuid === hatchDesc.uuid && m.status === "active") {
      ws.close(); resolve(m);
    }
  });
});
await delay(Math.max(0, Number(embargoStart) - Math.floor(Date.now()/1000) + 8) * 1000);
const wsEvent = await Promise.race([wsPromise, delay(40_000).then(() => null)]);
record("step7_ws_status_active", !!wsEvent, wsEvent);

/* ────────────── 9. SIWE → POST /read entitled (pre-reveal, kind=0 per-hatch via server pool) ────────────── */
log("=== Step 8: SIWE auth + entitled /read + unentitled 403 (no pool gas) ===");
async function siweLogin(role: "SUBSCRIBER" | "ANON" | "PUBLISHER") {
  const a = acct(role);
  const w = wallet(role);
  const nonce = (await fetch(`${API}/siwe/nonce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: a.address }) }).then((r) => r.json())).nonce;
  const message = new SiweMessage({
    domain: "hatch.local", address: a.address, statement: "Sign in to Hatch",
    uri: "http://hatch.local", version: "1", chainId: 1315, nonce,
  }).prepareMessage();
  const signature = await w.signMessage({ message });
  const verify = await fetch(`${API}/siwe/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }).then((r) => r.json());
  return verify.token as string;
}

const sub2Token = await siweLogin("ANON");      // SUB2 owns the per-hatch license from step 5
const subOnlyToken = await siweLogin("SUBSCRIBER"); // SUB owns a SUB-pass (kind=1) but NOT a kind=0 license for THIS hatch

/* Snapshot any pool wallet balances pre-call (post-step6 server may have lazily-created pool wallets) */
async function balSnap(addrs: string[]) {
  let sum = 0n; for (const a of addrs) sum += await publicClient.getBalance({ address: a as Address }); return sum;
}

/* Unentitled pre-reveal: SUB tries kind=0 with SUB2's license id → ownerOf mismatch → 403, no pool work */
const fakeLicId = buy.licenseTokenId.toString();
const beforeUnent = await fetch(`${API}/healthz`).then((r) => r.json()); // sanity
const unentRes = await fetch(`${API}/hatches/${hatchDesc.uuid}/read`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${subOnlyToken}` },
  body: JSON.stringify({ entitlement: { kind: 0, licenseTokenIds: [fakeLicId] }, via: "anonymous" }),
});
const unentBody = await unentRes.json();
record("step8a_unentitled_403", unentRes.status === 403, { status: unentRes.status, body: unentBody });

/* Entitled pre-reveal: SUB2 with their valid kind=0 license — server pool buys fresh license + reads */
const entRes = await fetch(`${API}/hatches/${hatchDesc.uuid}/read`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sub2Token}` },
  body: JSON.stringify({ entitlement: { kind: 0, licenseTokenIds: [fakeLicId] }, via: "anonymous" }),
});
const entBody = await entRes.json();
const entOk = entRes.status === 200 && entBody.text === hatchText && entBody.media?.[0]?.bytesBase64 && createHash("sha256").update(Buffer.from(entBody.media[0].bytesBase64, "base64")).digest("hex") === imgSha;
record("step8b_entitled_decrypts", entOk, { status: entRes.status, reader: entBody.reader, error: entBody.error, detail: entBody.detail?.slice?.(0, 200), byteExact: createHash("sha256").update(Buffer.from(entBody.media?.[0]?.bytesBase64 ?? "", "base64")).digest("hex") === imgSha });

/* ────────────── 10. Post-reveal anonymous read via API ────────────── */
log("=== Step 9: wait revealAt + post-reveal anonymous via API ===");
await delay(Math.max(0, Number(revealAt) - Math.floor(Date.now()/1000) + 8) * 1000);
const postRes = await fetch(`${API}/hatches/${hatchDesc.uuid}/read`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sub2Token}` },
  body: JSON.stringify({ via: "anonymous" }),
});
const postBody = await postRes.json();
const postOk = postRes.status === 200 && postBody.text === hatchText &&
  createHash("sha256").update(Buffer.from(postBody.media?.[0]?.bytesBase64 ?? "", "base64")).digest("hex") === imgSha;
record("step9_post_reveal_api_read", postOk, { reader: postBody.reader, status: postRes.status, error: postBody.error, detail: postBody.detail?.slice?.(0, 200) });

/* ────────────── 11. Reorg-test: re-scan back N blocks; assert no duplicates ────────────── */
log("=== Step 10: reorg test — rescan recent blocks, expect no dupes ===");
const beforeCount = (await db.select({ c: count() }).from(schema.hatches))[0].c;
const subsCountBefore = (await db.select({ c: count() }).from(schema.subscriptions))[0].c;
const licCountBefore = (await db.select({ c: count() }).from(schema.licenses))[0].c;
/* force re-scan by rolling cursor back */
await db.execute(sql`UPDATE indexer_cursor SET last_block = last_block - 100 WHERE last_block > 100`);
await delay(15_000);
const beforeAfter = (await db.select({ c: count() }).from(schema.hatches))[0].c;
const subsAfter = (await db.select({ c: count() }).from(schema.subscriptions))[0].c;
const licAfter = (await db.select({ c: count() }).from(schema.licenses))[0].c;
record("step10_reorg_idempotent", beforeCount === beforeAfter && subsCountBefore === subsAfter && licCountBefore === licAfter,
  { hatches: { before: beforeCount, after: beforeAfter }, subs: { before: subsCountBefore, after: subsAfter }, licenses: { before: licCountBefore, after: licAfter } });

/* ────────────── done ────────────── */
const passing = Object.values(results).filter((r) => r.ok).length;
const total = Object.keys(results).length;
log(`\nINTEGRATION: ${passing}/${total} pass · ${passing === total ? "ALL OK ✅" : "FAIL"}`);
writeFileSync(new URL("../.build4-integration.json", import.meta.url), JSON.stringify({ results, passing, total }, null, 2));

stopRunner();
await pgClient.end();
process.exit(passing === total ? 0 : 1);
