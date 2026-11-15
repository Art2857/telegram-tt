import { type TeactNode, useMemo } from '../lib/teact/teact';
import { getActions, getGlobal } from '../global';

import type { MenuItemContextAction } from '../components/ui/ListItem';
import type { TabWithProperties } from '../components/ui/SquareTabList';
import {
  type ApiChatFolder,
  type ApiChatlistExportedInvite,
  type ApiMessageEntity,
  type ApiMessageEntityCustomEmoji,
  ApiMessageEntityTypes,
} from '../api/types';
import { SettingsScreens } from '../types';

import { ALL_FOLDER_ID } from '../config';
import { selectCanShareFolder, selectIsCurrentUserPremium } from '../global/selectors';
import { MEMO_EMPTY_ARRAY } from '../util/memo';
import { isProxyPeerId } from '../api/proxy/ids';
import { renderTextWithEntities } from '../components/common/helpers/renderTextWithEntities';
import { moveFolder } from '../proxygram/folderOrder';
import { canHideFolders, ownFolderKey, setFolderHidden } from '../proxygram/hiddenFolders';
import { getPxgState, setPxgState } from '../proxygram/server/store';
import { openSharedFolderEditor, prefsByKey, saveSharedFolder } from '../proxygram/sharedFolders';
import useSelector from './data/useSelector';
import useAppLayout from './useAppLayout';
import { useFolderManagerForUnreadChatsByFolder, useFolderManagerForUnreadCounters } from './useFolderManager';
import useLang from './useLang';
import useLastCallback from './useLastCallback';

type FolderNameOptions = {
  text: string;
  entities?: ApiMessageEntity[];
  noCustomEmojiPlayback?: boolean;
  emojiSize?: number;
};

type Params = {
  sidebarMode: boolean;
  orderedFolderIds?: number[];
  chatFoldersById: Record<number, ApiChatFolder>;
  maxFolders: number;
  noEmoticons?: boolean;
} & ({
  isReadOnly?: false;
  maxChatLists: number;
  folderInvitesById: Record<number, ApiChatlistExportedInvite[]>;
  maxFolderInvites: number;
} | {
  isReadOnly: true;
});

const useFolderTabs = (params: Params) => {
  const {
    sidebarMode,
    orderedFolderIds,
    chatFoldersById,
    maxFolders,
    noEmoticons,
    isReadOnly,
  } = params;

  const {
    maxChatLists,
    folderInvitesById,
    maxFolderInvites,
  } = !isReadOnly ? params : {};

  const lang = useLang();
  const { isMobile } = useAppLayout();
  const canMoveAllFolder = useSelector((global) => (
    !isProxyPeerId(global.currentUserId) && selectIsCurrentUserPremium(global)
  ));

  const {
    openShareChatFolderModal,
    openDeleteChatFolderModal,
    openEditChatFolder,
    openLimitReachedModal,
    markChatMessagesRead,
    openSettingsScreen,
    setSharedSettingOption,
    applyProxyFolderPrefs,
    showNotification,
  } = getActions();

  const allChatsFolder: ApiChatFolder = useMemo(() => {
    return {
      id: ALL_FOLDER_ID,
      title: { text: orderedFolderIds?.[0] === ALL_FOLDER_ID ? lang('FilterAllChatsShort') : lang('FilterAllChats') },
      includedChatIds: MEMO_EMPTY_ARRAY,
      excludedChatIds: MEMO_EMPTY_ARRAY,
      emoticon: '💬',
    } satisfies ApiChatFolder;
  }, [orderedFolderIds, lang]);

  const displayedFolders = useMemo(() => {
    return orderedFolderIds
      ? orderedFolderIds.filter((id) => id === ALL_FOLDER_ID || chatFoldersById[id]).map((id) => {
        if (id === ALL_FOLDER_ID) {
          return allChatsFolder;
        }

        return chatFoldersById[id];
      })
      : undefined;
  }, [chatFoldersById, allChatsFolder, orderedFolderIds]);

  const folderUnreadChatsCountersById = useFolderManagerForUnreadChatsByFolder();
  const handleReadAllChats = useLastCallback((folderId: number) => {
    const unreadChatIds = folderUnreadChatsCountersById[folderId];
    if (!unreadChatIds?.length) return;

    unreadChatIds.forEach((chatId) => {
      markChatMessagesRead({ id: chatId });
    });
  });

  const folderCountersById = useFolderManagerForUnreadCounters();
  const folderTabs = useMemo(() => {
    if (!displayedFolders || !displayedFolders.length) {
      return undefined;
    }

    return displayedFolders.map((folder, i) => {
      const { id } = folder;
      // У локальной папки название может быть своим; без него — исходное название или подпись владельца
      const localFallback = folder.pxgLocalKind === 'folder'
        ? (folder.pxgOriginalTitle || lang('PxgSharedFolder'))
        : folder.pxgOwnerName ? lang('PxgOwnerTab', { name: folder.pxgOwnerName }) : lang('PxgSharedWithMe');
      const localTitle = folder.pxgLocal
        ? { text: folder.pxgCustomTitle && folder.title.text ? folder.title.text : localFallback }
        : folder.title;
      const title = localTitle;
      const isBlocked = !folder.pxgLocal && id !== ALL_FOLDER_ID && i > maxFolders - 1;
      const canShareFolder = selectCanShareFolder(getGlobal(), id);
      const contextActions: MenuItemContextAction[] = [];
      const canReorder = !isReadOnly && !isBlocked && (folder.pxgLocal || id !== ALL_FOLDER_ID || canMoveAllFolder);
      const reorderGroup = canReorder ? (folder.pxgLocal ? 'shared' : 'own') : undefined;
      if (canReorder) {
        [-1, 1].forEach((delta) => {
          const target = displayedFolders[i + delta];
          if (!target || Boolean(target.pxgLocal) !== Boolean(folder.pxgLocal)
            || (!canMoveAllFolder && target.id === ALL_FOLDER_ID)
            || (!target.pxgLocal && i + delta > maxFolders - 1)) return;
          contextActions.push({
            title: lang(delta < 0 ? 'PxgFolderMoveLeft' : 'PxgFolderMoveRight'),
            icon: delta < 0 ? 'previous' : 'next',
            handler: () => void moveFolder(id, target.id),
          });
        });
      }

      if (!isReadOnly && folder.pxgLocal) {
        contextActions.push({
          title: lang('PxgFolderRename'),
          icon: 'edit',
          handler: () => openSharedFolderEditor(folder),
        });
        if (folder.pxgCustomTitle) {
          contextActions.push({
            title: lang('PxgFolderReset'),
            icon: 'undo',
            handler: () => {
              void saveSharedFolder(folder.pxgLocalKey!, { title: '' })
                .then(({ prefs }) => applyProxyFolderPrefs({ prefs: prefsByKey(prefs) }))
                .catch(() => showNotification({ message: { key: 'PxgErrorGeneric' } }));
            },
          });
        }
        contextActions.push({
          title: lang('PxgFolderHide'),
          icon: 'eye-crossed',
          handler: () => void setFolderHidden(folder.pxgLocalKey!, true, id),
        });
      }

      if (!isReadOnly && !folder.pxgLocal) {
        if (canShareFolder) {
          contextActions.push({
            title: lang('FilterShare'),
            icon: 'link',
            handler: () => {
              const chatListCount = Object.values(chatFoldersById)
                .reduce((acc, el) => acc + (el.isChatList ? 1 : 0), 0);
              if (chatListCount >= maxChatLists! && !folder.isChatList) {
                openLimitReachedModal({
                  limit: 'chatlistJoined',
                });
                return;
              }

              // Greater amount can be after premium downgrade
              if (folderInvitesById![id]?.length >= maxFolderInvites!) {
                openLimitReachedModal({
                  limit: 'chatlistInvites',
                });
                return;
              }

              openShareChatFolderModal({
                folderId: id,
              });
            },
          });
        }

        // PXG: A folder share follows the folder: chats added to it later appear for the guest too
        if (id !== ALL_FOLDER_ID && getPxgState().session?.level === 'client') {
          contextActions.push({
            title: lang('PxgShareFolderMenu'),
            icon: 'user',
            handler: () => setPxgState({
              shareFolder: { id, title: folder.title.text }, shareChatId: undefined, shareTopic: undefined,
            }),
          });
        }

        if (id === ALL_FOLDER_ID) {
          contextActions.push({
            title: lang('FilterEditFolders'),
            icon: 'edit',
            handler: () => {
              openSettingsScreen({ screen: SettingsScreens.Folders });
            },
          });

          if (folderUnreadChatsCountersById[id]?.length) {
            contextActions.push({
              title: lang('ChatListMarkAllAsRead'),
              icon: 'readchats',
              handler: () => handleReadAllChats(folder.id),
            });
          }
        } else {
          contextActions.push({
            title: lang('EditFolder'),
            icon: 'edit',
            handler: () => {
              openEditChatFolder({ folderId: id });
            },
          });

          if (folderUnreadChatsCountersById[id]?.length) {
            contextActions.push({
              title: lang('ChatListMarkAllAsRead'),
              icon: 'readchats',
              handler: () => handleReadAllChats(folder.id),
            });
          }

          // Proxygram: a folder of one's own can be hidden too; «Settings → Chat Folders» brings it back
          if (canHideFolders()) {
            contextActions.push({
              title: lang('PxgFolderHide'),
              icon: 'eye-crossed',
              handler: () => void setFolderHidden(ownFolderKey(id), true, id),
            });
          }

          contextActions.push({
            title: lang('FilterMenuDelete'),
            icon: 'delete',
            destructive: true,
            handler: () => {
              openDeleteChatFolderModal({ folderId: id });
            },
          });
        }

        if (!isMobile) {
          contextActions.push({
            isSeparator: true,
          });

          contextActions.push({
            title: sidebarMode ? lang('TabsPositionTop') : lang('TabsPositionLeft'),
            icon: 'forums',
            handler: () => {
              setSharedSettingOption({ foldersPosition: sidebarMode ? 'top' : 'left' });
            },
          });
        }
      }

      const folderNameOptions: FolderNameOptions = {
        text: title.text,
        entities: title.entities,
        noCustomEmojiPlayback: folder.noTitleAnimations,
      };

      let folderIcon: string | ApiMessageEntityCustomEmoji | undefined = folder.emoticon;

      if (sidebarMode) {
        folderNameOptions.emojiSize = 10;
        const currentCustomEmoji = title.entities?.find(
          (entity): entity is ApiMessageEntityCustomEmoji =>
            entity.type === ApiMessageEntityTypes.CustomEmoji && entity.offset === 0);
        if (currentCustomEmoji) {
          folderIcon = currentCustomEmoji;
          const { offset, length } = currentCustomEmoji;

          folderNameOptions.text = title.text.replace(title.text.substring(offset, offset + length), '');
          folderNameOptions.entities = title.entities?.filter((entity) => entity.offset !== offset).map((entity) => ({
            ...entity,
            offset: entity.offset - length,
          }));
        }
      }

      const folderName: TeactNode[] | string = renderTextWithEntities(folderNameOptions);

      return {
        id,
        title: folderName,
        badgeCount: folderCountersById[id]?.chatsCount,
        isBadgeActive: Boolean(folderCountersById[id]?.notificationsCount),
        isBlocked,
        reorderGroup,
        contextActions: contextActions.length ? contextActions : undefined,
        emoticon: noEmoticons ? undefined : folderIcon,
        noTitleAnimations: folder.noTitleAnimations,
        isPxgShared: folder.pxgLocal && Boolean(folder.pxgSharedBy),
        pxgSharedTitle: folder.pxgSharedBy
          ? lang('PxgFolderFrom', { name: folder.pxgSharedBy })
          : undefined,
      } satisfies TabWithProperties;
    });
  }, [
    displayedFolders, maxFolders, folderCountersById, lang, chatFoldersById, maxChatLists, folderInvitesById,
    maxFolderInvites, folderUnreadChatsCountersById, isReadOnly, sidebarMode, isMobile, noEmoticons, canMoveAllFolder,
  ]);

  return {
    displayedFolders,
    folderTabs,
  };
};

export default useFolderTabs;
