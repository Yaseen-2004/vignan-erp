/**
 * Notifications that reach the device.
 *
 * The bell in the corner only tells someone what happened once they are already
 * looking at the portal. A parent needs to hear that their child was marked
 * absent while their phone is in their pocket, and a teacher needs to know a
 * sheet came back for correction without keeping a tab open. That is what web
 * push is for: the browser's own push service delivers the message and the
 * service worker shows it, whether or not the portal is open.
 *
 * How the pieces fit:
 *
 *   The VAPID pair is this server's identity to the push services. It is
 *   generated once with `npm run push:keys -w server` and kept in the
 *   environment. There is no account with anybody — the keys are the whole of
 *   the arrangement.
 *
 *   A subscription is per browser, not per person: the endpoint the push
 *   service issued, plus two keys belonging to that browser. The payload is
 *   encrypted for those keys, so the push service carries the message without
 *   being able to read it.
 *
 *   Subscriptions rot. A browser is reinstalled, permission withdrawn, an app
 *   deleted. The push service says so with 404 or 410, and the row is deleted
 *   the moment it does.
 *
 * Push never blocks the thing that caused it. If a notification cannot be
 * delivered to a device, the record is still written and the bell still shows
 * it — a failed push must not fail a marks approval.
 */
import webpush from 'web-push';
import { all, run } from '../db/connection.js';
import env from '../config/env.js';

export const pushConfigured = Boolean(env.vapidPublicKey && env.vapidPrivateKey);

if (pushConfigured) {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
}

/** The public key a browser needs in order to subscribe. */
export const publicKey = () => env.vapidPublicKey || null;

/**
 * Send one notification to every device a person has allowed.
 *
 * Returns how many devices took it. Never throws: the caller is in the middle
 * of doing something more important.
 */
export async function pushToUser(userId, payload) {
  if (!pushConfigured || !userId) return 0;

  let devices;
  try {
    devices = await all(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
  } catch {
    return 0;
  }
  if (!devices.length) return 0;

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body ?? '',
    link: payload.link ?? '/',
    type: payload.type ?? 'INFO',
    // Notifications about the same thing replace one another on the device
    // rather than stacking up: five attendance marks should not be five alerts.
    tag: payload.tag ?? `${payload.type ?? 'INFO'}:${payload.entityType ?? ''}${payload.entityId ?? ''}`,
  });

  let delivered = 0;
  await Promise.all(devices.map(async (device) => {
    const subscription = {
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    };
    try {
      await webpush.sendNotification(subscription, message, { TTL: 12 * 60 * 60 });
      delivered += 1;
      await run(
        `UPDATE push_subscriptions
            SET last_used_at = to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'), failures = 0
          WHERE id = ?`,
        [device.id]
      ).catch(() => {});
    } catch (error) {
      // 404/410 mean the push service has retired this endpoint for good.
      const gone = error?.statusCode === 404 || error?.statusCode === 410;
      try {
        if (gone) {
          await run('DELETE FROM push_subscriptions WHERE id = ?', [device.id]);
        } else {
          await run('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?', [device.id]);
        }
      } catch { /* the cleanup is not worth an error of its own */ }
    }
  }));

  return delivered;
}

/** Remember a browser's subscription, replacing any earlier one for it. */
export async function saveSubscription(userId, subscription, userAgent) {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;

  // The endpoint identifies the browser. Re-subscribing on the same browser —
  // or a second person signing in on a shared device — replaces the row rather
  // than adding one, so a notification never goes to whoever used it last.
  await run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent,
            failures = 0`,
    [userId, endpoint, p256dh, auth, (userAgent || '').slice(0, 250)]
  );
  return endpoint;
}

/** Forget one browser's subscription. */
export async function removeSubscription(userId, endpoint) {
  if (!endpoint) return 0;
  const result = await run(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    [endpoint, userId]
  );
  return result.changes;
}

/**
 * The devices a person currently has switched on.
 *
 * The endpoint is included because the browser needs it to answer a question
 * it cannot answer alone: "is the subscription I am holding registered to
 * *me*?" On a shared device — a family tablet, a staff-room machine — a
 * subscription left by the last person to sign in is still a live
 * subscription, and without this the portal would tell the new user they are
 * receiving notifications that are in fact going to someone else.
 *
 * It is the caller's own endpoint, which their browser already holds.
 */
export async function devicesFor(userId) {
  return all(
    `SELECT id, endpoint, user_agent, last_used_at, created_at
       FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
}
