/* Bridge between Privy's `useSmartWallets()` and our SDK's `TxExecutor`-shaped
 * needs.
 *
 * Why a context instead of calling `useSmartWallets()` directly in `useStoryWiring`?
 *   `useSmartWallets()` throws when called outside `<SmartWalletsProvider>`. We mount
 *   `<SmartWalletsProvider>` conditionally (only when VITE_PRIVY_APP_ID is set). A
 *   context bridge lets `useStoryWiring` consume the smart wallet without depending
 *   on Privy being mounted — the context simply yields `null` when Privy is off. */

import { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import type { Address, Hash, Hex } from "viem";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { PRIVY_ENABLED } from "./privy.js";

export interface SmartWalletExecutor {
  sendTransaction(args: { to: Address; data: Hex; value?: bigint }): Promise<Hash>;
}

const SmartWalletContext = createContext<SmartWalletExecutor | null>(null);

function PrivySmartWalletProvider({ children }: PropsWithChildren) {
  const { client } = useSmartWallets();
  const executor = useMemo<SmartWalletExecutor | null>(() => {
    if (!client) return null;
    return {
      async sendTransaction(args) {
        return client.sendTransaction({
          to: args.to,
          data: args.data,
          value: args.value,
        });
      },
    };
  }, [client]);
  return <SmartWalletContext.Provider value={executor}>{children}</SmartWalletContext.Provider>;
}

/** Mount inside `<SmartWalletsProvider>` when Privy is enabled. Pass-through otherwise. */
export function SmartWalletBridge({ children }: PropsWithChildren) {
  if (!PRIVY_ENABLED) return <>{children}</>;
  return <PrivySmartWalletProvider>{children}</PrivySmartWalletProvider>;
}

/** Read the active smart wallet executor. Returns null when Privy is disabled
 *  or the user logged in with an external wallet (no smart wallet attached). */
export function useSmartWalletsSafe(): SmartWalletExecutor | null {
  return useContext(SmartWalletContext);
}
