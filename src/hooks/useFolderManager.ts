import { useEffect, useRef } from '../lib/teact/teact';

import {
  addChatsCountCallback,
  addOrderedIdsCallback, addUnreadChatsByFolderIdCallback,
  addUnreadCountersCallback,
  getChatsCount,
  getOrderedIds, getUnreadChatsByFolderId,
  getUnreadCounters,
} from '../util/folderManager';
import useForceUpdate from './useForceUpdate';

export function useFolderManagerForOrderedIds(folderId: number) {
  const forceUpdate = useForceUpdate();
  const orderedIds = getOrderedIds(folderId);
  const renderedIdsRef = useRef(orderedIds);
  renderedIdsRef.current = orderedIds;

  useEffect(() => {
    // The list may have arrived between the render and this subscription, and no callback will tell about it
    if (getOrderedIds(folderId) !== renderedIdsRef.current) forceUpdate();
    return addOrderedIdsCallback(folderId, forceUpdate);
  }, [folderId, forceUpdate]);

  return orderedIds;
}

export function useFolderManagerForUnreadCounters() {
  const forceUpdate = useForceUpdate();

  useEffect(() => addUnreadCountersCallback(forceUpdate), [forceUpdate]);

  return getUnreadCounters();
}

export function useFolderManagerForChatsCount() {
  const forceUpdate = useForceUpdate();

  useEffect(() => addChatsCountCallback(forceUpdate), [forceUpdate]);

  return getChatsCount();
}

export function useFolderManagerForUnreadChatsByFolder() {
  const forceUpdate = useForceUpdate();

  useEffect(() => addUnreadChatsByFolderIdCallback(forceUpdate), [forceUpdate]);

  return getUnreadChatsByFolderId();
}
