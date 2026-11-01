import { getAccountsInfo } from '../util/multiaccount';
import { pxgRpc } from './server/rpc';

/**
 * Web Push for guests: the server pushes new messages from shared chats while the client is closed.
 * A browser keeps a single push subscription per service worker, shared by every account slot. Telegram
 * sessions keep it for Telegram's own pushes, so a guest takes it over only when no slot has a Telegram session.
 */
export async function subscribePxgPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const { vapidPublicKey } = await pxgRpc.call<{ vapidPublicKey?: string }>('push.config');
  if (!vapidPublicKey) return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription || !hasServerKey(subscription, vapidPublicKey)) {
    if (Object.keys(getAccountsInfo()).length) return false;
    await subscription?.unsubscribe();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(vapidPublicKey),
    });
  }
  const { endpoint, keys } = subscription.toJSON();
  await pxgRpc.call('push.subscribe', { endpoint, keys });
  return true;
}

function hasServerKey(subscription: PushSubscription, vapidPublicKey: string) {
  const key = subscription.options.applicationServerKey;
  if (!key) return false;
  const expected = decodeBase64Url(vapidPublicKey);
  const actual = new Uint8Array(key);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}
