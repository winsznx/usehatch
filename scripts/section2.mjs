import { CDRClient, uuidToLabel } from "@piplabs/cdr-sdk";
import { initWasm } from "@piplabs/cdr-crypto";
import { encodeAbiParameters, formatEther, bytesToHex, toHex } from "viem";
import { randomBytes } from "node:crypto";
import { publicClient, wallet, addr, API_URL } from "./lib.mjs";

await initWasm();

const OWNER_WRITE = "0x4C9bFC96d7092b590D497A191826C3dA2277c34B";
const OPEN_READ = "0x92600298587ed7c0244f3033020171620433ca21"; // OpenCondition v2 (4-arg)

const pubAddr = addr("PUBLISHER");

const publisher = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("PUBLISHER"), apiUrl: API_URL });
const subscriber = new CDRClient({ network: "testnet", walletClient: wallet("SUBSCRIBER"), publicClient, apiUrl: API_URL });

const dataKey = new Uint8Array(randomBytes(32));
console.log("original dataKey:", bytesToHex(dataKey));

const balBefore = await publicClient.getBalance({ address: pubAddr });
const t0 = performance.now();

// Manual uploadCDR: SDK's uploadCDR runs validateConditionContract against a stale
// 3-arg ABI and rejects correct 4-arg conditions, so allocate with skipConditionValidation.
const { uuid, txHash: allocateTx } = await publisher.uploader.allocate({
  updatable: false,
  writeConditionAddr: OWNER_WRITE,
  writeConditionData: encodeAbiParameters([{ type: "address" }], [pubAddr]),
  readConditionAddr: OPEN_READ,
  readConditionData: "0x",
  skipConditionValidation: true,
});
const label = uuidToLabel(uuid);
const ciphertext = await publisher.uploader.encryptDataKey({ dataKey, label });
const { txHash: writeTx } = await publisher.uploader.write({
  uuid,
  accessAuxData: "0x",
  encryptedData: toHex(ciphertext.raw),
});
const tUpload = performance.now() - t0;
const balAfter = await publicClient.getBalance({ address: pubAddr });

console.log("\n--- Section 2 vault created ---");
console.log("UUID:", uuid);
console.log("allocate tx:", allocateTx);
console.log("write tx:", writeTx);
console.log("upload wall time:", tUpload.toFixed(0), "ms");
console.log("publisher balance delta (fees+gas):", formatEther(balBefore - balAfter), "IP");

console.log("\n--- SUBSCRIBER accessCDR (open read) ---");
const tRead0 = performance.now();
const { dataKey: got, txHash } = await subscriber.consumer.accessCDR({ uuid, accessAuxData: "0x" });
const readLatency = performance.now() - tRead0;
console.log("read tx:", txHash);
console.log("accessCDR end-to-end latency:", readLatency.toFixed(0), "ms", `(${(readLatency/1000).toFixed(1)}s)`);
console.log("recovered dataKey:", bytesToHex(got));

const match = got.length === dataKey.length && got.every((b, i) => b === dataKey[i]);
console.log("dataKey MATCH:", match ? "YES ✅" : "NO ❌");
process.exit(match ? 0 : 1);
