import type { ApiMessage } from '../../api/types';
import type { GlobalState, TabArgs } from '../../global/types';
import type { AttributionDto, MessageDto } from '../server/types';
import { MAIN_THREAD_ID } from '../../api/types';

import {
  addChatMessagesById, safeReplaceViewportIds, updateChatMessage, updateListedIds,
} from '../../global/reducers';
import { selectChatMessage, selectViewportIds } from '../../global/selectors';
import { getCurrentTabId } from '../../util/establishMultitabRole';

/** Значок вложения: тип файла известен, а самого объекта Web A у надгробия нет */
const MEDIA_ICONS: Record<string, string> = {
  photo: '🖼',
  video: '🎬',
  round: '⏺',
  gif: '🎞',
  sticker: '🌟',
  voice: '🎤',
  audio: '🎵',
  document: '📎',
  poll: '📊',
  geo: '📍',
  contact: '👤',
};

/**
 * Удалённое сообщение из серверного архива → сообщение Web A с пометкой «удалено».
 * Медиа восстановить в виде объекта Web A нельзя — остаются текст и значок вложения.
 */
export function tombstoneToApiMessage(dto: MessageDto, chatId: string): ApiMessage {
  const icon = dto.media && dto.media.kind !== 'webpage' ? MEDIA_ICONS[dto.media.kind] ?? '📎' : undefined;
  const text = [icon, dto.text].filter(Boolean).join(' ');

  return {
    id: dto.msgId,
    chatId,
    date: toUnix(dto.date),
    isOutgoing: dto.isOutgoing,
    senderId: dto.senderId ? String(dto.senderId) : undefined,
    content: { text: { text } },
    editDate: dto.editDate ? toUnix(dto.editDate) : undefined,
    isEdited: Boolean(dto.editDate) || undefined,
    pxgDeletedAt: dto.deleted ? toUnix(dto.deleted.at) : toUnix(dto.date),
  };
}

/**
 * Вставляет надгробия в ленту основного потока чата: в сообщения, в список загруженных
 * и в видимое окно — те, что попадают между уже показанными сообщениями, а если окно
 * дошло до конца чата, то и удалённые после последнего живого сообщения.
 */
export function insertTombstones<T extends GlobalState>(
  global: T,
  chatId: string,
  tombstones: MessageDto[],
  options: { isAtEnd?: boolean },
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  const fresh = tombstones.filter((dto) => !selectChatMessage(global, chatId, dto.msgId));
  if (fresh.length === 0) return global;

  const byId: Record<number, ApiMessage> = {};
  fresh.forEach((dto) => {
    byId[dto.msgId] = tombstoneToApiMessage(dto, chatId);
  });
  const ids = fresh.map((dto) => dto.msgId);

  global = addChatMessagesById(global, chatId, byId);
  global = updateListedIds(global, chatId, MAIN_THREAD_ID, ids);

  const viewportIds = selectViewportIds(global, chatId, MAIN_THREAD_ID, tabId) ?? [];
  if (viewportIds.length) {
    const min = viewportIds[0];
    const max = viewportIds[viewportIds.length - 1];
    const inside = ids.filter((id) => id > min && (id < max || options.isAtEnd));
    if (inside.length) {
      global = safeReplaceViewportIds(global, chatId, MAIN_THREAD_ID, [...viewportIds, ...inside], tabId);
    }
  }
  return global;
}

/** «✍ Имя» у исходящих владельца, которые отправил гость; сообщения, которых нет в ленте, пропускаются */
export function applyAttribution<T extends GlobalState>(global: T, chatId: string, entries: AttributionDto[]): T {
  entries.forEach(({ msgId, userId, name }) => {
    const message = selectChatMessage(global, chatId, msgId);
    if (!message || message.pxgSentByName === name) return;
    global = updateChatMessage(global, chatId, msgId, { pxgSentByUserId: userId, pxgSentByName: name });
  });
  return global;
}

function toUnix(iso: string) {
  return Math.floor(Date.parse(iso) / 1000);
}
