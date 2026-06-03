/**
 * Typed errors with user-facing messages. Wraps known CDR + Hatch contract reverts
 * so the backend / frontend can route to specific UI states.
 */
export type HatchErrorCode =
  | "READ_CONDITION_NOT_MET"
  | "PRE_WINDOW"
  | "GRANDFATHER_VIOLATION"
  | "EXPIRED_PASS"
  | "NOT_OWNER_OF_PASS"
  | "WRONG_PUBLISHER_ROOT"
  | "CROSS_IP_LICENSE"
  | "WALLET_REQUIRED"
  | "VAULT_NOT_FOUND"
  | "EMPTY_VAULT"
  | "MANIFEST_TOO_LARGE"
  | "MEDIA_DECRYPT_FAILED"
  | "ORACLE_NOT_OPERATOR"
  | "ORACLE_NONCE_USED"
  | "ORACLE_WINDOW_OPEN"
  | "REGISTRY_NOT_AUTHORIZED"
  | "REGISTRY_NOT_IP_OWNER"
  | "REGISTRY_SLASH_WINDOW"
  | "EPHEMERAL_NO_LEASE"
  | "UNKNOWN";

export class HatchError extends Error {
  readonly code: HatchErrorCode;
  override readonly cause?: unknown;
  constructor(code: HatchErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "HatchError";
    this.code = code;
    this.cause = cause;
  }
}

/** Translate a thrown error (typically a viem ContractFunctionExecutionError) into a HatchError. */
export function translate(err: unknown): HatchError {
  const msg = ((err as any)?.shortMessage || (err as any)?.message || String(err)) as string;
  const errorName =
    (err as any)?.cause?.data?.errorName ?? (err as any)?.cause?.cause?.data?.errorName ?? null;
  // HatchCondition + LicenseReadCondition both surface the precompile's "CDR: Read condition not met".
  if (msg.includes("CDR: Read condition not met")) return new HatchError("READ_CONDITION_NOT_MET", "Access denied: read condition not met", err);
  if (msg.includes("EmptyVault")) return new HatchError("EMPTY_VAULT", "This hatch has no payload yet", err);
  switch (errorName) {
    case "NotOperator": return new HatchError("ORACLE_NOT_OPERATOR", "Signer is not an authorized operator", err);
    case "NonceUsed":   return new HatchError("ORACLE_NONCE_USED", "Attestation nonce already consumed", err);
    case "WindowOpen":  return new HatchError("ORACLE_WINDOW_OPEN", "Challenge window has not elapsed", err);
    case "NotAuthorized": return new HatchError("REGISTRY_NOT_AUTHORIZED", "Caller cannot slash", err);
    case "NotIpOwner":  return new HatchError("REGISTRY_NOT_IP_OWNER", "You don't own this IP", err);
    case "InSlashWindow": return new HatchError("REGISTRY_SLASH_WINDOW", "Unstake locked during slash window", err);
  }
  return new HatchError("UNKNOWN", msg, err);
}
