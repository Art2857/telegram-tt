import { getActions, getGlobal, setGlobal } from '../global';

import type { ApiMessage } from '../api/types';
import type { ThreadId } from '../types';

import { SERVICE_NOTIFICATIONS_USER_ID } from '../config';
import { getIsSavedDialog } from '../global/helpers';
import { selectChat, selectListedIds } from '../global/selectors';
import { isLocalMessageId } from '../util/keys/messageKey';
import { callApi } from '../api/gramjs';
import { isProxyGuest } from '../api/proxy';
import { getPxgState } from './server/store';
import { applyTailMessages, planTailMerge } from './historyTail';

/** Сколько последних сообщений сверяется: обычно хватает одной небольшой страницы */
const TAIL_LIMIT = 30;
/** Разрыв больше страницы — догружаем страницы постарше, пока лента не состыкуется */
const OLDER_PAGE_LIMIT = 100;
const MAX_OLDER_PAGES = 3;
/** Один чат не сверяется чаще: вход в чат и плановая сверка */
const MIN_INTERVAL_MS = 15_000;
/** Возврат в приложение и переподключение — повод сверить сразу, но не чаще этого */
const MIN_FORCED_INTERVAL_MS = 3_000;
/** Найден разрыв — заодно полная синхронизация списка чатов (Web A `sync`), не чаще этого */
const FULL_SYNC_INTERVAL_MS = 5 * 60_000;

export type TailCheckReason = 'open' | 'resume' | 'reconnect' | 'periodic';

const lastCheckAt = new Map<string, number>();
const inFlight = new Set<string>();
let lastFullSyncAt = 0;
let gapsFound = 0;

/** Сколько раз сверка уже нашла потерянные сообщения за эту загрузку страницы (для отладки и проверок) */
export function getTailGapsFound() {
  return gapsFound;
}

/**
 * Сверяет последние сообщения потока с источником — Telegram у своего аккаунта, сервер Proxygram у прокси-чата —
 * и вставляет то, что потерялось. Ничего не удаляет: удалённое приходит своими обновлениями (и антиудаление
 * оставляет его в ленте), а случайное расхождение не должно стирать сообщения.
 */
export async function checkThreadTail(chatId: string, threadId: ThreadId, reason: TailCheckReason): Promise<number> {
  const key = `${chatId}_${threadId}`;
  if (inFlight.has(key)) return 0;
  const now = Date.now();
  const minInterval = reason === 'open' || reason === 'periodic' ? MIN_INTERVAL_MS : MIN_FORCED_INTERVAL_MS;
  if (now - (lastCheckAt.get(key) ?? 0) < minInterval) return 0;

  let global = getGlobal();
  const chat = selectChat(global, chatId);
  if (!chat || chat.pxgDownloaded || chatId === SERVICE_NOTIFICATIONS_USER_ID) return 0;
  // Лента ещё не загружена — Web A загрузит её с источника сам
  const listedIds = selectListedIds(global, chatId, threadId);
  if (!listedIds) return 0;
  // Отправка в пути: её сообщение у источника ещё под настоящим номером, а в ленте под временным — сверим позже
  if (listedIds.some(isLocalMessageId)) return 0;
  if (!isSourceReady(Boolean(chat.pxgProxy))) return 0;

  const isSavedDialog = getIsSavedDialog(chatId, threadId, global.currentUserId);
  const sourceChat = isSavedDialog ? selectChat(global, String(threadId)) : chat;
  if (!sourceChat) return 0;

  inFlight.add(key);
  lastCheckAt.set(key, now);
  try {
    const first = await callApi('fetchMessages', {
      chat: sourceChat, threadId, limit: TAIL_LIMIT, isSavedDialog,
    });
    if (!first) return 0;
    let messages: ApiMessage[] = first.messages;
    let hasReachedStart = first.messages.length < TAIL_LIMIT;
    let plan = planTailMerge(selectListedIds(getGlobal(), chatId, threadId), messages.map(({ id }) => id),
      hasReachedStart);

    for (let page = 0; plan.kind === 'detached' && page < MAX_OLDER_PAGES; page++) {
      const oldestId = Math.min(...messages.map(({ id }) => id));
      const older = await callApi('fetchMessages', {
        chat: sourceChat, threadId, offsetId: oldestId, limit: OLDER_PAGE_LIMIT, isSavedDialog,
      });
      if (!older) return 0;
      messages = [...older.messages.filter(({ id }) => id < oldestId), ...messages];
      hasReachedStart = older.messages.length < OLDER_PAGE_LIMIT;
      plan = planTailMerge(selectListedIds(getGlobal(), chatId, threadId), messages.map(({ id }) => id),
        hasReachedStart);
    }
    if (plan.kind === 'ok') return 0;

    global = getGlobal();
    // Пока шёл запрос, началась отправка — её сообщение могло попасть в ответ, лучше сверить в следующий раз
    if (selectListedIds(global, chatId, threadId)?.some(isLocalMessageId)) {
      lastCheckAt.delete(key);
      return 0;
    }
    const tabIds = Object.keys(global.byTabId).map(Number);
    global = applyTailMessages(global, chatId, threadId, messages, plan.missingIds, tabIds, plan.kind === 'detached');
    setGlobal(global);

    gapsFound++;
    // eslint-disable-next-line no-console
    console.warn(`[PXG] History check (${reason}): ${plan.missingIds.length} missed message(s) restored in ${chatId}`);
    onGapFound(chatId, Boolean(chat.pxgProxy));
    return plan.missingIds.length;
  } catch {
    // Нет связи или чат недоступен — сверим в следующий раз
    lastCheckAt.delete(key);
    return 0;
  } finally {
    inFlight.delete(key);
  }
}

function isSourceReady(isProxyChat: boolean) {
  if (isProxyChat) return getPxgState().connection === 'online';
  const global = getGlobal();
  return !isProxyGuest() && global.connectionState === 'connectionStateReady' && Boolean(global.isSynced)
    && !global.isSyncing && !global.isFetchingDifference;
}

/**
 * Сообщения потерялись — значит, сломан поток, который должен был их принести, и другие чаты тоже могут отставать:
 * догоняем пропущенное и обновляем чат в списке
 */
function onGapFound(chatId: string, isProxyChat: boolean) {
  const actions = getActions();
  actions.requestChatUpdate({ chatId });
  if (isProxyChat) {
    actions.syncProxyChanges();
    return;
  }
  void callApi('pxgRequestDifference');
  const global = getGlobal();
  if (Date.now() - lastFullSyncAt > FULL_SYNC_INTERVAL_MS && !global.isSyncing) {
    lastFullSyncAt = Date.now();
    actions.sync();
  }
}

/** Догнать пропущенное у своей сессии Telegram — при возврате в приложение и восстановлении сети */
export function requestCatchUp() {
  if (isProxyGuest()) {
    getActions().syncProxyChanges();
    return;
  }
  const global = getGlobal();
  if (global.connectionState !== 'connectionStateReady') return;
  void callApi('pxgRequestDifference');
  if (getPxgState().connection === 'online') getActions().syncProxyChanges();
}
