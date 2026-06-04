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
import { custom, type Address, type Hash, type Hex } from "viem";
import { StoryClient, type StoryConfig } from "@story-protocol/core-sdk";
import { AENEID, HATCH, type HatchConfig, type TxExecutor } from "@usehatch/sdk";
import { useSmartWalletsSafe } from "./privy-bridge.js";

export const STORY_AENEID_ID = 1315;

export interface StoryWiring {
  storyClient: StoryClient;
  account: { address: `0x${string}`; type: "json-rpc" };
  walletClient: ReturnType<typeof useWalletClient>["data"];
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

    const transport = custom(walletClient.transport);
    const storyConfig: StoryConfig = {
      account: { address, type: "json-rpc" },
      transport,
      chainId: "aeneid",
    } as StoryConfig;
    const storyClient = StoryClient.newClient(storyConfig);

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
      walletClient,
      publicClient,
      hatchConfig: { chain: AENEID, hatch: HATCH },
      txExecutor,
    };
  }, [address, isConnected, chainId, publicClient, walletClient, smartWallet]);
}
