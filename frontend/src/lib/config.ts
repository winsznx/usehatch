/* Env-driven runtime configuration.
 *
 * Vite exposes only VITE_* prefixed env vars to the client bundle via
 * import.meta.env. All values fall back to local-dev defaults so the app
 * boots without a .env in development. */
import type { Address } from "viem";

const env = import.meta.env;

function readAddress(value: string | undefined, fallback: string): Address {
  return ((value && value.trim()) || fallback).toLowerCase() as Address;
}

function readUrl(value: string | undefined, fallback: string): string {
  return ((value && value.trim()) || fallback).replace(/\/+$/, "");
}

export const config = {
  backendUrl: readUrl(env.VITE_BACKEND_URL, "http://127.0.0.1:4011"),
  rpcUrl: readUrl(env.VITE_RPC_URL, "https://aeneid.storyrpc.io"),
  chainId: Number(env.VITE_CHAIN_ID ?? 1315),

  contracts: {
    subscriptionPass: readAddress(env.VITE_CONTRACT_SUBSCRIPTION_PASS, "0x9fc74922a10ad962570eb9692e66b0f6cb6909e1"),
    condition: readAddress(env.VITE_CONTRACT_CONDITION, "0x9362bf2874c17ebe2d977a16861ee51bfbb0b474"),
    oracle: readAddress(env.VITE_CONTRACT_ORACLE, "0x5257eabbf0297ca6073ad0d7aba09c980d708a24"),
    registry: readAddress(env.VITE_CONTRACT_REGISTRY, "0x0000000000000000000000000000000000000000"),
  },

  vapidPublicKey: env.VITE_VAPID_PUBLIC_KEY ?? "",
  publicUrl: readUrl(env.VITE_HATCH_PUBLIC_URL, "http://localhost:5173"),
  blueskyHandle: env.VITE_BLUESKY_HANDLE ?? "winszn.bsky.social",
} as const;

export type AppConfig = typeof config;
