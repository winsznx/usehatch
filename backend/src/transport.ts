import { http, fallback, type Transport } from "viem";

/** Build a ranked viem transport from `RPC_URL` + comma-separated `RPC_URL_FALLBACKS`.
 *  Falls back to a single-RPC transport when no fallbacks are configured. */
export function aeneidTransport(): Transport {
  const primary = process.env.RPC_URL;
  if (!primary) throw new Error("RPC_URL env not set");
  const fallbacks = (process.env.RPC_URL_FALLBACKS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!fallbacks.length) return http(primary);
  return fallback([http(primary), ...fallbacks.map((u) => http(u))], { rank: true, retryCount: 2 });
}

/** Install a global fetch interceptor that synthesizes a MethodNotSupported (-32601)
 *  response for any JSON-RPC `eth_fillTransaction` call.
 *
 *  Why: viem 2.51.3 added a Tempo-style optimization that opportunistically calls
 *  `eth_fillTransaction` during `prepareTransactionRequest`. Aeneid's RPC doesn't
 *  support it cleanly — it returns -32000 "Missing or invalid parameters" which
 *  viem treats as a real failure and propagates. We return -32601 instead, which
 *  viem caches via `supportsFillTransaction[client.uid] = false` and never calls
 *  again.
 *
 *  Idempotent — safe to call multiple times. */
let installed = false;
export function installAeneidFetchPatch(): void {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body);
        const list = Array.isArray(body) ? body : [body];
        const methods = list.map((b: { method?: string }) => b?.method);
        if (methods.includes("eth_fillTransaction")) {
          const resp = list.map((b: { id?: number }) => ({
            jsonrpc: "2.0", id: b?.id ?? 0,
            error: { code: -32601, message: "the method eth_fillTransaction does not exist/is not available" },
          }));
          const out = Array.isArray(body) ? resp : resp[0];
          return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
        }
      } catch { /* not JSON or not RPC — fall through */ }
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
