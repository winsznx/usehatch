/* Typed REST client for the Hatch backend.
 *
 * Base URL via VITE_BACKEND_URL (see lib/config.ts).
 *
 * Auth: the Bearer SIWE token is held in React state via lib/siwe.ts.
 * Callers either pass `{ token }` explicitly, or use api.withToken(t) to
 * get a token-bound client. NO localStorage / sessionStorage — Section 1.3.
 *
 * Every request sends `credentials: 'include'` so the backend's future
 * httpOnly hatch_session cookie travels with the request once wired. A 401
 * surfaces as ApiUnauthorizedError so the SIWE provider can prompt re-sign. */
import type { Address } from "viem";

import { config } from "./lib/config.js";

const BASE = config.backendUrl;

export class ApiUnauthorizedError extends Error {
  constructor(message = "401 Unauthorized") { super(message); this.name = "ApiUnauthorizedError"; }
}
export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body: string) {
    super(message); this.name = "ApiError"; this.status = status; this.body = body;
  }
}

export type HatchStatus = "sealed" | "active" | "revealed" | "resolved";
export interface HatchSummary {
  uuid: number;
  signalIpId: Address;
  publisherRootIp: Address;
  mode: 0 | 1 | 2;
  embargoStart: string;
  revealAt: string;
  status: HatchStatus;
  title?: string | null;
  summary?: string | null;
  postedUri?: string | null;
  manifestRef?: string | null;
  perHatchPriceWei?: string | null;
  perHatchTermsId?: string | null;
  outcomeSpec?: unknown;
  createdAt?: string;
  txHashes?: { allocate?: string; write?: string; derivative?: string } | null;
}
export interface QueueItem extends HatchSummary {
  access: "Author" | "Subscribed" | "Bought";
}
export type TimelineEvent =
  | { type: "revealed"; ts: string; uuid: number; title: string | null; publisherRootIp: Address }
  | { type: "upcoming"; ts: string; uuid: number; title: string | null; publisherRootIp: Address; revealAt: string; mine: boolean }
  | { type: "outcome"; ts: string; uuid: number; title: string | null; publisherRootIp: Address; outcomeValue: string | null; mine: boolean };
export interface ResolutionRow {
  uuid: number;
  title: string | null;
  summary: string | null;
  revealAt: string;
  finalizedAt: string | null;
  outcomeValue: string | null;
  operator: string | null;
}
export interface PublisherSummary {
  wallet: Address;
  publisherRootIp: Address;
  displayName?: string | null;
  payoutAddress?: Address | null;
  subscriptionTermsId?: string | null;
  verified: boolean;
  stakeWei?: string;
}
export interface TrackRecord {
  publisherRootIp: Address;
  totalHatches: number;
  resolvedHatches: number;
  weightedAccuracy: string | null;
  subscriberCount: number;
  disputeCount: number;
}
export interface PublisherMetrics {
  trackRecord: TrackRecord | null;
  activeSubscribers: number;
  followerCount: number;
}

interface ReqOpts {
  token?: string | null;
  signal?: AbortSignal;
}

async function req<T>(path: string, init: RequestInit & ReqOpts = {}): Promise<T> {
  const { token, signal, ...rest } = init;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...((rest.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    credentials: "include",
    signal,
  });
  if (res.status === 401) throw new ApiUnauthorizedError(`401 ${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, `${res.status} ${res.statusText} ${path}`, body.slice(0, 500));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface RawApi {
  baseUrl: string;

  /* Auth — SIWE-lite */
  siweNonce(address: Address): Promise<{ nonce: string }>;
  siweVerify(message: string, signature: `0x${string}`): Promise<{ token: string; wallet: Address }>;
  signOut(token: string): Promise<void>;

  /* Public reads */
  publishers(): Promise<{ publishers: PublisherSummary[] }>;
  publisher(rootIp: Address): Promise<{ publisher: PublisherSummary; trackRecord: TrackRecord | null }>;
  publisherResolutions(rootIp: Address): Promise<{ resolutions: ResolutionRow[] }>;
  publisherMetrics(rootIp: Address): Promise<PublisherMetrics>;
  hatches(opts?: { status?: HatchStatus; publisher?: Address; limit?: number }): Promise<{ hatches: HatchSummary[] }>;
  hatch(uuid: number): Promise<{ hatch: HatchSummary }>;
  hatchReveal(uuid: number): Promise<{ revealedContent: { hatchUuid: number; text: string | null; media: { name: string; mime: string; cid: string }[] | null; revealedAt: string; revealedBy: string | null } }>;
  outcome(uuid: number): Promise<{ outcome: { hatchUuid: number; status: string; outcomeValue: string | null; finalizedAt: string | null; operator: string | null } }>;

  /* Authed (token required) */
  mySubscriptions(wallet: Address, token: string): Promise<{ wallet: Address; subscriptions: unknown[] }>;
  myLicenses(wallet: Address, token: string): Promise<{ wallet: Address; licenses: unknown[] }>;
  myQueue(token: string): Promise<{ items: QueueItem[] }>;
  myTimeline(token: string): Promise<{ items: TimelineEvent[] }>;
  setHatchMetadata(
    uuid: number,
    body: { title?: string; summary?: string; publisherRootIp?: Address; signalIpId?: Address; mode?: number; embargoStart?: number; revealAt?: number },
    token: string,
  ): Promise<{ ok: true; uuid: number; title?: string; summary?: string; upserted?: boolean }>;
  /* Two-party Subscribe — client mints sub license, backend mints Pass with publisher minter key. */
  subscribe(publisherRootIp: Address, token: string, storyClient: unknown): Promise<{ subLicenseTokenId: string; passId: string; mintLicenseTx: `0x${string}`; mintPassTx: `0x${string}` }>;
  /* Authed read — gates entitlement, returns decrypted text + media. */
  readHatchAuthed(uuid: number, body: { entitlement: object | "empty"; via: "wallet" | "anonymous" }, token: string): Promise<{
    text: string; media: { name: string; mime: string; bytesBase64: string }[]; reader: Address; txHash: `0x${string}`;
  }>;

  /* Follows */
  follow(publisherRootIp: Address, token: string): Promise<{ ok: true }>;
  unfollow(publisherRootIp: Address, token: string): Promise<{ ok: true }>;
  follows(wallet: Address): Promise<{ wallet: Address; publishers: Address[] }>;
  followers(rootIp: Address): Promise<{ publisherRootIp: Address; followers: Address[] }>;

  /* Web Push */
  pushSubscribe(subscription: PushSubscriptionJSON, token: string): Promise<{ ok: true; vapidPublicKey: string | null }>;
  pushUnsubscribe(endpoint: string, token: string): Promise<{ ok: true }>;

  /* Read (kind=1 anonymous lent-pass or empty post-reveal) */
  readHatch(uuid: number, body: { entitlement: object | "empty"; via: "wallet" | "anonymous" }, token: string): Promise<{
    text: string; media: { name: string; mime: string; bytesBase64: string }[]; reader: Address; txHash: `0x${string}`;
  }>;
}

export const api: RawApi = {
  baseUrl: BASE,

  siweNonce(address) {
    return req("/siwe/nonce", { method: "POST", body: JSON.stringify({ address }) });
  },
  siweVerify(message, signature) {
    return req("/siwe/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
  },
  async signOut(token) {
    await req<void>("/siwe/signout", { method: "POST", token }).catch(() => undefined);
  },

  publishers() { return req("/publishers"); },
  publisher(rootIp) { return req(`/publishers/${rootIp.toLowerCase()}`); },
  publisherResolutions(rootIp) { return req(`/publishers/${rootIp.toLowerCase()}/resolutions`); },
  publisherMetrics(rootIp) { return req(`/publishers/${rootIp.toLowerCase()}/metrics`); },
  hatches(opts) {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.publisher) qs.set("publisher", opts.publisher.toLowerCase());
    if (opts?.limit) qs.set("limit", String(opts.limit));
    return req(`/hatches${qs.toString() ? "?" + qs.toString() : ""}`);
  },
  hatch(uuid) { return req(`/hatches/${uuid}`); },
  hatchReveal(uuid) { return req(`/hatches/${uuid}/reveal`); },
  outcome(uuid) { return req(`/outcomes/${uuid}`); },

  mySubscriptions(wallet, token) { return req(`/subscriptions/${wallet.toLowerCase()}`, { token }); },
  myLicenses(wallet, token) { return req(`/licenses/${wallet.toLowerCase()}`, { token }); },
  myQueue(token) { return req("/me/queue", { token }); },
  myTimeline(token) { return req("/me/timeline", { token }); },
  setHatchMetadata(uuid, body, token) {
    return req(`/hatches/${uuid}/metadata`, { method: "PATCH", body: JSON.stringify(body), token });
  },

  follow(publisherRootIp, token) {
    return req("/follow", { method: "POST", body: JSON.stringify({ publisherRootIp }), token });
  },
  unfollow(publisherRootIp, token) {
    return req("/follow", { method: "DELETE", body: JSON.stringify({ publisherRootIp }), token });
  },
  follows(wallet) { return req(`/follows/${wallet.toLowerCase()}`); },
  followers(rootIp) { return req(`/followers/${rootIp.toLowerCase()}`); },

  pushSubscribe(subscription, token) {
    return req("/push/subscribe", { method: "POST", body: JSON.stringify(subscription), token });
  },
  pushUnsubscribe(endpoint, token) {
    return req("/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }), token });
  },

  readHatch(uuid, body, token) {
    return req(`/hatches/${uuid}/read`, { method: "POST", body: JSON.stringify(body), token });
  },
  readHatchAuthed(uuid, body, token) {
    return req(`/hatches/${uuid}/read`, { method: "POST", body: JSON.stringify(body), token });
  },
  async subscribe(publisherRootIp, token, storyClient: any) {
    // (a) fetch publisher to read subscriptionTermsId
    const { publisher } = await req<{ publisher: PublisherSummary; trackRecord: TrackRecord | null }>(`/publishers/${publisherRootIp.toLowerCase()}`);
    if (!publisher.subscriptionTermsId) throw new Error("Publisher has no subscription terms configured");
    // (b) subscriber mints sub license token client-side
    const mint = await storyClient.license.mintLicenseTokens({
      licensorIpId: publisherRootIp,
      licenseTermsId: BigInt(publisher.subscriptionTermsId),
      amount: 1,
      maxMintingFee: 10n ** 18n,
      receiver: undefined,
    });
    const subLicenseTokenId = String(mint.licenseTokenIds[0]);
    // (c) backend mints the paired Pass with the publisher's minter key
    const res = await req<{ passId: string; mintPassTx: `0x${string}` }>("/subscribe", {
      method: "POST", token,
      body: JSON.stringify({ publisherRootIp, subLicenseTokenId, durationDays: 30 }),
    });
    return { subLicenseTokenId, passId: res.passId, mintLicenseTx: mint.txHash, mintPassTx: res.mintPassTx };
  },
};
