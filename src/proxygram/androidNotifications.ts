import { IS_TAURI } from '../util/browser/globalEnvironment';
import { IS_ANDROID } from '../util/browser/windowEnvironment';
import { ACCOUNT_SLOT } from '../util/multiaccount';

export type AndroidPeer = { accountId: string; peerId: number; pxgUserId: string };

type AndroidTarget = { slot: number; threadId?: number; allTopics?: boolean } & (
  AndroidPeer | { chatId: string; ownerId: string }
);

export type AndroidTap = AndroidTarget & { receipt: string; messageId: number };

type AndroidNotificationBridge = {
  show(raw: string): void;
  read(raw: string, maxId: number): void;
  setVisible(raw: string): void;
  peekTap(): string;
  consumeTap(receipt: string): void;
  ensureRunning(slot: number, userId: string, sessionId: string, endpoint: string, hidePreviews: boolean): boolean;
  configure(slot: number, raw: string): boolean;
  stop(slot: number): void;
};

export const ANDROID_NOTIFICATION_EVENT = 'pxg:android-notification';

export function getAndroidNotifications() {
  if (!IS_TAURI || !IS_ANDROID) return undefined;
  return (window as { PxgAndroidNotifications?: AndroidNotificationBridge }).PxgAndroidNotifications;
}

export function stopAndroidInbox(slot = ACCOUNT_SLOT || 1) {
  getAndroidNotifications()?.stop(slot);
}

export function androidTarget(chatId: string, ownerId: string, peer?: AndroidPeer, threadId?: number): AndroidTarget {
  return { ...(peer ?? { chatId, ownerId }), slot: ACCOUNT_SLOT || 1, threadId };
}

/** Android may start the app before the WebView or the account is ready. The Activity keeps the tap until consumed. */
export function parseAndroidTap(raw: string): AndroidTap | undefined {
  if (!raw || raw.length > 4096) return undefined;
  try {
    const target = JSON.parse(raw) as AndroidTap;
    if (!target || typeof target.receipt !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.receipt)
      || !Number.isInteger(target.slot) || target.slot < 1 || target.slot > 99
      || !Number.isSafeInteger(target.messageId) || target.messageId <= 0) return undefined;
    if ('accountId' in target) {
      if (typeof target.accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.accountId)
        || !Number.isSafeInteger(target.peerId) || target.peerId === 0 || typeof target.pxgUserId !== 'string') {
        return undefined;
      }
    } else if (typeof target.chatId !== 'string' || typeof target.ownerId !== 'string') {
      return undefined;
    }
    const threadId = Number.isSafeInteger(target.threadId) && target.threadId! > 0 ? target.threadId : undefined;
    return { ...target, threadId };
  } catch {
    return undefined;
  }
}
