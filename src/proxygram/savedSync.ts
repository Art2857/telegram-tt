import { getGlobal } from '../global';

import type { ApiUpdate } from '../api/types';

import { selectChat, selectChatMessages } from '../global/selectors';
import { fetchSavedById, fetchSavedHistory } from '../api/proxy/saved';

/** New messages arrive from the newest page; already loaded older messages are checked by ID */
const SYNC_LIMIT = 100;

/**
 * Saved Messages changed on another device of the guest (`saved.changed`): new, edited, pinned and deleted messages
 * come here as the usual updates. Local messages still being sent keep their fractional IDs
 */
export async function syncSavedMessages(apiUpdate: (update: ApiUpdate) => void, onFirstMessage: () => void) {
  const global = getGlobal();
  const chatId = global.currentUserId;
  const chat = chatId ? selectChat(global, chatId) : undefined;
  if (!chatId || !chat?.pxgProxy) return;
  const { messages } = await fetchSavedHistory(chat, undefined, 0, SYNC_LIMIT);
  const known = selectChatMessages(getGlobal(), chatId) || {};
  const oldest = messages.length === SYNC_LIMIT ? Math.min(...messages.map(({ id }) => id)) : 0;
  const olderIds = Object.keys(known).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id < oldest);
  messages.push(...await fetchSavedById(chat, olderIds));
  if (getGlobal().currentUserId !== chatId) return;
  const fetched = new Set(messages.map(({ id }) => id));
  messages.forEach((message) => {
    apiUpdate(known[message.id]
      ? { '@type': 'updateMessage', chatId, id: message.id, message, isFull: true }
      : { '@type': 'newMessage', chatId, id: message.id, message });
  });
  const deleted = Object.keys(known).map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && !fetched.has(id));
  if (deleted.length) apiUpdate({ '@type': 'deleteMessages', chatId, ids: deleted });
  // The first message puts Saved Messages into the chat list
  if (messages.length && !Object.keys(known).length) onFirstMessage();
}
