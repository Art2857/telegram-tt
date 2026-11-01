import { memo, useEffect } from '../../lib/teact/teact';
import { getGlobal, setGlobal, withGlobal } from '../../global';

import { MAIN_THREAD_ID } from '../../api/types';

import { updateChatMessage } from '../../global/reducers';
import {
  selectChatLastMessageId, selectChatMessage, selectCurrentMessageList, selectViewportIds,
} from '../../global/selectors';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { getServerTime } from '../../util/serverTime';
import { isProxyPeerId } from '../../api/proxy/ids';
import { pruneLocalArchive, readChatArchive, selectLocalTombstones } from '../../proxygram/archive/localArchive';
import { insertTombstones } from '../../proxygram/archive/serverTombstones';

type OwnProps = {
  ownerId: string;
};

type StateProps = {
  chatId?: string;
  minId?: number;
  maxId?: number;
  /** The feed window reached the last message of the chat */
  isAtEnd?: boolean;
};

/** The feed is being scrolled: the device archive is read no more often than this */
const READ_DEBOUNCE_MS = 400;

/**
 * Anti-delete of the full client from the device archive (L1, PLAN.md 9.4): what was deleted or edited while
 * the client was open gets back into the feed after a reload, also without a connected server.
 */
const LocalArchiveLoader = ({
  ownerId, chatId, minId, maxId, isAtEnd,
}: OwnProps & StateProps) => {
  useEffect(() => {
    void pruneLocalArchive(ownerId, getServerTime());
  }, [ownerId]);

  useEffect(() => {
    if (!chatId || isProxyPeerId(chatId) || minId === undefined || maxId === undefined) return undefined;

    const timer = window.setTimeout(async () => {
      const archive = await readChatArchive(ownerId, chatId);
      if (!archive) return;
      let global = getGlobal();
      if (global.currentUserId !== ownerId) return;

      const tombstones = selectLocalTombstones(archive, chatId, minId, isAtEnd ? Infinity : maxId);
      if (tombstones.length) global = insertTombstones(global, chatId, tombstones, { isAtEnd }, getCurrentTabId());
      Object.entries(archive.versions).forEach(([id, versions]) => {
        const message = selectChatMessage(global, chatId, Number(id));
        if (!message || message.pxgEditHistory?.length) return;
        global = updateChatMessage(global, chatId, message.id, { pxgEditHistory: versions });
      });
      setGlobal(global);
    }, READ_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ownerId, chatId, minId, maxId, isAtEnd]);

  return undefined;
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const list = selectCurrentMessageList(global);
    if (!list || list.type !== 'thread' || list.threadId !== MAIN_THREAD_ID) {
      return {
        chatId: undefined, minId: undefined, maxId: undefined, isAtEnd: undefined,
      };
    }
    const viewportIds = selectViewportIds(global, list.chatId, MAIN_THREAD_ID);
    const maxId = viewportIds?.[viewportIds.length - 1];
    const lastId = selectChatLastMessageId(global, list.chatId);
    return {
      chatId: list.chatId,
      minId: viewportIds?.[0],
      maxId,
      isAtEnd: maxId !== undefined && lastId !== undefined && maxId >= lastId,
    };
  },
)(LocalArchiveLoader));
