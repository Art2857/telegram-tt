import type { GlobalState, TabArgs, TabState } from '../types';

import { getCurrentTabId } from '../../util/establishMultitabRole';

export function updateTabState<T extends GlobalState>(
  global: T,
  tabStatePartial: Partial<TabState>,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  // A tab state is created complete by `init`: an entry made from a partial update without a known tab would
  // later break every reader of the tab (and be kept in the cached state of the device)
  if (tabId === undefined || !global.byTabId[tabId]) return global;
  return {
    ...global,
    byTabId: {
      ...global.byTabId,
      [tabId]: {
        ...global.byTabId[tabId],
        ...tabStatePartial,
      },
    },
  };
}
