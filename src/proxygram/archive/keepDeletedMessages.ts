import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { updateChatMessage } from '../../global/reducers';
import { selectChatMessage, selectCommonBoxChatId } from '../../global/selectors';
import { getServerTime } from '../../util/serverTime';

/**
 * Антиудаление на устройстве (L1, PLAN.md 9). Вместо удаления сообщение остаётся в чате
 * с пометкой `pxgDeletedAt`. Не сохраняется то, что правила Telegram API требуют дать удалить:
 * сообщения с таймером автоудаления и самоуничтожающиеся медиа. Служебные сообщения тоже
 * не храним — в них нечего терять.
 */
export function keepDeletedMessages<T extends GlobalState>(
  global: T, chatId: string | undefined, ids: number[],
): { global: T; remainingIds: number[]; kept: ApiMessage[] } {
  const now = getServerTime();
  const remainingIds: number[] = [];
  const kept: ApiMessage[] = [];

  ids.forEach((id) => {
    const messageChatId = chatId ?? selectCommonBoxChatId(global, id);
    const message = messageChatId ? selectChatMessage(global, messageChatId, id) : undefined;
    // PXG: Proxy archives decide visibility on the server; a missing row must disappear
    const isProxy = messageChatId && global.chats.byId[messageChatId]?.pxgProxy;

    if (isProxy || !messageChatId || !message || !canKeepDeleted(message)) {
      remainingIds.push(id);
      return;
    }

    global = updateChatMessage(global, messageChatId, id, { pxgDeletedAt: now });
    kept.push({ ...message, pxgDeletedAt: now });
  });

  return { global, remainingIds, kept };
}

function canKeepDeleted(message: ApiMessage) {
  return !message.ttlPeriod
    && !message.content.ttlSeconds
    && !message.content.action
    && !message.pxgDeletedAt;
}
