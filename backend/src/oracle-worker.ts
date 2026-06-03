import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { createPublicClient, createWalletClient, http, keccak256, toHex, pad, encodePacked, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { loadEnv } from "./env.js";
import { installAeneidFetchPatch } from "./transport.js";
import { CONTRACTS, indexerBus } from "./indexer.js";

loadEnv();
installAeneidFetchPatch();

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:55379";
const RPC_URL = process.env.RPC_URL!;
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

// Aeneid basefee ≈ 7 wei; viem's auto-estimate defaults are far too high and
// trigger "balance exceeds" cascades. Pass these explicitly on every write.
const AENEID_FEE_OVERRIDES = {
  maxFeePerGas: 1_000_000_000n,       // 1 gwei
  maxPriorityFeePerGas: 100_000_000n, // 0.1 gwei
} as const;

export const oracleQueue   = new Queue("hatch-oracle",   { connection });
export const finalizeQueue = new Queue("hatch-finalize", { connection });

const aeneid = { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const;
const publicClient = createPublicClient({ chain: aeneid as never, transport: http(RPC_URL) });

const operatorPk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
const operatorAccount = operatorPk ? privateKeyToAccount(operatorPk) : null;
const operatorWallet = operatorAccount
  ? createWalletClient({ account: operatorAccount, chain: aeneid as never, transport: http(RPC_URL) })
  : null;

interface OutcomeSpec {
  kind: "price" | "sports" | "manual";
  asset?: string;          // BTC, ETH, etc.
  currency?: string;       // USD, EUR
  source?: "coingecko" | "odds-api";
  expected?: number;       // publisher's prediction (for scoring)
  tolerance?: number;      // for continuous outcomes
  scale?: number;          // decimals to scale by (default 1e8)
}

interface OracleJobData { uuid: number }
interface FinalizeJobData { uuid: number; hatchId: `0x${string}` }

const HATCH_ORACLE_ABI = parseAbi([
  "function attestationDigest((bytes32 hatchId,bytes32 outcomeHash,int256 outcomeValue,uint64 observedAt,uint256 nonce)) view returns (bytes32)",
  "function submitAttestation((bytes32 hatchId,bytes32 outcomeHash,int256 outcomeValue,uint64 observedAt,uint256 nonce), bytes signature)",
  "function finalize(bytes32 hatchId)",
  "function getRecord(bytes32 hatchId) view returns ((bytes32 hatchId,bytes32 outcomeHash,int256 outcomeValue,uint64 observedAt,uint256 nonce) att, address signer, uint64 submittedAt, uint8 status, address challenger, uint256 bond)",
  "function challengeWindow() view returns (uint64)",
  "function isOperator(address) view returns (bool)",
  "function addOperator(address)",
]);

/** Canonical hatchId from uuid — same derivation as @usehatch/sdk hatchIdFor */
const hatchIdFor = (uuid: number): `0x${string}` => pad(toHex(BigInt(uuid)), { size: 32 });

/** Pull current price from CoinGecko Demo API.
 *  Returns { value, observedAt } where value is the price scaled by 1e8 (int). */
async function fetchPriceCoingecko(asset: string, currency: string): Promise<{ value: bigint; raw: number; observedAt: number }> {
  const key = process.env.COINGECKO_DEMO_KEY;
  if (!key) throw new Error("oracle: COINGECKO_DEMO_KEY unset");
  // CoinGecko uses lowercase ids; map common tickers to ids.
  const idMap: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", IP: "story", USDC: "usd-coin" };
  const coinId = idMap[asset.toUpperCase()] ?? asset.toLowerCase();
  const cur = currency.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${cur}&x_cg_demo_api_key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`coingecko ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const body = (await res.json()) as Record<string, Record<string, number>>;
  const raw = body[coinId]?.[cur];
  if (typeof raw !== "number") throw new Error(`coingecko: no price for ${coinId}/${cur} (body=${JSON.stringify(body).slice(0, 200)})`);
  // Scale: BTC at 100000.xx USD * 1e8 = 1e13. Fits in int256 easily.
  const value = BigInt(Math.round(raw * 1e8));
  return { value, raw, observedAt: Math.floor(Date.now() / 1000) };
}

/** Canonical JSON for the outcome payload — hashed and stored on-chain as outcomeHash. */
function canonicalOutcomeHash(payload: object): `0x${string}` {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return keccak256(toHex(canonical));
}

async function ensureOperatorRegistered(): Promise<void> {
  if (!operatorAccount) return;
  const isOp = await publicClient.readContract({
    address: CONTRACTS.oracle, abi: HATCH_ORACLE_ABI, functionName: "isOperator", args: [operatorAccount.address],
  });
  if (isOp) return;
  console.log(`[oracle] operator ${operatorAccount.address} not registered; attempting addOperator (requires PUBLISHER_PK as owner)`);
  const ownerPk = process.env.PUBLISHER_PK as `0x${string}` | undefined;
  if (!ownerPk) {
    console.error(`[oracle] PUBLISHER_PK unset — cannot self-register operator. Run manually:`);
    console.error(`         oracle.addOperator(${operatorAccount.address}) from the Oracle owner.`);
    return;
  }
  const ownerAccount = privateKeyToAccount(ownerPk);
  const ownerWallet = createWalletClient({ account: ownerAccount, chain: aeneid as never, transport: http(RPC_URL) });
  try {
    const { request } = await publicClient.simulateContract({
      address: CONTRACTS.oracle, abi: HATCH_ORACLE_ABI, functionName: "addOperator",
      args: [operatorAccount.address], account: ownerAccount,
    });
    const tx = await ownerWallet.writeContract({ ...request, ...AENEID_FEE_OVERRIDES });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`[oracle] operator ${operatorAccount.address} registered (tx ${tx})`);
  } catch (e) {
    console.error(`[oracle] addOperator failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

/** Ensure the operator wallet has gas. Tops up 0.1 IP from PUBLISHER if balance < 0.02 IP. */
async function ensureOperatorFunded(): Promise<void> {
  if (!operatorAccount) return;
  const bal = await publicClient.getBalance({ address: operatorAccount.address });
  if (bal >= 20_000_000_000_000_000n) return; // 0.02 IP
  const ownerPk = process.env.PUBLISHER_PK as `0x${string}` | undefined;
  if (!ownerPk) return;
  const owner = privateKeyToAccount(ownerPk);
  const w = createWalletClient({ account: owner, chain: aeneid as never, transport: http(RPC_URL) });
  try {
    const tx = await w.sendTransaction({
      to: operatorAccount.address, value: 100_000_000_000_000_000n, // 0.1 IP
      chain: aeneid as never, account: owner,
      gas: 21_000n, ...AENEID_FEE_OVERRIDES,
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`[oracle] funded operator with 0.1 IP (tx ${tx})`);
  } catch (e) {
    console.error(`[oracle] fund operator failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

async function processOracleJob(job: Job<OracleJobData>): Promise<unknown> {
  const { uuid } = job.data;
  if (!operatorWallet || !operatorAccount) return { skipped: "no_operator_key" };

  // Idempotency: skip if outcomes row already has a non-null operator for this uuid.
  // outcomes table is keyed on hatchUuid (PK), so a row implies submitted.
  const [existing] = await db.select().from(schema.outcomes).where(eq(schema.outcomes.hatchUuid, uuid));
  if (existing && existing.operator) {
    return { skipped: "already_attested", existingOperator: existing.operator };
  }

  const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!h) throw new Error(`oracle: hatch ${uuid} not in DB`);
  const spec = h.outcomeSpec as OutcomeSpec | null;
  if (!spec) return { skipped: "no_outcome_spec" };
  if (spec.kind !== "price") return { skipped: `kind_${spec.kind}_unsupported` };
  if (Date.now() < h.revealAt.getTime()) throw new Error(`oracle: too early for ${uuid}`);

  // Fetch source data
  const asset = spec.asset ?? "BTC";
  const currency = spec.currency ?? "USD";
  const { value: outcomeValue, raw, observedAt } = await fetchPriceCoingecko(asset, currency);
  const payload = { kind: spec.kind, asset, currency, source: spec.source ?? "coingecko", raw, observedAt };
  const outcomeHash = canonicalOutcomeHash(payload);

  // Build attestation
  const hatchId = hatchIdFor(uuid);
  const nonce = BigInt(Date.now()) * 1000n + BigInt(uuid);
  const att = { hatchId, outcomeHash, outcomeValue, observedAt: BigInt(observedAt), nonce };

  // EIP-712 sign
  const domain = { name: "HatchOracle", version: "1", chainId: 1315, verifyingContract: CONTRACTS.oracle };
  const types = {
    Attestation: [
      { name: "hatchId", type: "bytes32" }, { name: "outcomeHash", type: "bytes32" },
      { name: "outcomeValue", type: "int256" }, { name: "observedAt", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const sig = await operatorAccount.signTypedData({ domain, types, primaryType: "Attestation", message: att });

  // Submit on-chain with explicit Aeneid-tuned fees (viem default maxFeePerGas is ~10000× too high)
  const { request } = await publicClient.simulateContract({
    address: CONTRACTS.oracle, abi: HATCH_ORACLE_ABI, functionName: "submitAttestation",
    args: [att, sig], account: operatorAccount,
  });
  const tx = await operatorWallet.writeContract({ ...request, ...AENEID_FEE_OVERRIDES });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash: tx });

  // Schedule finalize at submittedAt + challengeWindow + 5s buffer
  const window = await publicClient.readContract({
    address: CONTRACTS.oracle, abi: HATCH_ORACLE_ABI, functionName: "challengeWindow",
  });
  const finalizeDelay = Number(window) * 1000 + 5000;
  await finalizeQueue.add("finalize", { uuid, hatchId } satisfies FinalizeJobData, {
    jobId: `finalize-${uuid}`, delay: finalizeDelay, attempts: 5,
    backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { count: 100 },
  });
  return { tx, gas: rcpt.gasUsed.toString(), outcomeValue: outcomeValue.toString(), raw, payload };
}

async function processFinalizeJob(job: Job<FinalizeJobData>): Promise<unknown> {
  const { uuid, hatchId } = job.data;
  if (!operatorWallet || !operatorAccount) return { skipped: "no_operator_key" };
  const rec = await publicClient.readContract({
    address: CONTRACTS.oracle, abi: HATCH_ORACLE_ABI, functionName: "getRecord", args: [hatchId],
  });
  // viem returns multi-return tuples as arrays even when named in parseAbi.
  // tuple layout: [att, signer, submittedAt, status, challenger, bond]
  const status = Array.isArray(rec) ? Number(rec[3]) : Number((rec as { status: number }).status);
  if (status === 3) return { skipped: "already_finalized" };
  if (status === 2) return { skipped: "disputed", note: "requires owner resolveChallenge" };
  if (status !== 1) return { skipped: `status_${status}` };
  try {
    const { request } = await publicClient.simulateContract({
      address: CONTRACTS.oracle, abi: HATCH_ORACLE_ABI, functionName: "finalize",
      args: [hatchId], account: operatorAccount,
    });
    const tx = await operatorWallet.writeContract({ ...request, ...AENEID_FEE_OVERRIDES });
    const r = await publicClient.waitForTransactionReceipt({ hash: tx });
    return { tx, gas: r.gasUsed.toString() };
  } catch (e) {
    // WindowOpen → reschedule briefly
    const msg = (e as Error).message;
    if (msg.includes("WindowOpen")) {
      await finalizeQueue.add("finalize", { uuid, hatchId }, {
        jobId: `finalize-${uuid}-retry-${Date.now()}`, delay: 10_000, attempts: 3,
      });
      return { skipped: "window_still_open_rescheduled" };
    }
    throw e;
  }
}

/** Enqueue oracle attestation for a hatch at revealAt. Called by indexer on hatch:allocated
 *  (only if outcome_spec is set). Idempotent jobId. */
export async function enqueueOracle(uuid: number, revealAtMs: number): Promise<void> {
  const delay = Math.max(0, revealAtMs - Date.now());
  await oracleQueue.add("oracle", { uuid }, {
    jobId: `oracle-${uuid}`, delay, attempts: 5,
    backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: { count: 100 },
  });
}

/** Boot the oracle + finalize workers. Returns both for shutdown control. */
export async function startOracleWorker(): Promise<{ oracle: Worker; finalize: Worker }> {
  await ensureOperatorFunded();
  await ensureOperatorRegistered();
  const oracle = new Worker<OracleJobData>("hatch-oracle", processOracleJob, { connection, concurrency: 2 });
  const finalize = new Worker<FinalizeJobData>("hatch-finalize", processFinalizeJob, { connection, concurrency: 2 });
  for (const w of [oracle, finalize]) {
    w.on("failed", (job, err) => console.error(`[oracle] ${w.name}/${job?.id} failed: ${err?.message?.slice(0, 200)}`));
    w.on("completed", (job, ret) => console.log(`[oracle] ${w.name}/${job.id} → ${JSON.stringify(ret)?.slice(0, 200)}`));
  }

  // Auto-enqueue when the indexer surfaces a new hatch with an outcome_spec
  indexerBus.on("hatch:allocated", async ({ uuid }) => {
    try {
      const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
      if (!h || !h.outcomeSpec) return;
      await enqueueOracle(uuid, h.revealAt.getTime());
    } catch (e) {
      console.error("[oracle] auto-enqueue failed:", (e as Error).message);
    }
  });

  return { oracle, finalize };
}
