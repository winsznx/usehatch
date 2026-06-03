/** Minimal SIWE message constructor — EIP-4361 format. Client-side only
 *  (we just generate the text; the backend verifies the signature). Keeps
 *  the bundle ~30 lines instead of pulling the full `siwe` npm package. */
export class SiweMessage {
  domain!: string;
  address!: string;
  statement?: string;
  uri!: string;
  version!: string;
  chainId!: number;
  nonce!: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];

  constructor(init: Partial<SiweMessage>) { Object.assign(this, init); }

  prepareMessage(): string {
    const now = this.issuedAt ?? new Date().toISOString();
    const lines = [
      `${this.domain} wants you to sign in with your Ethereum account:`,
      this.address,
      "",
    ];
    if (this.statement) { lines.push(this.statement, ""); }
    lines.push(
      `URI: ${this.uri}`,
      `Version: ${this.version}`,
      `Chain ID: ${this.chainId}`,
      `Nonce: ${this.nonce}`,
      `Issued At: ${now}`,
    );
    if (this.expirationTime) lines.push(`Expiration Time: ${this.expirationTime}`);
    if (this.notBefore) lines.push(`Not Before: ${this.notBefore}`);
    if (this.requestId) lines.push(`Request ID: ${this.requestId}`);
    if (this.resources?.length) {
      lines.push("Resources:");
      for (const r of this.resources) lines.push(`- ${r}`);
    }
    return lines.join("\n");
  }
}
