/* Hatch service worker — minimal. Handles Web Push payloads and notification clicks. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { /* non-JSON */ }
  const title = payload.title || "Hatch";
  const body  = payload.body  || "A hatch you can read just revealed.";
  const url   = payload.url   || "/";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "/favicon.svg", badge: "/favicon.svg", data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) if ("focus" in c) { await c.focus(); return c.navigate(url); }
    await self.clients.openWindow(url);
  })());
});
