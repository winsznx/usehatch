import { createPublicClient, parseAbi, parseEventLogs, decodeAbiParameters, type Log, type Address } from "viem";
// import { hatchIdFor } from "../../sdk/dist/index.js"; // unused here; the inverse parse is enough
import { and, eq, sql } from "drizzle-orm";
import { EventEmitter } from "node:events";
import { db, schema } from "./db/client.js";

import { loadEnv } from "./env.js";
import { aeneidTransport } from "./transport.js";
loadEnv();

const RPC_URL = process.env.RPC_URL!;
const aeneid = { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const;
export const publicClient = createPublicClient({ chain: aeneid, transport: aeneidTransport() });

/* ────────────────────────── deployed addresses (lowercase for cursor keys) */
/* Registry default mirrors `sdk/src/config.ts` so the indexer picks up
 * PublisherRegistered events out-of-the-box. Env var still wins for the
 * integration test (which deploys a fresh registry per run). */
const DEFAULT_REGISTRY_AENEID = "0x33519cf182bf9830046352150f4e03a5592bddfa";
export const CONTRACTS = {
  cdr:              "0xcccccc0000000000000000000000000000000005",
  hatchCondition:   "0x9362bf2874c17ebe2d977a16861ee51bfbb0b474", // v2.1
  pass:             "0x9fc74922a10ad962570eb9692e66b0f6cb6909e1",
  oracle:           "0x5257eabbf0297ca6073ad0d7aba09c980d708a24",
  registry:         (process.env.REGISTRY_ADDR ?? DEFAULT_REGISTRY_AENEID).toLowerCase(),
  licensingModule:  "0x04fbd8a2e56dd85cfd5500a4a4dfa955b9f1de6f",
  // Story DisputeModule (identical address on Aeneid + Mainnet).
  disputeModule:    "0x9b7a9c70aff961c799110954fc06f3093aeb94c5",
  // Story GroupingModule (identical address on Aeneid + Mainnet).
  groupingModule:   "0x69d3a7aa9edb72bc226e745a7ccdd50d947b69ac",
} as const;

/* ────────────────────────── event ABIs (one source of truth) */
const cdrAbi = parseAbi([
  "event VaultAllocated(uint32 uuid, bool updatable, address writeConditionAddr, address readConditionAddr, bytes writeConditionData, bytes readConditionData)",
  "event VaultWritten(uint32 uuid, bytes encryptedData)",
  "event VaultRead(uint32 uuid, address indexed requester, bytes ciphertext, bytes requesterPubKey)",
]);
const passAbi = parseAbi([
  "event PassMinted(uint256 indexed tokenId, address indexed to, address indexed publisherRoot, uint256 subLicenseTokenId, uint64 expiresAt, uint256 subPriceWei)",
  "event SubscriptionUpdate(uint256 indexed tokenId, uint64 expiration)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const oracleAbi = parseAbi([
  "event AttestationSubmitted(bytes32 indexed hatchId, address indexed operator, bytes32 outcomeHash, int256 outcomeValue, uint64 observedAt, uint256 nonce)",
  "event Challenged(bytes32 indexed hatchId, address indexed challenger, uint256 bond)",
  "event Finalized(bytes32 indexed hatchId)",
  "event Resolved(bytes32 indexed hatchId, bool operatorWins)",
]);
const registryAbi = parseAbi([
  "event PublisherRegistered(address indexed publisher, address indexed rootIp)",
  "event Staked(address indexed publisher, uint256 amount, uint256 newStake)",
  "event Unstaked(address indexed publisher, uint256 amount, uint256 newStake)",
  "event Slashed(address indexed publisher, uint256 amount, address indexed beneficiary, uint64 at)",
]);
const licensingAbi = parseAbi([
  "event LicenseTokensMinted(address indexed caller, address indexed licensorIpId, address indexed licenseTemplate, uint256 licenseTermsId, uint256 amount, address receiver, uint256 startLicenseTokenId)",
]);
const disputeAbi = parseAbi([
  "event DisputeRaised(uint256 disputeId, address targetIpId, address disputeInitiator, uint256 disputeTimestamp, address arbitrationPolicy, bytes32 disputeEvidenceHash, bytes32 targetTag, bytes data)",
  "event DisputeJudgementSet(uint256 disputeId, bool decision, bytes data)",
  "event DisputeCancelled(uint256 disputeId, bytes data)",
  "event DisputeResolved(uint256 disputeId, bytes data)",
]);
const groupingAbi = parseAbi([
  "event IPGroupRegistered(address indexed groupId, address indexed groupPool)",
  "event AddedIpToGroup(address indexed groupId, address[] ipIds)",
  "event RemovedIpFromGroup(address indexed groupId, address[] ipIds)",
]);

/* ────────────────────────── runtime event bus (API/WS subscribe to this) */
export const indexerBus = new EventEmitter();

/* ────────────────────────── helpers */
const lc = (s: string) => s.toLowerCase();
const tsFromUnix = (n: bigint | number) => new Date(Number(n) * 1000);
const upsertCursor = async (contract: string, block: bigint) => {
  await db.insert(schema.indexerCursor).values({ contract, lastBlock: block })
    .onConflictDoUpdate({ target: schema.indexerCursor.contract, set: { lastBlock: block, updatedAt: new Date() } });
};
const readCursor = async (contract: string, fallback: bigint): Promise<bigint> => {
  const [r] = await db.select().from(schema.indexerCursor).where(eq(schema.indexerCursor.contract, contract));
  return r ? r.lastBlock : fallback;
};

/** Reorg-safe idempotency: returns true if this is the first time we see (tx, logIndex). */
async function tryClaim(log: Log): Promise<boolean> {
  const res = await db.insert(schema.processedLogs).values({
    txHash: log.transactionHash!, logIndex: log.logIndex!, blockNumber: log.blockNumber!,
  }).onConflictDoNothing().returning({ txHash: schema.processedLogs.txHash });
  return res.length > 0;
}

/* ────────────────────────── per-event handlers */
async function handleVaultAllocated(log: any) {
  if (lc(log.args.readConditionAddr) !== lc(CONTRACTS.hatchCondition)) return; // not a Hatch vault
  // decode HatchCondition v2.1 conditionData: (uint8 mode, address ipId, address publisherRoot, uint64 embargoStart, uint64 revealAt)
  let mode: number, ipId: string, publisherRoot: string, embargoStart: bigint, revealAt: bigint;
  try {
    const dec = decodeAbiParameters(
      [{ type: "uint8" }, { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint64" }],
      log.args.readConditionData,
    );
    [mode, ipId, publisherRoot, embargoStart, revealAt] = dec as any;
  } catch { return; }
  await db.insert(schema.hatches).values({
    uuid: Number(log.args.uuid),
    signalIpId: lc(ipId), publisherRootIp: lc(publisherRoot), mode,
    embargoStart: tsFromUnix(embargoStart), revealAt: tsFromUnix(revealAt),
    status: "sealed", txHashes: { allocate: log.transactionHash },
  }).onConflictDoNothing();
  indexerBus.emit("hatch:allocated", { uuid: Number(log.args.uuid), publisherRoot: lc(publisherRoot) });
}

async function handleVaultWritten(log: any) {
  await db.update(schema.hatches)
    .set({ txHashes: sql`COALESCE(${schema.hatches.txHashes}, '{}'::jsonb) || ${JSON.stringify({ write: log.transactionHash })}::jsonb` })
    .where(eq(schema.hatches.uuid, Number(log.args.uuid)));
}

async function handleVaultRead(log: any) {
  const exists = await db.select({ uuid: schema.hatches.uuid }).from(schema.hatches).where(eq(schema.hatches.uuid, Number(log.args.uuid)));
  if (!exists.length) return;
  await db.insert(schema.reads).values({
    id: `${log.transactionHash}:${log.logIndex}`,
    hatchUuid: Number(log.args.uuid),
    readerAddr: lc(log.args.requester),
    kind: 255, via: "indexer", txHash: log.transactionHash,
    readAt: tsFromUnix((await publicClient.getBlock({ blockNumber: log.blockNumber! })).timestamp),
  }).onConflictDoNothing();
}

async function handlePassMinted(log: any) {
  const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
  await db.insert(schema.subscriptions).values({
    id: log.args.tokenId.toString(),
    subscriberWallet: lc(log.args.to),
    publisherRootIp: lc(log.args.publisherRoot),
    subLicenseTokenId: log.args.subLicenseTokenId,
    passId: log.args.tokenId,
    expiresAt: tsFromUnix(log.args.expiresAt),
    mintedAt: tsFromUnix(block.timestamp),
  }).onConflictDoNothing();
}

async function handleSubscriptionUpdate(log: any) {
  await db.update(schema.subscriptions)
    .set({ expiresAt: tsFromUnix(log.args.expiration) })
    .where(eq(schema.subscriptions.passId, log.args.tokenId));
}

async function handleAttestation(log: any) {
  // Map hatchId → uuid by trying our convention: keccak("hatch-<uuid>"). The indexer doesn't enforce the convention;
  // it just records by hatchId and links to uuid if it can locate one via the outcomes.hatch_id back-fill.
  // For now we accept the hatchId as the primary key for outcomes.
  // The API can resolve uuid via outcomes.hatch_id ↔ keccak in a later step.
  const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
  const observedIso = tsFromUnix(log.args.observedAt).toISOString();
  // Map hatchId → uuid by convention: hatchId = keccak256(utf8("hatch-<uuid>")).
  // Resolve by trying each known hatch (small set at MVP scale). For prod, store the convention in the SDK
  // and write hatchId during createHatch so we can index by it directly.
  // Canonical hatchId = padded uint32 (uuidFromHatchId is the inverse).
  // No O(N) lookup needed: parse the uuid directly.
  const parsed = Number(BigInt(log.args.hatchId));
  const [hatchExists] = await db.select({ uuid: schema.hatches.uuid }).from(schema.hatches).where(eq(schema.hatches.uuid, parsed));
  const resolvedUuid: number | null = hatchExists ? parsed : null;
  if (resolvedUuid !== null) {
    await db.insert(schema.outcomes).values({
      hatchUuid: resolvedUuid, hatchId: log.args.hatchId,
      outcomeValue: log.args.outcomeValue.toString(),
      outcomeHash: log.args.outcomeHash,
      observedAt: tsFromUnix(log.args.observedAt),
      operator: lc(log.args.operator),
      status: "pending",
    }).onConflictDoUpdate({
      target: schema.outcomes.hatchUuid,
      set: { outcomeValue: log.args.outcomeValue.toString(), outcomeHash: log.args.outcomeHash, observedAt: tsFromUnix(log.args.observedAt), operator: lc(log.args.operator), status: "pending" },
    });
  }
  indexerBus.emit("oracle:submitted", { hatchId: log.args.hatchId });
}

async function handleFinalized(log: any) {
  await db.update(schema.outcomes)
    .set({ status: "finalized", finalizedAt: new Date() })
    .where(eq(schema.outcomes.hatchId, log.args.hatchId));
  // also flip hatch status to resolved
  await db.execute(sql`
    UPDATE hatches SET status = 'resolved'
    WHERE uuid = (SELECT hatch_uuid FROM outcomes WHERE hatch_id = ${log.args.hatchId})
  `);
  // Two events: low-level (hatchId only) and aggregator-friendly (with uuid).
  // Canonical hatchId = padded uint32 uuid, so the inverse is straight integer parse.
  const uuid = Number(BigInt(log.args.hatchId));
  indexerBus.emit("oracle:finalized", { hatchId: log.args.hatchId, hatchUuid: uuid });
  indexerBus.emit("outcome:finalized", { hatchUuid: uuid, hatchId: log.args.hatchId });
}

/* Story's LicenseRegistry on Aeneid (chain 1315). Identical to mainnet (1514).
 * Used to backfill the subscription terms id at register time — the publisher's
 * `mintAndRegisterIpAssetWithPilTerms` call attaches PIL terms at index 0, but
 * neither HatchPublisherRegistry nor Story's LicensingModule re-emit them in a
 * shape the indexer was watching, so we read them on-chain here. */
const LICENSE_REGISTRY = "0x529a750E02d8E2f15649c13D69a465286a780e24" as const;
const licenseRegistryAbi = parseAbi([
  "function getAttachedLicenseTerms(address ipId, uint256 index) view returns (address licenseTemplate, uint256 licenseTermsId)",
  "function getAttachedLicenseTermsCount(address ipId) view returns (uint256)",
]);

async function handlePublisherRegistered(log: any) {
  const wallet = lc(log.args.publisher);
  const rootIp = lc(log.args.rootIp);
  console.log(`[idx] PublisherRegistered: ${wallet} → ${rootIp}`);
  let subscriptionTermsId: bigint | null = null;
  try {
    const count = await publicClient.readContract({
      address: LICENSE_REGISTRY, abi: licenseRegistryAbi, functionName: "getAttachedLicenseTermsCount", args: [rootIp as Address],
    });
    if (count > 0n) {
      const [, termsId] = await publicClient.readContract({
        address: LICENSE_REGISTRY, abi: licenseRegistryAbi, functionName: "getAttachedLicenseTerms", args: [rootIp as Address, 0n],
      });
      subscriptionTermsId = termsId;
    }
  } catch (e) {
    console.log(`[idx] PublisherRegistered: getAttachedLicenseTerms failed for ${rootIp}: ${(e as Error).message}`);
  }
  await db.insert(schema.publishers).values({
    wallet, publisherRootIp: rootIp, subscriptionTermsId,
  }).onConflictDoUpdate({
    target: schema.publishers.wallet,
    set: { publisherRootIp: rootIp, ...(subscriptionTermsId != null ? { subscriptionTermsId } : {}) },
  });
}

async function handleStaked(log: any) {
  console.log(`[idx] Staked: ${lc(log.args.publisher)} newStake=${log.args.newStake.toString()}`);
  await db.execute(sql`
    UPDATE publishers SET stake_wei = ${log.args.newStake.toString()}::numeric,
      verified = (${log.args.newStake.toString()}::numeric >= ${"50000000000000000"}::numeric)
    WHERE wallet = ${lc(log.args.publisher)}
  `);
}

async function handleSlashed(log: any) {
  const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
  await db.update(schema.publishers)
    .set({ lastSlashAt: tsFromUnix(block.timestamp) })
    .where(eq(schema.publishers.wallet, lc(log.args.publisher)));
}

/* Story DisputeModule events. Tags are bytes32-encoded strings ("IMPROPER_USAGE"
 * etc.). We decode by stripping trailing zeros and ASCII-converting.
 *
 * On DisputeRaised, we cross-reference the target IP against our hatches table:
 * - target matches a publisher root → set publisherRootIp on the dispute row.
 * - target matches a signal IP → set both hatchUuid and the parent publisherRootIp.
 * - neither matches → dispute against an IP unrelated to Hatch; row stored for
 *   completeness but won't surface on our pages. */
function decodeBytes32Tag(b: `0x${string}`): string {
  // bytes32 ASCII tag: strip trailing zero bytes, then convert.
  const hex = b.slice(2);
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

async function handleDisputeRaised(log: any) {
  const targetIp = lc(log.args.targetIpId);
  const challenger = lc(log.args.disputeInitiator);

  // Cross-reference target → our schema.
  let hatchUuid: number | null = null;
  let publisherRootIp: string | null = null;
  const [byPublisher] = await db.select({ root: schema.publishers.publisherRootIp })
    .from(schema.publishers).where(eq(schema.publishers.publisherRootIp, targetIp));
  if (byPublisher) {
    publisherRootIp = byPublisher.root;
  } else {
    const [bySignal] = await db.select({ uuid: schema.hatches.uuid, root: schema.hatches.publisherRootIp })
      .from(schema.hatches).where(eq(schema.hatches.signalIpId, targetIp));
    if (bySignal) {
      hatchUuid = bySignal.uuid;
      publisherRootIp = bySignal.root;
    }
  }

  const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
  await db.insert(schema.disputes).values({
    storyDisputeId: log.args.disputeId as bigint,
    targetIpId: targetIp,
    hatchUuid: hatchUuid ?? undefined,
    publisherRootIp,
    challenger,
    tag: decodeBytes32Tag(log.args.targetTag as `0x${string}`),
    evidenceHash: log.args.disputeEvidenceHash as string,
    arbitrationPolicy: lc(log.args.arbitrationPolicy),
    status: "raised",
    raisedAt: tsFromUnix(block.timestamp),
    txHashes: { raised: log.transactionHash },
  }).onConflictDoNothing();

  if (publisherRootIp) {
    indexerBus.emit("dispute:raised", {
      disputeId: log.args.disputeId.toString(),
      publisherRoot: publisherRootIp,
      hatchUuid,
    });
  }
}

async function handleDisputeJudgement(log: any) {
  const decision = Boolean(log.args.decision);
  await db.update(schema.disputes)
    .set({
      status: decision ? "judged-true" : "judged-false",
      decision,
      judgedAt: new Date(),
      txHashes: sql`COALESCE(${schema.disputes.txHashes}, '{}'::jsonb) || ${JSON.stringify({ judged: log.transactionHash })}::jsonb`,
    })
    .where(eq(schema.disputes.storyDisputeId, log.args.disputeId as bigint));
}

async function handleDisputeCancelled(log: any) {
  await db.update(schema.disputes)
    .set({
      status: "cancelled",
      resolvedAt: new Date(),
      txHashes: sql`COALESCE(${schema.disputes.txHashes}, '{}'::jsonb) || ${JSON.stringify({ cancelled: log.transactionHash })}::jsonb`,
    })
    .where(eq(schema.disputes.storyDisputeId, log.args.disputeId as bigint));
}

async function handleDisputeResolved(log: any) {
  await db.update(schema.disputes)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      txHashes: sql`COALESCE(${schema.disputes.txHashes}, '{}'::jsonb) || ${JSON.stringify({ resolved: log.transactionHash })}::jsonb`,
    })
    .where(eq(schema.disputes.storyDisputeId, log.args.disputeId as bigint));
}

/* Story GroupingModule events. Group registration and member adds/removes.
 * We store group_members rows so the API can serve "what's in this group" +
 * "what groups does this hatch belong to" queries quickly. */
async function handleIPGroupRegistered(log: any) {
  const groupId = lc(log.args.groupId);
  await db.insert(schema.groups).values({
    groupIpId: groupId,
    groupPool: lc(log.args.groupPool),
    status: "active",
    txHashes: { registerGroup: log.transactionHash },
  }).onConflictDoNothing();
  indexerBus.emit("group:registered", { groupId });
}

async function handleAddedIpToGroup(log: any) {
  const groupId = lc(log.args.groupId);
  const ipIds = (log.args.ipIds as `0x${string}`[]).map(lc);
  if (ipIds.length === 0) return;

  // Resolve each member against our hatches table to populate hatch_uuid.
  const matches = await db.select({ id: schema.hatches.signalIpId, uuid: schema.hatches.uuid })
    .from(schema.hatches);
  const byId = new Map(matches.map((m) => [m.id, m.uuid]));

  for (const memberIp of ipIds) {
    await db.insert(schema.groupMembers).values({
      groupIpId: groupId,
      memberIpId: memberIp,
      hatchUuid: byId.get(memberIp) ?? undefined,
    }).onConflictDoNothing();
  }
  indexerBus.emit("group:members-added", { groupId, count: ipIds.length });
}

async function handleRemovedIpFromGroup(log: any) {
  const groupId = lc(log.args.groupId);
  const ipIds = (log.args.ipIds as `0x${string}`[]).map(lc);
  for (const memberIp of ipIds) {
    await db.update(schema.groupMembers)
      .set({ removedAt: new Date() })
      .where(and(eq(schema.groupMembers.groupIpId, groupId), eq(schema.groupMembers.memberIpId, memberIp)));
  }
}

async function handleLicenseMinted(log: any) {
  // Per-hatch license: licensorIpId matches a known hatch.signal_ip_id.
  // Subscription license: licensorIpId matches a known publisher.publisher_root_ip.
  const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
  const startId: bigint = log.args.startLicenseTokenId;
  const amount: bigint = log.args.amount;
  for (let i = 0n; i < amount; i++) {
    const tokenId = startId + i;
    const [hatch] = await db.select({ uuid: schema.hatches.uuid })
      .from(schema.hatches).where(eq(schema.hatches.signalIpId, lc(log.args.licensorIpId)));
    if (hatch) {
      await db.insert(schema.licenses).values({
        id: tokenId.toString(),
        hatchUuid: hatch.uuid,
        licenseTokenId: tokenId,
        buyerWallet: lc(log.args.receiver),
        mintedAt: tsFromUnix(block.timestamp),
      }).onConflictDoNothing();
    }
  }
}

/* ────────────────────────── per-contract log fetch + dispatch */
const REORG_DEPTH = 12n;

async function pollContract(contract: string, abi: typeof cdrAbi, fromBlock: bigint, toBlock: bigint, dispatcher: (log: any) => Promise<void>): Promise<bigint> {
  if (toBlock < fromBlock) return fromBlock;
  const CHUNK = 5000n;
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + CHUNK > toBlock ? toBlock : cursor + CHUNK;
    const raw = await publicClient.getLogs({
      address: contract as Address, fromBlock: cursor, toBlock: end,
    });
    const parsed = parseEventLogs({ abi: abi as any, logs: raw }) as any[];
    for (const log of parsed) {
      if (!(await tryClaim(log))) continue;
      try { await dispatcher(log); }
      catch (e) { console.error(`[${contract.slice(0, 10)}] handler error:`, (e as Error).message); }
    }
    cursor = end + 1n;
  }
  return toBlock;
}

function dispatchCdr(log: any) {
  if (log.eventName === "VaultAllocated") return handleVaultAllocated(log);
  if (log.eventName === "VaultWritten") return handleVaultWritten(log);
  if (log.eventName === "VaultRead") return handleVaultRead(log);
  return Promise.resolve();
}
function dispatchPass(log: any) {
  if (log.eventName === "PassMinted") return handlePassMinted(log);
  if (log.eventName === "SubscriptionUpdate") return handleSubscriptionUpdate(log);
  return Promise.resolve();
}
function dispatchOracle(log: any) {
  if (log.eventName === "AttestationSubmitted") return handleAttestation(log);
  if (log.eventName === "Finalized") return handleFinalized(log);
  return Promise.resolve();
}
function dispatchRegistry(log: any) {
  if (log.eventName === "PublisherRegistered") return handlePublisherRegistered(log);
  if (log.eventName === "Staked") return handleStaked(log);
  if (log.eventName === "Slashed") return handleSlashed(log);
  return Promise.resolve();
}
function dispatchLicensing(log: any) {
  if (log.eventName === "LicenseTokensMinted") return handleLicenseMinted(log);
  return Promise.resolve();
}
function dispatchDispute(log: any) {
  if (log.eventName === "DisputeRaised") return handleDisputeRaised(log);
  if (log.eventName === "DisputeJudgementSet") return handleDisputeJudgement(log);
  if (log.eventName === "DisputeCancelled") return handleDisputeCancelled(log);
  if (log.eventName === "DisputeResolved") return handleDisputeResolved(log);
  return Promise.resolve();
}
function dispatchGrouping(log: any) {
  if (log.eventName === "IPGroupRegistered") return handleIPGroupRegistered(log);
  if (log.eventName === "AddedIpToGroup") return handleAddedIpToGroup(log);
  if (log.eventName === "RemovedIpFromGroup") return handleRemovedIpFromGroup(log);
  return Promise.resolve();
}

/* ────────────────────────── status tick (sealed→active→revealed crossings) */
async function statusTick(now: Date) {
  const iso = now.toISOString();
  const promoted = await db.execute(sql`
    UPDATE hatches SET status = 'active'
    WHERE status = 'sealed' AND embargo_start <= ${iso}::timestamptz
    RETURNING uuid, publisher_root_ip
  `);
  for (const row of promoted as any) indexerBus.emit("hatch:status", { uuid: row.uuid, status: "active", publisherRoot: row.publisher_root_ip });
  // active→revealed is owned by the reveal worker (it sets status='revealed' AFTER decrypting and
  // writing revealed_content). statusTick stops at the embargo-start transition.
}

/* ────────────────────────── runner */
export async function runIndexer({ startBlock, tickIntervalMs = 5000 }: { startBlock: bigint; tickIntervalMs?: number; }) {
  const head = () => publicClient.getBlockNumber();
  const pairs: { contract: string; abi: any; dispatch: (l: any) => Promise<void> }[] = [
    { contract: CONTRACTS.cdr, abi: cdrAbi, dispatch: dispatchCdr },
    { contract: CONTRACTS.pass, abi: passAbi, dispatch: dispatchPass },
    { contract: CONTRACTS.oracle, abi: oracleAbi, dispatch: dispatchOracle },
    { contract: CONTRACTS.licensingModule, abi: licensingAbi, dispatch: dispatchLicensing },
    { contract: CONTRACTS.disputeModule, abi: disputeAbi, dispatch: dispatchDispute },
    { contract: CONTRACTS.groupingModule, abi: groupingAbi, dispatch: dispatchGrouping },
  ];
  if (CONTRACTS.registry) pairs.push({ contract: CONTRACTS.registry, abi: registryAbi, dispatch: dispatchRegistry });

  // initial fast catch-up
  const initialHead = await head();
  for (const p of pairs) {
    const from = await readCursor(p.contract, startBlock);
    const newCursor = await pollContract(p.contract, p.abi, from, initialHead, p.dispatch);
    await upsertCursor(p.contract, newCursor);
    console.log(`[idx] backfill ${p.contract.slice(0,10)} ${from} → ${newCursor}`);
  }

  // tail loop
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const h = await head();
        const safe = h > REORG_DEPTH ? h - REORG_DEPTH : 0n;
        for (const p of pairs) {
          const from = (await readCursor(p.contract, startBlock)) - REORG_DEPTH; // re-scan last N blocks
          const fromSafe = from < 0n ? 0n : from;
          await pollContract(p.contract, p.abi, fromSafe, h, p.dispatch);
          await upsertCursor(p.contract, h);
        }
        await statusTick(new Date());
      } catch (e) { console.error("[idx] tail error:", (e as Error).message); }
      await new Promise((r) => setTimeout(r, tickIntervalMs));
    }
  };
  loop();
  return () => { stopped = true; };
}
