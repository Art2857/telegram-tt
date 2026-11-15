import { getActions, getGlobal } from '../global';

import type { GlobalState } from '../global/types';
import type { SharedFolderPrefDto } from './server/types';

import { selectTabState } from '../global/selectors';
import { getCurrentTabId } from '../util/establishMultitabRole';
import { getPxgState } from './server/store';
import { prefsByKey, saveSharedFolder } from './sharedFolders';

/**
 * Hidden folders (docs/spec/13 §8). A folder of one's own — Telegram's for a full login, the server's for a guest —
 * is hidden by the key `own:<id>` in the same per-person settings as folders from others: the tab leaves the strip,
 * the folder stays, «Settings → Chat Folders» brings it back on every device
 */
export function ownFolderKey(folderId: number) {
  return `own:${folderId}`;
}

export function canHideFolders() {
  return Boolean(getPxgState().session);
}

function hiddenOwnFolderIds(prefs?: Record<string, SharedFolderPrefDto>) {
  const ids = new Set<number>();
  Object.values(prefs ?? {}).forEach(({ key, hidden }) => {
    if (hidden && key.startsWith('own:')) ids.add(Number(key.slice(4)));
  });
  return ids;
}

export function isOwnFolderHidden(global: GlobalState, folderId: number) {
  return Boolean(global.chatFolders.pxgPrefs?.[ownFolderKey(folderId)]?.hidden);
}

let cache: { orderedIds?: number[]; prefs?: Record<string, SharedFolderPrefDto>; result?: number[] } = {};

/** Folder tabs as the strip shows them: the same array while nothing changed, so lists do not re-render */
export function selectVisibleFolderIds(global: GlobalState) {
  const { orderedIds, pxgPrefs } = global.chatFolders;
  if (cache.orderedIds === orderedIds && cache.prefs === pxgPrefs) return cache.result;
  const hidden = hiddenOwnFolderIds(pxgPrefs);
  const result = hidden.size && orderedIds ? orderedIds.filter((id) => !hidden.has(id)) : orderedIds;
  cache = { orderedIds, prefs: pxgPrefs, result };
  return result;
}

/**
 * Hides or shows a folder. The open tab keeps pointing at the same folder: tabs are addressed by position, and
 * a hidden tab before it shifted the strip and its highlight
 */
export async function setFolderHidden(key: string, isHidden: boolean, folderId?: number) {
  const { applyProxyFolderPrefs, setActiveChatFolder, showNotification } = getActions();
  try {
    const { prefs } = await saveSharedFolder(key, { hidden: isHidden });
    const global = getGlobal();
    const tabId = getCurrentTabId();
    const visibleBefore = selectVisibleFolderIds(global) ?? [];
    const activeIndex = selectTabState(global, tabId).activeChatFolder;
    const activeId = visibleBefore[activeIndex];
    applyProxyFolderPrefs({ prefs: prefsByKey(prefs) });
    // Actions run after this tick: the strip without the hidden tab is computed here, both land in one render
    if (isHidden) {
      const nextIndex = activeId === undefined || activeId === folderId
        ? 0 : visibleBefore.filter((id) => id !== folderId).indexOf(activeId);
      if (nextIndex !== activeIndex) {
        setActiveChatFolder({ activeChatFolder: Math.max(nextIndex, 0), tabId }, { forceOnHeavyAnimation: true });
      }
      return;
    }
    // A shown tab may land before the open one: keep the same folder open once the strip is rebuilt
    setTimeout(() => {
      const nextIndex = activeId === undefined ? -1 : (selectVisibleFolderIds(getGlobal()) ?? []).indexOf(activeId);
      if (nextIndex >= 0 && nextIndex !== selectTabState(getGlobal(), tabId).activeChatFolder) {
        setActiveChatFolder({ activeChatFolder: nextIndex, tabId }, { forceOnHeavyAnimation: true });
      }
    });
  } catch {
    showNotification({ message: { key: 'PxgErrorGeneric' } });
  }
}
