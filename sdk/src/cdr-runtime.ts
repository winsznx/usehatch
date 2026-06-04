/** Recommended CDR validator timeout (per Story's advanced-configuration docs).
 *  The current `@piplabs/cdr-sdk@0.2.1` constructor does NOT yet expose `timeoutMs`;
 *  this constant is exported for forward-compat — once the CDR SDK accepts it,
 *  every constructor call in this module can be updated in one place.
 *  See https://docs.story.foundation/developers/cdr-sdk/advanced-configuration */
export const CDR_DEFAULT_TIMEOUT_MS = 120_000;

/** Minimum threshold ratio for validator responses. Tune up if reads flake under
 *  thin validator sets; default (network-decided) is fine for most flows. */
export const CDR_DEFAULT_MIN_THRESHOLD_RATIO: number | undefined = undefined;

export interface CdrRetryOpts {
  attempts?: number;          // default 2
  baseDelayMs?: number;       // default 200
  maxDelayMs?: number;        // default 1500
  onRetry?: (err: unknown, attempt: number) => void;
}

/** Wrap a CDR validator call (`accessCDR`, `downloadFile`, …) with jittered backoff.
 *  Validator timeouts and transient RPC errors retry; explicit revert reasons do not. */
export async function withCdrRetry<T>(fn: () => Promise<T>, opts?: CdrRetryOpts): Promise<T> {
  const attempts = opts?.attempts ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 200;
  const maxDelayMs = opts?.maxDelayMs ?? 1500;
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts || isPermanentError(err)) throw err;
      opts?.onRetry?.(err, i + 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delay = Math.min(maxDelayMs, baseDelayMs * (i + 1) + jitter);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function isPermanentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /reverted|condition.*not met|insufficient funds|nonce too low|already known/i.test(msg);
}
