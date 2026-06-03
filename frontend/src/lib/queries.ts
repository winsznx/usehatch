/* TanStack Query setup — single QueryClient instance for the whole app.
 *
 * Defaults match the spec:
 *   - staleTime 30s (cards/pages shared across navigations stay warm)
 *   - refetchOnWindowFocus true (Bloomberg-terminal freshness expectation)
 *   - retry once on transient failures; never on 401 (auth errors propagate
 *     so SIWE provider can prompt re-sign).
 *
 * Query keys live in `qk` — a factory so type changes propagate and we never
 * stringly-typed-key collide. */
import { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";

import { ApiUnauthorizedError } from "../api.js";
import type { HatchStatus } from "../api.js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiUnauthorizedError) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const qk = {
  all: ["hatch"] as const,

  publishers: () => [...qk.all, "publishers"] as const,
  publisher: (root: Address) => [...qk.all, "publisher", root.toLowerCase()] as const,

  hatches: (filter?: { status?: HatchStatus; publisher?: Address; limit?: number }) =>
    [...qk.all, "hatches", filter ?? {}] as const,
  hatch: (uuid: number) => [...qk.all, "hatch", uuid] as const,
  hatchReveal: (uuid: number) => [...qk.all, "hatch", uuid, "reveal"] as const,
  outcome: (uuid: number) => [...qk.all, "outcome", uuid] as const,

  mySubscriptions: (wallet: Address) => [...qk.all, "me", wallet.toLowerCase(), "subscriptions"] as const,
  myLicenses: (wallet: Address) => [...qk.all, "me", wallet.toLowerCase(), "licenses"] as const,

  follows: (wallet: Address) => [...qk.all, "follows", wallet.toLowerCase()] as const,
  followers: (root: Address) => [...qk.all, "followers", root.toLowerCase()] as const,
} as const;
