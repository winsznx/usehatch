import { pgTable, text, integer, bigint, boolean, jsonb, timestamp, numeric, pgEnum, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ────────────────────────── enums */
export const hatchStatusEnum = pgEnum("hatch_status", ["sealed", "active", "revealed", "resolved"]);
export const outcomeStatusEnum = pgEnum("outcome_status", ["none", "pending", "disputed", "finalized"]);

/* ────────────────────────── publishers
 * One row per registered publisher wallet. wallet is the on-chain msg.sender that
 * registered; publisher_root_ip is the IIPAccount they control. */
export const publishers = pgTable("publishers", {
  wallet: text("wallet").primaryKey(),                       // 0x… lowercase
  publisherRootIp: text("publisher_root_ip").notNull(),
  displayName: text("display_name"),
  payoutAddress: text("payout_address"),
  subscriptionTermsId: bigint("subscription_terms_id", { mode: "bigint" }),
  stakeWei: bigint("stake_wei", { mode: "bigint" }).notNull().default(sql`0`),
  verified: boolean("verified").notNull().default(false),
  lastSlashAt: timestamp("last_slash_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byRoot: uniqueIndex("publishers_root_idx").on(t.publisherRootIp),
}));

/* ────────────────────────── hatches */
export const hatches = pgTable("hatches", {
  uuid: integer("uuid").primaryKey(),                        // CDR vault uuid (uint32)
  signalIpId: text("signal_ip_id").notNull(),
  publisherRootIp: text("publisher_root_ip").notNull(),
  mode: integer("mode").notNull(),                           // 0/1/2
  perHatchTermsId: bigint("per_hatch_terms_id", { mode: "bigint" }),
  perHatchPriceWei: bigint("per_hatch_price_wei", { mode: "bigint" }),
  embargoStart: timestamp("embargo_start", { withTimezone: true }).notNull(),
  revealAt: timestamp("reveal_at", { withTimezone: true }).notNull(),
  outcomeSpec: jsonb("outcome_spec"),
  title: text("title"),
  summary: text("summary"),
  status: hatchStatusEnum("status").notNull().default("sealed"),
  manifestRef: text("manifest_ref"),                         // optional: storage CID of full manifest if mirrored
  txHashes: jsonb("tx_hashes").$type<{ allocate?: string; write?: string; derivative?: string }>(),
  postedUri: text("posted_uri"),                             // Bluesky AT-URI of the reveal post; idempotent gate
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byPublisher: index("hatches_publisher_idx").on(t.publisherRootIp),
  byReveal: index("hatches_reveal_idx").on(t.revealAt),
  byStatus: index("hatches_status_idx").on(t.status),
}));

/* ────────────────────────── subscriptions */
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),                               // synthesized: passId-as-decimal
  subscriberWallet: text("subscriber_wallet").notNull(),
  publisherRootIp: text("publisher_root_ip").notNull(),
  subLicenseTokenId: bigint("sub_license_token_id", { mode: "bigint" }).notNull(),
  passId: bigint("pass_id", { mode: "bigint" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  mintedAt: timestamp("minted_at", { withTimezone: true }).notNull(),
}, (t) => ({
  bySubscriber: index("subs_subscriber_idx").on(t.subscriberWallet),
  byRoot: index("subs_root_idx").on(t.publisherRootIp),
  byPass: uniqueIndex("subs_pass_idx").on(t.passId),
}));

/* ────────────────────────── licenses (per-hatch) */
export const licenses = pgTable("licenses", {
  id: text("id").primaryKey(),                               // licenseTokenId-as-decimal
  hatchUuid: integer("hatch_uuid").notNull().references(() => hatches.uuid),
  licenseTokenId: bigint("license_token_id", { mode: "bigint" }).notNull(),
  buyerWallet: text("buyer_wallet").notNull(),
  mintedAt: timestamp("minted_at", { withTimezone: true }).notNull(),
}, (t) => ({
  byHatch: index("lic_hatch_idx").on(t.hatchUuid),
  byBuyer: index("lic_buyer_idx").on(t.buyerWallet),
  byToken: uniqueIndex("lic_token_idx").on(t.licenseTokenId),
}));

/* ────────────────────────── reads (audit trail) */
export const reads = pgTable("reads", {
  id: text("id").primaryKey(),                               // tx_hash:logIndex (synth from indexer) or random for API reads
  hatchUuid: integer("hatch_uuid").notNull().references(() => hatches.uuid),
  readerAddr: text("reader_addr").notNull(),
  kind: integer("kind").notNull(),                           // 0 per-hatch, 1 sub, 255 empty/post-reveal
  via: text("via").notNull(),                                // "wallet" | "anonymous" | "indexer"
  txHash: text("tx_hash"),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byHatch: index("reads_hatch_idx").on(t.hatchUuid),
}));

/* ────────────────────────── revealed_content (populated by reveal worker — Build 5)
 * Defined now to lock the contract between indexer/API and the reveal worker. */
export const revealedContent = pgTable("revealed_content", {
  hatchUuid: integer("hatch_uuid").primaryKey().references(() => hatches.uuid),
  text: text("text"),
  media: jsonb("media").$type<{ name: string; mime: string; cid: string }[]>(),
  revealedAt: timestamp("revealed_at", { withTimezone: true }).notNull().defaultNow(),
  revealedBy: text("revealed_by"),
});

/* ────────────────────────── outcomes */
export const outcomes = pgTable("outcomes", {
  hatchUuid: integer("hatch_uuid").primaryKey().references(() => hatches.uuid),
  hatchId: text("hatch_id").notNull(),                       // bytes32 (the attestation key — keccak("hatch-<uuid>") by convention)
  outcomeValue: numeric("outcome_value"),                    // int256 stored as numeric for arbitrary precision
  outcomeHash: text("outcome_hash"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  operator: text("operator"),
  status: outcomeStatusEnum("status").notNull().default("none"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  challenge: jsonb("challenge").$type<{ challenger: string; bond: string; resolvedAt?: string; operatorWins?: boolean }>(),
}, (t) => ({
  byHatchId: uniqueIndex("outcomes_hatchid_idx").on(t.hatchId),
}));

/* ────────────────────────── track_records (populated by aggregator — Build 7) */
export const trackRecords = pgTable("track_records", {
  publisherRootIp: text("publisher_root_ip").primaryKey(),
  totalHatches: integer("total_hatches").notNull().default(0),
  resolvedHatches: integer("resolved_hatches").notNull().default(0),
  weightedAccuracy: numeric("weighted_accuracy"),                       // 0.0–1.0
  subscriberCount: integer("subscriber_count").notNull().default(0),
  disputeCount: integer("dispute_count").notNull().default(0),
  lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true }), // high-watermark for idempotency
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────── groups (Story GroupingModule)
 * One row per Group IPA created via @usehatch/sdk's createGroup. Members are
 * tracked in `group_members` so a single group can grow incrementally (Story
 * caps groups at 1000 members). `licenseTermsId` is the LRP terms attached at
 * registration — every member hatch's per-hatch terms must dedup to this id. */
export const groups = pgTable("groups", {
  groupIpId: text("group_ip_id").primaryKey(),                 // lowercase 0x… — the Group IP address
  publisherRootIp: text("publisher_root_ip"),                  // back-ref when owner is a known publisher
  ownerWallet: text("owner_wallet"),                           // creator wallet (signer of registerGroup)
  groupPool: text("group_pool").notNull(),                     // typically EvenSplitGroupPool
  licenseTermsId: bigint("license_terms_id", { mode: "bigint" }),
  title: text("title"),                                        // editorial label set by composer
  description: text("description"),
  status: text("status").notNull().default("active"),          // active | locked (post-derivative) | dissolved
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  txHashes: jsonb("tx_hashes").$type<{ registerTerms?: string; registerGroup?: string }>(),
}, (t) => ({
  byPublisher: index("groups_publisher_idx").on(t.publisherRootIp),
  byOwner: index("groups_owner_idx").on(t.ownerWallet),
}));

/* group_members — many-to-many between groups and IPs. We don't FK to hatches
 * because group members can be ANY Story IP, not just our signal IPs. UI joins
 * to `hatches` for display when applicable. */
export const groupMembers = pgTable("group_members", {
  groupIpId: text("group_ip_id").notNull(),                    // FK by convention
  memberIpId: text("member_ip_id").notNull(),                  // lowercase 0x… — any IP
  hatchUuid: integer("hatch_uuid"),                            // populated when memberIpId matches a known signal IP
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (t) => ({
  pk: primaryKey({ columns: [t.groupIpId, t.memberIpId] }),
  byGroup: index("group_members_group_idx").on(t.groupIpId),
  byMember: index("group_members_member_idx").on(t.memberIpId),
}));

/* ────────────────────────── disputes (Story DisputeModule)
 * One row per on-chain dispute. `storyDisputeId` is the protocol's uint256 id.
 * `targetIpId` may be a publisher root OR a signal IP — when it matches a known
 * signal, `hatchUuid` is populated for fast joins. `status` is derived:
 *   raised      → DisputeRaised seen, no judgement yet
 *   judged-true → DisputeJudgementSet { decision: true } (target IS infringing)
 *   judged-false→ DisputeJudgementSet { decision: false } (initiator loses bond)
 *   cancelled   → DisputeCancelled before liveness closed
 *   resolved    → DisputeResolved (final settlement) */
export const disputes = pgTable("disputes", {
  storyDisputeId: bigint("story_dispute_id", { mode: "bigint" }).primaryKey(),
  targetIpId: text("target_ip_id").notNull(),                  // lowercase 0x…
  hatchUuid: integer("hatch_uuid"),                            // nullable — only set when target == signal IP
  publisherRootIp: text("publisher_root_ip"),                  // nullable — back-pointer when known
  challenger: text("challenger").notNull(),
  tag: text("tag").notNull(),                                  // bytes32 hex, decoded server-side
  evidenceHash: text("evidence_hash"),                         // bytes32 hex from event
  evidenceCid: text("evidence_cid"),                           // CID we resolved from hash (optional)
  arbitrationPolicy: text("arbitration_policy"),
  bondWei: bigint("bond_wei", { mode: "bigint" }),
  status: text("status").notNull().default("raised"),
  decision: boolean("decision"),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  judgedAt: timestamp("judged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  txHashes: jsonb("tx_hashes").$type<{ raised?: string; judged?: string; cancelled?: string; resolved?: string }>(),
}, (t) => ({
  byTarget: index("disputes_target_idx").on(t.targetIpId),
  byPublisher: index("disputes_publisher_idx").on(t.publisherRootIp),
  byHatch: index("disputes_hatch_idx").on(t.hatchUuid),
  byStatus: index("disputes_status_idx").on(t.status),
}));

/* ────────────────────────── indexer cursor (per contract address) */
export const indexerCursor = pgTable("indexer_cursor", {
  contract: text("contract").primaryKey(),                   // lowercase 0x…
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull().default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────── processed_logs (idempotency for reorgs) */
export const processedLogs = pgTable("processed_logs", {
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.txHash, t.logIndex] }),
  byBlock: index("processed_block_idx").on(t.blockNumber),
}));

/* ────────────────────────── follows (Build 6)
 * A wallet can follow many publisher root IPs (free, off-chain — analogous to
 * Twitter follow). Subscriptions ∪ follows is the union the notify worker fans
 * email/push out to, and is what "my-publishers" WS channel routes against. */
export const follows = pgTable("follows", {
  followerWallet: text("follower_wallet").notNull(),         // lowercase 0x…
  publisherRootIp: text("publisher_root_ip").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.followerWallet, t.publisherRootIp] }),
  byFollower: index("follows_follower_idx").on(t.followerWallet),
  byPublisher: index("follows_publisher_idx").on(t.publisherRootIp),
}));

/* ────────────────────────── sent_notifications (Build 6)
 * Idempotency for outbound notifications. The PK is a synthesized text key
 * `${user}|${event_type}|${channel}|${hatchUuid||subscriptionId}` — lets us
 * INSERT … ON CONFLICT DO NOTHING for hard exactly-once per (user, event,
 * channel, subject). The per-user-per-hour throttle is layered on top via a
 * `sent_at >= now() - 1h` count, not via PK. */
export const sentNotifications = pgTable("sent_notifications", {
  id: text("id").primaryKey(),                               // user|event|channel|subject
  userIdentifier: text("user_identifier").notNull(),         // wallet (lowercase) OR email if no wallet
  hatchUuid: integer("hatch_uuid"),                          // for reveal / reveal_reminder
  subscriptionId: text("subscription_id"),                   // for expiry_reminder
  eventType: text("event_type").notNull(),                   // reveal | reveal_reminder | expiry_reminder
  channel: text("channel").notNull(),                        // email | push
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index("sent_notif_user_idx").on(t.userIdentifier),
  byHatch: index("sent_notif_hatch_idx").on(t.hatchUuid),
  byUserChannelSent: index("sent_notif_throttle_idx").on(t.userIdentifier, t.channel, t.sentAt),
}));

/* ────────────────────────── siwe_sessions
 * Durable SIWE session store — replaces the in-memory Map so process restart
 * (and horizontal scaling behind a load balancer) doesn't drop everyone.
 *
 * The bearer token is the primary key. The verify endpoint INSERTs a row;
 * /siwe/me and requireSiwe look it up; /siwe/signout DELETEs it. Expired rows
 * are cleared by a tiny background sweep (TTL is enforced both via expiresAt
 * check on read AND by the sweep, defense in depth). */
export const siweSessions = pgTable("siwe_sessions", {
  token: text("token").primaryKey(),
  wallet: text("wallet").notNull(),               // lowercase 0x…
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
}, (t) => ({
  byWallet: index("siwe_sessions_wallet_idx").on(t.wallet),
  byExpiry: index("siwe_sessions_expiry_idx").on(t.expiresAt),
}));

/* ────────────────────────── siwe_nonces
 * Durable nonce store — also moved out of the in-memory Map so a verify after
 * a backend restart still works. Keyed by address; nonces expire after a
 * short window. */
export const siweNonces = pgTable("siwe_nonces", {
  address: text("address").primaryKey(),         // lowercase 0x…
  nonce: text("nonce").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────── push_subscriptions (Build 6 — Web Push)
 * Browser PushSubscription objects, one row per wallet+endpoint. The endpoint
 * is the unique identifier (different browsers/devices → multiple rows for one
 * wallet). user_agent stored only for triage. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  wallet: text("wallet").notNull(),                          // lowercase 0x…
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byWallet: index("push_subs_wallet_idx").on(t.wallet),
}));
