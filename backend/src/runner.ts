import "node:process";
import { loadEnv } from "./env.js";
import { installAeneidFetchPatch } from "./transport.js";
loadEnv();
installAeneidFetchPatch();

import { runIndexer } from "./indexer.js";
import { startServer } from "./api.js";
import { startRevealWorker } from "./reveal.js";

const startBlock = BigInt(process.env.INDEXER_START_BLOCK ?? "18800000");
console.log(`[runner] starting indexer from block ${startBlock}`);
await runIndexer({ startBlock, tickIntervalMs: 5000 });
console.log(`[runner] starting reveal worker (Redis @ ${process.env.REDIS_URL ?? "redis://127.0.0.1:55379"})`);
startRevealWorker();

const { startBlueskyBot } = await import("./bluesky-bot.js");
const { startNotifyWorker } = await import("./notify.js");
if (process.env.BSKY_HANDLE && process.env.BSKY_APP_PASSWORD) {
  console.log(`[runner] starting Bluesky bot (handle: ${process.env.BSKY_HANDLE})`);
  startBlueskyBot();
} else {
  console.log(`[runner] BSKY_HANDLE / BSKY_APP_PASSWORD unset — Bluesky bot SKIPPED`);
}
console.log(`[runner] starting notify worker (Resend + Web Push)`);
startNotifyWorker();

const { startOracleWorker } = await import("./oracle-worker.js");
const { startAggregator, startAggregatorSweep } = await import("./aggregator.js");
if (process.env.OPERATOR_PRIVATE_KEY) {
  console.log(`[runner] starting oracle worker + finalize worker`);
  await startOracleWorker();
} else {
  console.log(`[runner] OPERATOR_PRIVATE_KEY unset — oracle worker SKIPPED`);
}
console.log(`[runner] starting track-record aggregator (event-driven + 5m sweep)`);
startAggregator();
startAggregatorSweep();
console.log(`[runner] starting API on :${process.env.API_PORT ?? 4011}`);
await startServer();
console.log(`[runner] ready`);
