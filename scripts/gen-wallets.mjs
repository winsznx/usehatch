import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../.env", import.meta.url);

if (existsSync(envPath) && readFileSync(envPath, "utf8").includes("PUBLISHER_PK")) {
  console.error("Refusing to overwrite existing .env with PUBLISHER_PK. Delete it first if you really want fresh keys.");
  process.exit(1);
}

const roles = ["PUBLISHER", "SUBSCRIBER", "ANON"];
const lines = ["# Hatch Day0 wallets — generated locally, DO NOT COMMIT", `# generated ${new Date().toISOString()}`];

console.log("Generated wallets (fund PUBLISHER + SUBSCRIBER via https://faucet.story.foundation):\n");
for (const role of roles) {
  const pk = generatePrivateKey();
  const acct = privateKeyToAccount(pk);
  lines.push(`${role}_PK=${pk}`);
  lines.push(`${role}_ADDR=${acct.address}`);
  console.log(`${role.padEnd(11)} ${acct.address}`);
}
lines.push("RPC_URL=https://aeneid.storyrpc.io");
lines.push("API_URL=http://172.192.41.96:1317");
writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
console.log("\nKeys written to .env (chmod 600, gitignored). ANON will be funded on-chain from PUBLISHER in Section 5.");
