import { createPublicClient, http, bytesToHex } from "viem";
import { initWasm } from "@piplabs/cdr-crypto";
import { CDRClient } from "@piplabs/cdr-sdk";

const RPC_URL = "https://aeneid.storyrpc.io";
const API_URL = "http://172.192.41.96:1317";
const CHAIN_ID = 1315;

const aeneid = {
  id: CHAIN_ID,
  name: "Story Aeneid",
  nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const log = (label, value) => console.log(`${label.padEnd(28)} ${value}`);
const time = async (label, fn) => {
  const t0 = performance.now();
  try {
    const v = await fn();
    log(label, `${v}  (${(performance.now() - t0).toFixed(0)}ms)`);
    return v;
  } catch (e) {
    log(label, `ERROR: ${e?.shortMessage || e?.message || e}`);
    return undefined;
  }
};

const t0 = performance.now();
await initWasm();
console.log(`initWasm() OK  (${(performance.now() - t0).toFixed(0)}ms)\n`);

const publicClient = createPublicClient({ chain: aeneid, transport: http(RPC_URL) });
log("connected chainId", await publicClient.getChainId());
log("latest block", await publicClient.getBlockNumber());
console.log();

const client = new CDRClient({ network: "testnet", publicClient, apiUrl: API_URL });
const o = client.observer;

console.log("--- DKG state (REST) ---");
const pk = await time("getGlobalPubKey()", async () => {
  const k = await o.getGlobalPubKey();
  return `${k.length} bytes, prefix ${bytesToHex(k.slice(0, 2))}`;
});
await time("getActiveRound()", () => o.getActiveRound());
await time("getParticipantCount()", () => o.getParticipantCount());
await time("getThreshold()", () => o.getThreshold());

console.log("\n--- Fees + limits (EVM) ---");
await time("getAllocateFee()", async () => `${await o.getAllocateFee()} wei`);
await time("getWriteFee()", async () => `${await o.getWriteFee()} wei`);
await time("getReadFee()", async () => `${await o.getReadFee()} wei`);
await time("getMaxEncryptedDataSize()", async () => `${await o.getMaxEncryptedDataSize()} bytes`);
await time("getOperationalThreshold()", async () => `${await o.getOperationalThreshold()} bps`);

console.log("\nSection 1 smoke complete.");
