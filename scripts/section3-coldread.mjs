import { CDRClient } from "@piplabs/cdr-sdk";
import { initWasm } from "@piplabs/cdr-crypto";
import { encodeAbiParameters, bytesToHex } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { publicClient, wallet, API_URL } from "./lib.mjs";

const st = JSON.parse(readFileSync(new URL("../.section3-state.json", import.meta.url)));
const delayMs = Number(process.argv[2] ?? 300000);
console.log(`[coldread] sleeping ${delayMs / 1000}s for cold-cache sample...`);
await new Promise((r) => setTimeout(r, delayMs));

await initWasm();
const subscriber = new CDRClient({ network: "testnet", publicClient, walletClient: wallet("SUBSCRIBER"), apiUrl: API_URL });
const accessAux = encodeAbiParameters([{ type: "uint256[]" }], [[BigInt(st.licenseTokenId)]]);
const t0 = performance.now();
const { dataKey: got, txHash } = await subscriber.consumer.accessCDR({ uuid: st.vaultUuid, accessAuxData: accessAux });
const coldLatency = (performance.now() - t0) / 1000;
const match = bytesToHex(got) === st.dataKey;
console.log(`[coldread] tx: ${txHash} latency: ${coldLatency.toFixed(1)}s match: ${match}`);
st.coldLatencyS = coldLatency.toFixed(1);
st.coldReadTx = txHash;
st.coldMatch = match;
writeFileSync(new URL("../.section3-state.json", import.meta.url), JSON.stringify(st, null, 2));
