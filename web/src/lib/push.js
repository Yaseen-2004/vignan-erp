/**
 * Turning device notifications on, from the browser's side.
 *
 * Three things have to line up, and any of them can be missing:
 *
 *   the browser must support service workers and push (Safari only since 16.4,
 *   and on iOS only once the portal has been added to the Home Screen);
 *   the page must be on HTTPS, or on localhost;
 *   the person must allow it, in a prompt only their own click may trigger.
 *
 * So every function here reports *why* something is unavailable rather than
 * failing quietly — "your browser does not support this" and "you blocked
 * notifications earlier" need different answers from the person reading.
 */
import { api } from '../api/client.js';

/** Push needs a secure context; localhost counts as one. */
export const isSecure = () =>
  typeof window !== 'undefined'
  && (window.isSecureContext || window.location.hostname === 'localhost');

export const isSupported = () =>
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

/** What is standing in the way, in words a person can act on. */
export function unavailableReason() {
  if (typeof window === 'undefined') return 'Not available here.';
  if (!isSupported()) {
    // iOS only offers push to a site added to the Home Screen.
    const iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    if (iOS) return 'On iPhone and iPad, add the portal to your Home Screen first — then notifications can be switched on.';
    return 'This browser cannot show device notifications. Chrome, Edge, Firefox and Safari 16.4 or later can.';
  }
  if (!isSecure()) return 'Device notifications need a secure (https) connection.';
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.';
  }
  return null;
}

export const permission = () => (isSupported() ? Notification.permission : 'unsupported');

/** The push service wants the key as bytes, not as the text we transport it in. */
function decodeKey(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = window.atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

let registration = null;

/** Register the worker that will show the notifications. */
export async function ready() {
  if (!isSupported() || !isSecure()) return null;
  if (registration) return registration;
  registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return registration;
}

/** Whether this browser already has a live subscription. */
export async function currentSubscription() {
  if (!isSupported() || !isSecure()) return null;
  try {
    const reg = await ready();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask permission, subscribe, and tell the server.
 *
 * Must be called from a real click: browsers refuse the prompt otherwise, and
 * one refused prompt counts as a denial the person then has to undo in settings.
 */
export async function enable(publicKey) {
  const reason = unavailableReason();
  if (reason) throw new Error(reason);
  if (!publicKey) throw new Error('Device notifications are not configured on this server.');

  const granted = await Notification.requestPermission();
  if (granted !== 'granted') {
    throw new Error('Notifications were not allowed. You can switch them on later from this page.');
  }

  const reg = await ready();
  const existing = await reg.pushManager.getSubscription();
  // A subscription made with a different key cannot be reused; drop it first.
  if (existing) await existing.unsubscribe().catch(() => {});

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true, // every push shows something — required, and honest
    applicationServerKey: decodeKey(publicKey),
  });

  await api.post('/communication/push/subscribe', subscription.toJSON());
  return subscription;
}

/** Stop notifications on this browser. */
export async function disable() {
  const subscription = await currentSubscription();
  if (!subscription) return false;
  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});
  try {
    await api.post('/communication/push/unsubscribe', { endpoint });
  } catch {
    // Unsubscribed locally either way; the server prunes dead endpoints itself.
  }
  return true;
}

/** Ask the server to send one, to prove the whole path works. */
export async function sendTest() {
  const result = await api.post('/communication/push/test');
  return result.data?.delivered ?? 0;
}
