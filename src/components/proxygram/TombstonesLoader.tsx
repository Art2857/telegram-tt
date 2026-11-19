import { memo, useEffect, useRef } from '../../lib/teact/teact';
import { getGlobal, setGlobal, withGlobal } from '../../global';

import type { ApiMessage } from '../../api/types';
import type { AttributionDto, MessageDto } from '../../proxygram/server/types';
import type { ThreadId } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';

import {
  selectChatLastMessageId, selectChatMessages, selectCurrentMessageList, selectFirstMessageId, selectViewportIds,
} from '../../global/selectors';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { isProxyPeerId } from '../../api/proxy/ids';
import {
  applyAttribution, DIALOG_PREFIX_LIMIT, insertTombstones, tombstoneToApiMessage,
} from '../../proxygram/archive/serverTombstones';
import { pxgRpc } from '../../proxygram/server/rpc';

type OwnProps = {
  accountId: string;
};

type StateProps = {
  chatId?: string;
  /** Comments and forum topics get the guests' marks too; tombstones belong to the whole chat's feed */
  threadId?: ThreadId;
  /** Changes whenever Web A replaces the chat's messages, which drops the attribution overlay */
  messagesById?: Record<number, ApiMessage>;
  minId?: number;
  maxId?: number;
  firstLiveId?: number;
  /** Окно ленты дошло до последнего сообщения чата */
  isAtEnd?: boolean;
};

/** Ленту листают — запрос надгробий не чаще этого */
const FETCH_DEBOUNCE_MS = 400;
/** В конце чата смотрим и удалённые после последнего живого сообщения */
const TAIL_RANGE = 10_000;

/**
 * Антиудаление полного клиента из серверного архива (PLAN.md 5.2 п.4). Сервер записал удалённое,
 * даже когда приложение было закрыто, — при открытии чата его надгробия встают на свои места в ленте.
 */
const TombstonesLoader = ({
  accountId, chatId, threadId, messagesById, minId, maxId, firstLiveId, isAtEnd,
}: OwnProps & StateProps) => {
  // уже запрошенные диапазоны по чатам — при прокрутке туда-обратно сервер не дёргаем
  const fetchedRef = useRef(new Map<string, [number, number][]>());
  const prefixesRef = useRef(new Map<string, number>());
  // авторы-гости по чатам: перезагруженная из Telegram лента получает отметки снова
  const attributionRef = useRef(new Map<string, AttributionDto[]>());

  useEffect(() => {
    if (!chatId || threadId === undefined || isProxyPeerId(chatId) || minId === undefined || maxId === undefined) {
      return undefined;
    }
    const known = attributionRef.current.get(chatId);
    if (known?.length) {
      const global = applyAttribution(getGlobal(), chatId, known);
      setGlobal(global);
    }

    const isMainThread = threadId === MAIN_THREAD_ID;
    const to = isAtEnd ? maxId + TAIL_RANGE : maxId;
    const fetchedKey = [chatId, threadId].join('_');
    const ranges = fetchedRef.current.get(fetchedKey) ?? [];
    const fetchRange = !ranges.some(([from, until]) => from <= minId && until >= to);
    const fetchPrefix = isMainThread && firstLiveId !== undefined && firstLiveId > 1 && minId <= firstLiveId
      && firstLiveId !== prefixesRef.current.get(fetchedKey);
    if (!fetchRange && !fetchPrefix) return undefined;

    const timer = window.setTimeout(() => {
      const range = { accountId, peerId: Number(chatId), minMsgId: minId, maxMsgId: to };
      Promise.all([
        fetchRange && isMainThread ? pxgRpc.call<MessageDto[]>('archive.tombstones', range) : [],
        fetchRange ? pxgRpc.call<AttributionDto[]>('archive.attribution', range) : [],
        fetchPrefix ? pxgRpc.call<MessageDto[]>('archive.tombstones', {
          ...range, minMsgId: 1, maxMsgId: firstLiveId - 1, newestLimit: DIALOG_PREFIX_LIMIT,
        }) : [],
      ])
        .then(([tombstones, attribution, prefix]) => {
          if (fetchRange) fetchedRef.current.set(fetchedKey, [...ranges, [minId, to]]);
          if (fetchPrefix) prefixesRef.current.set(fetchedKey, firstLiveId);
          const entries = [...(attributionRef.current.get(chatId) ?? []), ...attribution];
          attributionRef.current.set(chatId, entries);
          let global = getGlobal();
          if (tombstones.length || prefix.length) {
            const messages = [...new Map([...tombstones, ...prefix].map((dto) => [dto.msgId, dto])).values()]
              .map((dto) => tombstoneToApiMessage(dto, chatId));
            global = insertTombstones(global, chatId, messages, {
              isAtEnd, firstLiveId, isFromServer: true,
            }, getCurrentTabId());
          }
          global = applyAttribution(global, chatId, entries);
          setGlobal(global);
        })
        .catch(() => undefined);
    }, FETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [accountId, chatId, threadId, minId, maxId, firstLiveId, isAtEnd]);

  // A history reload from Telegram replaces messages with fresh copies: the known marks go back without a request
  useEffect(() => {
    const known = chatId && messagesById ? attributionRef.current.get(chatId) : undefined;
    if (!known?.length) return;
    const current = getGlobal();
    const global = applyAttribution(current, chatId!, known);
    if (global !== current) setGlobal(global);
  }, [chatId, messagesById]);

  return undefined;
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const list = selectCurrentMessageList(global);
    if (!list || list.type !== 'thread') {
      return {
        chatId: undefined,
        threadId: undefined,
        messagesById: undefined,
        minId: undefined,
        maxId: undefined,
        firstLiveId: undefined,
        isAtEnd: undefined,
      };
    }
    const viewportIds = selectViewportIds(global, list.chatId, list.threadId);
    const maxId = viewportIds?.[viewportIds.length - 1];
    const lastId = selectChatLastMessageId(global, list.chatId);
    return {
      chatId: list.chatId,
      threadId: list.threadId,
      messagesById: selectChatMessages(global, list.chatId),
      minId: viewportIds?.[0],
      maxId,
      firstLiveId: selectFirstMessageId(global, list.chatId, list.threadId),
      isAtEnd: maxId !== undefined && lastId !== undefined && maxId >= lastId,
    };
  },
)(TombstonesLoader));
