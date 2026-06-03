import type { Address } from "viem";

/** Story Aeneid (chain 1315) addresses, pinned. */
export const AENEID = {
  chainId: 1315 as const,
  rpcUrl: "https://aeneid.storyrpc.io",
  storyApiUrl: "http://172.192.41.96:1317",
  // Story core
  wip: "0x1514000000000000000000000000000000000000" as Address,
  licenseToken: "0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC" as Address,
  pilTemplate: "0x2E896b0b2Fdb7457499B56AAaA4AE55BCB4Cd316" as Address,
  royaltyPolicyLap: "0xBe54FB168b3c982b7AaE60dB6CF75Bd8447b390E" as Address,
  // CDR
  cdr: "0xCcCcCC0000000000000000000000000000000005" as Address,
  dkg: "0xCcCcCC0000000000000000000000000000000004" as Address,
  // CDR built-in conditions (not used by Hatch but exposed for SDK consumers)
  licenseReadCondition: "0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3" as Address,
  ownerWriteCondition: "0x4C9bFC96d7092b590D497A191826C3dA2277c34B" as Address,
} as const;

/** Hatch v1 deployments (Build 1 + Build 2). */
export const HATCH = {
  subscriptionPass: "0x9fc74922a10ad962570eb9692e66b0f6cb6909e1" as Address,
  hatchCondition:   "0x9362bf2874c17ebe2d977a16861ee51bfbb0b474" as Address, // v2.1 (split-slot ipId/publisherRoot)
  oracle:           "0x5257eabbf0297ca6073ad0d7aba09c980d708a24" as Address,
  publisherRegistry:"0x33519cf182bf9830046352150f4e03a5592bddfa" as Address,
} as const;

export interface HatchConfig {
  chain: typeof AENEID;
  hatch: typeof HATCH;
  /** Storage provider — SupabaseProvider (prod) or LocalDiskProvider (test). */
  storage: import("./storage.js").HatchStorage;
  /** Optional secondary read-failover storage (e.g. Storacha). */
  fallbackStorage?: import("./storage.js").HatchStorage;
  /** Treasury wallet for the EphemeralPool, if anonymous reads are enabled. */
  ephemeralTreasuryPk?: `0x${string}`;
  ephemeralPoolSize?: number;
}

export const defaultConfig = (overrides: Partial<HatchConfig> & Pick<HatchConfig, "storage">): HatchConfig => ({
  chain: AENEID,
  hatch: HATCH,
  ephemeralPoolSize: 4,
  ...overrides,
});
