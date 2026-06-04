/* StoryClient + HatchConfig wired to the user's wagmi wallet.
 *
 * `useStoryWiring()` resolves to `{ storyClient, account, walletClient,
 * publicClient, txExecutor? }` once wagmi has the connected wallet ready on
 * Aeneid. The returned StoryClient is constructed against the user's account
 * so writes sign with their wallet.
 *
 * `txExecutor` is populated when Privy + Pimlico smart wallets are configured
 * (VITE_PRIVY_APP_ID set + user logged in via embedded wallet). When passed to
 * SDK calls that accept a TxExecutor, the transaction is submitted through the
 * smart wallet (paymaster-sponsored, no gas paid by user). */
import { useMemo } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { createWalletClient, custom, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from "viem";
import { StoryClient, type StoryConfig } from "@story-protocol/core-sdk";
import { AENEID, HATCH, type HatchConfig, type TxExecutor } from "@usehatch/sdk";
import { useSmartWalletsSafe } from "./privy-bridge.js";

export const STORY_AENEID_ID = 1315;

/* Story SDK calls `simulateContract → writeContract` without pre-estimating gas,
 * delegating to the wallet. MetaMask normally estimates, but Privy embedded
 * wallets (and some custom connectors on Aeneid) forward `eth_sendTransaction`
 * with `gas: 0`, which the node rejects with "intrinsic gas too low".
 *
 * Wrap the underlying provider so any `eth_sendTransaction` that arrives without
 * a gas field gets one estimated via the public RPC, with a 20% buffer. */
type JsonRpcRequest = { method: string; params?: readonly unknown[] };
type JsonRpcProvider = { request: (args: JsonRpcRequest) => Promise<unknown> };
function withGasEstimation(provider: JsonRpcProvider, publicClient: PublicClient): JsonRpcProvider {
  return {
    async request(args: JsonRpcRequest): Promise<unknown> {
      if (args.method !== "eth_sendTransaction" || !Array.isArray(args.params) || !args.params[0]) {
        return provider.request(args);
      }
      const tx = { ...(args.params[0] as Record<string, unknown>) };
      const currentGas = typeof tx.gas === "string" ? tx.gas : undefined;
      if (!currentGas || currentGas === "0x" || currentGas === "0x0") {
        try {
          const estimated = await publicClient.estimateGas({
            account: tx.from as `0x${string}`,
            to: tx.to as `0x${string}` | undefined,
            data: tx.data as `0x${string}` | undefined,
            value: typeof tx.value === "string" ? BigInt(tx.value) : undefined,
          });
          tx.gas = `0x${((estimated * 120n) / 100n).toString(16)}`;
        } catch {
          // Aeneid estimateGas occasionally fails on first-touch IPAs; fall back
          // to a generous limit so the demo flow doesn't dead-end on the heuristic.
          tx.gas = `0x${(3_000_000n).toString(16)}`;
        }
        return provider.request({ method: "eth_sendTransaction", params: [tx] });
      }
      return provider.request(args);
    },
  };
}

export interface StoryWiring {
  storyClient: StoryClient;
  account: { address: `0x${string}`; type: "json-rpc" };
  /** Gas-estimating walletClient — every `eth_sendTransaction` it issues is
   *  guaranteed to carry a populated `gas` field, so CDR / registry / Story
   *  SDK writes all land instead of dying at "intrinsic gas too low". */
  walletClient: WalletClient;
  publicClient: ReturnType<typeof usePublicClient>;
  hatchConfig: Pick<HatchConfig, "chain" | "hatch">;
  /** Sponsored-tx executor (Privy + Pimlico). null when Privy is disabled
   *  or the user logged in with an external wallet (no smart wallet attached). */
  txExecutor: TxExecutor | null;
}

/** Returns null until both wagmi clients are ready and chain is Aeneid. */
export function useStoryWiring(): StoryWiring | null {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const smartWallet = useSmartWalletsSafe();

  return useMemo(() => {
    if (!isConnected || !address || chainId !== STORY_AENEID_ID) return null;
    if (!publicClient || !walletClient) return null;

    /* Wrap the underlying provider once; both the StoryClient transport and the
     * viem walletClient we expose are built on top of it, so every signed write
     * downstream (Story SDK, CDR uploader, our HatchPublisherRegistry calls)
     * gets gas estimation injected at the same point. */
    const wrappedProvider = withGasEstimation(walletClient.transport as unknown as JsonRpcProvider, publicClient);
    const transport = custom(wrappedProvider);
    const storyConfig: StoryConfig = {
      account: { address, type: "json-rpc" },
      transport,
      chainId: "aeneid",
    } as StoryConfig;
    const storyClient = StoryClient.newClient(storyConfig);

    const wrappedWalletClient = createWalletClient({
      account: { address, type: "json-rpc" },
      chain: walletClient.chain,
      transport,
    });

    const txExecutor: TxExecutor | null = smartWallet
      ? {
          async sendTransaction(args: { to: Address; data: Hex; value?: bigint }): Promise<Hash> {
            return smartWallet.sendTransaction({
              to: args.to,
              data: args.data,
              value: args.value,
            });
          },
        }
      : null;

    return {
      storyClient,
      account: { address, type: "json-rpc" },
      walletClient: wrappedWalletClient,
      publicClient,
      hatchConfig: { chain: AENEID, hatch: HATCH },
      txExecutor,
    };
  }, [address, isConnected, chainId, publicClient, walletClient, smartWallet]);
}
