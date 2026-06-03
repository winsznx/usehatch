import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StoryClient } from "@story-protocol/core-sdk";

process.loadEnvFile(new URL("../.env", import.meta.url));

export const RPC_URL = process.env.RPC_URL;
// Story-API REST endpoint (DKG state). `API_URL` is kept as a back-compat alias.
export const API_URL = process.env.STORY_API_URL ?? process.env.API_URL;
export const WIP = "0x1514000000000000000000000000000000000000";

export const aeneid = {
  id: 1315,
  name: "Story Aeneid",
  nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

export const publicClient = createPublicClient({ chain: aeneid, transport: http(RPC_URL) });

export const account = (role) => privateKeyToAccount(process.env[`${role}_PK`]);
export const addr = (role) => process.env[`${role}_ADDR`];
export const wallet = (role) =>
  createWalletClient({ account: account(role), chain: aeneid, transport: http(RPC_URL) });

export const storyClient = (role) =>
  StoryClient.newClient({ account: account(role), transport: http(RPC_URL), chainId: "aeneid" });

// Verified Aeneid addresses (cross-checked: core-sdk address book + storyscan)
export const ADDR = {
  LICENSE_TOKEN: "0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC",
  LICENSE_READ_CONDITION: "0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3",
  OWNER_WRITE_CONDITION: "0x4C9bFC96d7092b590D497A191826C3dA2277c34B",
  ROYALTY_MODULE: "0xD2f60c40fEbccf6311f8B47c4f2Ec6b040400086",
  ROYALTY_POLICY_LAP: "0xBe54FB168b3c982b7AaE60dB6CF75Bd8447b390E",
};

