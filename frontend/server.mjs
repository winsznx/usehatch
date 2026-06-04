/* Production static file server for the Hatch frontend.
 *
 * Replaces sirv-cli (which had a port-collision bug on Railway that made it
 * fall back to port 5 instead of $PORT) and `vite preview` (dev-grade, no
 * compression, no cache headers).
 *
 * Behavior:
 *   - Serves files from ./dist on $PORT (default 5173).
 *   - Returns brotli-encoded body when the client sends Accept-Encoding: br
 *     AND a sibling ".br" file exists. Falls back to gzip ".gz" similarly.
 *     Vite emits .gz / .br alongside the original during build when the
 *     compression flag is set, but we also support on-the-fly gzip via Node's
 *     zlib for files without pre-compressed siblings.
 *   - Sets `Cache-Control: public, max-age=31536000, immutable` on hashed
 *     asset paths (anything under /assets/). Hash is part of the filename so
 *     content changes get new URLs.
 *   - Sets short cache + no-revalidate on index.html so deploys propagate.
 *   - SPA fallback: any GET that does not match a real file or contain a
 *     dot in the basename returns /index.html.
 */
import http from "node:http";
import { promises as fs, createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Readable } from "node:stream";

const PORT = Number(process.env.PORT || 5173);
const ROOT = path.resolve("./dist");

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js",   "text/javascript; charset=utf-8"],
  [".mjs",  "text/javascript; charset=utf-8"],
  [".css",  "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg",  "image/svg+xml"],
  [".png",  "image/png"],
  [".jpg",  "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico",  "image/x-icon"],
  [".woff",  "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf",   "font/ttf"],
  [".otf",   "font/otf"],
  [".txt",  "text/plain; charset=utf-8"],
  [".xml",  "application/xml; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".map",  "application/json; charset=utf-8"],
]);

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".xml", ".wasm", ".map"]);

function pickEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  const ae = acceptEncoding.toLowerCase();
  if (ae.includes("br")) return "br";
  if (ae.includes("gzip")) return "gzip";
  return null;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body && body.pipe) body.pipe(res);
  else res.end(body);
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const joined = path.normalize(path.join(root, decoded));
  if (!joined.startsWith(root)) return null;
  return joined;
}

async function serveFile(req, res, absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME.get(ext) || "application/octet-stream";
  // Vite emits hashed filenames under /assets/ (e.g. index-Bl_mGILE.js,
  // vendor-privy-ClJjENbI.js). Anything under /assets/ is content-addressed
  // so we can mark it immutable + cacheable forever.
  const isImmutable = req.url.startsWith("/assets/");

  const baseHeaders = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cache-control": isImmutable
      ? "public, max-age=31536000, immutable"
      : ext === ".html"
        ? "no-cache"
        : "public, max-age=3600",
    vary: "Accept-Encoding",
  };

  const enc = pickEncoding(req.headers["accept-encoding"]);

  // Prefer pre-compressed sibling if present.
  if (enc) {
    const siblingExt = enc === "br" ? ".br" : ".gz";
    const sibling = absPath + siblingExt;
    if (existsSync(sibling)) {
      const stat = statSync(sibling);
      send(res, 200, {
        ...baseHeaders,
        "content-encoding": enc,
        "content-length": stat.size,
      }, createReadStream(sibling));
      return;
    }
  }

  // Compress on the fly for text-ish files (cheap, ephemeral).
  if (enc && COMPRESSIBLE.has(ext)) {
    res.writeHead(200, { ...baseHeaders, "content-encoding": enc });
    const stream = createReadStream(absPath);
    const compressor = enc === "br" ? zlib.createBrotliCompress() : zlib.createGzip();
    stream.pipe(compressor).pipe(res);
    return;
  }

  const stat = statSync(absPath);
  send(res, 200, { ...baseHeaders, "content-length": stat.size }, createReadStream(absPath));
}

async function handle(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { "content-type": "text/plain" }, "Method Not Allowed");
  }

  const urlPath = (req.url || "/").split("?")[0];
  let abs = safeJoin(ROOT, urlPath);
  if (!abs) return send(res, 400, { "content-type": "text/plain" }, "Bad Request");

  // Directory request -> index.html within that dir, else SPA fallback.
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const indexAt = path.join(abs, "index.html");
    if (existsSync(indexAt)) return serveFile(req, res, indexAt);
  }

  if (existsSync(abs) && statSync(abs).isFile()) {
    return serveFile(req, res, abs);
  }

  // SPA fallback: any "no dot in basename" or any unmatched route -> /index.html
  const fallback = path.join(ROOT, "index.html");
  if (existsSync(fallback)) return serveFile(req, res, fallback);

  send(res, 404, { "content-type": "text/plain" }, "Not Found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[server] handler error:", err);
    try { send(res, 500, { "content-type": "text/plain" }, "Internal Server Error"); } catch {}
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] hatch frontend listening on 0.0.0.0:${PORT} (root: ${ROOT})`);
});

process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
process.on("SIGINT",  () => { server.close(() => process.exit(0)); });
