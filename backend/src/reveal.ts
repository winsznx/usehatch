import { Queue, Worker, QueueEvents, type Job } from "bullmq";
import IORedis from "ioredis";
import { eq, and, lte, isNull } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { publicClient, indexerBus, CONTRACTS } from "./indexer.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:55379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

export const revealQueue   = new Queue("hatch-reveal",     { connection });
export const distributeQueue = new Queue("hatch-distribute", { connection });

/** Stable jobId for dedup. Re-enqueuing the same uuid is a no-op (BullMQ guards). */
const jobIdFor = (uuid: number) => `reveal-${uuid}`;

/** Schedule a reveal at the hatch's revealAt timestamp.
 *  - Delayed up to revealAt (ms from now)
 *  - Idempotent: same uuid → same jobId; BullMQ refuses duplicates
 *  - Also enqueues the 1h pre-reveal reminder (no-op if reveal is already within 1h). */
export async function enqueueReveal(uuid: number, revealAtMs: number): Promise<void> {
  const now = Date.now();
  const delay = Math.max(0, revealAtMs - now);
  await revealQueue.add("reveal", { uuid }, {
    jobId: jobIdFor(uuid), delay,
    attempts: 5, backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 100 }, removeOnFail: false, // keep failed for inspection (dead-letter)
  });
  try {
    const [h] = await db.select({ p: schema.hatches.publisherRootIp }).from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
    if (h) {
      const { enqueueRevealReminder } = await import("./notify.js");
      await enqueueRevealReminder(uuid, h.p, revealAtMs);
    }
  } catch (e) {
    console.error("[reveal] reminder enqueue failed (non-fatal):", (e as Error).message);
  }
}

/** Sweep poll: every 60s, re-enqueue any active hatches whose revealAt has passed
 *  and that have no revealed_content row. Safety net — covers job loss during a worker outage. */
let sweepTimer: NodeJS.Timeout | null = null;
export function startSweep(intervalMs = 60_000) {
  if (sweepTimer) return;
  const tick = async () => {
    try {
      const now = new Date();
      const due = await db.select({
        uuid: schema.hatches.uuid, revealAt: schema.hatches.revealAt,
      }).from(schema.hatches)
        .leftJoin(schema.revealedContent, eq(schema.revealedContent.hatchUuid, schema.hatches.uuid))
        .where(and(lte(schema.hatches.revealAt, now), isNull(schema.revealedContent.hatchUuid)));
      for (const h of due) await enqueueReveal(h.uuid, h.revealAt.getTime());
    } catch (e) { console.error("[reveal-sweep] error:", (e as Error).message); }
  };
  tick();
  sweepTimer = setInterval(tick, intervalMs);
}

/** The actual reveal: lease ephemeral, accessCDR empty aux, write revealed_content,
 *  flip hatch.status, emit WS, enqueue downstream distribute jobs.
 *  Idempotent: PK on revealed_content blocks dup writes. */
async function processReveal(job: Job<{ uuid: number }>) {
  const { uuid } = job.data;

  // Idempotency gate: if revealed_content already exists, no-op (no re-decrypt, no re-tweet).
  const [existing] = await db.select().from(schema.revealedContent).where(eq(schema.revealedContent.hatchUuid, uuid));
  if (existing) return { skipped: "already-revealed" };

  // Load hatch
  const [hatch] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!hatch) throw new Error(`reveal: hatch ${uuid} not in DB yet (indexer lag?)`);

  // Must be past revealAt to read with empty aux
  if (Date.now() < hatch.revealAt.getTime()) throw new Error(`reveal: too early for ${uuid}; revealAt=${hatch.revealAt.toISOString()}`);

  // Lazy-load SDK + pool. Storage providers come from the Node-only sub-path
  // so the barrel stays browser-safe for the frontend.
  const sdk = await import("../../sdk/dist/index.js" as any);
  const { readHatch, EphemeralPool, defaultConfig, ensureWasm } = sdk;
  const { LocalDiskProvider, SupabaseProvider } = await import("@usehatch/sdk/storage");
  await ensureWasm();

  // Storage provider — same priority as the API
  const storage = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET)
    ? new SupabaseProvider(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_BUCKET)
    : new LocalDiskProvider(process.env.LOCAL_STORAGE_DIR ?? "/tmp/hatch-roundtrip-storage");

  // One pool shared across reveals (module-singleton)
  const pool = await getRevealPool(EphemeralPool);

  // Build config: HATCH addresses from indexer + chain bits via SDK's defaultConfig
  const cfgBase = defaultConfig({ storage });
  const cfg = { ...cfgBase, hatch: { ...cfgBase.hatch, hatchCondition: CONTRACTS.hatchCondition, subscriptionPass: CONTRACTS.pass } };

  // Read (post-reveal open path)
  const result = await readHatch({
    config: cfg, publicClient, uuid, entitlement: "empty", via: "anonymous", pool,
  });

  // Persist
  try {
    await db.insert(schema.revealedContent).values({
      hatchUuid: uuid,
      text: result.text,
      media: result.media.map((m: any) => ({ name: m.name, mime: m.mime, cid: "" /* media bytes inline in this dev path; CID lives in manifest */ })),
      revealedBy: result.reader.toLowerCase(),
    });
  } catch (e: any) {
    // PK collision => raced with another worker; treat as success
    if (!/duplicate|unique/i.test(e?.message ?? "")) throw e;
    return { skipped: "race-on-pk" };
  }
  await db.update(schema.hatches).set({ status: "revealed" }).where(eq(schema.hatches.uuid, uuid));

  // Emit WS hatch:revealed
  indexerBus.emit("hatch:revealed", { uuid, publisherRoot: hatch.publisherRootIp, revealedBy: result.reader });

  // Producer crafts the post text (bot is verbatim). Template per Build 6 brief:
  //   🥚 [publisher] just hatched: [title]
  //   sealed [duration] · revealed on time
  //   [hatch.usehatch.xyz/h/{uuid}]
  const [pubRow] = await db.select({ displayName: schema.publishers.displayName })
    .from(schema.publishers)
    .where(eq(schema.publishers.publisherRootIp, hatch.publisherRootIp));
  const publisherLabel = pubRow?.displayName?.trim() || `${hatch.publisherRootIp.slice(0, 6)}…${hatch.publisherRootIp.slice(-4)}`;
  const sealedSecs = Math.max(0, Math.floor((hatch.revealAt.getTime() - hatch.embargoStart.getTime()) / 1000));
  const fmtDur = (s: number) =>
    s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
  const publicUrl = (process.env.HATCH_PUBLIC_URL ?? "https://hatch.usehatch.xyz").replace(/\/+$/, "");
  const titleLine = hatch.title?.trim() || result.text.split("\n")[0].slice(0, 120);

  // Build 7 enrichment: append "track record: NN% over K hatches" when the publisher has
  // ≥3 resolved hatches. Looked up from track_records (populated by aggregator).
  let trackRecordLine = "";
  try {
    const [tr] = await db.select({ wa: schema.trackRecords.weightedAccuracy, rh: schema.trackRecords.resolvedHatches })
      .from(schema.trackRecords).where(eq(schema.trackRecords.publisherRootIp, hatch.publisherRootIp));
    if (tr && tr.rh >= 3 && tr.wa !== null) {
      const pct = Math.round(Number(tr.wa) * 100);
      trackRecordLine = `\ntrack record: ${pct}% over ${tr.rh} hatches`;
    }
  } catch { /* no track record yet — skip */ }

  const postText =
    `🥚 ${publisherLabel} just hatched: ${titleLine}\n` +
    `sealed ${fmtDur(sealedSecs)} · revealed on time\n` +
    `${publicUrl}/h/${uuid}` + trackRecordLine;
  const cappedText = postText.length > 280 ? postText.slice(0, 277) + "…" : postText;

  await distributeQueue.add("tweet", {
    uuid, publisherRootIp: hatch.publisherRootIp, text: cappedText, mediaCount: result.media.length,
  }, { jobId: `tweet-${uuid}`, attempts: 5, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 100 } });
  await distributeQueue.add("notify", {
    uuid, publisherRootIp: hatch.publisherRootIp,
  }, { jobId: `notify-${uuid}`, attempts: 5, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 100 } });

  return { uuid, reader: result.reader, txHash: result.txHash, latencyMs: result.latencyMs };
}

let revealPool: any = null;
async function getRevealPool(EphemeralPool: any) {
  if (revealPool) return revealPool;
  revealPool = new EphemeralPool({
    treasuryPk: process.env.SERVER_TREASURY_PK as `0x${string}`,
    chain: { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } },
    rpcUrl: process.env.RPC_URL!,
    size: Number(process.env.REVEAL_POOL_SIZE ?? 4),
  });
  // Pre-fund sequentially so the first concurrent burst of leases doesn't stampede the treasury.
  await revealPool.prefund();
  return revealPool;
}

/** Boot the worker. Concurrency tracks pool slot count so we don't queue beyond capacity. */
export function startRevealWorker() {
  const concurrency = Number(process.env.REVEAL_POOL_SIZE ?? 4);
  const worker = new Worker("hatch-reveal", processReveal, { connection, concurrency });
  worker.on("failed", (job, err) => { console.error(`[reveal] job ${job?.id} failed:`, err?.message); });
  worker.on("completed", (job, ret) => { console.log(`[reveal] job ${job.id} completed:`, JSON.stringify(ret)?.slice(0, 120)); });

  // Auto-enqueue when indexer surfaces a new hatch
  indexerBus.on("hatch:allocated", async ({ uuid }) => {
    try {
      const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
      if (h) await enqueueReveal(uuid, h.revealAt.getTime());
    } catch (e) { console.error("[reveal] enqueue on hatch:allocated failed:", (e as Error).message); }
  });

  startSweep();
  return worker;
}
