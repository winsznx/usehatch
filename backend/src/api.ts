import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { SiweMessage, generateNonce } from "siwe";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { verifyMessage, parseAbi, encodeAbiParameters, parseEther, http, createWalletClient, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db, schema } from "./db/client.js";
import { publicClient, CONTRACTS, indexerBus } from "./indexer.js";

// Railway auto-injects PORT at runtime; fall back to API_PORT for local dev.
// `||` (not `??`) so empty strings fall through — `API_PORT=${{PORT}}` from
// Railway variable references resolves to an empty string at deploy time.
const PORT = Number(process.env.PORT || process.env.API_PORT || 4011);

/* ────────────────────────── durable session store (Postgres-backed)
 *
 * Sessions live in `siwe_sessions`, nonces in `siwe_nonces`. The previous
 * in-memory Maps lost everyone's session on backend restart and couldn't
 * survive horizontal scaling. Now both survive restart + work behind a
 * load balancer.
 *
 * Sweep: every 60s we delete expired sessions (defense in depth — readers
 * also check expiresAt on lookup). The sweep starts on first verify so it
 * doesn't run during integration tests that never sign in. */
const TOKEN_TTL = 24 * 3600_000;
const NONCE_TTL = 10 * 60_000; // 10 minutes is plenty between nonce + verify

let _sweepStarted = false;
function ensureSweepStarted() {
  if (_sweepStarted) return;
  _sweepStarted = true;
  setInterval(() => {
    db.delete(schema.siweSessions)
      .where(lte(schema.siweSessions.expiresAt, new Date()))
      .catch((e) => console.error("[siwe] sweep failed", e));
    db.delete(schema.siweNonces)
      .where(lte(schema.siweNonces.createdAt, new Date(Date.now() - NONCE_TTL)))
      .catch((e) => console.error("[siwe] nonce sweep failed", e));
  }, 60_000).unref();
}

/* ────────────────────────── in-memory rate limit (per IP + wallet) */
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (b.count >= limit) return false;
  b.count++; return true;
}

/* ────────────────────────── status derivation */
function effectiveStatus(h: { embargoStart: Date; revealAt: Date; status: string }): string {
  const now = Date.now();
  if (h.status === "resolved") return "resolved";
  if (now >= h.revealAt.getTime()) return h.status === "resolved" ? "resolved" : "revealed";
  if (now >= h.embargoStart.getTime()) return "active";
  return "sealed";
}

/* ────────────────────────── SDK lazy-loader (so the API can use it for entitlement-gated reads) */
let sdkPromise: Promise<typeof import("../../sdk/dist/index.js")> | null = null;
const sdk = () => (sdkPromise ??= import("../../sdk/dist/index.js" as any));

/* ────────────────────────── server-side ephemeral pool (lazy) */
let serverPool: any = null;
async function getPool() {
  if (serverPool) return serverPool;
  const { EphemeralPool } = await sdk();
  serverPool = new EphemeralPool({
    treasuryPk: process.env.SERVER_TREASURY_PK as `0x${string}`,
    chain: { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } } as any,
    rpcUrl: process.env.RPC_URL!,
    size: Number(process.env.SERVER_POOL_SIZE ?? 4),
  });
  return serverPool;
}

/* ────────────────────────── on-chain entitlement checks */
const ltAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isLicenseTokenRevoked(uint256 tokenId) view returns (bool)",
  "function getLicenseTokenMetadata(uint256 tokenId) view returns ((address licensorIpId, address licenseTemplate, uint256 licenseTermsId, bool transferable, uint32 commercialRevShare))",
]);
const passAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isValidFor(uint256 tokenId, address publisherRoot) view returns (bool)",
  "function mintedAt(uint256 tokenId) view returns (uint64)",
]);
const LICENSE_TOKEN = "0xFe3838BFb30B34170F00030B52eA4893d8aAC6bC" as Address;

async function checkPerHatchEntitlement(wallet: Address, tokenIds: bigint[], signalIpId: Address): Promise<boolean> {
  for (const id of tokenIds) {
    try {
      const [owner, revoked, meta] = await Promise.all([
        publicClient.readContract({ address: LICENSE_TOKEN, abi: ltAbi, functionName: "ownerOf", args: [id] }),
        publicClient.readContract({ address: LICENSE_TOKEN, abi: ltAbi, functionName: "isLicenseTokenRevoked", args: [id] }),
        publicClient.readContract({ address: LICENSE_TOKEN, abi: ltAbi, functionName: "getLicenseTokenMetadata", args: [id] }),
      ]);
      if (owner.toLowerCase() !== wallet.toLowerCase()) continue;
      if (revoked) continue;
      if (meta.licensorIpId.toLowerCase() !== signalIpId.toLowerCase()) continue;
      return true;
    } catch { continue; }
  }
  return false;
}
async function checkSubscriptionEntitlement(wallet: Address, passId: bigint, publisherRoot: Address, embargoStart: Date): Promise<boolean> {
  try {
    const [owner, validFor, minted] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.pass as Address, abi: passAbi, functionName: "ownerOf", args: [passId] }),
      publicClient.readContract({ address: CONTRACTS.pass as Address, abi: passAbi, functionName: "isValidFor", args: [passId, publisherRoot] }),
      publicClient.readContract({ address: CONTRACTS.pass as Address, abi: passAbi, functionName: "mintedAt", args: [passId] }),
    ]);
    if (owner.toLowerCase() !== wallet.toLowerCase()) return false;
    if (!validFor) return false;
    if (Number(minted) * 1000 > embargoStart.getTime()) return false;
    return true;
  } catch { return false; }
}

/* ────────────────────────── Hono app + WS */
export const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
interface WsClient {
  send: (s: string) => void;
  follow?: string;
  channel?: string;                  // "public" | "my-publishers"
  authWallet?: string | null;
  publisherSet?: Set<string> | null; // resolved at connect time for "my-publishers"
}
const wsClients = new Set<WsClient>();

/** Should this WS client receive an event about `publisherRoot`?
 *  - "my-publishers" channel: must be in the client's resolved publisherSet.
 *  - "public" channel (default): all events; the legacy `follow` query param
 *    (single-publisher filter) is honored for back-compat. */
function shouldRoute(client: WsClient, publisherRoot: string | undefined): boolean {
  if (client.channel === "my-publishers") {
    return !!publisherRoot && !!client.publisherSet?.has(publisherRoot.toLowerCase());
  }
  if (client.follow) return !!publisherRoot && client.follow.toLowerCase() === publisherRoot.toLowerCase();
  return true;
}

indexerBus.on("hatch:status", (e) => {
  const msg = JSON.stringify({ type: "hatch:status", ...e });
  for (const c of wsClients) if (shouldRoute(c, e.publisherRoot)) c.send(msg);
});
indexerBus.on("hatch:allocated", (e) => {
  const msg = JSON.stringify({ type: "hatch:new", ...e });
  for (const c of wsClients) if (shouldRoute(c, e.publisherRoot)) c.send(msg);
});
indexerBus.on("hatch:revealed", (e) => {
  const msg = JSON.stringify({ type: "hatch:revealed", ...e });
  for (const c of wsClients) if (shouldRoute(c, e.publisherRoot)) c.send(msg);
});

const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174")
  .split(",").map((s) => s.trim()).filter(Boolean);
app.use("*", cors({
  origin: (origin) => (origin && corsOrigins.includes(origin) ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["content-type", "authorization"],
  maxAge: 600,
}));

app.use("*", async (c, next) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (!rateLimit(`ip:${ip}`, 60, 60_000)) return c.json({ error: "rate_limited" }, 429);
  await next();
});

async function loadSession(token: string): Promise<{ wallet: string; expiresAt: Date } | null> {
  const [s] = await db.select().from(schema.siweSessions).where(eq(schema.siweSessions.token, token));
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  // Lazy lastSeenAt bump — fire-and-forget; never blocks the response.
  db.update(schema.siweSessions).set({ lastSeenAt: new Date() })
    .where(eq(schema.siweSessions.token, token)).catch(() => undefined);
  return { wallet: s.wallet, expiresAt: s.expiresAt };
}

/* Session restore via Bearer header OR httpOnly cookie. The cookie is set by
 * /siwe/verify so a page refresh in the same browser restores the session
 * without re-signing — production-critical for users who close/open tabs. */
app.get("/siwe/me", async (c) => {
  let token = (c.req.header("authorization") ?? "").startsWith("Bearer ")
    ? (c.req.header("authorization") ?? "").slice(7)
    : null;
  if (!token) token = getCookie(c, "hatch_session") ?? null;
  if (!token) return c.json({ error: "no_session" }, 401);
  const s = await loadSession(token);
  if (!s) return c.json({ error: "no_session" }, 401);
  return c.json({ token, wallet: s.wallet });
});

/* ── SIWE-lite */
app.post("/siwe/nonce", async (c) => {
  const { address } = await c.req.json<{ address: string }>().catch(() => ({ address: "" }));
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: "bad address" }, 400);
  const nonce = generateNonce();
  await db.insert(schema.siweNonces).values({ address: address.toLowerCase(), nonce })
    .onConflictDoUpdate({ target: schema.siweNonces.address, set: { nonce, createdAt: new Date() } });
  return c.json({ nonce, statement: "Sign in to Hatch", domain: "hatch.local", uri: `http://hatch.local`, version: "1", chainId: 1315 });
});
app.post("/siwe/verify", async (c) => {
  const { message, signature } = await c.req.json<{ message: string; signature: string }>().catch(() => ({} as any));
  if (!message || !signature) return c.json({ error: "missing" }, 400);
  try {
    const sm = new SiweMessage(message);
    const result = await sm.verify({ signature });
    if (!result.success) return c.json({ error: "siwe_verify_failed", detail: String(result.error?.type ?? result.error ?? "unknown") }, 401);
    const [stored] = await db.select().from(schema.siweNonces).where(eq(schema.siweNonces.address, sm.address.toLowerCase()));
    if (!stored || stored.nonce !== sm.nonce) return c.json({ error: "nonce_mismatch" }, 401);
    if (stored.createdAt.getTime() < Date.now() - NONCE_TTL) return c.json({ error: "nonce_expired" }, 401);
    await db.delete(schema.siweNonces).where(eq(schema.siweNonces.address, sm.address.toLowerCase()));
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL);
    await db.insert(schema.siweSessions).values({
      token,
      wallet: sm.address.toLowerCase(),
      expiresAt,
      ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    ensureSweepStarted();
    // Cookie attributes are env-driven so the same code works in three modes:
    //   - dev cross-origin HTTP: Bearer fallback only (cookies can't be set
    //     SameSite=None without Secure, and Lax+POST is blocked cross-site).
    //     Set COOKIE_DISABLE=1 to skip cookie entirely; refresh loses session.
    //   - dev same-origin: SameSite=Lax works; Bearer also fine.
    //   - prod (HTTPS, possibly cross-origin via subdomain): SameSite=None;
    //     Secure. Set COOKIE_SAMESITE=None and COOKIE_SECURE=1.
    const sameSite = (process.env.COOKIE_SAMESITE as "Strict" | "Lax" | "None" | undefined) ?? "Lax";
    const secure = process.env.COOKIE_SECURE === "1";
    if (process.env.COOKIE_DISABLE !== "1") {
      setCookie(c, "hatch_session", token, {
        httpOnly: true,
        sameSite,
        secure,
        maxAge: Math.floor(TOKEN_TTL / 1000),
        path: "/",
        domain: process.env.COOKIE_DOMAIN || undefined,
      });
    }
    return c.json({ token, wallet: sm.address });
  } catch (e: any) { return c.json({ error: "siwe_error", detail: e?.message?.slice(0, 200) }, 401); }
});

app.post("/siwe/signout", async (c) => {
  const token = (c.req.header("authorization") ?? "").startsWith("Bearer ")
    ? (c.req.header("authorization") ?? "").slice(7)
    : getCookie(c, "hatch_session") ?? null;
  if (token) await db.delete(schema.siweSessions).where(eq(schema.siweSessions.token, token));
  deleteCookie(c, "hatch_session", { path: "/" });
  return c.json({ ok: true });
});

async function requireSiwe(c: any): Promise<string | null> {
  let token = (c.req.header("authorization") ?? "").startsWith("Bearer ")
    ? (c.req.header("authorization") ?? "").slice(7)
    : null;
  if (!token) token = getCookie(c, "hatch_session") ?? null;
  if (!token) return null;
  const s = await loadSession(token);
  return s?.wallet ?? null;
}

/* ── Public reads */
app.get("/publishers", async (c) => {
  const rows = await db.select().from(schema.publishers).orderBy(desc(schema.publishers.createdAt)).limit(100);
  return c.json({ publishers: rows.map((r) => ({ ...r, stakeWei: r.stakeWei.toString() })) });
});
app.get("/publishers/:root", async (c) => {
  const root = c.req.param("root").toLowerCase();
  const [p] = await db.select().from(schema.publishers).where(eq(schema.publishers.publisherRootIp, root));
  if (!p) return c.json({ error: "not_found" }, 404);
  const [tr] = await db.select().from(schema.trackRecords).where(eq(schema.trackRecords.publisherRootIp, root));
  return c.json({ publisher: { ...p, stakeWei: p.stakeWei.toString() }, trackRecord: tr ?? null });
});

/* Resolutions for a publisher — joined hatches + outcomes. Used by Track Record. */
app.get("/publishers/:root/resolutions", async (c) => {
  const root = c.req.param("root").toLowerCase();
  const rows = await db
    .select({ hatch: schema.hatches, outcome: schema.outcomes })
    .from(schema.hatches)
    .innerJoin(schema.outcomes, eq(schema.outcomes.hatchUuid, schema.hatches.uuid))
    .where(and(eq(schema.hatches.publisherRootIp, root), eq(schema.outcomes.status, "finalized")))
    .orderBy(desc(schema.outcomes.finalizedAt))
    .limit(50);
  return c.json({
    resolutions: rows.map((r) => ({
      uuid: r.hatch.uuid,
      title: r.hatch.title,
      summary: r.hatch.summary,
      revealAt: r.hatch.revealAt.toISOString(),
      finalizedAt: r.outcome.finalizedAt?.toISOString() ?? null,
      outcomeValue: r.outcome.outcomeValue?.toString() ?? null,
      operator: r.outcome.operator,
    })),
  });
});

/* Available-to-claim royalties for a publisher root. Reads RoyaltyModule for the
 * IP's royalty vault, then queries the vault's `claimableRevenue(claimer, token)`.
 * Returns "0" when the IP has no vault yet (typical when no licenses minted). */
const ROYALTY_MODULE = "0xD2f60c40fEbccf6311f8B47c4f2Ec6b040400086" as Address;
const WIP_TOKEN = "0x1514000000000000000000000000000000000000" as Address;
const royaltyModuleAbi = parseAbi([
  "function ipRoyaltyVaults(address ipId) view returns (address)",
]);
const ipRoyaltyVaultAbi = parseAbi([
  "function claimableRevenue(address claimer, address token) view returns (uint256)",
]);

app.get("/publishers/:root/claimable", async (c) => {
  const root = c.req.param("root").toLowerCase() as Address;
  const claimer = ((c.req.query("claimer") ?? root) as string).toLowerCase() as Address;
  const token = ((c.req.query("token") ?? WIP_TOKEN) as string).toLowerCase() as Address;

  try {
    const vault = await publicClient.readContract({
      address: ROYALTY_MODULE, abi: royaltyModuleAbi,
      functionName: "ipRoyaltyVaults", args: [root],
    });
    if (vault === "0x0000000000000000000000000000000000000000") {
      return c.json({ wip: "0", vault: null, claimer, lastChecked: new Date().toISOString() });
    }
    const claimable = await publicClient.readContract({
      address: vault, abi: ipRoyaltyVaultAbi,
      functionName: "claimableRevenue", args: [claimer, token],
    });
    return c.json({
      wip: claimable.toString(),
      vault,
      claimer,
      token,
      lastChecked: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: "claimable_probe_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/* ── Groups (Story GroupingModule)
 *
 * Like disputes, groups are written by the indexer when it sees on-chain
 * `IPGroupRegistered` / `AddedIpToGroup` events. The PATCH endpoint lets the
 * composer race ahead and persist the group's editorial title + description
 * + publisher back-reference immediately after registering on-chain, instead
 * of waiting for an indexer tick. */
app.get("/groups", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const cond: any[] = [];
  if (q.publisher) cond.push(eq(schema.groups.publisherRootIp, q.publisher.toLowerCase()));
  if (q.owner) cond.push(eq(schema.groups.ownerWallet, q.owner.toLowerCase()));
  const rows = await db.select().from(schema.groups)
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(desc(schema.groups.createdAt)).limit(limit);
  return c.json({
    groups: rows.map((r) => ({
      ...r,
      licenseTermsId: r.licenseTermsId?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

app.get("/groups/:groupId", async (c) => {
  const groupId = c.req.param("groupId").toLowerCase();
  const [g] = await db.select().from(schema.groups).where(eq(schema.groups.groupIpId, groupId));
  if (!g) return c.json({ error: "not_found" }, 404);
  const members = await db.select().from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupIpId, groupId)).limit(1000);
  return c.json({
    group: { ...g, licenseTermsId: g.licenseTermsId?.toString() ?? null, createdAt: g.createdAt.toISOString() },
    members: members.map((m) => ({ ...m, addedAt: m.addedAt.toISOString(), removedAt: m.removedAt?.toISOString() ?? null })),
  });
});

/* Composer race-ahead: persist editorial metadata for a group right after
 * registering on-chain. Auth: caller's wallet must own the publisher root
 * referenced. */
app.patch("/groups/:groupId/metadata", async (c) => {
  const siweWallet = await requireSiwe(c); if (!siweWallet) return c.json({ error: "auth_required" }, 401);
  const groupId = c.req.param("groupId").toLowerCase();
  const body = await c.req.json<{ title?: string; description?: string; publisherRootIp?: string; licenseTermsId?: string }>().catch(() => ({} as any));
  if (body.publisherRootIp) {
    const [pub] = await db.select().from(schema.publishers).where(eq(schema.publishers.publisherRootIp, body.publisherRootIp.toLowerCase()));
    if (!pub || pub.wallet.toLowerCase() !== siweWallet.toLowerCase()) {
      return c.json({ error: "forbidden", message: "publisher_root must be owned by signed-in wallet" }, 403);
    }
  }
  const values: any = {
    title: body.title?.trim() ?? null,
    description: body.description?.trim() ?? null,
    ownerWallet: siweWallet.toLowerCase(),
  };
  if (body.publisherRootIp) values.publisherRootIp = body.publisherRootIp.toLowerCase();
  if (body.licenseTermsId) values.licenseTermsId = BigInt(body.licenseTermsId);
  await db.insert(schema.groups).values({
    groupIpId: groupId, groupPool: "", status: "active", ...values,
  }).onConflictDoUpdate({
    target: schema.groups.groupIpId,
    set: values,
  });
  return c.json({ ok: true, groupId });
});

/* ── Disputes (Story DisputeModule)
 *
 * Disputes flow: client uses @usehatch/sdk's `raiseDispute` from the user's wallet
 * → indexer (DisputeModule watcher) inserts into `disputes` table → these routes
 * serve read-only listings. No server-side raiseDispute path — the bond must be
 * paid by the challenger's wallet. */
app.get("/disputes", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const cond: any[] = [];
  if (q.targetIpId) cond.push(eq(schema.disputes.targetIpId, q.targetIpId.toLowerCase()));
  if (q.publisher) cond.push(eq(schema.disputes.publisherRootIp, q.publisher.toLowerCase()));
  if (q.hatchUuid) cond.push(eq(schema.disputes.hatchUuid, Number(q.hatchUuid)));
  if (q.status) cond.push(eq(schema.disputes.status, q.status));
  const rows = await db.select().from(schema.disputes)
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(desc(schema.disputes.raisedAt)).limit(limit);
  return c.json({
    disputes: rows.map((r) => ({
      ...r,
      storyDisputeId: r.storyDisputeId.toString(),
      bondWei: r.bondWei?.toString() ?? null,
      raisedAt: r.raisedAt.toISOString(),
      judgedAt: r.judgedAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    })),
  });
});

/* Aggregate dispute status for a publisher — used to render the "disputed"
 * badge on publisher cards without paging through every individual dispute. */
app.get("/publishers/:root/dispute-status", async (c) => {
  const root = c.req.param("root").toLowerCase();
  const rows = await db.select({ status: schema.disputes.status }).from(schema.disputes)
    .where(eq(schema.disputes.publisherRootIp, root));
  const counts = { raised: 0, judgedTrue: 0, judgedFalse: 0, cancelled: 0, resolved: 0 };
  for (const r of rows) {
    if (r.status === "raised") counts.raised++;
    else if (r.status === "judged-true") counts.judgedTrue++;
    else if (r.status === "judged-false") counts.judgedFalse++;
    else if (r.status === "cancelled") counts.cancelled++;
    else if (r.status === "resolved") counts.resolved++;
  }
  return c.json({
    publisherRootIp: root,
    active: counts.raised,
    judgedAgainst: counts.judgedTrue,
    total: rows.length,
    counts,
  });
});

/* Publisher metrics — track record + subscriber/follower counts. */
app.get("/publishers/:root/metrics", async (c) => {
  const root = c.req.param("root").toLowerCase();
  const [tr] = await db.select().from(schema.trackRecords).where(eq(schema.trackRecords.publisherRootIp, root));
  const subRows = await db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.publisherRootIp, root), gte(schema.subscriptions.expiresAt, new Date())));
  const followerRows = await db.select({ w: schema.follows.followerWallet }).from(schema.follows).where(eq(schema.follows.publisherRootIp, root));
  return c.json({
    trackRecord: tr ? { ...tr, weightedAccuracy: tr.weightedAccuracy?.toString() ?? null } : null,
    activeSubscribers: subRows.length,
    followerCount: followerRows.length,
  });
});

function serializeHatch(h: typeof schema.hatches.$inferSelect) {
  return {
    ...h,
    status: effectiveStatus(h),
    perHatchPriceWei: h.perHatchPriceWei?.toString() ?? null,
    perHatchTermsId: h.perHatchTermsId?.toString() ?? null,
    embargoStart: h.embargoStart.toISOString(),
    revealAt: h.revealAt.toISOString(),
    createdAt: h.createdAt.toISOString(),
  };
}

app.get("/hatches", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit ?? 50), 200);
  const cond: any[] = [];
  if (q.publisher) cond.push(eq(schema.hatches.publisherRootIp, q.publisher.toLowerCase()));
  if (q.mode) cond.push(eq(schema.hatches.mode, Number(q.mode)));
  const rows = await db.select().from(schema.hatches)
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(desc(schema.hatches.createdAt)).limit(limit);
  let hatches = rows.map(serializeHatch);
  if (q.status) hatches = hatches.filter((h) => h.status === q.status);
  return c.json({ hatches });
});

app.get("/hatches/:uuid", async (c) => {
  const uuid = Number(c.req.param("uuid"));
  const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!h) return c.json({ error: "not_found" }, 404);
  return c.json({ hatch: serializeHatch(h) });
});

/* Publisher-set public metadata on a hatch. The composer calls this right
 * after createHatch so cards show the real title immediately — without it,
 * users would see "Hatch #<uuid>" until the indexer catches up.
 *
 * Race: the composer's PATCH typically races ahead of the indexer (which
 * polls every ~5s). If the row doesn't exist yet, we INSERT a placeholder
 * carrying the composer-provided fields (which we KNOW because they were
 * just signed on-chain). The indexer's existing UPSERT on VaultAllocated +
 * VaultWritten will merge in the rest later — same convergence path it
 * already takes when out-of-order events arrive.
 *
 * Auth: caller's wallet must own the publisher root. The publisherRootIp
 * must be passed in the body when we may need to insert (composer always
 * has it). Once the row exists, we re-derive it from the existing row. */
app.patch("/hatches/:uuid/metadata", async (c) => {
  const siwe = await requireSiwe(c); if (!siwe) return c.json({ error: "auth_required" }, 401);
  const uuid = Number(c.req.param("uuid"));
  if (!Number.isInteger(uuid) || uuid <= 0) return c.json({ error: "bad_uuid" }, 400);
  const body = await c.req.json<{
    title?: string; summary?: string;
    publisherRootIp?: string; signalIpId?: string; mode?: number;
    embargoStart?: number; revealAt?: number;
  }>().catch(() => ({} as any));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 280) : undefined;
  const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 1000) : undefined;
  if (title === undefined && summary === undefined) return c.json({ error: "nothing_to_update" }, 400);

  const [existing] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));

  let publisherRootIp: string;
  if (existing) {
    publisherRootIp = existing.publisherRootIp;
  } else {
    if (typeof body.publisherRootIp !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.publisherRootIp))
      return c.json({ error: "publisherRootIp_required_for_upsert" }, 400);
    publisherRootIp = body.publisherRootIp.toLowerCase();
  }

  const [pub] = await db.select().from(schema.publishers).where(eq(schema.publishers.publisherRootIp, publisherRootIp));
  if (!pub) return c.json({ error: "publisher_unknown" }, 404);
  if (pub.wallet.toLowerCase() !== siwe) return c.json({ error: "forbidden", message: "only the hatch's publisher can edit metadata" }, 403);

  if (existing) {
    const update: Record<string, string> = {};
    if (title !== undefined) update.title = title;
    if (summary !== undefined) update.summary = summary;
    await db.update(schema.hatches).set(update).where(eq(schema.hatches.uuid, uuid));
  } else {
    // Placeholder insert — indexer will UPSERT the rest from on-chain events.
    if (typeof body.signalIpId !== "string" || typeof body.mode !== "number" ||
        typeof body.embargoStart !== "number" || typeof body.revealAt !== "number") {
      return c.json({ error: "bad_request", message: "signalIpId, mode, embargoStart, revealAt required for upsert" }, 400);
    }
    await db.insert(schema.hatches).values({
      uuid,
      signalIpId: body.signalIpId.toLowerCase(),
      publisherRootIp,
      mode: body.mode,
      embargoStart: new Date(body.embargoStart * 1000),
      revealAt: new Date(body.revealAt * 1000),
      title: title ?? null,
      summary: summary ?? null,
      status: "sealed",
    }).onConflictDoUpdate({
      target: schema.hatches.uuid,
      set: { title: title ?? undefined, summary: summary ?? undefined },
    });
  }
  return c.json({ ok: true, uuid, title, summary, upserted: !existing });
});

app.get("/hatches/:uuid/reveal", async (c) => {
  const uuid = Number(c.req.param("uuid"));
  const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!h) return c.json({ error: "not_found" }, 404);
  if (effectiveStatus(h) !== "revealed" && effectiveStatus(h) !== "resolved") {
    return c.json({ error: "not_revealed", revealAt: h.revealAt, countdownSec: Math.max(0, Math.floor((h.revealAt.getTime() - Date.now()) / 1000)) }, 403);
  }
  const [r] = await db.select().from(schema.revealedContent).where(eq(schema.revealedContent.hatchUuid, uuid));
  if (!r) return c.json({ error: "reveal_pending", message: "reveal worker has not committed content yet" }, 202);
  return c.json({ revealedContent: r });
});

app.get("/outcomes/:uuid", async (c) => {
  const uuid = Number(c.req.param("uuid"));
  const [o] = await db.select().from(schema.outcomes).where(eq(schema.outcomes.hatchUuid, uuid));
  if (!o) return c.json({ error: "not_found" }, 404);
  return c.json({ outcome: { ...o, outcomeValue: o.outcomeValue?.toString() } });
});

/* ── SIWE-protected */
app.get("/subscriptions/:wallet", async (c) => {
  const siwe = await requireSiwe(c); if (!siwe) return c.json({ error: "auth_required" }, 401);
  const w = c.req.param("wallet").toLowerCase();
  if (w !== siwe) return c.json({ error: "forbidden" }, 403);
  const rows = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.subscriberWallet, w));
  return c.json({ subscriptions: rows.map((r) => ({ ...r, subLicenseTokenId: r.subLicenseTokenId.toString(), passId: r.passId.toString() })) });
});

app.get("/licenses/:wallet", async (c) => {
  const siwe = await requireSiwe(c); if (!siwe) return c.json({ error: "auth_required" }, 401);
  const w = c.req.param("wallet").toLowerCase();
  if (w !== siwe) return c.json({ error: "forbidden" }, 403);
  const rows = await db.select().from(schema.licenses).where(eq(schema.licenses.buyerWallet, w));
  return c.json({ licenses: rows.map((r) => ({ ...r, licenseTokenId: r.licenseTokenId.toString() })) });
});

/* /me/queue — hatches the signed-in wallet has access to, sorted by reveal time.
 * Access = active subscription OR per-hatch license. Also includes the user's
 * own authored hatches when their wallet is a publisher. */
app.get("/me/queue", async (c) => {
  const siwe = await requireSiwe(c); if (!siwe) return c.json({ error: "auth_required" }, 401);
  const subs = await db.select({ root: schema.subscriptions.publisherRootIp })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.subscriberWallet, siwe), gte(schema.subscriptions.expiresAt, new Date())));
  const lics = await db.select({ hatchUuid: schema.licenses.hatchUuid })
    .from(schema.licenses).where(eq(schema.licenses.buyerWallet, siwe));
  const [me] = await db.select().from(schema.publishers).where(eq(schema.publishers.wallet, siwe));
  const subRoots = new Set(subs.map((s) => s.root));
  const licUuids = new Set(lics.map((l) => l.hatchUuid));
  const myRoot = me?.publisherRootIp;
  const rows = await db.select().from(schema.hatches).orderBy(schema.hatches.revealAt).limit(200);
  const items = rows
    .filter((h) => {
      const status = effectiveStatus(h);
      if (status === "resolved") return false;
      if (myRoot && h.publisherRootIp === myRoot) return true;
      if (subRoots.has(h.publisherRootIp)) return true;
      if (licUuids.has(h.uuid)) return true;
      return false;
    })
    .map((h) => {
      const access = (myRoot && h.publisherRootIp === myRoot) ? "Author"
        : subRoots.has(h.publisherRootIp) ? "Subscribed"
        : "Bought";
      return { ...serializeHatch(h), access };
    });
  return c.json({ items });
});

/* /me/timeline — activity river: reveals from followed publishers + outcomes
 * + the user's own publishing activity. Lightweight projection of recent events
 * from a small set of joined tables, ordered newest-first. */
app.get("/me/timeline", async (c) => {
  const siwe = await requireSiwe(c); if (!siwe) return c.json({ error: "auth_required" }, 401);
  const limit = Math.min(Number(c.req.query("limit") ?? 30), 100);

  // Universe: follows + subscriptions + own publisher root
  const followRows = await db.select({ root: schema.follows.publisherRootIp })
    .from(schema.follows).where(eq(schema.follows.followerWallet, siwe));
  const subRows = await db.select({ root: schema.subscriptions.publisherRootIp })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.subscriberWallet, siwe), gte(schema.subscriptions.expiresAt, new Date())));
  const [me] = await db.select().from(schema.publishers).where(eq(schema.publishers.wallet, siwe));
  const universe = new Set<string>([
    ...followRows.map((r) => r.root),
    ...subRows.map((r) => r.root),
    ...(me?.publisherRootIp ? [me.publisherRootIp] : []),
  ]);
  if (universe.size === 0) return c.json({ items: [] });

  const rootList = Array.from(universe);
  // Recent hatches from the universe — used for reveal + upcoming + outcome events
  const recentHatches = await db.select().from(schema.hatches)
    .where(and(
      gte(schema.hatches.embargoStart, new Date(Date.now() - 14 * 24 * 3600_000)),
    ))
    .orderBy(desc(schema.hatches.createdAt))
    .limit(200);
  const filtered = recentHatches.filter((h) => rootList.includes(h.publisherRootIp));

  // Build event list
  const events: Array<{ type: string; ts: string; [k: string]: unknown }> = [];
  for (const h of filtered) {
    const status = effectiveStatus(h);
    if (status === "revealed" || status === "resolved") {
      events.push({
        type: "revealed",
        ts: h.revealAt.toISOString(),
        uuid: h.uuid,
        title: h.title,
        publisherRootIp: h.publisherRootIp,
      });
    } else if (status === "active" || status === "sealed") {
      events.push({
        type: "upcoming",
        ts: h.embargoStart.toISOString(),
        uuid: h.uuid,
        title: h.title,
        publisherRootIp: h.publisherRootIp,
        revealAt: h.revealAt.toISOString(),
        mine: me?.publisherRootIp === h.publisherRootIp,
      });
    }
  }

  // Outcomes
  const finalized = await db.select({ outcome: schema.outcomes, hatch: schema.hatches })
    .from(schema.outcomes)
    .innerJoin(schema.hatches, eq(schema.hatches.uuid, schema.outcomes.hatchUuid))
    .where(and(eq(schema.outcomes.status, "finalized")))
    .orderBy(desc(schema.outcomes.finalizedAt))
    .limit(50);
  for (const { outcome, hatch } of finalized) {
    if (!rootList.includes(hatch.publisherRootIp) || !outcome.finalizedAt) continue;
    events.push({
      type: "outcome",
      ts: outcome.finalizedAt.toISOString(),
      uuid: hatch.uuid,
      title: hatch.title,
      publisherRootIp: hatch.publisherRootIp,
      outcomeValue: outcome.outcomeValue?.toString() ?? null,
      mine: me?.publisherRootIp === hatch.publisherRootIp,
    });
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return c.json({ items: events.slice(0, limit) });
});

/* ── /read — SIWE + on-chain entitlement check + SDK read via server pool */
app.post("/hatches/:uuid/read", async (c) => {
  const siwe = await requireSiwe(c);
  if (!siwe) return c.json({ error: "auth_required" }, 401);
  if (!rateLimit(`wallet:${siwe}`, 30, 60_000)) return c.json({ error: "rate_limited" }, 429);

  const uuid = Number(c.req.param("uuid"));
  const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!h) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{ entitlement?: any; via?: "wallet" | "anonymous" }>().catch(() => ({} as any));
  const via = body.via ?? "anonymous";
  const status = effectiveStatus(h);
  const postReveal = status === "revealed" || status === "resolved";

  // Entitlement check (skipped if post-reveal — open to all)
  let entitled = postReveal;
  if (!postReveal) {
    if (!body.entitlement) return c.json({ error: "entitlement_required_pre_reveal" }, 403);
    if (body.entitlement.kind === 0) {
      const ids = (body.entitlement.licenseTokenIds || []).map((x: string) => BigInt(x));
      entitled = await checkPerHatchEntitlement(siwe as Address, ids, h.signalIpId as Address);
    } else if (body.entitlement.kind === 1) {
      entitled = await checkSubscriptionEntitlement(siwe as Address, BigInt(body.entitlement.passId), h.publisherRootIp as Address, h.embargoStart);
    }
  }
  if (!entitled) return c.json({ error: "not_entitled" }, 403);

  // Reads:
  //   - post-reveal: pool reads with empty aux (no per-hatch cost).
  //   - pre-reveal + kind=1: lent-pass (subscriber lends → ephemeral reads → unlend).
  //     Server can only orchestrate if it can sign for the subscriber. Production needs
  //     EIP-712 lendBySig on the Pass + client-signed auth; we ship TEST_WALLET_PKS env
  //     for the integration test to drive the full flow.
  //   - pre-reveal + kind=0: NOT offered. The per-hatch license mint is already a public
  //     action — anonymous-per-hatch provides no privacy beyond what the user can self-do.
  if (!postReveal && body.entitlement?.kind === 0) {
    return c.json({ error: "anonymous_per_hatch_not_offered", message: "kind=0 anonymous reads are not offered; mint a license and read via:'wallet'" }, 400);
  }

  const { readHatch } = await sdk();
  const pool = await getPool();

  try {
    if (postReveal) {
      const res = await readHatch({
        config: buildSdkConfig(), publicClient, uuid, entitlement: "empty", via: "anonymous", pool,
      });
      await db.insert(schema.reads).values({
        id: `${res.txHash}:api`, hatchUuid: uuid, readerAddr: res.reader.toLowerCase(),
        kind: 255, via: "anonymous", txHash: res.txHash,
      }).onConflictDoNothing();
      return c.json({ text: res.text, media: res.media.map((m) => ({ name: m.name, mime: m.mime, bytesBase64: Buffer.from(m.bytes).toString("base64") })), reader: res.reader, txHash: res.txHash, latencyMs: res.latencyMs });
    }
    // pre-reveal kind=1: lent-pass via TEST_WALLET_PKS subscriber-PK lookup (dev/test only)
    const subPkMap = parseTestWalletPks(process.env.TEST_WALLET_PKS);
    const subPk = subPkMap.get(siwe);
    if (!subPk) {
      return c.json({
        error: "client_orchestration_required",
        message: "kind=1 anonymous: production flow is client-signed lend → server read → client-signed unlend. Use SDK readHatch via:'anonymous-lent' directly.",
      }, 400);
    }
    const { privateKeyToAccount } = await import("viem/accounts");
    const { createWalletClient, http: vhttp } = await import("viem");
    const subAcct = privateKeyToAccount(subPk as `0x${string}`);
    const subChain = { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } };
    // any-cast justified: viem chain shape generic across consumers; we type-erase only at the boundary.
    const subWallet = createWalletClient({ account: subAcct, chain: subChain as any, transport: vhttp(process.env.RPC_URL!) });

    const res = await readHatch({
      config: buildSdkConfig(), publicClient, uuid,
      entitlement: { kind: 1, passId: BigInt(body.entitlement.passId) },
      via: "anonymous-lent",
      pool, subscriberWallet: subWallet, subscriberAccount: subAcct,
    });
    await db.insert(schema.reads).values({
      id: `${res.txHash}:api`, hatchUuid: uuid, readerAddr: res.reader.toLowerCase(),
      kind: 1, via: "anonymous", txHash: res.txHash,
    }).onConflictDoNothing();
    return c.json({ text: res.text, media: res.media.map((m: { name: string; mime: string; bytes: Uint8Array }) => ({ name: m.name, mime: m.mime, bytesBase64: Buffer.from(m.bytes).toString("base64") })), reader: res.reader, txHash: res.txHash, latencyMs: res.latencyMs });
  } catch (e: unknown) {
    const msg = (e as { message?: string })?.message ?? String(e);
    return c.json({ error: "read_failed", detail: msg.slice(0, 240) }, 500);
  }
});

/** Parse TEST_WALLET_PKS env "addr=pk,addr=pk" → Map(lowercase addr → pk). Dev/test only. */
function parseTestWalletPks(s: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!s) return m;
  for (const part of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [addr, pk] = part.split("=");
    if (addr && pk) m.set(addr.toLowerCase(), pk);
  }
  return m;
}

/** Build a HatchConfig for server-side SDK calls. */
function buildSdkConfig() {
  const chain = {
    chainId: 1315, rpcUrl: process.env.RPC_URL!, storyApiUrl: process.env.STORY_API_URL!,
    wip: "0x1514000000000000000000000000000000000000",
    licenseToken: LICENSE_TOKEN,
    pilTemplate: "0x2E896b0b2Fdb7457499B56AAaA4AE55BCB4Cd316",
    royaltyPolicyLap: "0xBe54FB168b3c982b7AaE60dB6CF75Bd8447b390E",
    cdr: CONTRACTS.cdr, dkg: "0xcccccc0000000000000000000000000000000004",
    licenseReadCondition: "0xC0640AD4CF2CaA9914C8e5C44234359a9102f7a3",
    ownerWriteCondition: "0x4C9bFC96d7092b590D497A191826C3dA2277c34B",
  };
  // any-cast justified: HatchConfig is defined in the SDK; we construct compatible shape here.
  return {
    chain, storage: serverStorageProvider(),
    hatch: { hatchCondition: CONTRACTS.hatchCondition, subscriptionPass: CONTRACTS.pass, oracle: CONTRACTS.oracle, publisherRegistry: CONTRACTS.registry },
  } as any;
}

let _storageProvider: unknown = null;
async function ensureServerStorage(): Promise<unknown> {
  if (_storageProvider) return _storageProvider;
  // Storage providers are Node-only — import from the sub-path so they don't
  // get pulled into the browser bundle via the @usehatch/sdk barrel.
  const { LocalDiskProvider, SupabaseProvider } = await import("@usehatch/sdk/storage");
  _storageProvider = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET)
    ? new SupabaseProvider(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_BUCKET)
    : new LocalDiskProvider(process.env.LOCAL_STORAGE_DIR ?? "/tmp/hatch-roundtrip-storage");
  return _storageProvider;
}
function serverStorageProvider(): unknown {
  if (!_storageProvider) throw new Error("serverStorageProvider: not initialized; ensureServerStorage() must be awaited first");
  return _storageProvider;
}

/* ── Storage provider (LocalDisk for dev; SupabaseProvider when creds land).
 * Node-only path so node:fs stays out of any consumer's browser bundle. */
async function loadStorageProvider() {
  const { LocalDiskProvider, SupabaseProvider } = await import("@usehatch/sdk/storage");
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET) {
    return new SupabaseProvider(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_BUCKET);
  }
  return new LocalDiskProvider(process.env.LOCAL_STORAGE_DIR ?? "/tmp/hatch-roundtrip-storage");
}

/* ────────────────────────── /storage — client-side composer's ciphertext sink.
 * The frontend's BackendStorage adapter (implements HatchStorage from
 * @usehatch/sdk) POSTs encrypted media bytes here as base64. The server hashes
 * and stores via the same storage provider the reveal worker reads from, so
 * read paths see the same bytes.
 *
 * Auth: SIWE required to write (rate-limited per wallet). Reads are public:
 * the bytes are encrypted at rest and only useful with a manifest key.
 *
 * Body shape: { dataBase64: string } — uniform with /siwe payloads. */
app.post("/storage", async (c) => {
  const siwe = await requireSiwe(c); if (!siwe) return c.json({ error: "auth_required" }, 401);
  if (!rateLimit(`storage:${siwe}`, 60, 60_000)) return c.json({ error: "rate_limited" }, 429);
  const body = await c.req.json<{ dataBase64?: string }>().catch(() => ({} as any));
  if (typeof body.dataBase64 !== "string" || body.dataBase64.length === 0) return c.json({ error: "bad_request", message: "dataBase64 required" }, 400);
  if (body.dataBase64.length > 4 * 1024 * 1024) return c.json({ error: "too_large", message: "max 3 MiB per upload" }, 413);
  let bytes: Buffer;
  try { bytes = Buffer.from(body.dataBase64, "base64"); }
  catch { return c.json({ error: "bad_base64" }, 400); }
  try {
    const sp = await ensureServerStorage() as { upload: (b: Uint8Array) => Promise<string> };
    const cid = await sp.upload(new Uint8Array(bytes));
    return c.json({ cid });
  } catch (e: any) {
    return c.json({ error: "storage_failed", detail: e?.message ?? String(e) }, 502);
  }
});
app.get("/storage/:cid", async (c) => {
  const cid = c.req.param("cid");
  if (!/^[a-zA-Z0-9._-]+$/.test(cid)) return c.json({ error: "bad_cid" }, 400);
  try {
    const sp = await ensureServerStorage() as { download: (cid: string) => Promise<Uint8Array> };
    const bytes = await sp.download(cid);
    return c.body(Buffer.from(bytes), 200, { "content-type": "application/octet-stream", "cache-control": "private, max-age=300" });
  } catch (e: any) {
    return c.json({ error: "not_found", detail: e?.message ?? String(e) }, 404);
  }
});

/* ────────────────────────── subscribe (Build 6 — two-party mint)
 * Client mints the subscription license token from the publisher root (signed
 * by subscriber). This route then mints the paired HatchSubscriptionPass via
 * PASS_MINTER_PK (an env-provided publisher minter key). Returns the passId. */
const PASS_MINT_ABI_FULL = parseAbi([
  "function mint(address to, address publisherRoot_, uint256 subLicenseTokenId_, uint64 duration, uint256 subPriceWei_) returns (uint256)",
]);
const SUB_PASS_ADDR = "0x9fc74922a10ad962570eb9692e66b0f6cb6909e1" as Address;
const DEFAULT_SUB_PRICE_WEI = parseEther("0.05");

app.post("/subscribe", async (c) => {
  const siwe = await requireSiwe(c);
  if (!siwe) return c.json({ error: "auth_required" }, 401);
  const body = await c.req.json<{ publisherRootIp: string; subLicenseTokenId: string; durationDays?: number }>().catch(() => ({} as any));
  const { publisherRootIp, subLicenseTokenId } = body;
  const durationDays = Math.max(1, Math.min(Number(body.durationDays ?? 30), 365));
  if (typeof publisherRootIp !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(publisherRootIp))
    return c.json({ error: "bad_request", message: "publisherRootIp required" }, 400);
  if (typeof subLicenseTokenId !== "string" || !/^\d+$/.test(subLicenseTokenId))
    return c.json({ error: "bad_request", message: "subLicenseTokenId required" }, 400);

  const pk = process.env.PASS_MINTER_PK;
  if (!pk) return c.json({ error: "subscribe_not_configured", message: "Server has no PASS_MINTER_PK env — set the publisher minter private key to enable Subscribe." }, 503);
  const minter = privateKeyToAccount(pk as `0x${string}`);
  const walletClient = createWalletClient({ account: minter, chain: { id: 1315, name: "Story Aeneid", nativeCurrency: { name: "IP", symbol: "IP", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } } as any, transport: http(process.env.RPC_URL!) });

  const duration = BigInt(durationDays) * 24n * 3600n;
  try {
    const sim = await publicClient.simulateContract({
      address: SUB_PASS_ADDR, abi: PASS_MINT_ABI_FULL, functionName: "mint",
      args: [siwe as Address, publisherRootIp.toLowerCase() as Address, BigInt(subLicenseTokenId), duration, DEFAULT_SUB_PRICE_WEI],
      account: minter,
    });
    const mintPassTx = await walletClient.writeContract(sim.request);
    await publicClient.waitForTransactionReceipt({ hash: mintPassTx });
    return c.json({ passId: sim.result.toString(), mintPassTx });
  } catch (e: any) {
    return c.json({ error: "mint_failed", detail: e?.shortMessage ?? e?.message ?? String(e) }, 502);
  }
});

/* ────────────────────────── follows (Build 6) */
app.post("/follow", async (c) => {
  const siwe = await requireSiwe(c);
  if (!siwe) return c.json({ error: "auth_required" }, 401);
  const { publisherRootIp } = await c.req.json().catch(() => ({}));
  if (typeof publisherRootIp !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(publisherRootIp))
    return c.json({ error: "bad_request", message: "publisherRootIp required" }, 400);
  await db.insert(schema.follows).values({
    followerWallet: siwe, publisherRootIp: publisherRootIp.toLowerCase(),
  }).onConflictDoNothing();
  return c.json({ ok: true });
});

app.delete("/follow", async (c) => {
  const siwe = await requireSiwe(c);
  if (!siwe) return c.json({ error: "auth_required" }, 401);
  const { publisherRootIp } = await c.req.json().catch(() => ({}));
  if (typeof publisherRootIp !== "string") return c.json({ error: "bad_request" }, 400);
  await db.delete(schema.follows).where(and(
    eq(schema.follows.followerWallet, siwe),
    eq(schema.follows.publisherRootIp, publisherRootIp.toLowerCase()),
  ));
  return c.json({ ok: true });
});

app.get("/follows/:wallet", async (c) => {
  const wallet = c.req.param("wallet").toLowerCase();
  const rows = await db.select({ p: schema.follows.publisherRootIp }).from(schema.follows).where(eq(schema.follows.followerWallet, wallet));
  return c.json({ wallet, publishers: rows.map((r) => r.p) });
});

app.get("/followers/:root", async (c) => {
  const root = c.req.param("root").toLowerCase();
  const rows = await db.select({ w: schema.follows.followerWallet }).from(schema.follows).where(eq(schema.follows.publisherRootIp, root));
  return c.json({ publisherRootIp: root, followers: rows.map((r) => r.w) });
});

/* ────────────────────────── Web Push subscribe (Build 6) */
app.post("/push/subscribe", async (c) => {
  const siwe = await requireSiwe(c);
  if (!siwe) return c.json({ error: "auth_required" }, 401);
  const body = await c.req.json().catch(() => null);
  // Expected: { endpoint, keys: { p256dh, auth } } — the standard PushSubscription JSON
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth)
    return c.json({ error: "bad_request", message: "endpoint + keys.p256dh + keys.auth required" }, 400);
  await db.insert(schema.pushSubscriptions).values({
    endpoint: body.endpoint, wallet: siwe,
    p256dh: body.keys.p256dh, auth: body.keys.auth,
    userAgent: c.req.header("user-agent") ?? null,
  }).onConflictDoNothing();
  return c.json({ ok: true, vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null });
});

app.delete("/push/subscribe", async (c) => {
  const siwe = await requireSiwe(c);
  if (!siwe) return c.json({ error: "auth_required" }, 401);
  const { endpoint } = await c.req.json().catch(() => ({}));
  if (typeof endpoint !== "string") return c.json({ error: "bad_request" }, 400);
  await db.delete(schema.pushSubscriptions).where(and(
    eq(schema.pushSubscriptions.endpoint, endpoint),
    eq(schema.pushSubscriptions.wallet, siwe),
  ));
  return c.json({ ok: true });
});

/* ────────────────────────── WS (auth-aware, per-user routing for "my-publishers") */
app.get("/ws", upgradeWebSocket((c) => {
  const follow = c.req.query("follow")?.toLowerCase();
  const channel = c.req.query("channel"); // "public" | "my-publishers"
  // Auth: SIWE token via query param `token` OR `sec-websocket-protocol: <token>` header.
  const tokenFromQuery = c.req.query("token");
  const tokenFromProto = c.req.header("sec-websocket-protocol");
  // Tokens delivered via the protocol header are prefixed with `hatch.bearer.`
  // by the browser shim; strip it so the DB lookup matches.
  const rawProtoToken = tokenFromProto?.replace(/^hatch\.bearer\./, "");
  const token = tokenFromQuery ?? rawProtoToken ?? undefined;
  let authWallet: string | null = null;
  // "my-publishers" requires auth; public stays open.
  const needsAuth = channel === "my-publishers";
  let publisherSet: Set<string> | null = null;

  return {
    async onOpen(_, ws) {
      if (token) {
        const s = await loadSession(token);
        if (s) authWallet = s.wallet;
      }
      const authOk = !needsAuth || !!authWallet;
      if (!authOk) {
        ws.send(JSON.stringify({ type: "error", reason: "auth_required" }));
        ws.close(4401, "auth_required");
        return;
      }
      if (channel === "my-publishers" && authWallet) {
        // Resolve (subscriptions ∪ follows) for this wallet at connect time.
        const subs = await db.select({ p: schema.subscriptions.publisherRootIp })
          .from(schema.subscriptions).where(eq(schema.subscriptions.subscriberWallet, authWallet));
        const flw = await db.select({ p: schema.follows.publisherRootIp })
          .from(schema.follows).where(eq(schema.follows.followerWallet, authWallet));
        publisherSet = new Set([...subs, ...flw].map((r) => r.p.toLowerCase()));
      }
      const client = { send: (s: string) => ws.send(s), follow, channel, authWallet, publisherSet };
      wsClients.add(client);
      (ws as { __client?: typeof client }).__client = client;
      ws.send(JSON.stringify({
        type: "hello", channel: channel ?? "public",
        wallet: authWallet, followingCount: publisherSet?.size ?? 0,
      }));
    },
    onClose(_, ws) {
      const w = ws as { __client?: { send: (s: string) => void } };
      if (w.__client) wsClients.delete(w.__client);
    },
    onMessage() { /* one-way for v1 */ },
  };
}));

/* Health check that actually verifies dependencies. Used by Railway/k8s
 * liveness probes and by ops dashboards. Returns 200 only when all probes
 * pass; 503 if any are degraded. Per-probe latency is included so dashboards
 * can alert on slow upstreams before they fail outright. */
app.get("/healthz", async (c) => {
  const checks: Record<string, { ok: boolean; ms: number; detail?: string }> = {};
  const probe = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    try { await fn(); checks[name] = { ok: true, ms: Date.now() - t0 }; }
    catch (e: any) { checks[name] = { ok: false, ms: Date.now() - t0, detail: (e?.message ?? String(e)).slice(0, 200) }; }
  };
  await Promise.all([
    probe("db", async () => { await db.execute(sql`select 1`); }),
    probe("rpc", async () => { await publicClient.getBlockNumber(); }),
    probe("storage", async () => {
      // Storage probe is opportunistic: we ping the provider's read path on a
      // sentinel cid that may not exist. Both Supabase + LocalDisk return a
      // not-found error for missing cids, which we treat as "provider up".
      try {
        const sp = await ensureServerStorage() as { download: (cid: string) => Promise<Uint8Array> };
        await sp.download("__healthz__").catch((e: any) => {
          const msg = String(e?.message ?? e);
          if (/not_found|not found|Object not found|ENOENT/i.test(msg)) return; // expected
          throw e;
        });
      } catch (e) { throw e; }
    }),
  ]);
  const allOk = Object.values(checks).every((c) => c.ok);
  return c.json({ ok: allOk, ts: new Date().toISOString(), checks }, allOk ? 200 : 503);
});

/* Liveness (process-up) check for orchestrators that distinguish liveness
 * from readiness. Always 200 as long as the process responds — used by k8s
 * `livenessProbe` so transient DB blips don't trigger a pod restart. */
app.get("/livez", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

export async function startServer() {
  await ensureServerStorage();
  const server = serve({ fetch: app.fetch, port: PORT });
  injectWebSocket(server);
  return server;
}
