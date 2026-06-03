import { readFileSync, writeFileSync } from "node:fs";
import { parseEther } from "viem";
import { publicClient, wallet, addr, WIP } from "./lib.mjs";

const pub = wallet("PUBLISHER");
const pubAddr = addr("PUBLISHER");

const oracleArt = JSON.parse(readFileSync("./contracts/out/HatchOracle.sol/HatchOracle.json", "utf8"));
const regArt    = JSON.parse(readFileSync("./contracts/out/HatchPublisherRegistry.sol/HatchPublisherRegistry.json", "utf8"));

// short windows for testing
const CHALLENGE_WINDOW = 30n;        // seconds
const CHALLENGE_BOND   = parseEther("0.05");
const VERIFIED_THRESH  = parseEther("0.05");
const SLASH_WINDOW     = 60n;        // seconds

// 1. HatchOracle
let h = await pub.deployContract({
  abi: oracleArt.abi, bytecode: oracleArt.bytecode.object,
  args: [pubAddr, CHALLENGE_WINDOW, CHALLENGE_BOND],
});
let r = await publicClient.waitForTransactionReceipt({ hash: h });
const ORACLE = r.contractAddress;
console.log("HatchOracle:           ", ORACLE, "gas:", r.gasUsed.toString(), "tx:", h);

// 2. HatchPublisherRegistry
h = await pub.deployContract({
  abi: regArt.abi, bytecode: regArt.bytecode.object,
  args: [WIP, pubAddr, VERIFIED_THRESH, SLASH_WINDOW],
});
r = await publicClient.waitForTransactionReceipt({ hash: h });
const REG = r.contractAddress;
console.log("HatchPublisherRegistry:", REG, "gas:", r.gasUsed.toString(), "tx:", h);

// 3. Wire: registry.setOracle(oracle); oracle.setRegistry(registry); oracle.addOperator(PUBLISHER)
const writeFn = async (address, abi, fn, args) => {
  const { request } = await publicClient.simulateContract({ address, abi, functionName: fn, args, account: pub.account });
  const tx = await pub.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
};
await writeFn(REG, regArt.abi, "setOracle", [ORACLE]);
await writeFn(ORACLE, oracleArt.abi, "setRegistry", [REG]);
await writeFn(ORACLE, oracleArt.abi, "addOperator", [pubAddr]);
console.log("Wired: registry.oracle =", ORACLE, "/ oracle.registry =", REG, "/ operator =", pubAddr);

writeFileSync(new URL("../.build2-state.json", import.meta.url), JSON.stringify({
  oracle: ORACLE, registry: REG,
  CHALLENGE_WINDOW: CHALLENGE_WINDOW.toString(),
  CHALLENGE_BOND: CHALLENGE_BOND.toString(),
  VERIFIED_THRESH: VERIFIED_THRESH.toString(),
  SLASH_WINDOW: SLASH_WINDOW.toString(),
}, null, 2));
console.log("state -> .build2-state.json");
