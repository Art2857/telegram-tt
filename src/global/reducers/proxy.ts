import type { GlobalState } from '../types';
import { PROXY_FOLDER_ID } from '../../api/proxy/types';

import { ALL_FOLDER_ID } from '../../config';
import { isProxyPeerId } from '../../api/proxy/ids';

/** Cached proxy data is discarded until the server revalidates the current accesses */
export function clearProxyChats<T extends GlobalState>(global: T): T {
  const chats = Object.fromEntries(Object.entries(global.chats.byId).filter(([id]) => !isProxyPeerId(id)));
  const keepId = (id: string) => !isProxyPeerId(id);
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
      fullInfoById: Object.fromEntries(Object.entries(global.chats.fullInfoById).filter(([id]) => keepId(id))),
      lastMessageIds: {
        ...global.chats.lastMessageIds,
        all: Object.fromEntries(Object.entries(global.chats.lastMessageIds.all || {}).filter(([id]) => keepId(id))),
      },
    },
    users: {
      ...global.users,
      byId: Object.fromEntries(Object.entries(global.users.byId).filter(([id]) => (
        keepId(id) || id === global.currentUserId
      ))),
    },
    messages: {
      ...global.messages,
      byChatId: Object.fromEntries(Object.entries(global.messages.byChatId).filter(([id]) => keepId(id))),
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
