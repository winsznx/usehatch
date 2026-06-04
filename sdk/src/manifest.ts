import { encryptFile, decryptFile } from "@piplabs/cdr-crypto";
import type { HatchStorage } from "./storage.js";
import type { Manifest, ManifestMedia } from "./types.js";
import { HatchError } from "./errors.js";

const MANIFEST_MAX_BYTES = 1024;

/* Universal base64url codec — works in browsers and Node ≥16 without `Buffer`.
   Node's `Buffer.from(s, "base64url")` is missing in the npm `buffer` shim
   used in browser builds, so the previous Buffer-backed impl threw
   "Unknown encoding: base64url" in production. Uses atob/btoa, which are
   standard on globalThis everywhere we ship. */
const b64u = {
  encode(b: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string): Uint8Array {
    const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export interface MediaInput {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

/** Encrypt each media file with a per-file AES-256-GCM key, upload ciphertexts,
 *  and emit a ≤1024-byte JSON manifest carrying the keys + storage paths.
 *  If the manifest exceeds the cap, push `text` into an extra media blob and
 *  replace it with a pointer (manifest stays well under 1KB). */
export async function buildManifest(args: {
  storage: HatchStorage;
  text: string;
  media: MediaInput[];
}): Promise<{ manifest: Manifest; manifestBytes: Uint8Array }> {
  const mediaEntries: ManifestMedia[] = [];
  for (const m of args.media) {
    const { ciphertext, key } = encryptFile(m.bytes);
    const path = await args.storage.upload(ciphertext);
    mediaEntries.push({ path, key: b64u.encode(key), mime: m.mime, name: m.name, size: m.bytes.byteLength });
  }
  let manifest: Manifest = { v: 1, text: args.text, media: mediaEntries, createdAt: Math.floor(Date.now() / 1000) };
  let bytes = new TextEncoder().encode(JSON.stringify(manifest));

  if (bytes.byteLength > MANIFEST_MAX_BYTES) {
    // Spill long text into a media blob; manifest text becomes a fingerprint pointer.
    const textBytes = new TextEncoder().encode(args.text);
    const { ciphertext, key } = encryptFile(textBytes);
    const path = await args.storage.upload(ciphertext);
    const spill: ManifestMedia = { path, key: b64u.encode(key), mime: "text/plain", name: "__hatch_text__.txt", size: textBytes.byteLength };
    manifest = { v: 1, text: `@text:${path}`, media: [spill, ...mediaEntries], createdAt: manifest.createdAt };
    bytes = new TextEncoder().encode(JSON.stringify(manifest));
    if (bytes.byteLength > MANIFEST_MAX_BYTES) {
      throw new HatchError("MANIFEST_TOO_LARGE", `manifest is ${bytes.byteLength}B after text-spill; reduce media count`);
    }
  }
  return { manifest, manifestBytes: bytes };
}

/** Inverse of buildManifest. Returns the decrypted text + media bytes. */
export async function parseManifest(args: {
  storage: HatchStorage;
  manifestBytes: Uint8Array;
}): Promise<{ text: string; media: { name: string; mime: string; bytes: Uint8Array }[] }> {
  const manifest = JSON.parse(new TextDecoder().decode(args.manifestBytes)) as Manifest;
  const media: { name: string; mime: string; bytes: Uint8Array }[] = [];
  let text = manifest.text;
  for (const m of manifest.media) {
    const ct = await args.storage.download(m.path);
    let plain: Uint8Array;
    try { plain = decryptFile({ ciphertext: ct, key: b64u.decode(m.key) }); }
    catch (e) { throw new HatchError("MEDIA_DECRYPT_FAILED", `decrypt failed for ${m.name}`, e); }
    if (text.startsWith("@text:") && text.slice(6) === m.path) {
      text = new TextDecoder().decode(plain);
    } else {
      media.push({ name: m.name, mime: m.mime, bytes: plain });
    }
  }
  return { text, media };
}
