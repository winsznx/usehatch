import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { indexerBus } from "./indexer.js";
import { loadEnv } from "./env.js";

loadEnv();

interface OutcomeSpec {
  kind: "price" | "sports" | "binary" | "manual";
  expected?: number;       // publisher's prediction (raw, unscaled)
  tolerance?: number;      // for continuous outcomes (raw, unscaled)
  scale?: number;          // attestation scale (default 1e8 for price)
}

/** Per-hatch outcome score in [0, 1].
 *  - binary  → 1.0 if expected matches actual; 0.0 else
 *  - price/continuous → 1 - min(1, |expected - actual| / tolerance)
 *  Returns null if the spec/outcome is unscorable (manual, missing fields, etc.). */
export function computeOutcomeScore(spec: OutcomeSpec, outcomeValue: bigint): number | null {
  const scale = spec.scale ?? 1e8;
  const actual = Number(outcomeValue) / scale;
  if (spec.kind === "binary") {
    if (spec.expected === undefined) return null;
    // expected stored as 0/1; outcomeValue likewise (scaled or raw)
    return Math.abs(actual - spec.expected) < 1e-9 ? 1.0 : 0.0;
  }
  if (spec.kind === "price" || spec.kind === "sports") {
    if (spec.expected === undefined || spec.tolerance === undefined || spec.tolerance <= 0) return null;
    const diff = Math.abs(spec.expected - actual);
    return Math.max(0, 1 - Math.min(1, diff / spec.tolerance));
  }
  return null; // manual — needs human resolution
}

/** Recompute track_record for a single publisher from all their finalized outcomes.
 *  Idempotent: bumps lastAggregatedAt only on success; ON CONFLICT updates in place. */
export async function aggregatePublisher(publisherRootIp: string): Promise<{
  totalHatches: number;
  resolvedHatches: number;
  weightedAccuracy: number | null;
  subscriberCount: number;
  disputeCount: number;
}> {
  // Total + resolved hatches
  const allHatches = await db.select({ uuid: schema.hatches.uuid, perHatchPriceWei: schema.hatches.perHatchPriceWei, outcomeSpec: schema.hatches.outcomeSpec })
    .from(schema.hatches).where(eq(schema.hatches.publisherRootIp, publisherRootIp));
  const totalHatches = allHatches.length;

  const finalized = await db.select({
    uuid: schema.outcomes.hatchUuid,
    outcomeValue: schema.outcomes.outcomeValue,
  }).from(schema.outcomes)
    .innerJoin(schema.hatches, eq(schema.outcomes.hatchUuid, schema.hatches.uuid))
    .where(and(eq(schema.hatches.publisherRootIp, publisherRootIp), eq(schema.outcomes.status, "finalized")));
  const resolvedHatches = finalized.length;

  // Price-weighted accuracy: sum(price * score) / sum(price) over finalized hatches.
  // Hatches with null perHatchPriceWei treated as 0 (no contribution either way).
  let weightedNumerator = 0;
  let weightedDenominator = 0;
  for (const f of finalized) {
    const [h] = allHatches.filter((x) => x.uuid === f.uuid);
    if (!h) continue;
    const spec = h.outcomeSpec as OutcomeSpec | null;
    if (!spec) continue;
    const score = computeOutcomeScore(spec, BigInt(f.outcomeValue!.toString()));
    if (score === null) continue;
    const priceWei = h.perHatchPriceWei ? Number(h.perHatchPriceWei) : 0;
    // Use a minimum weight floor so zero-priced hatches still count (just less).
    const weight = priceWei > 0 ? priceWei : 1;
    weightedNumerator += weight * score;
    weightedDenominator += weight;
  }
  const weightedAccuracy = weightedDenominator > 0 ? weightedNumerator / weightedDenominator : null;

  // Active subscriber count
  const now = new Date();
  const subs = await db.select({ c: sql<number>`count(*)::int` })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.publisherRootIp, publisherRootIp), gt(schema.subscriptions.expiresAt, now)));
  const subscriberCount = Number(subs[0]?.c ?? 0);

  // Dispute count = outcomes with status 'disputed' for this publisher
  const disp = await db.select({ c: sql<number>`count(*)::int` })
    .from(schema.outcomes)
    .innerJoin(schema.hatches, eq(schema.outcomes.hatchUuid, schema.hatches.uuid))
    .where(and(eq(schema.hatches.publisherRootIp, publisherRootIp), eq(schema.outcomes.status, "disputed")));
  const disputeCount = Number(disp[0]?.c ?? 0);

  // UPSERT
  await db.insert(schema.trackRecords).values({
    publisherRootIp,
    totalHatches, resolvedHatches,
    weightedAccuracy: weightedAccuracy === null ? null : String(weightedAccuracy),
    subscriberCount, disputeCount,
    lastAggregatedAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.trackRecords.publisherRootIp,
    set: {
      totalHatches, resolvedHatches,
      weightedAccuracy: weightedAccuracy === null ? null : String(weightedAccuracy),
      subscriberCount, disputeCount,
      lastAggregatedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  indexerBus.emit("aggregator:publisher_updated", {
    publisherRootIp, totalHatches, resolvedHatches, weightedAccuracy, subscriberCount, disputeCount,
  });

  return { totalHatches, resolvedHatches, weightedAccuracy, subscriberCount, disputeCount };
}

/** Listen for outcome:finalized events on the indexerBus and aggregate the affected publisher. */
export function startAggregator(): void {
  indexerBus.on("outcome:finalized", async ({ hatchUuid }: { hatchUuid: number }) => {
    try {
      const [h] = await db.select({ p: schema.hatches.publisherRootIp }).from(schema.hatches).where(eq(schema.hatches.uuid, hatchUuid));
      if (!h) return;
      const result = await aggregatePublisher(h.p);
      console.log(`[aggregator] publisher ${h.p} → weighted=${result.weightedAccuracy?.toFixed(4) ?? "null"} resolved=${result.resolvedHatches}/${result.totalHatches}`);
    } catch (e) {
      console.error("[aggregator] update failed:", (e as Error).message.slice(0, 200));
    }
  });
}

/** Sweep poll for unaggregated finalized outcomes. Safety net if indexerBus events
 *  are missed (worker restart between finalize and aggregation). */
let sweepTimer: NodeJS.Timeout | null = null;
export function startAggregatorSweep(intervalMs = 5 * 60_000): void {
  if (sweepTimer) return;
  const tick = async () => {
    try {
      // Find publishers with finalized outcomes newer than their last aggregation
      // (or never aggregated). One row per publisher.
      const stale = await db.execute(sql`
        SELECT DISTINCT h.publisher_root_ip AS p
        FROM hatches h
        JOIN outcomes o ON o.hatch_uuid = h.uuid
        LEFT JOIN track_records tr ON tr.publisher_root_ip = h.publisher_root_ip
        WHERE o.status = 'finalized'
          AND (tr.last_aggregated_at IS NULL OR tr.last_aggregated_at < o.finalized_at)
      `) as Array<{ p: string }>;
      for (const r of stale) await aggregatePublisher(r.p);
    } catch (e) {
      console.error("[aggregator-sweep] failed:", (e as Error).message);
    }
  };
  tick();
  sweepTimer = setInterval(tick, intervalMs);
}
