import type { ApiChatFolder } from '../../api/types';
import type { GlobalState } from '../types';
import { isLocalFolderId, PROXY_FOLDER_ID } from '../../api/proxy/types';

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
      orderedIds: global.chatFolders.orderedIds?.filter((id) => !isLocalFolderId(id)),
    },
  };
}

/** PLAN.md 7.7: the accesses tab for a full sign-in and, with several owners, a tab per owner */
export function updateProxyFolder<T extends GlobalState>(global: T): T {
  const isGuest = Boolean(global.currentUserId && isProxyPeerId(global.currentUserId));
  const chats = Object.values(global.chats.byId).filter((chat) => chat.pxgProxy && chat.isListed);
  const owners = new Map<string, { name: string; chatIds: string[] }>();
  chats.forEach(({ id, pxgProxy }) => {
    const owner = owners.get(pxgProxy!.accountId);
    if (owner) owner.chatIds.push(id);
    else owners.set(pxgProxy!.accountId, { name: pxgProxy!.providerName ?? '', chatIds: [id] });
  });

  const localFolder = (id: number, chatIds: string[], ownerName?: string): ApiChatFolder => ({
    id,
    title: { text: ownerName ?? 'Proxygram' },
    includedChatIds: chatIds,
    excludedChatIds: [],
    pxgLocal: true,
    pxgOwnerName: ownerName,
  });
  const ownerFolders = owners.size > 1
    ? [...owners.values()]
      .filter((owner) => owner.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((owner, index) => localFolder(PROXY_FOLDER_ID - 1 - index, owner.chatIds, owner.name))
    : [];
  // A guest's whole list is shared already: the accesses tab would repeat "All"
  const accessesFolder = isGuest || !chats.length ? [] : [localFolder(PROXY_FOLDER_ID, chats.map((chat) => chat.id))];
  const folders = [...accessesFolder, ...ownerFolders];

  const serverFolders = Object.values(global.chatFolders.byId).filter((folder) => !folder.pxgLocal);
  const hadLocal = serverFolders.length !== Object.keys(global.chatFolders.byId).length;
  if (!folders.length && !hadLocal) return global;
  const serverIds = (global.chatFolders.orderedIds || [ALL_FOLDER_ID]).filter((id) => !isLocalFolderId(id));
  return {
    ...global,
    chatFolders: {
      ...global.chatFolders,
      byId: Object.fromEntries([...serverFolders, ...folders].map((folder) => [folder.id, folder])),
      orderedIds: [...serverIds, ...folders.map((folder) => folder.id)],
    },
  };
}
