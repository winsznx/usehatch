/** Canonical env loader. Project root `.env` is the source of truth (matches
 *  `.env.example`); `backend/.env` is read second as an optional override.
 *  Missing files are swallowed silently. Idempotent — safe to call multiple times. */
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const path of [
    new URL("../../.env", import.meta.url),  // project root — canonical
    new URL("../.env", import.meta.url),     // backend-local override
  ]) {
    try { process.loadEnvFile(path); } catch { /* missing file is fine */ }
  }
}
