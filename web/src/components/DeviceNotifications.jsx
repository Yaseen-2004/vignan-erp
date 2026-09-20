import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Icon } from './Icon.jsx';
import { Badge, Button } from './ui.jsx';
import {
  currentSubscription,
  disable,
  enable,
  isSupported,
  permission,
  sendTest,
  unavailableReason,
} from '../lib/push.js';

/**
 * Switching on notifications that reach the phone or desktop.
 *
 * The one rule the browsers impose shapes this component: the permission prompt
 * may only appear in response to a real click. It cannot be asked for on page
 * load, and a prompt dismissed counts as a refusal the person then has to undo
 * in their browser settings — so this never asks on its own, explains what it
 * is for first, and asks only when the button is pressed.
 *
 * When it cannot work it says which of the reasons applies, because they need
 * different answers: an old browser, a page not on https, an iPhone that has
 * not added the portal to its Home Screen, or a permission refused earlier.
 */
export function DeviceNotifications({ compact = false }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, publicKey: null, enabled: false, devices: [] });
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.get('/communication/push/key');
      const here = await currentSubscription();

      // Holding a subscription is not the same as being subscribed. On a shared
      // device the previous user's subscription is still live in this browser,
      // and saying "you receive notifications" then would be wrong twice over:
      // this person would get none, and the previous one would go on receiving
      // the school's notifications on a device they have handed over. So the
      // endpoint has to match one the server lists as *ours*.
      const mine = (result.data?.devices || []).some((d) => d.endpoint === here?.endpoint);
      setSubscribed(Boolean(here) && mine);

      setState({ loading: false, ...result.data });
    } catch {
      setState({ loading: false, publicKey: null, enabled: false, devices: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const turnOn = async () => {
    setBusy(true);
    try {
      await enable(state.publicKey);
      toast.success('Notifications will now appear on this device');
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not switch on notifications');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disable();
      toast.info('Notifications switched off on this device');
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not switch off notifications');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const delivered = await sendTest();
      if (delivered) toast.success(`Sent to ${delivered} device${delivered === 1 ? '' : 's'}`);
      else toast.info('No device is switched on to receive it yet');
    } catch (e) {
      toast.error(e.message || 'Could not send the test');
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) return null;
  // Push is not configured on this server — offering it would only fail.
  if (!state.enabled) return null;

  const blocked = unavailableReason();

  /* ----------------------------------------------- the nudge in the bell */
  if (compact) {
    if (subscribed || dismissed || blocked) return null;
    return (
      <div className="push-nudge">
        <Icon name="bell" size={15} />
        <div>
          <strong>Get these on your device</strong>
          <p>Be told about attendance, marks and fees without opening the portal.</p>
        </div>
        <div className="push-nudge-actions">
          <Button size="sm" variant="primary" loading={busy} onClick={turnOn}>Turn on</Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Not now</Button>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------- the full control */
  return (
    <div className="push-panel">
      <div className="push-state">
        <span className={`push-lamp ${subscribed ? 'on' : ''}`}>
          <Icon name={subscribed ? 'check-circle' : 'bell'} size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <strong>
            {subscribed ? 'This device receives notifications' : 'This device does not receive notifications'}
          </strong>
          <p className="text-muted text-sm">
            {subscribed
              ? 'Attendance, marks, fees and messages appear even when the portal is closed.'
              : 'Switch on to be told about attendance, marks, fees and messages without opening the portal.'}
          </p>
        </div>
        <div className="row row-wrap" style={{ marginLeft: 'auto' }}>
          {subscribed ? (
            <>
              <Button variant="secondary" loading={busy} onClick={test}>Send a test</Button>
              <Button variant="ghost" loading={busy} onClick={turnOff}>Switch off</Button>
            </>
          ) : (
            <Button variant="primary" icon="bell" loading={busy} disabled={Boolean(blocked)} onClick={turnOn}>
              Turn on for this device
            </Button>
          )}
        </div>
      </div>

      {blocked && !subscribed && (
        <div className="rule-note">
          <Icon name="alert-circle" size={14} />
          <span>{blocked}</span>
        </div>
      )}

      {state.devices?.length > 0 && (
        <div className="push-devices">
          <div className="push-devices-head">
            Switched on for {state.devices.length} device{state.devices.length === 1 ? '' : 's'}
          </div>
          {state.devices.map((device) => (
            <div className="push-device" key={device.id}>
              <Icon name={/mobile|android|iphone|ipad/i.test(device.user_agent || '') ? 'smartphone' : 'monitor'} size={14} />
              <span className="what">{describeDevice(device.user_agent)}</span>
              <span className="when text-subtle text-xs">
                {device.last_used_at ? `last used ${device.last_used_at.slice(0, 10)}` : 'not used yet'}
              </span>
            </div>
          ))}
        </div>
      )}

      {permission() === 'denied' && (
        <p className="text-xs text-subtle">
          Blocked in this browser. Allow notifications for this site in its settings, then reload.
        </p>
      )}
    </div>
  );
}

/** A user-agent string is not something to show a parent; name the browser. */
function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari'
            : 'Browser';
  const platform = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone or iPad'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'Mac'
          : /Linux/.test(ua) ? 'Linux'
            : '';
  return platform ? `${browser} on ${platform}` : browser;
}

export default DeviceNotifications;
