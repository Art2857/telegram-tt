import { memo, useEffect, useRef } from '../../lib/teact/teact';
import { getGlobal, setGlobal, withGlobal } from '../../global';

import type { AttributionDto, MessageDto } from '../../proxygram/server/types';
import { MAIN_THREAD_ID } from '../../api/types';

import { selectChatLastMessageId, selectCurrentMessageList, selectViewportIds } from '../../global/selectors';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { isProxyPeerId } from '../../api/proxy/ids';
import { applyAttribution, insertTombstones, tombstoneToApiMessage } from '../../proxygram/archive/serverTombstones';
import { pxgRpc } from '../../proxygram/server/rpc';

type OwnProps = {
  accountId: string;
};

type StateProps = {
  chatId?: string;
  minId?: number;
  maxId?: number;
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
  accountId, chatId, minId, maxId, isAtEnd,
}: OwnProps & StateProps) => {
  // уже запрошенные диапазоны по чатам — при прокрутке туда-обратно сервер не дёргаем
  const fetchedRef = useRef(new Map<string, [number, number][]>());
  // авторы-гости по чатам: перезагруженная из Telegram лента получает отметки снова
  const attributionRef = useRef(new Map<string, AttributionDto[]>());

  useEffect(() => {
    if (!chatId || isProxyPeerId(chatId) || minId === undefined || maxId === undefined) return undefined;
    const known = attributionRef.current.get(chatId);
    if (known?.length) {
      const global = applyAttribution(getGlobal(), chatId, known);
      setGlobal(global);
    }

    const to = isAtEnd ? maxId + TAIL_RANGE : maxId;
    const ranges = fetchedRef.current.get(chatId) ?? [];
    if (ranges.some(([from, until]) => from <= minId && until >= to)) return undefined;

    const timer = window.setTimeout(() => {
      const range = { accountId, peerId: Number(chatId), minMsgId: minId, maxMsgId: to };
      Promise.all([
        pxgRpc.call<MessageDto[]>('archive.tombstones', range),
        pxgRpc.call<AttributionDto[]>('archive.attribution', range),
      ])
        .then(([tombstones, attribution]) => {
          fetchedRef.current.set(chatId, [...ranges, [minId, to]]);
          const entries = [...(attributionRef.current.get(chatId) ?? []), ...attribution];
          attributionRef.current.set(chatId, entries);
          let global = getGlobal();
          if (tombstones.length) {
            const messages = tombstones.map((dto) => tombstoneToApiMessage(dto, chatId));
            global = insertTombstones(global, chatId, messages, { isAtEnd }, getCurrentTabId());
          }
          global = applyAttribution(global, chatId, entries);
          setGlobal(global);
        })
        .catch(() => undefined);
    }, FETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [accountId, chatId, minId, maxId, isAtEnd]);

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
)(TombstonesLoader));
