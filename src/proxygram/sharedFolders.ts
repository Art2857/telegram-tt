import type { ApiChatFolder } from '../api/types';
import type { SharedFolderPrefDto } from './server/types';

import { pxgRpc } from './server/rpc';
import { setPxgState } from './server/store';

/** Настройки локальных папок доступов: названия, скрытие и порядок, общие для всех устройств */
export function fetchSharedFolderPrefs() {
  return pxgRpc.call<SharedFolderPrefDto[]>('folders.local');
}

export function prefsByKey(prefs: SharedFolderPrefDto[]) {
  return Object.fromEntries(prefs.map((pref) => [pref.key, pref]));
}

export async function saveSharedFolder(key: string, patch: { title?: string | null; hidden?: boolean }) {
  return pxgRpc.call<{ prefs: SharedFolderPrefDto[] }>('folders.localSet', { key, ...patch });
}

export async function reorderSharedFolders(keys: string[]) {
  return pxgRpc.call<{ prefs: SharedFolderPrefDto[] }>('folders.localOrder', { keys });
}

/** Открыть окно переименования для вкладки или строки настроек */
export function openSharedFolderEditor(folder: ApiChatFolder) {
  if (!folder.pxgLocalKey) return;
  setPxgState({
    sharedFolderEdit: {
      key: folder.pxgLocalKey,
      title: folder.pxgCustomTitle ? folder.title.text : '',
      originalTitle: folder.pxgOriginalTitle ?? '',
      ownerName: folder.pxgOwnerName,
      kind: folder.pxgLocalKind ?? 'owner',
    },
  });
}
