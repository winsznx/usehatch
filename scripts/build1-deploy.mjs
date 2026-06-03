import { readFileSync, writeFileSync } from "node:fs";
import { publicClient, wallet, addr, WIP, ADDR } from "./lib.mjs";

const pub = wallet("PUBLISHER");
const pubAddr = addr("PUBLISHER");

const passArt = JSON.parse(readFileSync("./contracts/out/HatchSubscriptionPass.sol/HatchSubscriptionPass.json", "utf8"));
const condArt = JSON.parse(readFileSync("./contracts/out/HatchConditionV2.sol/HatchConditionV2.json", "utf8"));

// 1. Deploy HatchSubscriptionPass(licenseToken, wip, initialMinter, owner)
let hash = await pub.deployContract({
  abi: passArt.abi, bytecode: passArt.bytecode.object,
  args: [ADDR.LICENSE_TOKEN, WIP, pubAddr, pubAddr],
});
let r = await publicClient.waitForTransactionReceipt({ hash });
const PASS = r.contractAddress;
console.log("HatchSubscriptionPass:", PASS, "gas:", r.gasUsed.toString(), "tx:", hash);

// 2. Deploy HatchConditionV2(pass)
hash = await pub.deployContract({
  abi: condArt.abi, bytecode: condArt.bytecode.object,
  args: [PASS],
});
r = await publicClient.waitForTransactionReceipt({ hash });
const HATCH_V2 = r.contractAddress;
console.log("HatchConditionV2:      ", HATCH_V2, "gas:", r.gasUsed.toString(), "tx:", hash);

writeFileSync(new URL("../.build1-state.json", import.meta.url), JSON.stringify({
  pass: PASS, hatchV2: HATCH_V2,
  IP_ROOT_1: "0x26eEda6e00d0044575D08ee23d0da9F2dd034Ff3", // Section 3 IP
  IP_ROOT_2: "0xF00370C726190b7Ee09e77a4c31f4C6e0Df65E6b", // Section 5 Publisher_Root
  LICENSE_TERMS_ID: "1203",
}, null, 2));
console.log("state -> .build1-state.json");
