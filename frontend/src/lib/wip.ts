/* Shared helper: ensure the connected wallet holds at least `required` WIP,
 * auto-wrapping the shortfall from native IP when not. Centralises the
 * wrap-before-action pattern used by stake — Story SDK paths (subscribe / tip)
 * already auto-wrap via contractCallWithFees, so this helper is only needed
 * for non-Story SDK contract calls like HatchPublisherRegistry.stake. */
import { getWipBalance, wrapNativeToWip } from "@usehatch/sdk";
import type { StoryWiring } from "./story.js";

export const AENEID_FAUCET_URL = "https://aeneid.faucet.story.foundation/";

export interface EnsureWipOptions {
  /** Called when a wrap is about to fire — UI hook for "Wrapping IP → WIP…" labels. */
  onWrapStart?: (deltaWei: bigint) => void;
}

/** Thrown when the user holds neither enough WIP nor enough native IP to wrap.
 *  Carries the faucet URL so UIs can surface a one-click link. */
export class InsufficientNativeIpError extends Error {
  readonly faucetUrl = AENEID_FAUCET_URL;
  readonly need: bigint;
  readonly have: bigint;
  constructor(need: bigint, have: bigint) {
    super(`Need ${formatWei(need)} IP to wrap into WIP, but wallet only has ${formatWei(have)} IP. Get testnet IP at ${AENEID_FAUCET_URL}.`);
    this.name = "InsufficientNativeIpError";
    this.need = need;
    this.have = have;
  }
}

function formatWei(v: bigint): string {
  const n = Number(v) / 1e18;
  return n < 0.0001 ? n.toExponential(2) : n.toFixed(4).replace(/\.?0+$/, "");
}

/** Read current WIP balance, then wrap the delta from native IP if it's short.
 *  Throws `InsufficientNativeIpError` if native IP is also insufficient.
 *  Returns the wrapped delta (0n if no wrap was needed). */
export async function ensureWip(
  wiring: StoryWiring,
  required: bigint,
  opts: EnsureWipOptions = {},
): Promise<bigint> {
  if (required <= 0n) return 0n;
  const balance = await getWipBalance({
    config: { ...wiring.hatchConfig, storage: /* unused for view-only */ null as never },
    publicClient: wiring.publicClient as never,
    owner: wiring.account.address,
  });
  if (balance >= required) return 0n;
  const delta = required - balance;
  const nativeBal = await wiring.publicClient!.getBalance({ address: wiring.account.address });
  if (nativeBal < delta) throw new InsufficientNativeIpError(delta, nativeBal);
  opts.onWrapStart?.(delta);
  await wrapNativeToWip({
    config: { ...wiring.hatchConfig, storage: null as never },
    publicClient: wiring.publicClient as never,
    walletClient: wiring.walletClient as never,
    account: wiring.account,
    amount: delta,
  });
  return delta;
}
