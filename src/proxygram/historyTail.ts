import type { ApiMessage } from '../api/types';
import type { GlobalState } from '../global/types';
import type { ThreadId } from '../types';
import { MAIN_THREAD_ID } from '../api/types';

import { MESSAGE_LIST_VIEWPORT_LIMIT } from '../config';
import { orderHistoryIds } from '../global/helpers';
import {
  addChatMessagesById, safeReplaceViewportIds, updateChatLastMessageId, updateListedIds,
} from '../global/reducers';
import { replaceThreadLocalStateParam } from '../global/reducers/threads';
import { selectChatLastMessageId, selectListedIds, selectViewportIds } from '../global/selectors';
import { isLocalMessageId } from '../util/keys/messageKey';

/**
 * Сверка хвоста ленты с источником (Telegram или сервер Proxygram). Web A доверяет потоку обновлений: если
 * обновление потерялось, сообщение не появится ни в ленте, ни при повторном входе в чат — пока приложение не
 * перезапустят. Поэтому открытый чат время от времени сверяет свои последние сообщения с источником.
 *
 * - `ok` — локальная лента содержит всё, что прислал источник;
 * - `merge` — недостающие сообщения стыкуются с лентой: их можно просто вставить;
 * - `detached` — последние сообщения источника не доходят до ленты: между ними разрыв неизвестного размера,
 *   нужны страницы постарше (или замена ленты, если разрыв слишком велик).
 */
export type TailPlan =
  | { kind: 'ok' }
  | { kind: 'merge'; missingIds: number[] }
  | { kind: 'detached'; missingIds: number[] };

/**
 * @param listedIds загруженная лента потока
 * @param serverIds последние сообщения потока у источника (одна или несколько страниц подряд, от новых к старым)
 * @param hasReachedStart источник отдал меньше, чем просили: дальше назад сообщений нет
 */
export function planTailMerge(
  listedIds: number[] | undefined, serverIds: number[], hasReachedStart: boolean,
): TailPlan {
  const server = orderHistoryIds(serverIds.filter((id) => !isLocalMessageId(id)).slice());
  if (!server.length) return { kind: 'ok' };

  const local = (listedIds || []).filter((id) => !isLocalMessageId(id));
  const localSet = new Set(local);
  const missingIds = server.filter((id) => !localSet.has(id));
  if (!missingIds.length) return { kind: 'ok' };

  const localMax = local.length ? Math.max(...local) : undefined;
  // Источник покрывает всё от своего самого старого сообщения до самого нового: если лента доходит до него, всё,
  // чего в ней нет в этом промежутке, — потерянные обновления
  if (hasReachedStart || (localMax !== undefined && server[0] <= localMax)) {
    return { kind: 'merge', missingIds };
  }

  return { kind: 'detached', missingIds };
}

/**
 * Вставляет найденные сообщения в ленту. Окно просмотра вкладки, которое стояло в конце ленты, получает и новые
 * сообщения — человек видит их там же, где ждал. Сообщения, которые уже есть, не перезаписываются.
 *
 * @param shouldReplaceList разрыв слишком велик: лента начинается заново с полученных сообщений, старое
 *   догрузится прокруткой вверх
 */
export function applyTailMessages<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  messages: ApiMessage[],
  missingIds: number[],
  tabIds: number[],
  shouldReplaceList = false,
): T {
  if (!missingIds.length) return global;
  const missing = new Set(missingIds);
  const byId: Record<number, ApiMessage> = {};
  messages.forEach((message) => {
    if (missing.has(message.id)) byId[message.id] = message;
  });
  const ids = Object.keys(byId).map(Number);
  if (!ids.length) return global;

  const listedBefore = (selectListedIds(global, chatId, threadId) || []).filter((id) => !isLocalMessageId(id));
  const localMaxBefore = listedBefore.length ? Math.max(...listedBefore) : undefined;
  const serverIds = orderHistoryIds(messages.map(({ id }) => id));

  global = addChatMessagesById(global, chatId, byId);

  if (shouldReplaceList) {
    // Сообщения, которые отправляются прямо сейчас, остаются в конце ленты
    const sending = (selectListedIds(global, chatId, threadId) || []).filter(isLocalMessageId);
    global = replaceThreadLocalStateParam(
      global, chatId, threadId, 'listedIds', orderHistoryIds([...serverIds, ...sending]),
    );
  } else {
    global = updateListedIds(global, chatId, threadId, ids);
  }

  tabIds.forEach((tabId) => {
    const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
    if (!viewportIds?.length) return;
    const realViewport = viewportIds.filter((id) => !isLocalMessageId(id));
    const viewportMax = realViewport.length ? Math.max(...realViewport) : undefined;
    const isAtEnd = viewportMax === undefined || localMaxBefore === undefined || viewportMax >= localMaxBefore;
    if (shouldReplaceList) {
      if (!isAtEnd) return;
      const sending = viewportIds.filter(isLocalMessageId);
      global = safeReplaceViewportIds(global, chatId, threadId,
        [...serverIds.slice(-MESSAGE_LIST_VIEWPORT_LIMIT), ...sending], tabId);
      return;
    }
    const viewportMin = realViewport.length ? Math.min(...realViewport) : -Infinity;
    // Внутрь окна — всегда; после его конца — только если окно стояло в конце ленты
    const toAdd = ids.filter((id) => id > viewportMin && (isAtEnd || id < viewportMax));
    if (!toAdd.length) return;
    const merged = orderHistoryIds([...viewportIds, ...toAdd.filter((id) => !viewportIds.includes(id))]);
    global = safeReplaceViewportIds(
      global, chatId, threadId, merged.slice(-MESSAGE_LIST_VIEWPORT_LIMIT), tabId,
    );
  });

  // Список чатов показывает последнее сообщение: оно тоже могло потеряться
  if (threadId === MAIN_THREAD_ID) {
    const newestId = Math.max(...ids);
    const lastId = selectChatLastMessageId(global, chatId);
    if (lastId === undefined || (newestId > lastId && !isLocalMessageId(lastId))) {
      global = updateChatLastMessageId(global, chatId, newestId);
    }
  }

  return global;
}
