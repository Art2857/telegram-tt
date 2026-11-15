import { getActions, getGlobal } from '../global';

import { ALL_FOLDER_ID } from '../config';
import { selectIsCurrentUserPremium } from '../global/selectors';
import { isProxyPeerId } from '../api/proxy/ids';
import { getPxgState } from './server/store';
import { prefsByKey, reorderSharedFolders } from './sharedFolders';

let isSaving = false;

/** Меняет порядок внутри группы папок, сохраняя скрытые папки и границу между своими и полученными */
export async function moveFolder(fromId: number, toId: number) {
  const global = getGlobal();
  const { sortChatFolders, applyProxyFolderPrefs, showNotification } = getActions();
  const { byId, orderedIds } = global.chatFolders;
  const userId = getPxgState().session?.user.id;
  if (isSaving || !orderedIds || fromId === toId) return;
  const isLocal = Boolean(byId[fromId]?.pxgLocal);
  if (isLocal !== Boolean(byId[toId]?.pxgLocal)) return;
  const canMoveAllFolder = !isProxyPeerId(global.currentUserId) && selectIsCurrentUserPremium(global);
  if (!isLocal && !canMoveAllFolder && (fromId === ALL_FOLDER_ID || toId === ALL_FOLDER_ID)) return;
  const ids = orderedIds.filter((id) => Boolean(byId[id]?.pxgLocal) === isLocal);
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return;
  ids.splice(toIndex, 0, ...ids.splice(fromIndex, 1));
  if (!isLocal) {
    let index = 0;
    sortChatFolders({ folderIds: orderedIds.map((id) => (byId[id]?.pxgLocal ? id : ids[index++])) });
    return;
  }
  isSaving = true;
  try {
    const visibleKeys = ids.map((id) => byId[id].pxgLocalKey!);
    const hiddenKeys = (global.chatFolders.pxgLocalFolders ?? [])
      .filter((folder) => !ids.includes(folder.id)).map((folder) => folder.pxgLocalKey!);
    const { prefs } = await reorderSharedFolders([...visibleKeys, ...hiddenKeys]);
    if (getPxgState().session?.user.id !== userId) return;
    applyProxyFolderPrefs({ prefs: prefsByKey(prefs) });
  } catch {
    showNotification({ message: { key: 'PxgErrorGeneric' } });
  } finally {
    isSaving = false;
  }
}
