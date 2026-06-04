import { CDRClient } from "@piplabs/cdr-sdk";
import { ensureWasm } from "./crypto.js";
import { encodeAbiParameters, parseAbi } from "viem";
import type { Account, PublicClient, WalletClient } from "viem";
import type { HatchConfig } from "./config.js";
import type { Entitlement, ReadResult, ReadVia } from "./types.js";
import { parseManifest } from "./manifest.js";
import { EphemeralPool } from "./ephemeral-pool.js";
import { HatchError, translate } from "./errors.js";
import { withCdrRetry } from "./cdr-runtime.js";

/** Pass lend/unlend ABI — only the bits this SDK invokes. */
const passLendAbi = parseAbi([
  "function lend(uint256 tokenId, address borrower) external",
  "function unlend(uint256 tokenId) external",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

/** Build accessAuxData per the canonical kind-prefixed encoding. */
export function encodeAccessAux(entitlement: Entitlement | "empty"): `0x${string}` {
  if (entitlement === "empty") return "0x";
  if (entitlement.kind === 0) {
    const inner = encodeAbiParameters([{ type: "uint256[]" }], [entitlement.licenseTokenIds]);
    return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [0, inner]);
  }
  const inner = encodeAbiParameters([{ type: "uint256" }], [entitlement.passId]);
  return encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [1, inner]);
}

export type ReadVia2 = ReadVia | "anonymous-lent";

export interface ReadHatchArgs {
  config: HatchConfig;
  publicClient: PublicClient;
  uuid: number;
  entitlement: Entitlement | "empty";        // "empty" for post-reveal open reads
  via: ReadVia2;
  // wallet-mode args
  walletClient?: WalletClient;
  account?: Account;
  // anonymous-mode args
  pool?: EphemeralPool;
  // anonymous-lent mode args (kind=1 anonymous)
  subscriberWallet?: WalletClient;
  subscriberAccount?: Account;
}

export async function readHatch(args: ReadHatchArgs): Promise<ReadResult> {
  await ensureWasm();
  const accessAuxData = encodeAccessAux(args.entitlement);
  const t0 = performance.now();

  try {
    if (args.via === "wallet") {
      if (!args.walletClient || !args.account) throw new HatchError("WALLET_REQUIRED", "wallet+account required for via:'wallet'");
      const cdr = new CDRClient({
        network: "testnet", publicClient: args.publicClient, walletClient: args.walletClient,
        apiUrl: args.config.chain.storyApiUrl,
      });
      const { dataKey, txHash } = await withCdrRetry(() => cdr.consumer.accessCDR({ uuid: args.uuid, accessAuxData }));
      const parsed = await parseManifest({ storage: args.config.storage, manifestBytes: dataKey });
      return { ...parsed, txHash, reader: args.account.address, latencyMs: performance.now() - t0 };
    }

    // anonymous mode (post-reveal "empty" path; kind=0 anonymous is NOT offered —
    // the per-hatch license mint is itself a public action, so anonymous-per-hatch
    // provides no privacy that the user can't already get themselves)
    if (args.via === "anonymous") {
      if (!args.pool) throw new HatchError("EPHEMERAL_NO_LEASE", "anonymous reads require an EphemeralPool in args.pool");
      if (args.entitlement !== "empty") {
        throw new HatchError("WALLET_REQUIRED", "via:'anonymous' supports only entitlement:'empty' (post-reveal). For kind=1 pre-reveal use via:'anonymous-lent'; kind=0 anonymous is not offered.");
      }
      return await args.pool.withLease(0n, async ({ address, wallet }) => {
        const cdr = new CDRClient({
          network: "testnet", publicClient: args.publicClient, walletClient: wallet,
          apiUrl: args.config.chain.storyApiUrl,
        });
        const { dataKey, txHash } = await withCdrRetry(() => cdr.consumer.accessCDR({ uuid: args.uuid, accessAuxData }));
        const parsed = await parseManifest({ storage: args.config.storage, manifestBytes: dataKey });
        return { ...parsed, txHash, reader: address, latencyMs: performance.now() - t0 };
      });
    }

    // anonymous-lent mode (kind=1 pre-reveal): subscriber lends pass → ephemeral reads → unlend.
    // Subscriber wallet must be available to sign the lend/unlend pair; this matches the canonical
    // "wallet popup at /read time" UX. Production v2 should add EIP-712 lendBySig on the Pass to
    // collapse to a single signature; we don't ship that here.
    if (args.via === "anonymous-lent") {
      if (!args.pool) throw new HatchError("EPHEMERAL_NO_LEASE", "anonymous-lent requires an EphemeralPool in args.pool");
      if (!args.subscriberWallet || !args.subscriberAccount)
        throw new HatchError("WALLET_REQUIRED", "anonymous-lent requires subscriberWallet + subscriberAccount");
      if (typeof args.entitlement !== "object" || args.entitlement.kind !== 1)
        throw new HatchError("WALLET_REQUIRED", "anonymous-lent requires entitlement: { kind: 1, passId }");
      const passId = args.entitlement.passId;
      const passAddress = args.config.hatch.subscriptionPass;

      return await args.pool.withLease(0n, async ({ address: ephAddr, wallet: ephWallet }) => {
        // 1. subscriber lends pass to ephemeral
        const lendSim = await args.publicClient.simulateContract({
          address: passAddress, abi: passLendAbi, functionName: "lend",
          args: [passId, ephAddr], account: args.subscriberAccount!,
        });
        const lendTx = await args.subscriberWallet!.writeContract(lendSim.request);
        await args.publicClient.waitForTransactionReceipt({ hash: lendTx });

        try {
          // 2. ephemeral reads with kind=1 — ownerOf(passId) now == ephemeral
          const cdr = new CDRClient({
            network: "testnet", publicClient: args.publicClient, walletClient: ephWallet,
            apiUrl: args.config.chain.storyApiUrl,
          });
          const { dataKey, txHash } = await withCdrRetry(() => cdr.consumer.accessCDR({ uuid: args.uuid, accessAuxData }));
          const parsed = await parseManifest({ storage: args.config.storage, manifestBytes: dataKey });
          return { ...parsed, txHash, reader: ephAddr, latencyMs: performance.now() - t0 };
        } finally {
          // 3. ALWAYS unlend, even on error, so the subscriber's pass isn't stranded
          try {
            const unlendSim = await args.publicClient.simulateContract({
              address: passAddress, abi: passLendAbi, functionName: "unlend",
              args: [passId], account: args.subscriberAccount!,
            });
            const unlendTx = await args.subscriberWallet!.writeContract(unlendSim.request);
            await args.publicClient.waitForTransactionReceipt({ hash: unlendTx });
          } catch (e) {
            console.error("[lent-pass] unlend failed; pass may be stuck on ephemeral", e);
          }
        }
      });
    }

    throw new HatchError("UNKNOWN", `unknown via mode: ${args.via}`);
  } catch (e) {
    if (e instanceof HatchError) throw e;
    throw translate(e);
  }
}
