import { describe, expect, it } from 'vitest';
import { setGlobal } from '../global';

import { ALL_FOLDER_ID } from '../config';
import { INITIAL_TAB_STATE } from '../global/initialState';
import { updateProxyFolder } from '../global/reducers/proxy';
import { buildGlobal } from '../proxygram/archive/testGlobal';
import { PRESETS } from '../proxygram/permissions';
import { getCurrentTabId } from './establishMultitabRole';
import { getOrderedIds, updateFolderManager } from './folderManager';

describe('архив диалогов в списке чатов', () => {
  it('держит закрытый диалог в отдельной папке и возвращает его в основной список при возобновлении', () => {
    const id = '-4700000000000001';
    const proxy = {
      accountId: 'owner-account', peerId: 42, shareIds: [], isOwn: true,
      permissions: PRESETS.readOnly,
    };
    const archived = {
      id, title: 'Диалог', type: 'chatTypePrivate' as const, isListed: true,
      pxgProxy: { ...proxy, isOwnerArchive: true },
    };
    const tabId = getCurrentTabId();
    const base = buildGlobal([]);
    const global = updateProxyFolder({
      ...base,
      byTabId: { [tabId]: { ...INITIAL_TAB_STATE, id: tabId, isMasterTab: true } },
      chats: { ...base.chats, byId: { [id]: archived }, listIds: { ...base.chats.listIds, active: [] } },
    });

    const folder = global.chatFolders.pxgLocalFolders?.find(({ pxgLocalKind }) => pxgLocalKind === 'dialogArchive');
    expect.assert(folder);
    setGlobal(global);
    expect(getOrderedIds(folder.id)).toEqual([id]);
    expect(getOrderedIds(ALL_FOLDER_ID) ?? []).toEqual([]);

    const reopened = updateProxyFolder({
      ...global,
      chats: {
        ...global.chats,
        byId: { [id]: { ...archived, pxgProxy: proxy } },
        listIds: { ...global.chats.listIds, active: [id] },
      },
    });
    updateFolderManager(reopened);
    expect(getOrderedIds(ALL_FOLDER_ID)).toEqual([id]);
    expect(getOrderedIds(folder.id) ?? []).toEqual([]);
  });
});
