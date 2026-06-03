import type { StorageProvider } from "@piplabs/cdr-sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Hatch's StorageProvider — re-exported so SDK consumers can swap implementations. */
export type HatchStorage = StorageProvider;

/** Read-failover wrapper: tries primary first, falls back to secondary on download error. */
export class FailoverStorage implements HatchStorage {
  constructor(private readonly primary: HatchStorage, private readonly secondary?: HatchStorage) {}
  async upload(data: Uint8Array, options?: { pin?: boolean }): Promise<string> {
    const cid = await this.primary.upload(data, options);
    // Best-effort secondary pin (parallel write). Failures are non-fatal.
    if (this.secondary) this.secondary.upload(data, options).catch(() => {});
    return cid;
  }
  async download(cid: string): Promise<Uint8Array> {
    try { return await this.primary.download(cid); }
    catch (e) {
      if (!this.secondary) throw e;
      return await this.secondary.download(cid);
    }
  }
}

/** Production storage. Bucket-scoped; cid = object path within the bucket.
 *  Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_BUCKET in env. */
export class SupabaseProvider implements HatchStorage {
  private readonly client: SupabaseClient;
  constructor(readonly url: string, serviceRoleKey: string, readonly bucket: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }
  async upload(data: Uint8Array, _options?: { pin?: boolean }): Promise<string> {
    const name = `${Date.now()}-${randomBytes(8).toString("hex")}`;
    const body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const { error } = await this.client.storage.from(this.bucket).upload(name, body, {
      contentType: "application/octet-stream", upsert: false,
    });
    if (error) throw new Error(`SupabaseProvider.upload: ${error.message}`);
    return name;
  }
  async download(cid: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(this.bucket).download(cid);
    if (error || !data) throw new Error(`SupabaseProvider.download(${cid}): ${error?.message}`);
    const buf = new Uint8Array(await data.arrayBuffer());
    return buf;
  }
}

/** Test / local-dev storage. cid = sha256(data) hex; same content addresses to same path.
 *  Used by the round-trip test when Supabase creds aren't configured. */
export class LocalDiskProvider implements HatchStorage {
  constructor(readonly root: string) {}
  private async ensureDir(): Promise<void> {
    if (!existsSync(this.root)) await mkdir(this.root, { recursive: true });
  }
  async upload(data: Uint8Array): Promise<string> {
    await this.ensureDir();
    const cid = createHash("sha256").update(data).digest("hex");
    await writeFile(join(this.root, cid), data);
    return cid;
  }
  async download(cid: string): Promise<Uint8Array> {
    const path = resolve(this.root, cid);
    if (!path.startsWith(resolve(this.root))) throw new Error("LocalDiskProvider: invalid cid");
    return new Uint8Array(await readFile(path));
  }
}
