// @usehatch/sdk — programmable embargoes on Story CDR.
// Typed barrel for backend AND frontend consumers.

export * from "./types.js";
export * from "./config.js";
export * from "./errors.js";
export { ensureWasm } from "./crypto.js";
export { hatchIdFor, uuidFromHatchId } from "./hatchid.js";
// Storage TYPE only — concrete providers (SupabaseProvider, LocalDiskProvider,
// FailoverStorage) live in `./storage.js` and import Node-only APIs (node:fs,
// @supabase/supabase-js). Re-exporting them from this barrel pulled node:fs
// into Vite's browser bundle, which externalized to a throwing getter and
// killed the page on load. Node consumers (backend) import them explicitly:
//   import { LocalDiskProvider, SupabaseProvider } from "@usehatch/sdk/dist/storage.js";
export type { HatchStorage } from "./storage.js";
export { buildManifest, parseManifest, type MediaInput } from "./manifest.js";
export { createPublisher, stake, unstake, getPublisher, wrapNativeToWip } from "./publisher.js";
export { createHatch, getHatch, encodeConditionData, encodeOwnerWriteData } from "./hatch.js";
export { buyHatch, subscribe } from "./commerce.js";
export { readHatch, encodeAccessAux } from "./read.js";
export { EphemeralPool } from "./ephemeral-pool.js";
export {
  signAttestation, submitAttestation, challenge, finalize, resolveChallenge, getOutcome,
  oracleDomain, ATTESTATION_TYPES, type Outcome,
} from "./oracle.js";
