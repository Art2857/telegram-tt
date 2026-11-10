import type { ApiChatFolder } from '../../api/types';
import type { GlobalState } from '../types';
import { isLocalFolderId, PROXY_FOLDER_ID } from '../../api/proxy/types';

import { ALL_FOLDER_ID } from '../../config';
import { isProxyPeerId } from '../../api/proxy/ids';

type LocalFolderKind = 'accesses' | 'owner' | 'folder';

type LocalGroup = {
  key: string;
  kind: LocalFolderKind;
  ownerName?: string;
  /** Название по умолчанию: исходное название расшаренной папки; для owner/accesses подпись даёт интерфейс */
  originalTitle: string;
  chatIds: string[];
};

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
      pxgLocalFolders: undefined,
    },
  };
}

/**
 * Локальные вкладки доступов: «Открыто мне» у полного входа, папка владельца для чатов вне расшаренных папок
 * и отдельная вкладка для каждой расшаренной папки. Название, порядок и скрытие хранятся на сервере и
 * применяются здесь; сами папки живут только в клиенте и никогда не уходят в Telegram.
 */
export function updateProxyFolder<T extends GlobalState>(global: T): T {
  const isGuest = Boolean(global.currentUserId && isProxyPeerId(global.currentUserId));
  const chats = Object.values(global.chats.byId).filter((chat) => chat.pxgProxy && chat.isListed);
  const owners = new Map<string, { name: string; chatIds: string[] }>();
  const groups = new Map<string, LocalGroup>();
  const folderChatIds = new Set<string>();

  chats.forEach(({ id, pxgProxy }) => {
    const proxy = pxgProxy!;
    const owner = owners.get(proxy.accountId);
    if (owner) owner.chatIds.push(id);
    else owners.set(proxy.accountId, { name: proxy.providerName ?? '', chatIds: [id] });

    (proxy.sharedFolders ?? []).forEach((folder) => {
      const key = `folder:${proxy.accountId}:${folder.id}`;
      const group = groups.get(key) ?? {
        key,
        kind: 'folder' as const,
        ownerName: proxy.providerName ?? undefined,
        originalTitle: folder.title ?? '',
        chatIds: [],
      };
      if (!group.chatIds.includes(id)) group.chatIds.push(id);
      folderChatIds.add(id);
      groups.set(key, group);
    });
  });

  // Папка владельца — только чаты, не попавшие в расшаренную папку: у каждого чата один источник
  const ownerGroups: LocalGroup[] = [...owners.entries()]
    .filter(([, owner]) => owner.name)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([accountId, owner]) => ({
      key: `owner:${accountId}`,
      kind: 'owner' as const,
      ownerName: owner.name,
      originalTitle: owner.name,
      chatIds: owner.chatIds.filter((id) => !folderChatIds.has(id)),
    }))
    .filter((group) => group.chatIds.length > 0);
  // A guest's whole list is shared already: the accesses tab would repeat "All"
  const accessesGroup: LocalGroup[] = isGuest || !chats.length ? [] : [{
    key: 'accesses',
    kind: 'accesses',
    originalTitle: '',
    chatIds: chats.map((chat) => chat.id),
  }];

  const allGroups = [...accessesGroup, ...ownerGroups, ...groups.values()];
  if (!allGroups.length) {
    const hadLocal = Object.keys(global.chatFolders.byId).some((id) => isLocalFolderId(Number(id)))
      || Boolean(global.chatFolders.pxgLocalFolders?.length);
    if (!hadLocal) {
      return {
        ...global,
        chatFolders: { ...global.chatFolders, pxgLocalFolders: [] },
      };
    }
    return {
      ...global,
      chatFolders: {
        ...global.chatFolders,
        byId: Object.fromEntries(
          Object.entries(global.chatFolders.byId).filter(([id]) => !isLocalFolderId(Number(id))),
        ),
        orderedIds: global.chatFolders.orderedIds?.filter((id) => !isLocalFolderId(id)),
        pxgLocalFolders: [],
      },
    };
  }

  const prefs = global.chatFolders.pxgPrefs ?? {};
  const defaultRank = (group: LocalGroup) => (group.kind === 'accesses' ? 0 : group.kind === 'owner' ? 1 : 2);
  const sorted = [...allGroups].sort((a, b) => {
    const aPosition = prefs[a.key]?.position;
    const bPosition = prefs[b.key]?.position;
    if (aPosition !== undefined && bPosition !== undefined) return aPosition - bPosition;
    if (aPosition !== undefined) return -1;
    if (bPosition !== undefined) return 1;
    return defaultRank(a) - defaultRank(b)
      || (a.originalTitle || a.ownerName || '').localeCompare(b.originalTitle || b.ownerName || '', 'ru')
      || a.key.localeCompare(b.key);
  });

  const usedIds = new Set<number>([-1, PROXY_FOLDER_ID]);
  const folderIdOf = (key: string) => {
    if (key === 'accesses') return PROXY_FOLDER_ID;
    let id = -(3 + (hashKey(key) % 1_000_000_000));
    while (usedIds.has(id)) id--;
    usedIds.add(id);
    return id;
  };

  const localFolders: ApiChatFolder[] = sorted.map((group) => {
    const customTitle = prefs[group.key]?.title?.trim();
    const title = customTitle || (group.kind === 'folder' ? group.originalTitle : '');
    return {
      id: folderIdOf(group.key),
      title: { text: title },
      includedChatIds: group.chatIds,
      excludedChatIds: [],
      pxgLocal: true,
      pxgLocalKey: group.key,
      pxgLocalKind: group.kind,
      pxgOriginalTitle: group.originalTitle || undefined,
      pxgOwnerName: group.ownerName,
      pxgSharedBy: group.ownerName,
      pxgCustomTitle: customTitle ? true : undefined,
      pxgLocalHidden: prefs[group.key]?.hidden ? true : undefined,
    };
  });
  const visibleFolders = localFolders.filter((folder) => !folder.pxgLocalHidden);

  const serverFolders = Object.values(global.chatFolders.byId).filter((folder) => !folder.pxgLocal);
  const serverIds = (global.chatFolders.orderedIds || [ALL_FOLDER_ID]).filter((id) => !isLocalFolderId(id));
  return {
    ...global,
    chatFolders: {
      ...global.chatFolders,
      byId: Object.fromEntries([...serverFolders, ...visibleFolders].map((folder) => [folder.id, folder])),
      orderedIds: [...serverIds, ...visibleFolders.map((folder) => folder.id)],
      pxgLocalFolders: localFolders,
    },
  };
}

/** Стабильный отрицательный ID вкладки из ключа: переименование и порядок не меняют ID */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
