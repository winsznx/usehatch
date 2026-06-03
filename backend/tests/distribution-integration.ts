/* Build 6 distribution integration test — Bluesky + Resend + Web Push + WS auth + follows.
 *  Live Aeneid + local Postgres + Redis + live Bluesky + live Resend. */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync, createWriteStream } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseEther, createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { eq, sql, count, and } from "drizzle-orm";
import IORedis from "ioredis";
import { AtpAgent } from "@atproto/api";
import { db, schema, sql as pgClient } from "../src/db/client.js";
import { unstickWallet } from "../../scripts/test-rbf.mjs";

// Load root .env first, backend .env second so backend can override (matches loadEnv cascade).
process.loadEnvFile(new URL("../../.env", import.meta.url));
try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* optional */ }
// Patch fetch so viem's eth_fillTransaction probe gets a MethodNotSupported response
// (viem then caches the unsupported flag and stops trying it). Aeneid's RPC otherwise
// returns -32000 "Missing or invalid parameters" which viem mis-treats as a real failure.
const { installAeneidFetchPatch } = await import("../src/transport.ts" as any);
installAeneidFetchPatch();

const RPC_URL = process.env.RPC_URL!;
const API_PORT = process.env.API_PORT ?? "4011";
const API = `http://127.0.0.1:${API_PORT}`;
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:55379";
const BSKY_HANDLE = process.env.BSKY_HANDLE;

const aeneid = { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const;
const acct = (role: string) => privateKeyToAccount(process.env[`${role}_PK`] as `0x${string}`);
const wallet = (role: string) => createWalletClient({ account: acct(role), chain: aeneid, transport: http(RPC_URL) });

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const results: Record<string, { ok: boolean; data?: unknown }> = {};
const record = (key: string, ok: boolean, data?: unknown) => { results[key] = { ok, data }; log(`${key}: ${ok ? "PASS ✅" : "FAIL ❌"} ${JSON.stringify(data).slice(0, 240)}`); };

const sdk = await import("../../sdk/dist/index.js" as any);
const { defaultConfig, LocalDiskProvider, ensureWasm, createPublisher, stake, wrapNativeToWip, createHatch, subscribe, hatchIdFor } = sdk;
await ensureWasm();
const { publicClient } = await import("../src/indexer.js" as any);
const { StoryClient } = await import("@story-protocol/core-sdk");
const storyClient = (roleEnv: string) => {
  const a = privateKeyToAccount(process.env[roleEnv] as `0x${string}`);
  return StoryClient.newClient({ account: a, transport: http(RPC_URL), chainId: "aeneid" });
};

const PUB  = { addr: acct("PUBLISHER").address, w: wallet("PUBLISHER"), a: acct("PUBLISHER") };
const SUB  = { addr: acct("SUBSCRIBER").address, w: wallet("SUBSCRIBER"), a: acct("SUBSCRIBER") };
const ANON = { addr: acct("ANON").address, w: wallet("ANON"), a: acct("ANON") };
const storage = new LocalDiskProvider("/tmp/hatch-roundtrip-storage");

/* ─── Part A: test-driver RBF — un-stick PUBLISHER's mempool */
log("=== Part A: test-driver RBF unstick PUBLISHER ===");
const rbf = await unstickWallet({ publicClient, walletClient: PUB.w, account: PUB.a, ageSecs: 20 });
record("partA_test_rbf_unstick", rbf.stuck === 0 || (rbf.replaced as any[]).length > 0, rbf);

/* ─── Setup: fresh Registry + truncate DB + clean Redis */
log("=== setup: fresh Registry + truncate + clean Redis ===");
const regArt = JSON.parse(readFileSync("../contracts/out/HatchPublisherRegistry.sol/HatchPublisherRegistry.json", "utf8"));
const ORACLE = "0x5257eabbf0297ca6073ad0d7aba09c980d708a24";
const WIP = "0x1514000000000000000000000000000000000000" as Address;
const tryDeploy = async () => {
  for (let i = 0; i < 3; i++) {
    try {
      const hx = await PUB.w.deployContract({
        abi: regArt.abi, bytecode: regArt.bytecode.object,
        args: [WIP, PUB.addr, parseEther("0.05"), 60n],
        gas: 1_500_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n,
      });
      const rx = await publicClient.waitForTransactionReceipt({ hash: hx });
      return rx.contractAddress!;
    } catch (e) {
      log(`deploy attempt ${i+1} failed: ${((e as { shortMessage?: string }).shortMessage ?? "").slice(0, 80)}`);
      await delay(5_000);
    }
  }
  throw new Error("registry deploy failed");
};
const REG = await tryDeploy();
const oracleAbi = parseAbi(["function setRegistry(address) external"]);
const regAbi = parseAbi(["function setOracle(address) external"]);
let sim = await publicClient.simulateContract({ address: ORACLE, abi: oracleAbi, functionName: "setRegistry", args: [REG], account: PUB.a });
await PUB.w.writeContract(sim.request);
sim = await publicClient.simulateContract({ address: REG, abi: regAbi, functionName: "setOracle", args: [ORACLE], account: PUB.a });
await PUB.w.writeContract(sim.request);
log(`fresh Registry @ ${REG}`);

await db.execute(sql`TRUNCATE publishers, hatches, subscriptions, licenses, reads, revealed_content, outcomes, track_records, indexer_cursor, processed_logs, follows, sent_notifications, push_subscriptions RESTART IDENTITY CASCADE`);
const redis = new IORedis(REDIS_URL);
const oldKeys = await redis.keys("bull:*");
if (oldKeys.length) await redis.del(...oldKeys);

const startBlock = await publicClient.getBlockNumber();
process.env.SERVER_TREASURY_PK = process.env.PUBLISHER_PK;
process.env.REGISTRY_ADDR = REG;
process.env.LOCAL_STORAGE_DIR = "/tmp/hatch-roundtrip-storage";
process.env.INDEXER_START_BLOCK = String(startBlock);
process.env.TEST_WALLET_PKS = `${SUB.addr.toLowerCase()}=${process.env.SUBSCRIBER_PK}`;
// dev-only email mapping: route both SUB and PUB to a real address so we can observe delivery.
const TEST_INBOX = process.env.TEST_INBOX_EMAIL ?? `delivered@resend.dev`; // Resend's universal test inbox
process.env.TEST_USER_EMAILS = `${SUB.addr.toLowerCase()}=${TEST_INBOX},${PUB.addr.toLowerCase()}=${TEST_INBOX}`;
process.env.REDIS_URL = REDIS_URL;
process.env.REVEAL_POOL_SIZE = "4";

/* ─── spawn runner */
log("=== launch runner (indexer + reveal + bluesky bot + notify + API) ===");
const runner: ChildProcess = spawn("pnpm", ["tsx", "src/runner.ts"], {
  cwd: process.cwd(), env: process.env as Record<string, string>, stdio: ["ignore", "pipe", "pipe"],
});
const runnerLog = createWriteStream("/tmp/hatch-runner.log", { flags: "w" });
runner.stdout?.pipe(runnerLog); runner.stderr?.pipe(runnerLog);
runner.stdout?.on("data", (b: Buffer) => process.stdout.write(`[runner] ${b}`));
runner.stderr?.on("data", (b: Buffer) => process.stdout.write(`[runner!] ${b}`));
process.on("exit", () => { try { runner.kill("SIGTERM"); } catch {} });

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${API}/healthz`).then((x) => x.json())).ok) break; } catch {}
  await delay(500);
}
log("runner ready");

const cfgBase = defaultConfig({ storage });
const cfg = { ...cfgBase, hatch: { ...cfgBase.hatch, publisherRegistry: REG } };

/* ─── prep: createPublisher + stake + subscribe */
log("=== prep: createPublisher + stake + subscribe ===");
// Aeneid RPC intermittently rejects eth_fillTransaction on Story-SDK multi-call flows.
// Retry-wrap with delay between attempts; pure backoff against chain transients.
const withRetry = async <T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> => {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      log(`${label} attempt ${i+1}/${attempts} failed: ${((e as { shortMessage?: string }).shortMessage ?? "").slice(0, 100)}`);
      await delay(8_000);
    }
  }
  throw lastErr;
};

const pubDesc = await withRetry("createPublisher", () => createPublisher({
  config: cfg, publicClient, walletClient: PUB.w, storyClient: storyClient("PUBLISHER_PK"),
  account: PUB.a, collection: { name: `Hatch B6 ${Date.now()}`, symbol: "HB6" }, // unused when spgNftContract is set
  subscription: { mintingFeeWip: parseEther("0.01"), commercialRevSharePct: 10 },
  spgNftContract: "0xc32A8a0FF3beDDDa58393d022aF433e78739FAbc", // Story's public SPG — bypasses Aeneid's createCollection regression
}));
// Persist a displayName so the Bluesky template uses it.
await db.update(schema.publishers).set({ displayName: "winszn" }).where(eq(schema.publishers.publisherRootIp, pubDesc.publisherRootIpId));
await wrapNativeToWip({ config: cfg, publicClient, walletClient: PUB.w, account: PUB.a, amount: parseEther("0.3") });
await stake({ config: cfg, publicClient, walletClient: PUB.w, account: PUB.a, amount: parseEther("0.06") });
const sub = await withRetry("subscribe", () => subscribe({
  config: cfg, publicClient, walletClient: PUB.w, storyClient: storyClient("SUBSCRIBER_PK"),
  minterAccount: PUB.a, subscriber: SUB.addr, publisherRootIpId: pubDesc.publisherRootIpId,
  subscriptionTermsId: pubDesc.subscriptionTermsId, durationDays: 7, subPriceWip: parseEther("0.01"),
}));
log(`pubRoot=${pubDesc.publisherRootIpId} passId=${sub.passId}`);

/* ─── SIWE helper */
const siweSign = async (w: typeof PUB) => {
  const nonce = (await fetch(`${API}/siwe/nonce`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: w.addr }) }).then((r) => r.json())).nonce;
  const message = new SiweMessage({ domain: "hatch.local", address: w.addr, statement: "Sign in", uri: "http://hatch.local", version: "1", chainId: 1315, nonce }).prepareMessage();
  const signature = await w.w.signMessage({ message });
  return (await fetch(`${API}/siwe/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }).then((r) => r.json())).token as string;
};
const subTok = await siweSign(SUB);
const anonTok = await siweSign(ANON);

/* ─── Step 5: follow + unfollow */
log("=== Step 5: follow + unfollow ===");
const followRes = await fetch(`${API}/follow`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${anonTok}` }, body: JSON.stringify({ publisherRootIp: pubDesc.publisherRootIpId }) }).then((r) => r.json());
const followsRes = await fetch(`${API}/follows/${ANON.addr.toLowerCase()}`).then((r) => r.json());
const followersRes = await fetch(`${API}/followers/${pubDesc.publisherRootIpId.toLowerCase()}`).then((r) => r.json());
const unfollowRes = await fetch(`${API}/follow`, { method: "DELETE", headers: { "content-type": "application/json", authorization: `Bearer ${anonTok}` }, body: JSON.stringify({ publisherRootIp: pubDesc.publisherRootIpId }) }).then((r) => r.json());
const afterUnfollow = await fetch(`${API}/follows/${ANON.addr.toLowerCase()}`).then((r) => r.json());
// Re-follow for later steps (ANON gets reveal email/push as a follower).
await fetch(`${API}/follow`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${anonTok}` }, body: JSON.stringify({ publisherRootIp: pubDesc.publisherRootIpId }) });
record("step5_follow_unfollow", followRes.ok && followsRes.publishers?.length === 1 && followersRes.followers?.length === 1 && unfollowRes.ok && afterUnfollow.publishers?.length === 0, { followRes, followsRes, followersRes, unfollowRes, afterUnfollow });

/* ─── Register a synthetic push subscription for SUB so step 4 can verify delivery attempt */
const fakeEndpoint = `https://localhost.test/push-${Date.now()}`;
const pushReg = await fetch(`${API}/push/subscribe`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${subTok}` },
  body: JSON.stringify({ endpoint: fakeEndpoint, keys: { p256dh: Buffer.from(randomBytes(65)).toString("base64url"), auth: Buffer.from(randomBytes(16)).toString("base64url") } }),
}).then((r) => r.json());
log(`push subscription registered: ${pushReg.ok}`);

/* ─── Step 6: WS auth — invalid rejected; valid + my-publishers routes correctly */
log("=== Step 6: WS auth + my-publishers routing ===");
const WS = (await import("ws")).WebSocket;
const tryWs = (url: string) => new Promise<{ connected: boolean; hello?: any; closed?: number }>((resolve) => {
  const w = new WS(url);
  const out: { connected: boolean; hello?: any; closed?: number } = { connected: false };
  w.on("open", () => { out.connected = true; });
  w.on("message", (b: any) => { const m = JSON.parse(b.toString()); if (m.type === "hello") out.hello = m; });
  w.on("close", (code) => { out.closed = code; resolve(out); });
  w.on("error", () => { /* swallow — close follows */ });
  setTimeout(() => { try { w.close(); } catch {} resolve(out); }, 3000);
});
const wsNoAuth = await tryWs(`ws://127.0.0.1:${API_PORT}/ws?channel=my-publishers`);
const wsGoodAuth = await tryWs(`ws://127.0.0.1:${API_PORT}/ws?channel=my-publishers&token=${subTok}`);
record("step6_ws_auth", !wsNoAuth.hello && !!wsGoodAuth.hello, {
  noAuth: { connected: wsNoAuth.connected, hello: !!wsNoAuth.hello, closeCode: wsNoAuth.closed },
  goodAuth: { connected: wsGoodAuth.connected, hello: wsGoodAuth.hello, followingCount: wsGoodAuth.hello?.followingCount },
});

/* ─── Steps 2,3,4,8: create hatch + watch Bluesky post + email/push + idempotency */
log("=== Steps 2/3/4: create hatch + observe Bluesky + email + push ===");
const base = Number((await publicClient.getBlock()).timestamp);
const embargoStart = BigInt(base + 30);
const revealAt = BigInt(base + 90);
const img = new Uint8Array(randomBytes(256));
const text = "Build 6 distribution test";
const hd = await withRetry("createHatch", () => createHatch({
  config: cfg, publicClient, walletClient: PUB.w, storyClient: storyClient("PUBLISHER_PK"),
  account: PUB.a, publisherRootIpId: pubDesc.publisherRootIpId, spgNftContract: pubDesc.spgNftContract,
  subscriptionTermsId: pubDesc.subscriptionTermsId,
  content: { text, media: [{ bytes: img, name: "p.bin", mime: "application/octet-stream" }] },
  mode: 2, perHatchPriceWip: parseEther("0.01"), embargoStart, revealAt, title: "Distribution probe",
}));
log(`hatch uuid=${hd.uuid}`);
// Open a WS to verify the my-publishers event fires for ANON (follower) + SUB (subscriber).
const anonWsP = new Promise<any[]>((resolve) => {
  const w = new WS(`ws://127.0.0.1:${API_PORT}/ws?channel=my-publishers&token=${anonTok}`);
  const events: any[] = [];
  w.on("message", (b: any) => { const m = JSON.parse(b.toString()); if (m.type) events.push(m); });
  setTimeout(() => { try { w.close(); } catch {} resolve(events); }, 130_000);
});

const targetMs = Number(revealAt) * 1000;
// Wait for revealed_content + posted_uri + sent_notifications
let postedUri: string | null = null;
let revealedRow: any = null;
let emailRows = 0, pushRows = 0;
for (let i = 0; i < 80; i++) {
  const [r] = await db.select().from(schema.revealedContent).where(eq(schema.revealedContent.hatchUuid, hd.uuid));
  if (r) revealedRow = r;
  const [h2] = await db.select({ postedUri: schema.hatches.postedUri }).from(schema.hatches).where(eq(schema.hatches.uuid, hd.uuid));
  if (h2?.postedUri) postedUri = h2.postedUri;
  const [{ c: emailC }] = await db.select({ c: count() }).from(schema.sentNotifications).where(and(eq(schema.sentNotifications.hatchUuid, hd.uuid), eq(schema.sentNotifications.channel, "email"), eq(schema.sentNotifications.eventType, "reveal")));
  const [{ c: pushC }] = await db.select({ c: count() }).from(schema.sentNotifications).where(and(eq(schema.sentNotifications.hatchUuid, hd.uuid), eq(schema.sentNotifications.channel, "push"), eq(schema.sentNotifications.eventType, "reveal")));
  emailRows = Number(emailC); pushRows = Number(pushC);
  if (revealedRow && postedUri && emailRows && pushRows) break;
  await delay(2000);
}
const revealLagS = revealedRow ? ((Date.now() - targetMs) / 1000) : Infinity;
record("step3_reveal", !!revealedRow, { lagS: revealLagS.toFixed(1), hatch: hd.uuid });
record("step2_bluesky_post", !!postedUri, { postedUri });
record("step3_email_sent_rows", emailRows >= 1, { emailRows });
record("step4_push_attempted_rows", pushRows >= 1, { pushRows });

/* ─── Step 2 detail: pull the post from Bluesky and confirm content match */
if (postedUri && BSKY_HANDLE) {
  try {
    const a = new AtpAgent({ service: "https://bsky.social" });
    await a.login({ identifier: BSKY_HANDLE, password: process.env.BSKY_APP_PASSWORD! });
    const rkey = postedUri.split("/").pop();
    const did = postedUri.split("/")[2];
    const post = await a.getPost({ repo: did, rkey: rkey! });
    record("step2b_bluesky_content_round_trip", typeof post.value.text === "string" && post.value.text.includes("Distribution probe"), { textPreview: post.value.text.slice(0, 200) });
  } catch (e) {
    record("step2b_bluesky_content_round_trip", false, { error: (e as Error).message.slice(0, 200) });
  }
}

/* ─── Step 8: idempotency — enqueue duplicate tweet + duplicate notify; counts hold */
log("=== Step 8: idempotency on duplicate tweet + notify ===");
const { Queue: BullQueue } = await import("bullmq");
const distQ = new BullQueue("hatch-distribute", { connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) });
const blueskyBeforeUri = postedUri;
const emailBefore = emailRows;
await distQ.add("tweet", { uuid: hd.uuid, publisherRootIp: pubDesc.publisherRootIpId, text: "duplicate poke", mediaCount: 0 }, { jobId: `tweet-${hd.uuid}-dup`, attempts: 1 });
await distQ.add("notify", { uuid: hd.uuid, publisherRootIp: pubDesc.publisherRootIpId }, { jobId: `notify-${hd.uuid}-dup`, attempts: 1 });
await delay(15_000);
const [hAfter] = await db.select({ p: schema.hatches.postedUri }).from(schema.hatches).where(eq(schema.hatches.uuid, hd.uuid));
const [{ c: emailAfterC }] = await db.select({ c: count() }).from(schema.sentNotifications).where(and(eq(schema.sentNotifications.hatchUuid, hd.uuid), eq(schema.sentNotifications.channel, "email"), eq(schema.sentNotifications.eventType, "reveal")));
await distQ.close();
record("step8_idempotency", hAfter?.p === blueskyBeforeUri && Number(emailAfterC) === emailBefore, {
  postedUriUnchanged: hAfter?.p === blueskyBeforeUri,
  emailRowsBefore: emailBefore, emailRowsAfter: Number(emailAfterC),
});

/* ─── Step 7: pre-reveal reminder fires (compressed) */
log("=== Step 7: pre-reveal reminder ===");
const { reminderQueue } = await import("../src/notify.js" as any);
await reminderQueue.add(
  "reminder",
  { uuid: hd.uuid, publisherRootIp: pubDesc.publisherRootIpId, kind: "reveal_reminder" },
  { jobId: `revremind-${hd.uuid}-test`, delay: 2_000, attempts: 1 },
);
await delay(20_000);
const [{ c: remCount }] = await db.select({ c: count() }).from(schema.sentNotifications).where(and(eq(schema.sentNotifications.hatchUuid, hd.uuid), eq(schema.sentNotifications.eventType, "reveal_reminder")));
record("step7_pre_reveal_reminder", Number(remCount) >= 1, { reminderRows: Number(remCount) });

/* ─── Step 9: Bluesky API failure simulation — sanity (we can't really break Bluesky, so we verify the bot survives a bad job + reveal path stays open) */
log("=== Step 9: bad-job survival ===");
await distQ.add?.("tweet", {}, { jobId: `tweet-bad-${Date.now()}`, attempts: 1 });
await delay(5_000);
const healthAfter = await fetch(`${API}/healthz`).then((r) => r.json()).catch(() => ({ ok: false }));
record("step9_bad_job_survival", !!healthAfter.ok, { health: healthAfter });

/* ─── Step 1: Part A already passed at top — pinning result */
record("step1_partA_rbf", (results.partA_test_rbf_unstick?.ok ?? false), { note: "see partA_test_rbf_unstick" });

/* ─── Collect WS events seen */
const wsEvents = await anonWsP;
const wsRevealed = wsEvents.some((m) => m.type === "hatch:revealed" && m.uuid === hd.uuid);
record("step6b_ws_my_publishers_routing", wsRevealed, { eventsReceived: wsEvents.length, gotRevealForHatch: wsRevealed });

/* ─── done */
const passing = Object.values(results).filter((r) => r.ok).length;
const total = Object.keys(results).length;
log(`\nBUILD 6: ${passing}/${total} pass · ${passing === total ? "ALL OK ✅" : "FAIL"}`);
writeFileSync(new URL("../.build6-integration.json", import.meta.url), JSON.stringify({ results, passing, total }, null, 2));
try { runner.kill("SIGTERM"); } catch {}
await redis.quit();
await pgClient.end();
process.exit(passing === total ? 0 : 1);
