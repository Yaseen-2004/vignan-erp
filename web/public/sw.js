/**
 * Service worker — the part that runs when the portal is not open.
 *
 * A page can only show a notification while it exists. This does not: the
 * browser keeps it alive on its own, hands it each push as it arrives, and it
 * shows the notification whether the portal is open, in a background tab, or
 * closed entirely. That is what makes an absence mark reach a parent's phone
 * rather than waiting in a tab nobody is looking at.
 *
 * It deliberately does nothing else. No caching, no offline handling, no
 * interception of requests — an ERP showing a stale roll or a stale fee balance
 * would be worse than showing nothing, so every request goes to the network as
 * it always did.
 */

// Take over as soon as installed rather than waiting for every tab to close;
// otherwise a person who has just switched notifications on would not receive
// any until they had shut the portal down completely.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Vignan ERP', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Vignan ERP';
  const options = {
    body: payload.body || '',
    // Same subject replaces rather than stacks: five attendance marks should
    // be one line on the lock screen, not five.
    tag: payload.tag || 'vignan',
    renotify: Boolean(payload.tag),
    data: { link: payload.link || '/' },
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    // A school notification is worth a glance, not a demand: no requireInteraction.
    timestamp: Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Tapping the notification opens the page it refers to.
 *
 * If the portal is already open somewhere, that window is focused and moved,
 * rather than opening a second copy — a parent tapping three notifications
 * should not end with three tabs.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const sameOrigin = new URL(client.url).origin === self.location.origin;
      if (sameOrigin && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try { await client.navigate(link); } catch { /* a focused window is enough */ }
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(link);
  })());
});

/** Keep the server's record tidy when a push service rotates a subscription. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const subscription = await self.registration.pushManager.subscribe(
        event.oldSubscription?.options || { userVisibleOnly: true }
      );
      await fetch('/api/communication/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(subscription),
      });
    } catch {
      // The portal asks again next time it is opened.
    }
  })());
});
