import { useRef } from '../../lib/teact/teact';

import type { ApiMessage } from '../../api/types';

import { areSortedArraysEqual } from '../../util/iteratees';

/** The same array comes back until the visible list changes, so the feed reacts only to real changes */
export default function useMessageIdsWithoutDeleted(
  ids?: number[], messagesById?: Record<number, ApiMessage>, isDeletedHidden?: boolean,
) {
  const lastRef = useRef<number[]>();
  if (!isDeletedHidden || !ids) return ids;

  const visibleIds = ids.filter((id) => !messagesById?.[id]?.pxgDeletedAt);
  if (visibleIds.length === ids.length) return ids;
  if (lastRef.current && areSortedArraysEqual(lastRef.current, visibleIds)) return lastRef.current;

  lastRef.current = visibleIds;
  return visibleIds;
}
