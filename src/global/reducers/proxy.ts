import type { GlobalState } from '../types';
import { PROXY_FOLDER_ID } from '../../api/proxy/types';

import { ALL_FOLDER_ID } from '../../config';
import { isProxyPeerId } from '../../api/proxy/ids';

/**
 * Cached proxy data is discarded until the server revalidates the current accesses. `keptChatIds` are the chats
 * whose access did not change: their messages and topics stay, so the open feed does not start over
 */
export function clearProxyChats<T extends GlobalState>(global: T, keptChatIds?: ReadonlySet<string>): T {
  // Channels known only as authors of the kept messages are not accesses: they stay with those messages
  const chats = Object.fromEntries(Object.entries(global.chats.byId).filter(([id, chat]) => (
    !isProxyPeerId(id) || (keptChatIds?.size && !chat.pxgProxy)
  )));
  const keepId = (id: string) => !isProxyPeerId(id);
  const keepContentId = (id: string) => keepId(id) || Boolean(keptChatIds?.has(id));
  return {
    ...global,
    chats: {
      ...global.chats,
      byId: chats,
      listIds: {
        ...global.chats.listIds,
        active: global.chats.listIds.active?.filter(keepId),
        archived: global.chats.listIds.archived?.filter(keepId),
      },
      orderedPinnedIds: {
        ...global.chats.orderedPinnedIds,
        active: global.chats.orderedPinnedIds.active?.filter(keepId),
        archived: global.chats.orderedPinnedIds.archived?.filter(keepId),
      },
      fullInfoById: Object.fromEntries(Object.entries(global.chats.fullInfoById).filter(([id]) => keepId(id))),
      // A topic access may have narrowed: the forum panel reloads the topics it is allowed to see
      topicsInfoById: Object.fromEntries(Object.entries(global.chats.topicsInfoById).filter(([id]) => (
        keepContentId(id)
      ))),
      lastMessageIds: {
        ...global.chats.lastMessageIds,
        all: Object.fromEntries(Object.entries(global.chats.lastMessageIds.all || {}).filter(([id]) => keepId(id))),
      },
    },
    users: {
      ...global.users,
      // Authors of the kept messages are proxy users too, and they come back only with their messages
      byId: Object.fromEntries(Object.entries(global.users.byId).filter(([id]) => (
        keepId(id) || id === global.currentUserId || keptChatIds?.size
      ))),
    },
    messages: {
      ...global.messages,
      byChatId: Object.fromEntries(Object.entries(global.messages.byChatId).filter(([id]) => keepContentId(id))),
    },
    chatFolders: {
      ...global.chatFolders,
      byId: Object.fromEntries(Object.entries(global.chatFolders.byId).filter(([, folder]) => !folder.pxgLocal)),
      orderedIds: global.chatFolders.orderedIds?.filter((id) => id !== PROXY_FOLDER_ID),
    },
  };
}

export function updateProxyFolder<T extends GlobalState>(global: T): T {
  if (global.currentUserId && isProxyPeerId(global.currentUserId)) return global;
  const ids = Object.values(global.chats.byId).filter((chat) => chat.pxgProxy && chat.isListed).map((chat) => chat.id);
  if (!ids.length) return global;
  return {
    ...global,
    chatFolders: {
      ...global.chatFolders,
      byId: {
        ...global.chatFolders.byId,
        [PROXY_FOLDER_ID]: {
          id: PROXY_FOLDER_ID,
          title: { text: 'Proxygram' },
          includedChatIds: ids,
          excludedChatIds: [],
          pxgLocal: true,
        },
      },
      orderedIds: [
        ...(global.chatFolders.orderedIds || [ALL_FOLDER_ID]).filter((id) => id !== PROXY_FOLDER_ID), PROXY_FOLDER_ID,
      ],
    },
  };
}
