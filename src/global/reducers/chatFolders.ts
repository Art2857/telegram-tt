import type { GlobalState } from '../types';

/** Позиция вкладки меняется, но каждая вкладка браузера остаётся в той же папке */
export function preserveActiveFolders<T extends GlobalState>(previous: T, next: T): T {
  const visibleIds = (state: T) => state.chatFolders.orderedIds?.filter((id) => (
    !state.chatFolders.pxgPrefs?.[`own:${id}`]?.hidden
  )) ?? [];
  const before = visibleIds(previous);
  const after = visibleIds(next);
  return {
    ...next,
    byTabId: Object.fromEntries(Object.entries(next.byTabId).map(([id, tab]) => {
      const folderId = before[previous.byTabId[Number(id)]?.activeChatFolder ?? 0];
      const activeChatFolder = Math.max(0, after.indexOf(folderId));
      return [id, tab.activeChatFolder === activeChatFolder ? tab : { ...tab, activeChatFolder }];
    })),
  };
}
