import { getGlobal } from '../global';

import type { ApiUpdate } from '../api/types';

import { selectChat, selectChatMessages } from '../global/selectors';
import { fetchSavedHistory } from '../api/proxy/saved';

/** Saved Messages are few; the newest page is what another device could have changed */
const SYNC_LIMIT = 100;

/**
 * Saved Messages changed on another device of the guest (`saved.changed`): new, edited, pinned and deleted messages
 * of the newest page come here as the usual updates. Local messages still being sent keep their fractional IDs
 */
export async function syncSavedMessages(apiUpdate: (update: ApiUpdate) => void, onFirstMessage: () => void) {
  const global = getGlobal();
  const chatId = global.currentUserId;
  const chat = chatId ? selectChat(global, chatId) : undefined;
  if (!chatId || !chat?.pxgProxy) return;
  const { messages } = await fetchSavedHistory(chat, undefined, 0, SYNC_LIMIT);
  const known = selectChatMessages(getGlobal(), chatId) || {};
  const fetched = new Set(messages.map(({ id }) => id));
  messages.forEach((message) => {
    apiUpdate(known[message.id]
      ? { '@type': 'updateMessage', chatId, id: message.id, message, isFull: true }
      : { '@type': 'newMessage', chatId, id: message.id, message });
  });
  const oldest = messages.length === SYNC_LIMIT ? Math.min(...fetched) : 0;
  const deleted = Object.keys(known).map(Number)
    .filter((id) => Number.isInteger(id) && id >= oldest && !fetched.has(id));
  if (deleted.length) apiUpdate({ '@type': 'deleteMessages', chatId, ids: deleted });
  // The first message puts Saved Messages into the chat list
  if (messages.length && !Object.keys(known).length) onFirstMessage();
}
