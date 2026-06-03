/* Browser wallet integration: EIP-1193 (window.ethereum) + SIWE.
 *
 * Phase 2 keeps this lightweight path for the SIWE message flow. Wagmi +
 * RainbowKit own multi-wallet connection UX (via WagmiProvider in main.tsx);
 * this helper is the direct EIP-1193 fallback for callers that already have
 * the user's address from wagmi and just want to drive the SIWE handshake.
 *
 * The verified token is returned to the caller — no storage side-effects. */
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { SiweMessage } from "./siwe-message.js";
import { api } from "./api.js";
import { storyAeneid } from "./lib/wagmi.js";

const STORY_AENEID = storyAeneid;

// window.ethereum is declared globally by viem/wagmi types (typed as any).

export interface WalletState {
  address?: Address;
  chainId?: number;
  authedWallet?: Address; // SIWE-verified wallet (matches address on success)
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/** Request accounts via EIP-1193. Throws if no injected wallet. */
export async function connect(): Promise<{ address: Address; chainId: number }> {
  if (!window.ethereum) throw new Error("No injected wallet (MetaMask/Rabby). Install one and reload.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  const chainHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  return { address: accounts[0] as Address, chainId: parseInt(chainHex, 16) };
}

/** Force-add + switch to Aeneid (chain 1315). Safe no-op if already on it. */
export async function ensureAeneid(): Promise<void> {
  if (!window.ethereum) return;
  const currentHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  if (parseInt(currentHex, 16) === STORY_AENEID.id) return;
  const params = [{
    chainId: `0x${STORY_AENEID.id.toString(16)}`,
    chainName: STORY_AENEID.name,
    nativeCurrency: STORY_AENEID.nativeCurrency,
    rpcUrls: STORY_AENEID.rpcUrls.default.http,
  }];
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params[0].chainId }] });
  } catch (e: unknown) {
    // 4902 → chain not added yet
    if ((e as { code?: number })?.code === 4902) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params });
    } else throw e;
  }
}

/** Build a viem WalletClient backed by the injected provider. */
export function viemWallet(): WalletClient {
  if (!window.ethereum) throw new Error("No injected wallet");
  return createWalletClient({
    chain: STORY_AENEID as never,
    transport: custom(window.ethereum as never),
  });
}

/** Full SIWE flow: nonce → sign → verify → token persisted via api.siweVerify. */
export async function signInWithEthereum(): Promise<{ token: string; wallet: Address }> {
  const { address } = await connect();
  await ensureAeneid();
  const { nonce } = await api.siweNonce(address);
  const message = new SiweMessage({
    domain: window.location.host,
    address,
    statement: "Sign in to Hatch - programmable embargoes on Story.",
    uri: window.location.origin,
    version: "1",
    chainId: STORY_AENEID.id,
    nonce,
  }).prepareMessage();
  const w = viemWallet();
  const signature = (await w.signMessage({ account: address, message })) as `0x${string}`;
  return api.siweVerify(message, signature);
}
