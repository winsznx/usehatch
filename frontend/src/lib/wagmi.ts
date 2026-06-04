/* Wagmi v2 configuration for Story Aeneid testnet (chain 1315).
 *
 * Auth + wallet-picker UI is driven by Privy now (see lib/privy.tsx). This
 * file keeps wagmi happy for everywhere else in the app that reads connected
 * account state via wagmi hooks (useAccount, useWalletClient, etc.). Privy's
 * adapter at @privy-io/wagmi exposes the connected wallet (embedded or
 * external) through those same hooks.
 *
 * Aeneid's eth_feeHistory-based estimator returns gas caps roughly 10,000x
 * higher than what the chain actually accepts. We override the EIP-1559 fee
 * fields at the chain level so every write call defaults to sane caps. */
import { http, fallback, type Transport } from "viem";
import type { Chain } from "viem";
import { createConfig } from "wagmi";
import { injected, metaMask, walletConnect } from "wagmi/connectors";

import { config as appConfig } from "./config.js";

function buildTransport(primary: string, fallbacks: string[]): Transport {
  if (!fallbacks.length) return http(primary);
  return fallback([http(primary), ...fallbacks.map((u) => http(u))], { rank: true, retryCount: 2 });
}

export const AENEID_MAX_FEE_PER_GAS = 1_000_000_000n;
export const AENEID_MAX_PRIORITY_FEE_PER_GAS = 100_000_000n;

export const storyAeneid: Chain = {
  id: 1315,
  name: "Story Aeneid",
  nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 },
  rpcUrls: {
    default: { http: [appConfig.rpcUrl] },
    public: { http: ["https://aeneid.storyrpc.io"] },
  },
  blockExplorers: {
    default: { name: "Storyscan", url: "https://aeneid.storyscan.io" },
  },
  testnet: true,
  fees: {
    estimateFeesPerGas: async () => ({
      maxFeePerGas: AENEID_MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: AENEID_MAX_PRIORITY_FEE_PER_GAS,
    }),
  },
};

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "";

export const wagmiConfig = createConfig({
  chains: [storyAeneid],
  connectors: [
    injected({ shimDisconnect: true }),
    metaMask(),
    ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })] : []),
  ],
  transports: { [storyAeneid.id]: buildTransport(appConfig.rpcUrl, appConfig.rpcUrlFallbacks) },
  ssr: false,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

// Privy supplies its own themed modal; RainbowKit theme exports removed.
