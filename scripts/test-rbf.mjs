/* Test-driver RBF helper. NOT part of EphemeralPool — pool has its own RBF
 * on its own nonce stream. This helper is for the test-driver wallet
 * (PUBLISHER), which gets its nonces poisoned when Aeneid RPC briefly rejects
 * eth_estimateGas and viem leaves the rejected tx at the same nonce in mempool.
 *
 * Usage:
 *   await unstickWallet({ publicClient, walletClient, account, ageSecs: 30 });
 *
 * One-shot: scans pending nonces > confirmed nonce, resubmits each as a self-send
 * with +12.5% gasPrice and the explicit fee params Aeneid wants. */
import { parseEther } from "viem";

const RBF_BUMP_BPS = 1250;       // +12.5%
const BASE_TIP_WEI = 100_000_000n; // 0.1 gwei tip floor

export async function unstickWallet({
  publicClient, walletClient, account, ageSecs = 30,
}) {
  const addr = account.address;
  const confirmedNonce = await publicClient.getTransactionCount({ address: addr, blockTag: "latest" });
  const pendingNonce = await publicClient.getTransactionCount({ address: addr, blockTag: "pending" });
  const stuck = pendingNonce - confirmedNonce;
  if (stuck <= 0) return { stuck: 0, replaced: [], pendingNonce, confirmedNonce };

  console.log(`[test-rbf] ${addr}: ${stuck} stuck tx(s) (confirmed=${confirmedNonce}, pending=${pendingNonce})`);
  const fee = await publicClient.getGasPrice().catch(() => 1_000_000_000n);
  const bumped = (fee * BigInt(10_000 + RBF_BUMP_BPS)) / 10_000n;
  const maxFee  = bumped > 1_000_000_000n ? bumped : 1_000_000_000n; // floor 1 gwei
  const maxTip  = bumped / 10n > BASE_TIP_WEI ? bumped / 10n : BASE_TIP_WEI;
  const replaced = [];

  for (let n = confirmedNonce; n < pendingNonce; n++) {
    try {
      const hash = await walletClient.sendTransaction({
        account, to: addr, value: 0n, chain: walletClient.chain,
        nonce: n, gas: 21000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxTip,
      });
      console.log(`[test-rbf]   replaced nonce ${n} → ${hash}`);
      replaced.push({ nonce: n, hash });
    } catch (e) {
      console.log(`[test-rbf]   nonce ${n} replace failed: ${e?.shortMessage ?? e?.message?.slice(0, 80)}`);
    }
  }
  // Wait briefly for receipts; one-shot fallback only — don't loop.
  await new Promise((r) => setTimeout(r, ageSecs * 1000));
  const after = await publicClient.getTransactionCount({ address: addr, blockTag: "latest" });
  return { stuck, replaced, confirmedAfter: after };
}
