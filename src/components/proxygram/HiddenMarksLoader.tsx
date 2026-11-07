import { memo, useEffect, useRef, useState } from '../../lib/teact/teact';
import { getGlobal, setGlobal, withGlobal } from '../../global';

import type { ApiMessage } from '../../api/types';
import type { HiddenMessageDto } from '../../proxygram/server/types';

import { selectChatMessages, selectCurrentMessageList, selectViewportIds } from '../../global/selectors';
import { isProxyPeerId } from '../../api/proxy/ids';
import { applyHiddenMarks } from '../../proxygram/archive/hiddenMarks';
import { pxgRpc } from '../../proxygram/server/rpc';
import { usePxgState } from '../../proxygram/server/store';

type OwnProps = {
  accountId: string;
};

type StateProps = {
  chatId?: string;
  /** Changes whenever Web A replaces the chat's messages, which drops the overlay */
  messagesById?: Record<number, ApiMessage>;
  minId?: number;
  maxId?: number;
};

/** The feed is scrolled: marks are requested no more often than this */
const FETCH_DEBOUNCE_MS = 400;

/**
 * "Hide from guests" for a full login: the owner sees from whom each message is hidden. Marks are read for the
 * visible part of a shared chat and again when another device of the owner changes them
 */
const HiddenMarksLoader = ({
  accountId, chatId, messagesById, minId, maxId,
}: OwnProps & StateProps) => {
  const marksRef = useRef(new Map<string, Map<number, HiddenMessageDto>>());
  const [version, setVersion] = useState(0);
  const isShared = usePxgState((state) => Boolean(chatId && state.sharedChats?.[chatId]?.length));
  const hasMarks = Boolean(chatId && marksRef.current.get(chatId)?.size);

  useEffect(() => pxgRpc.on((event) => {
    if (event.e !== 'hidden.changed' || event.d.accountId !== accountId) return;
    setVersion((current) => current + 1);
  }), [accountId]);

  useEffect(() => {
    if (!chatId || isProxyPeerId(chatId) || minId === undefined || maxId === undefined) return undefined;
    if (!isShared && !hasMarks) return undefined;
    const timer = window.setTimeout(() => {
      pxgRpc.call<HiddenMessageDto[]>('archive.hidden', {
        accountId, peerId: Number(chatId), minMsgId: minId, maxMsgId: maxId,
      }).then((entries) => {
        const marks = new Map(marksRef.current.get(chatId));
        [...marks.keys()].filter((id) => id >= minId && id <= maxId).forEach((id) => marks.delete(id));
        entries.forEach((entry) => marks.set(entry.msgId, entry));
        marksRef.current.set(chatId, marks);
        const global = applyHiddenMarks(getGlobal(), chatId, marks);
        setGlobal(global);
      }).catch(() => undefined);
    }, FETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [accountId, chatId, minId, maxId, isShared, hasMarks, version]);

  // A history reload from Telegram replaces messages with fresh copies: the known marks go back without a request
  useEffect(() => {
    const marks = chatId && messagesById ? marksRef.current.get(chatId) : undefined;
    if (!marks?.size) return;
    const current = getGlobal();
    const global = applyHiddenMarks(current, chatId!, marks);
    if (global !== current) setGlobal(global);
  }, [chatId, messagesById]);

  return undefined;
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const list = selectCurrentMessageList(global);
    if (!list || list.type !== 'thread') {
      return {
        chatId: undefined, messagesById: undefined, minId: undefined, maxId: undefined,
      };
    }
    const viewportIds = selectViewportIds(global, list.chatId, list.threadId);
    return {
      chatId: list.chatId,
      messagesById: selectChatMessages(global, list.chatId),
      minId: viewportIds?.[0],
      maxId: viewportIds?.[viewportIds.length - 1],
    };
  },
)(HiddenMarksLoader));
