/* StoryClient + HatchConfig wired to the user's wagmi wallet.
 *
 * `useStoryClient()` resolves to `{ storyClient, account, walletClient,
 * publicClient }` once wagmi has the connected wallet ready on Aeneid. The
 * returned StoryClient is constructed against the user's account so writes
 * sign with their wallet. */
import { useMemo } from "react";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { custom } from "viem";
import { StoryClient, type StoryConfig } from "@story-protocol/core-sdk";
import { AENEID, HATCH, type HatchConfig } from "@usehatch/sdk";

export const STORY_AENEID_ID = 1315;

export interface StoryWiring {
  storyClient: StoryClient;
  account: { address: `0x${string}` };
  walletClient: ReturnType<typeof useWalletClient>["data"];
  publicClient: ReturnType<typeof usePublicClient>;
  hatchConfig: Pick<HatchConfig, "chain" | "hatch">;
}

/** Returns null until both wagmi clients are ready and chain is Aeneid. */
export function useStoryWiring(): StoryWiring | null {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!isConnected || !address || chainId !== STORY_AENEID_ID) return null;
    if (!publicClient || !walletClient) return null;

    const transport = custom(walletClient.transport);
    const storyConfig: StoryConfig = {
      account: { address },
      transport,
      chainId: "aeneid",
    } as StoryConfig;
    const storyClient = StoryClient.newClient(storyConfig);

    return {
      storyClient,
      account: { address },
      walletClient,
      publicClient,
      hatchConfig: { chain: AENEID, hatch: HATCH },
    };
  }, [address, isConnected, chainId, publicClient, walletClient]);
}
