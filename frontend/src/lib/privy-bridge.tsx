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
import { usePrivy } from "@privy-io/react-auth";
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

/** Minimal shape ConnectWallet needs from Privy. The functions become no-ops
 *  when Privy is not mounted (local dev without VITE_PRIVY_APP_ID). */
export interface PrivySafe {
  ready: boolean;
  authenticated: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

function PrivyHookProbe(): PrivySafe {
  // This component is only rendered when PRIVY_ENABLED.
  const p = usePrivy();
  return useMemo<PrivySafe>(() => ({
    ready: p.ready,
    authenticated: p.authenticated,
    login: async () => { await p.login(); },
    logout: async () => { await p.logout(); },
  }), [p.ready, p.authenticated, p.login, p.logout]);
}

const PRIVY_SAFE_OFF: PrivySafe = {
  ready: false,
  authenticated: false,
  login: async () => {},
  logout: async () => {},
};

/** Call from any component. Returns Privy's real state when Privy is mounted;
 *  otherwise returns no-op fallbacks so consumers can be unconditional. */
export function usePrivySafe(): PrivySafe {
  if (!PRIVY_ENABLED) return PRIVY_SAFE_OFF;
  // Safe: PRIVY_ENABLED is a module-level constant, so the hook order is stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return PrivyHookProbe();
}
