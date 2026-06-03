import { Worker, Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { eq, and, gt, sql, count } from "drizzle-orm";
import webpush from "web-push";
import { db, schema } from "./db/client.js";
import { loadEnv } from "./env.js";

loadEnv();

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:55379";
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM ?? "Hatch <onboarding@resend.dev>";
const HATCH_PUBLIC_URL = (process.env.HATCH_PUBLIC_URL ?? "https://hatch.usehatch.xyz").replace(/\/+$/, "");

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:notifications@usehatch.xyz",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export const reminderQueue = new Queue("hatch-reminders", { connection });

interface NotifyJobData {
  uuid: number;
  publisherRootIp: string;
}
interface RevealReminderData {
  uuid: number;
  publisherRootIp: string;
  kind: "reveal_reminder" | "expiry_reminder";
  subscriptionId?: string;
}

const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // brief: max 1 per channel per user per hour

/** Resolve recipients: union of (active subscribers) + (followers).
 *  Returns lowercase wallet addresses. */
async function recipientsFor(publisherRootIp: string): Promise<Set<string>> {
  const now = new Date();
  const subs = await db.select({ w: schema.subscriptions.subscriberWallet })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.publisherRootIp, publisherRootIp), gt(schema.subscriptions.expiresAt, now)));
  const flw = await db.select({ w: schema.follows.followerWallet })
    .from(schema.follows)
    .where(eq(schema.follows.publisherRootIp, publisherRootIp));
  const out = new Set<string>();
  for (const r of [...subs, ...flw]) if (r.w) out.add(r.w.toLowerCase());
  return out;
}

/** Has the user received this channel within the throttle window? */
async function throttled(userIdentifier: string, channel: "email" | "push"): Promise<boolean> {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS);
  const [{ c }] = await db.select({ c: count() })
    .from(schema.sentNotifications)
    .where(and(
      eq(schema.sentNotifications.userIdentifier, userIdentifier),
      eq(schema.sentNotifications.channel, channel),
      gt(schema.sentNotifications.sentAt, since),
    ));
  return Number(c) > 0;
}

/** Best-effort wallet→email lookup. The publishers table has payoutAddress but
 *  no email; for v1 the only mapping we have is via the wallet itself (i.e. the
 *  user has set their email out-of-band). Frontend Build 8 will expose
 *  POST /me/email. For the integration test we read TEST_USER_EMAILS env:
 *  "0xaddr=user@example.com,0xaddr=user2@..." */
function emailForWallet(wallet: string): string | null {
  const csv = process.env.TEST_USER_EMAILS;
  if (!csv) return null;
  for (const part of csv.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, e] = part.split("=");
    if (a?.toLowerCase() === wallet.toLowerCase()) return e;
  }
  return null;
}

async function sendEmailViaResend(to: string, subject: string, html: string): Promise<{ id?: string; error?: string }> {
  if (!RESEND_API_KEY) return { error: "RESEND_API_KEY unset" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: `${res.status} ${JSON.stringify(body).slice(0, 200)}` };
  return { id: (body as { id?: string }).id };
}

async function sendPushTo(wallet: string, payload: { title: string; body: string; url: string }): Promise<{ delivered: number; failed: number }> {
  const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.wallet, wallet));
  let delivered = 0, failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      delivered++;
    } catch (e) {
      failed++;
      // GCM/FCM 410 means endpoint dead — drop it
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, s.endpoint));
      }
    }
  }
  return { delivered, failed };
}

/** Insert sent_notifications row idempotently. Returns true if WE wrote the row
 *  (i.e. the work to send was ours to do); false if a parallel worker beat us. */
async function claimSend(
  userIdentifier: string, hatchUuid: number | null, subscriptionId: string | null,
  eventType: "reveal" | "reveal_reminder" | "expiry_reminder", channel: "email" | "push",
): Promise<boolean> {
  const subject = hatchUuid !== null ? `h${hatchUuid}` : `s${subscriptionId}`;
  const id = `${userIdentifier}|${eventType}|${channel}|${subject}`;
  const rows = await db.insert(schema.sentNotifications)
    .values({ id, userIdentifier, hatchUuid, subscriptionId, eventType, channel })
    .onConflictDoNothing().returning({ id: schema.sentNotifications.id });
  return rows.length > 0;
}

async function processNotify(job: Job<NotifyJobData>): Promise<{ emailed: number; pushed: number; skipped: number }> {
  const { uuid, publisherRootIp } = job.data;

  const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
  if (!h) throw new Error(`notify: hatch ${uuid} not in DB`);
  const [pub] = await db.select({ displayName: schema.publishers.displayName }).from(schema.publishers).where(eq(schema.publishers.publisherRootIp, publisherRootIp));
  const publisherLabel = pub?.displayName?.trim() || `${publisherRootIp.slice(0, 6)}…${publisherRootIp.slice(-4)}`;

  const recipients = await recipientsFor(publisherRootIp);
  let emailed = 0, pushed = 0, skipped = 0;

  const subject = `${publisherLabel} just revealed a hatch you can read`;
  const url = `${HATCH_PUBLIC_URL}/h/${uuid}`;
  const html = `<p>${publisherLabel} just revealed a hatch you can read.</p><p><a href="${url}">Open hatch →</a></p>`;

  for (const wallet of recipients) {
    // EMAIL
    const email = emailForWallet(wallet);
    if (email) {
      if (await throttled(wallet, "email")) { skipped++; }
      else if (await claimSend(wallet, uuid, null, "reveal", "email")) {
        const r = await sendEmailViaResend(email, subject, html);
        if (r.error) {
          console.error(`[notify] email to ${email} failed: ${r.error}`);
          // best-effort: delete the claim so a retry can happen
          await db.delete(schema.sentNotifications).where(eq(schema.sentNotifications.id, `${wallet}|reveal|email|h${uuid}`));
        } else { emailed++; }
      } else { skipped++; }
    }

    // PUSH
    if (await throttled(wallet, "push")) { skipped++; }
    else if (await claimSend(wallet, uuid, null, "reveal", "push")) {
      const r = await sendPushTo(wallet, { title: subject, body: "Open in Hatch to read", url });
      if (r.delivered) pushed += r.delivered;
      else if (r.failed) {
        await db.delete(schema.sentNotifications).where(eq(schema.sentNotifications.id, `${wallet}|reveal|push|h${uuid}`));
      }
    } else { skipped++; }
  }

  return { emailed, pushed, skipped };
}

async function processReminder(job: Job<RevealReminderData>): Promise<{ emailed: number; pushed: number; skipped: number }> {
  if (job.data.kind === "reveal_reminder") {
    const { uuid, publisherRootIp } = job.data;
    const [h] = await db.select().from(schema.hatches).where(eq(schema.hatches.uuid, uuid));
    if (!h) return { emailed: 0, pushed: 0, skipped: 0 };
    const recipients = await recipientsFor(publisherRootIp);
    const [pub] = await db.select({ displayName: schema.publishers.displayName }).from(schema.publishers).where(eq(schema.publishers.publisherRootIp, publisherRootIp));
    const label = pub?.displayName?.trim() || `${publisherRootIp.slice(0, 6)}…${publisherRootIp.slice(-4)}`;
    const subject = `${label}: hatch revealing in ~1 hour`;
    const url = `${HATCH_PUBLIC_URL}/h/${uuid}`;
    const html = `<p>${label} has a hatch revealing in ~1 hour.</p><p><a href="${url}">Get ready →</a></p>`;
    let emailed = 0, pushed = 0, skipped = 0;
    for (const wallet of recipients) {
      const email = emailForWallet(wallet);
      if (email && !(await throttled(wallet, "email")) && await claimSend(wallet, uuid, null, "reveal_reminder", "email")) {
        const r = await sendEmailViaResend(email, subject, html);
        if (!r.error) emailed++;
        else await db.delete(schema.sentNotifications).where(eq(schema.sentNotifications.id, `${wallet}|reveal_reminder|email|h${uuid}`));
      } else { skipped++; }
      if (!(await throttled(wallet, "push")) && await claimSend(wallet, uuid, null, "reveal_reminder", "push")) {
        const r = await sendPushTo(wallet, { title: subject, body: "Pre-reveal reminder", url });
        if (r.delivered) pushed += r.delivered;
      } else { skipped++; }
    }
    return { emailed, pushed, skipped };
  }
  // expiry_reminder
  const { subscriptionId } = job.data;
  if (!subscriptionId) return { emailed: 0, pushed: 0, skipped: 0 };
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, subscriptionId));
  if (!sub) return { emailed: 0, pushed: 0, skipped: 0 };
  const wallet = sub.subscriberWallet.toLowerCase();
  const subject = "Your Hatch pass expires in 24 hours";
  const html = `<p>Your Hatch subscription pass expires at ${sub.expiresAt.toISOString()}.</p><p><a href="${HATCH_PUBLIC_URL}">Renew →</a></p>`;
  const email = emailForWallet(wallet);
  let emailed = 0, pushed = 0;
  if (email && await claimSend(wallet, null, subscriptionId, "expiry_reminder", "email")) {
    const r = await sendEmailViaResend(email, subject, html);
    if (!r.error) emailed++;
  }
  if (await claimSend(wallet, null, subscriptionId, "expiry_reminder", "push")) {
    const r = await sendPushTo(wallet, { title: subject, body: "Renew before it lapses", url: HATCH_PUBLIC_URL });
    if (r.delivered) pushed += r.delivered;
  }
  return { emailed, pushed, skipped: 0 };
}

/** Boot the notify worker. Listens on both queues with one process. */
export function startNotifyWorker(): { distribute: Worker; reminders: Worker } {
  const distribute = new Worker<NotifyJobData>(
    "hatch-distribute",
    async (job) => {
      if (job.name !== "notify") return;
      return await processNotify(job);
    },
    { connection, concurrency: 4 },
  );
  const reminders = new Worker<RevealReminderData>(
    "hatch-reminders",
    async (job) => await processReminder(job),
    { connection, concurrency: 4 },
  );
  for (const w of [distribute, reminders]) {
    w.on("failed", (job, err) => console.error(`[notify] ${w.name}/${job?.name} failed: ${err?.message}`));
    w.on("completed", (job, ret) => {
      if (w.name === "hatch-distribute" && job.name !== "notify") return;
      console.log(`[notify] ${w.name}/${job.name} → ${JSON.stringify(ret)?.slice(0, 120)}`);
    });
  }
  return { distribute, reminders };
}

/** Hook into reveal scheduling: enqueue the reveal_reminder 1h before revealAt.
 *  Called by reveal.ts when a hatch is first scheduled. */
export async function enqueueRevealReminder(uuid: number, publisherRootIp: string, revealAtMs: number): Promise<void> {
  const delay = Math.max(0, revealAtMs - 60 * 60 * 1000 - Date.now());
  if (delay === 0) return; // reveal is already within 1h; skip the reminder
  await reminderQueue.add(
    "reminder",
    { uuid, publisherRootIp, kind: "reveal_reminder" },
    { jobId: `revremind-${uuid}`, delay, attempts: 3, removeOnComplete: { count: 100 } },
  );
}

/** Hook for expiry reminders: 24h before pass expires. Called when a
 *  subscription is created or renewed. */
export async function enqueueExpiryReminder(subscriptionId: string, expiresAtMs: number): Promise<void> {
  const delay = Math.max(0, expiresAtMs - 24 * 60 * 60 * 1000 - Date.now());
  if (delay === 0) return;
  await reminderQueue.add(
    "reminder",
    { uuid: 0, publisherRootIp: "", kind: "expiry_reminder", subscriptionId },
    { jobId: `expremind-${subscriptionId}`, delay, attempts: 3, removeOnComplete: { count: 100 } },
  );
}
