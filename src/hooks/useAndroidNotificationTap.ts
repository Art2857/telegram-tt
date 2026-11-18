import { useEffect } from '../lib/teact/teact';
import { getActions, getGlobal } from '../global';

import { PxgError } from '../proxygram/server/types';

import { selectChat } from '../global/selectors';
import { ACCOUNT_SLOT, getAccountSlotUrl, loadSlotSession } from '../util/multiaccount';
import { getProxyPeerId } from '../api/proxy';
import {
  ANDROID_NOTIFICATION_EVENT, getAndroidNotifications, parseAndroidTap,
} from '../proxygram/androidNotifications';
import { pxgRpc } from '../proxygram/server/rpc';
import { getPxgState, readStoredSession } from '../proxygram/server/store';

const CHAT_LIST_WAIT_MS = 750;
const CHAT_LIST_MAX_ATTEMPTS = 20;
const CONNECTION_RETRY_MS = 2000;

export default function useAndroidNotificationTap(currentUserId: string | undefined, isOnline: boolean) {
  useEffect(() => {
    const bridge = getAndroidNotifications();
    if (!bridge || !currentUserId) return undefined;
    let isActive = true;
    let isChecking = false;
    let timer: number | undefined;
    let attempts = 0;
    let lastReceipt: string | undefined;
    const { focusMessage, loadProxyChats, openChat, openThread, showNotification } = getActions();

    const navigate = async () => {
      if (!isActive || isChecking || getGlobal().passcode.isScreenLocked) return;
      const raw = bridge.peekTap();
      const tap = parseAndroidTap(raw);
      if (!tap) return;
      if (lastReceipt !== tap.receipt) {
        lastReceipt = tap.receipt;
        attempts = 0;
      }
      if (tap.slot !== (ACCOUNT_SLOT || 1)) {
        const hasSlot = 'pxgUserId' in tap ? readStoredSession(tap.slot)?.user.id === tap.pxgUserId
          : String(loadSlotSession(tap.slot)?.userId) === tap.ownerId;
        if (hasSlot) window.location.replace(getAccountSlotUrl(tap.slot));
        else bridge.consumeTap(tap.receipt);
        return;
      }
      if ('pxgUserId' in tap ? getPxgState().session?.user.id !== tap.pxgUserId : currentUserId !== tap.ownerId) {
        bridge.consumeTap(tap.receipt);
        return;
      }

      if ('accountId' in tap && !isOnline) return;
      const chatId = 'accountId' in tap ? getProxyPeerId(tap.accountId, tap.peerId) : tap.chatId;
      if (!selectChat(getGlobal(), chatId)) {
        attempts += 1;
        if (attempts === 1 && 'accountId' in tap) loadProxyChats();
        if (attempts > CHAT_LIST_MAX_ATTEMPTS) {
          bridge.consumeTap(tap.receipt);
          showNotification({ message: { key: 'ErrorFocusInaccessibleMessage' } });
          return;
        }
        window.clearTimeout(timer);
        timer = window.setTimeout(check, CHAT_LIST_WAIT_MS);
        return;
      }
      isChecking = true;
      try {
        let shouldFocus = true;
        if ('accountId' in tap) {
          // A cached chat can outlive a grant. The server checks the selected topic and message before navigation.
          const { messages } = await pxgRpc.call<{ messages: unknown[] }>('messages.window', {
            accountId: tap.accountId, peerId: tap.peerId, topicId: tap.threadId, msgIds: [tap.messageId], limit: 1,
          });
          shouldFocus = messages.length > 0;
        }
        if (!isActive || raw !== bridge.peekTap() || getGlobal().currentUserId !== currentUserId) return;
        bridge.consumeTap(tap.receipt);
        if (shouldFocus) {
          focusMessage({ chatId, threadId: tap.threadId, messageId: tap.messageId, shouldReplaceHistory: true });
        } else if (tap.threadId) {
          openThread({ chatId, threadId: tap.threadId, shouldReplaceHistory: true });
        } else {
          openChat({ id: chatId, shouldReplaceHistory: true });
        }
      } catch (err) {
        if (!isActive || raw !== bridge.peekTap()) return;
        if (err instanceof PxgError && (err.code === 'forbidden' || err.code === 'not_found')) {
          bridge.consumeTap(tap.receipt);
          showNotification({ message: { key: 'ErrorFocusInaccessibleMessage' } });
        } else {
          window.clearTimeout(timer);
          timer = window.setTimeout(check, CONNECTION_RETRY_MS);
        }
      } finally {
        isChecking = false;
        const next = bridge.peekTap();
        if (isActive && next && next !== raw) check();
      }
    };

    function check() {
      void navigate();
    }

    window.addEventListener(ANDROID_NOTIFICATION_EVENT, check);
    check();
    return () => {
      isActive = false;
      window.clearTimeout(timer);
      window.removeEventListener(ANDROID_NOTIFICATION_EVENT, check);
    };
  }, [currentUserId, isOnline]);
}
