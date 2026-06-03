import { loadEnv } from "../env.js";
import { installAeneidFetchPatch } from "../transport.js";
loadEnv();
installAeneidFetchPatch();

const { startServer } = await import("../api.js");
await startServer();
console.log(`[api] ready on :${process.env.API_PORT ?? 4011}`);
