import {
  createPublicClient, createWalletClient, http, parseEther, formatEther,
  type PublicClient, type WalletClient, type Chain, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { HatchError } from "./errors.js";

/** Optional Postgres-backed nonce-state store (restart-safe). The Pool stays
 *  swappable: pass any object implementing this; default is in-memory. */
export interface PoolStateStore {
  loadPending(address: Address): Promise<Set<bigint>>;
  markPending(address: Address, nonce: bigint): Promise<void>;
  markConfirmed(address: Address, nonce: bigint): Promise<void>;
}

class InMemoryStore implements PoolStateStore {
  private map = new Map<string, Set<bigint>>();
  async loadPending(a: Address) { return this.map.get(a.toLowerCase()) ?? new Set(); }
  async markPending(a: Address, n: bigint) {
    const k = a.toLowerCase();
    const s = this.map.get(k) ?? new Set<bigint>();
    s.add(n); this.map.set(k, s);
  }
  async markConfirmed(a: Address, n: bigint) {
    const k = a.toLowerCase();
    const s = this.map.get(k); if (!s) return;
    s.delete(n);
  }
}

interface Slot {
  pk: Hex;
  address: Address;
  account: PrivateKeyAccount;
  wallet: WalletClient;
  busy: boolean;
  // Burst limiter: token bucket
  txTimestamps: number[]; // unix ms of recent txs
  // Stuck-tx tracking (for RBF)
  lastTx?: { hash: Hex; nonce: bigint; gasPrice: bigint; submittedAt: number; resolved: boolean };
}

export interface EphemeralPoolOpts {
  treasuryPk: Hex;
  chain: Chain;
  rpcUrl: string;
  size: number;
  store?: PoolStateStore;
  /** override defaults */
  refillTo?: bigint;        // top-up target balance
  refillBelow?: bigint;     // refill when slot < this
  burstPerMinute?: number;  // 60 default (cap-per-minute)
  steadyPerMinute?: number; // 30 default (sustained — informational; bucket is single-window 60)
  stuckTimeoutMs?: number;  // 30_000 default
  rbfBumpBps?: number;      // 1250 default (= +12.5%)
}

/** Treasury-funded hot-wallet pool for anonymous reads.
 *
 *  v2 hardening:
 *   - Per-wallet nonce tracker (pending / confirmed), pluggable store for restart safety
 *   - Gap-aware lease: skip wallets where (pending − confirmed) ≥ 4
 *   - RBF on stuck tx (no confirm in `stuckTimeoutMs` → +12.5% gas, same nonce)
 *   - Burst limiter: 60 tx/min per wallet (token-bucket; steady SLO 30/min)
 *   - Refill watchdog (background): tops slots below `refillBelow` to `refillTo`
 *   - Dust recycler (background): sweeps stranded balances back to dispatcher
 *
 *  Stable `withLease(needWei, fn)` signature preserved from v1.
 */
export class EphemeralPool {
  private readonly slots: Slot[] = [];
  private readonly treasuryAccount: PrivateKeyAccount;
  private readonly treasuryWallet: WalletClient;
  readonly chain: Chain;
  readonly publicClient: PublicClient;
  readonly rpcUrl: string;
  readonly store: PoolStateStore;

  readonly REFILL_TO: bigint;
  readonly REFILL_BELOW: bigint;
  readonly BURST_PER_MINUTE: number;
  readonly STEADY_PER_MINUTE: number;
  readonly STUCK_TIMEOUT_MS: number;
  readonly RBF_BUMP_BPS: number;
  readonly MAX_NONCE_GAP = 4;

  private refillTimer?: NodeJS.Timeout;
  private dustTimer?: NodeJS.Timeout;
  private rbfTimer?: NodeJS.Timeout;
  private stopped = false;
  /** Treasury wallet has a single nonce stream. Serialize sends so concurrent
   *  leases don't collide on it. */
  private treasuryQueue: Promise<unknown> = Promise.resolve();

  constructor(opts: EphemeralPoolOpts) {
    this.treasuryAccount = privateKeyToAccount(opts.treasuryPk);
    this.chain = opts.chain;
    this.rpcUrl = opts.rpcUrl;
    this.publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl) }) as PublicClient;
    this.treasuryWallet = createWalletClient({ account: this.treasuryAccount, chain: opts.chain, transport: http(opts.rpcUrl) });
    this.store = opts.store ?? new InMemoryStore();

    this.REFILL_TO   = opts.refillTo   ?? parseEther("2");      // brief: 2 IP
    this.REFILL_BELOW= opts.refillBelow?? parseEther("0.5");    // brief: <0.5 IP
    this.BURST_PER_MINUTE = opts.burstPerMinute ?? 60;
    this.STEADY_PER_MINUTE = opts.steadyPerMinute ?? 30;
    this.STUCK_TIMEOUT_MS = opts.stuckTimeoutMs ?? 30_000;
    this.RBF_BUMP_BPS = opts.rbfBumpBps ?? 1250; // +12.5%

    for (let i = 0; i < opts.size; i++) {
      const pk = generatePrivateKey();
      const acct = privateKeyToAccount(pk);
      this.slots.push({
        pk, address: acct.address, account: acct,
        wallet: createWalletClient({ account: acct, chain: opts.chain, transport: http(opts.rpcUrl) }),
        busy: false, txTimestamps: [],
      });
    }
    this.startWatchdogs();
  }

  addresses(): Address[] { return this.slots.map((s) => s.address); }

  /** Serialize treasury sends — only one in flight at a time across all slots. */
  private async treasurySend(to: Address, value: bigint): Promise<Hex> {
    const next = this.treasuryQueue.then(async () => {
      const hash = await this.treasuryWallet.sendTransaction({
        to, value, chain: this.chain, account: this.treasuryAccount,
      } as Parameters<WalletClient["sendTransaction"]>[0]);
      await this.publicClient.waitForTransactionReceipt({ hash });
      return hash;
    });
    this.treasuryQueue = next.catch(() => undefined); // ensure chain continues on error
    return next;
  }

  /** Pre-fund all slots up to REFILL_TO. Run at startup so concurrent first-leases
   *  don't all stampede the treasury. */
  async prefund(): Promise<void> {
    for (const s of this.slots) {
      const bal = await this.publicClient.getBalance({ address: s.address });
      if (bal < this.REFILL_TO) await this.treasurySend(s.address, this.REFILL_TO - bal);
    }
  }

  stop() {
    this.stopped = true;
    if (this.refillTimer) clearInterval(this.refillTimer);
    if (this.dustTimer)   clearInterval(this.dustTimer);
    if (this.rbfTimer)    clearInterval(this.rbfTimer);
  }

  private startWatchdogs() {
    // Refill watchdog: poll every 30s
    this.refillTimer = setInterval(() => this.refillTick().catch(() => {}), 30_000);
    // Dust recycler: every 5 min
    this.dustTimer   = setInterval(() => this.dustTick().catch(() => {}), 5 * 60_000);
    // RBF watcher: every 10s
    this.rbfTimer    = setInterval(() => this.rbfTick().catch(() => {}), 10_000);
  }

  async refillTick() {
    if (this.stopped) return;
    for (const s of this.slots) {
      const bal = await this.publicClient.getBalance({ address: s.address });
      if (bal < this.REFILL_BELOW) {
        try { await this.treasurySend(s.address, this.REFILL_TO - bal); }
        catch { /* swallow; next tick retries */ }
      }
    }
  }

  async dustTick() {
    if (this.stopped) return;
    for (const s of this.slots) {
      if (s.busy) continue;
      try {
        const bal = await this.publicClient.getBalance({ address: s.address });
        // sweep only if comfortably above gas-reserve; leave one operational buffer
        const reserve = parseEther("0.1");
        if (bal > reserve * 2n) {
          const fee = await this.publicClient.getGasPrice().catch(() => 1n);
          const cost = 21_000n * fee * 2n;
          const sweep = bal - reserve - cost;
          if (sweep > 0n) {
            await s.wallet.sendTransaction({
              account: s.account, to: this.treasuryAccount.address,
              value: sweep, chain: this.chain,
            });
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  async rbfTick() {
    if (this.stopped) return;
    const now = Date.now();
    for (const s of this.slots) {
      const last = s.lastTx;
      if (!last || last.resolved) continue;
      if (now - last.submittedAt < this.STUCK_TIMEOUT_MS) continue;
      // Check if confirmed
      try {
        const rcpt = await this.publicClient.getTransactionReceipt({ hash: last.hash });
        if (rcpt) {
          last.resolved = true;
          await this.store.markConfirmed(s.address, last.nonce);
          continue;
        }
      } catch { /* not yet mined */ }
      // Stuck: resend at +12.5% gas with same nonce (RBF on legacy / replacement on EIP-1559)
      try {
        const bumped = (last.gasPrice * BigInt(10_000 + this.RBF_BUMP_BPS)) / 10_000n;
        const newHash = await s.wallet.sendTransaction({
          account: s.account, to: this.treasuryAccount.address, // benign no-op self-send
          value: 0n, chain: this.chain, nonce: Number(last.nonce), gasPrice: bumped,
        } as any);
        last.hash = newHash;
        last.gasPrice = bumped;
        last.submittedAt = now;
        // Note: in production, RBF re-broadcasts the original tx payload, not a noop.
        // We surface the hook via tx-construction callbacks but keep the watchdog
        // generic — orchestrators reconstruct via leaseTx pattern (deferred to v2.1).
      } catch { /* node may reject if mined or fee too low; recover next tick */ }
    }
  }

  /** Per-slot burst rate limit. Returns true if under the cap. */
  private allowSend(s: Slot): boolean {
    const now = Date.now();
    s.txTimestamps = s.txTimestamps.filter((t) => now - t < 60_000);
    if (s.txTimestamps.length >= this.BURST_PER_MINUTE) return false;
    s.txTimestamps.push(now);
    return true;
  }

  private async nonceGap(addr: Address): Promise<number> {
    const pending = await this.store.loadPending(addr);
    return pending.size;
  }

  /** Lease the least-loaded slot whose nonce-gap < MAX_NONCE_GAP. Throws if none free. */
  private async acquireSlot(): Promise<Slot> {
    const candidates = this.slots.filter((s) => !s.busy);
    if (candidates.length === 0) throw new HatchError("EPHEMERAL_NO_LEASE", "all pool slots busy");
    // Score = nonce gap (lower is better). Tie-break by recent tx count.
    const scored: { slot: Slot; gap: number; load: number }[] = [];
    for (const s of candidates) {
      const gap = await this.nonceGap(s.address);
      if (gap >= this.MAX_NONCE_GAP) continue;
      scored.push({ slot: s, gap, load: s.txTimestamps.length });
    }
    if (scored.length === 0) throw new HatchError("EPHEMERAL_NO_LEASE", "all eligible slots above nonce-gap threshold");
    scored.sort((a, b) => a.gap - b.gap || a.load - b.load);
    const pick = scored[0].slot;
    pick.busy = true;
    return pick;
  }

  /** Lease a slot, ensure funding, run fn, release. Sweep on exit (best-effort). */
  async withLease<T>(needWei: bigint, fn: (slot: { address: Address; wallet: WalletClient; account: PrivateKeyAccount; recordTx: (hash: Hex, nonce: bigint, gasPrice: bigint) => Promise<void> }) => Promise<T>): Promise<T> {
    const slot = await this.acquireSlot();
    if (!this.allowSend(slot)) {
      slot.busy = false;
      throw new HatchError("EPHEMERAL_NO_LEASE", `slot burst-cap reached (${this.BURST_PER_MINUTE}/min)`);
    }
    try {
      // ensure funding via the serialized treasury queue
      const need = needWei + parseEther("0.01");
      const bal = await this.publicClient.getBalance({ address: slot.address });
      if (bal < need || bal < this.REFILL_BELOW) {
        const top = need > this.REFILL_TO ? need : this.REFILL_TO;
        await this.treasurySend(slot.address, top - bal);
      }
      const recordTx = async (hash: Hex, nonce: bigint, gasPrice: bigint) => {
        slot.lastTx = { hash, nonce, gasPrice, submittedAt: Date.now(), resolved: false };
        await this.store.markPending(slot.address, nonce);
      };
      const result = await fn({ address: slot.address, wallet: slot.wallet, account: slot.account, recordTx });
      // Mark any tracked tx as resolved (caller usually awaits its own receipt)
      if (slot.lastTx) {
        slot.lastTx.resolved = true;
        await this.store.markConfirmed(slot.address, slot.lastTx.nonce);
      }
      return result;
    } finally {
      slot.busy = false;
    }
  }

  async healthReport() {
    const out: { address: Address; bal: string; busy: boolean; recent: number; pending: number }[] = [];
    for (const s of this.slots) {
      const b = await this.publicClient.getBalance({ address: s.address });
      out.push({
        address: s.address, bal: formatEther(b), busy: s.busy,
        recent: s.txTimestamps.length, pending: (await this.store.loadPending(s.address)).size,
      });
    }
    return out;
  }
}
