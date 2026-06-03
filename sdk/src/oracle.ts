import type { Account, PublicClient, WalletClient, Address, Hash, Hex } from "viem";
import type { HatchConfig } from "./config.js";
import type { AttestationInput } from "./types.js";

/** EIP-712 domain — matches HatchOracle's on-chain _domainSeparatorV4(). */
export const oracleDomain = (oracle: Address, chainId: number) => ({
  name: "HatchOracle" as const, version: "1" as const, chainId, verifyingContract: oracle,
});

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: "hatchId", type: "bytes32" },
    { name: "outcomeHash", type: "bytes32" },
    { name: "outcomeValue", type: "int256" },
    { name: "observedAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const ORACLE_ABI = [
  { type: "function", name: "attestationDigest", stateMutability: "view",
    inputs: [{ name: "a", type: "tuple", components: [
      { name: "hatchId", type: "bytes32" }, { name: "outcomeHash", type: "bytes32" },
      { name: "outcomeValue", type: "int256" }, { name: "observedAt", type: "uint64" }, { name: "nonce", type: "uint256" },
    ]}], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "submitAttestation", stateMutability: "nonpayable",
    inputs: [
      { name: "a", type: "tuple", components: [
        { name: "hatchId", type: "bytes32" }, { name: "outcomeHash", type: "bytes32" },
        { name: "outcomeValue", type: "int256" }, { name: "observedAt", type: "uint64" }, { name: "nonce", type: "uint256" },
      ]},
      { name: "signature", type: "bytes" },
    ], outputs: [] },
  { type: "function", name: "challenge", stateMutability: "payable", inputs: [{ name: "hatchId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [{ name: "hatchId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "resolveChallenge", stateMutability: "nonpayable",
    inputs: [
      { name: "hatchId", type: "bytes32" }, { name: "operatorWins", type: "bool" },
      { name: "publisher", type: "address" }, { name: "slashAmount", type: "uint256" },
    ], outputs: [] },
  { type: "function", name: "getOutcome", stateMutability: "view", inputs: [{ name: "hatchId", type: "bytes32" }],
    outputs: [
      { name: "outcomeValue", type: "int256" }, { name: "outcomeHash", type: "bytes32" },
      { name: "observedAt", type: "uint64" }, { name: "operator", type: "address" }, { name: "status", type: "uint8" },
    ] },
] as const;

/** Sign an Attestation off-chain. The signer must be an authorized operator. */
export async function signAttestation(args: {
  config: HatchConfig; walletClient: WalletClient; account: Account; att: AttestationInput;
}): Promise<Hex> {
  return await args.walletClient.signTypedData({
    account: args.account,
    domain: oracleDomain(args.config.hatch.oracle, args.config.chain.chainId),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message: args.att,
  });
}

export async function submitAttestation(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account;
  att: AttestationInput; signature: Hex;
}): Promise<Hash> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.hatch.oracle, abi: ORACLE_ABI, functionName: "submitAttestation",
    args: [args.att, args.signature], account: args.account,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

export async function challenge(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account;
  hatchId: Hex; bond: bigint;
}): Promise<Hash> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.hatch.oracle, abi: ORACLE_ABI, functionName: "challenge",
    args: [args.hatchId], account: args.account, value: args.bond,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

export async function finalize(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account; hatchId: Hex;
}): Promise<Hash> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.hatch.oracle, abi: ORACLE_ABI, functionName: "finalize",
    args: [args.hatchId], account: args.account,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

export async function resolveChallenge(args: {
  config: HatchConfig; publicClient: PublicClient; walletClient: WalletClient; account: Account;
  hatchId: Hex; operatorWins: boolean; publisher?: Address; slashAmount?: bigint;
}): Promise<Hash> {
  const sim = await args.publicClient.simulateContract({
    address: args.config.hatch.oracle, abi: ORACLE_ABI, functionName: "resolveChallenge",
    args: [args.hatchId, args.operatorWins,
      (args.publisher ?? "0x0000000000000000000000000000000000000000") as Address,
      args.slashAmount ?? 0n],
    account: args.account,
  });
  const tx = await args.walletClient.writeContract(sim.request);
  await args.publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

export interface Outcome { outcomeValue: bigint; outcomeHash: Hex; observedAt: bigint; operator: Address; status: number; }
export async function getOutcome(args: { config: HatchConfig; publicClient: PublicClient; hatchId: Hex; }): Promise<Outcome> {
  const r = await args.publicClient.readContract({
    address: args.config.hatch.oracle, abi: ORACLE_ABI, functionName: "getOutcome", args: [args.hatchId],
  });
  return { outcomeValue: r[0], outcomeHash: r[1], observedAt: r[2], operator: r[3], status: r[4] };
}
