import { initWasm } from "@piplabs/cdr-crypto";

/** Module-level idempotency guard. Multiple Node ESM resolution paths may load
 *  separate `@piplabs/cdr-crypto` instances; calling `initWasm` is cheap once,
 *  but the underlying WASM module is per-instance. We memoize per-module so
 *  every crypto-touching function in the SDK can defensively call ensureWasm()
 *  without paying the init cost twice. Callers must NEVER call initWasm()
 *  directly; route through this. */
let initPromise: Promise<void> | null = null;
export function ensureWasm(): Promise<void> {
  return (initPromise ??= initWasm().then(() => undefined));
}
