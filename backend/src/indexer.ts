import { createPublicClient, http, parseAbi, parseEventLogs, decodeAbiParameters, type Log, type Address } from "viem";
// import { hatchIdFor } from "../../sdk/dist/index.js"; // unused here; the inverse parse is enough
import { and, eq, sql } from "drizzle-orm";
import { EventEmitter } from "node:events";
import { db, schema } from "./db/client.js";

import { loadEnv } from "./env.js";
loadEnv();

const RPC_URL = process.env.RPC_URL!;
const aeneid = { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const;
export const publicClient = createPublicClient({ chain: aeneid, transport: http(RPC_URL) });

/* ────────────────────────── deployed addresses (lowercase for cursor keys) */
export const CONTRACTS = {
  cdr:              "0xcccccc0000000000000000000000000000000005",
  hatchCondition:   "0x9362bf2874c17ebe2d977a16861ee51bfbb0b474", // v2.1
  pass:             "0x9fc74922a10ad962570eb9692e66b0f6cb6909e1",
  oracle:           "0x5257eabbf0297ca6073ad0d7aba09c980d708a24",
  // PublisherRegistry is set at runtime (the integration test deploys a fresh one)
  registry:         (process.env.REGISTRY_ADDR ?? "").toLowerCase(),
  licensingModule:  "0x04fbd8a2e56dd85cfd5500a4a4dfa955b9f1de6f",
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

async function handlePublisherRegistered(log: any) {
  console.log(`[idx] PublisherRegistered: ${lc(log.args.publisher)} → ${lc(log.args.rootIp)}`);
  await db.insert(schema.publishers).values({
    wallet: lc(log.args.publisher),
    publisherRootIp: lc(log.args.rootIp),
  }).onConflictDoNothing();
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
