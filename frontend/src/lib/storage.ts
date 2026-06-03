/* BackendStorage — HatchStorage adapter that proxies to our `/storage`
 * endpoints. The encrypted bytes still flow through the server-side
 * LocalDisk/Supabase provider (same one the reveal worker reads from), but
 * the browser doesn't need Node-only fs/path APIs. */
import { config } from "./config.js";
import { getSiweToken } from "./siwe.js";

export interface BrowserHatchStorage {
  upload(data: Uint8Array, options?: { pin?: boolean }): Promise<string>;
  download(cid: string): Promise<Uint8Array>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export class BackendStorage implements BrowserHatchStorage {
  constructor(private readonly baseUrl: string = config.backendUrl) {}

  async upload(data: Uint8Array): Promise<string> {
    const token = getSiweToken();
    if (!token) throw new Error("upload requires a signed-in wallet");
    const res = await fetch(`${this.baseUrl}/storage`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      credentials: "include",
      body: JSON.stringify({ dataBase64: bytesToBase64(data) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`storage upload failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const { cid } = (await res.json()) as { cid: string };
    return cid;
  }

  async download(cid: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}/storage/${encodeURIComponent(cid)}`, { credentials: "include" });
    if (!res.ok) throw new Error(`storage download failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
