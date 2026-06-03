import { AtpAgent } from "@atproto/api";
import { Worker, Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { loadEnv } from "./env.js";

loadEnv();
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:55379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

interface TweetJobData {
  uuid: number;
  publisherRootIp: string;
  text: string;
  mediaCount: number;
}

let agent: AtpAgent | null = null;
let agentReadyAt = 0;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // refresh session every 30 min

async function ensureAgent(): Promise<AtpAgent> {
  if (agent && Date.now() - agentReadyAt < SESSION_MAX_AGE_MS) return agent;
  const handle = process.env.BSKY_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD;
  if (!handle || !password) {
    throw new Error("bluesky-bot: BSKY_HANDLE and BSKY_APP_PASSWORD must be set");
  }
  const a = new AtpAgent({ service: "https://bsky.social" });
  await a.login({ identifier: handle, password });
  agent = a;
  agentReadyAt = Date.now();
  return a;
}

/** Producer-owned text. Bot posts it verbatim. ≤300 char Bluesky limit;
 *  reveal worker pre-truncates to 280. */
async function processTweet(job: Job<TweetJobData>): Promise<{ skipped?: string; uri?: string }> {
  const { uuid, text } = job.data;

  // Idempotency gate: skip if already posted.
  const [h] = await db.select({ postedUri: schema.hatches.postedUri }).from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!h) throw new Error(`bluesky-bot: hatch ${uuid} not in DB (indexer lag?)`);
  if (h.postedUri) return { skipped: "already-posted", uri: h.postedUri };

  const a = await ensureAgent();
  const res = await a.post({ text });
  // res.uri is the AT-URI e.g. at://did:plc:.../app.bsky.feed.post/<rkey>
  await db.update(schema.hatches).set({ postedUri: res.uri }).where(eq(schema.hatches.uuid, uuid));
  return { uri: res.uri };
}

/** Boot the bot worker. Concurrency 1 — Bluesky doesn't love concurrent
 *  posts from a single account and our throughput is low. */
export function startBlueskyBot(): Worker {
  const worker = new Worker<TweetJobData>(
    "hatch-distribute",
    async (job) => {
      if (job.name !== "tweet") return; // ignore notify jobs in this worker
      return await processTweet(job);
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    if (job?.name === "tweet") console.error(`[bluesky] job ${job.id} failed:`, err?.message);
  });
  worker.on("completed", (job, ret) => {
    if (job.name === "tweet") console.log(`[bluesky] job ${job.id} → ${JSON.stringify(ret)?.slice(0, 140)}`);
  });
  return worker;
}
