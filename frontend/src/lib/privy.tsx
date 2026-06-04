/* Privy + Pimlico provider stack.
 *
 * Strategy: additive, conditional.
 * - When `VITE_PRIVY_APP_ID` is set → Privy + SmartWallets + Privy's wagmi adapter
 *   mount. Privy's embedded-wallet appears as a wagmi connector, so RainbowKit's
 *   modal automatically lists "Privy / Email login" alongside MetaMask. No change
 *   to ConnectWallet or the SIWE handshake required.
 * - When unset → falls back to the existing wagmi + RainbowKit stack untouched.
 *
 * Pimlico paymaster sponsorship is configured in Privy's dashboard (Kernel/ZeroDev
 * smart wallet implementation). Testnet sponsorship is free; mainnet requires a
 * Privy/Pimlico billing relationship. */

import { type PropsWithChildren } from "react";
import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider as PrivyWagmiProvider, createConfig as createPrivyWagmiConfig } from "@privy-io/wagmi";
import { WagmiProvider } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";

import { wagmiConfig, hatchLightTheme, storyAeneid } from "./wagmi.js";
import { queryClient } from "./queries.js";
import { config as appConfig } from "./config.js";
import { SmartWalletBridge } from "./privy-bridge.js";
import { http, fallback, type Transport } from "viem";

const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID ?? "").trim();
const PRIVY_SPONSORSHIP_POLICY_ID = (import.meta.env.VITE_PRIVY_SPONSORSHIP_POLICY_ID ?? "").trim();
export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;

/** paymasterContext shape understood by Pimlico's verifying paymaster.
 *  Reference: https://docs.pimlico.io — pm_getPaymasterStubData accepts
 *  `{ sponsorshipPolicyId: "sp_xxx" }` as the context object.
 *  Privy plumbs this through SmartWalletsProvider's `config.paymasterContext`. */
const paymasterContext = PRIVY_SPONSORSHIP_POLICY_ID
  ? { sponsorshipPolicyId: PRIVY_SPONSORSHIP_POLICY_ID }
  : undefined;

function buildTransport(primary: string, fallbacks: string[]): Transport {
  if (!fallbacks.length) return http(primary);
  return fallback([http(primary), ...fallbacks.map((u) => http(u))], { rank: true, retryCount: 2 });
}

/** Privy-flavoured wagmi config. Mirrors the chain/transport setup of our normal
 *  wagmiConfig but uses @privy-io/wagmi so Privy's embedded wallet integrates as
 *  a wagmi connector automatically. RainbowKit picks it up by virtue of being
 *  inside this WagmiProvider. */
const privyWagmiConfig = createPrivyWagmiConfig({
  chains: [storyAeneid],
  transports: { [storyAeneid.id]: buildTransport(appConfig.rpcUrl, appConfig.rpcUrlFallbacks) },
});

/* Privy 3.x split `embeddedWallets.createOnLogin` into per-chain configs.
 * For our EVM-only stack we only need `ethereum.createOnLogin`. */
const privyAppConfig: PrivyClientConfig = {
  loginMethods: ["email", "wallet"],
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
  defaultChain: storyAeneid,
  supportedChains: [storyAeneid],
  appearance: {
    theme: "light",
    accentColor: "#E04F2C",
    logo: "/hatch-logo.jpg",
  },
};

export function AppProviders({ children }: PropsWithChildren) {
  if (PRIVY_ENABLED) {
    return (
      <PrivyProvider appId={PRIVY_APP_ID} config={privyAppConfig}>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={privyWagmiConfig as unknown as Parameters<typeof PrivyWagmiProvider>[0]["config"]}>
            <SmartWalletsProvider config={paymasterContext ? { paymasterContext } : undefined}>
              <SmartWalletBridge>
                <RainbowKitProvider theme={hatchLightTheme} modalSize="compact">
                  {children}
                </RainbowKitProvider>
              </SmartWalletBridge>
            </SmartWalletsProvider>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SmartWalletBridge>
          <RainbowKitProvider theme={hatchLightTheme} modalSize="compact">
            {children}
          </RainbowKitProvider>
        </SmartWalletBridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
