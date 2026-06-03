/** Web Push opt-in flow:
 *  1. register the service worker
 *  2. request notification permission
 *  3. subscribe with the backend's VAPID public key
 *  4. POST the subscription JSON to /push/subscribe
 *
 *  Auth: reads the Bearer token from the SIWE module mirror. Caller must
 *  ensure the user has signed in first. */
import { api } from "./api.js";
import { config } from "./lib/config.js";
import { getSiweToken } from "./lib/siwe.js";

const VAPID_PUBLIC_KEY: string = config.vapidPublicKey;

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

function urlBase64ToBuffer(b64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

export async function enablePush(): Promise<{ ok: true; endpoint: string } | { ok: false; reason: string }> {
  if (!pushSupported()) return { ok: false, reason: "Push not supported in this browser" };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: "VITE_VAPID_PUBLIC_KEY not set in frontend env" };
  const token = getSiweToken();
  if (!token) return { ok: false, reason: "Sign in first" };

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: `Permission ${perm}` };

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
    });
  }
  await api.pushSubscribe(sub.toJSON() as PushSubscriptionJSON, token);
  return { ok: true, endpoint: sub.endpoint };
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const token = getSiweToken();
  if (!token) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint, token);
    await sub.unsubscribe();
  }
}
