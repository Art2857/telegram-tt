import type { ApiMessage } from '../../api/types';
import type { GlobalState, TabArgs } from '../../global/types';
import type { AttributionDto, MessageDto } from '../server/types';
import { MAIN_THREAD_ID } from '../../api/types';

import {
  addChatMessagesById, safeReplaceViewportIds, updateChatMessage, updateListedIds,
} from '../../global/reducers';
import { selectChatMessage, selectViewportIds } from '../../global/selectors';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { buildProxyEntities } from '../../api/proxy/entities';
import { buildProxyArchiveMedia } from '../../api/proxy/media';

/** Значок вложения без файла: опрос, геопозиция, контакт */
export const MEDIA_ICONS: Record<string, string> = {
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
 * Удалённое сообщение из серверного архива → сообщение Web A с пометкой «удалено». Файл берётся из архива,
 * а если его там нет, вместо него — название и подпись «не сохранён»
 */
export function tombstoneToApiMessage(dto: MessageDto, chatId: string): ApiMessage {
  const media = dto.isMediaUnavailable ? undefined : buildProxyArchiveMedia(dto);
  const icon = !media && !dto.isMediaUnavailable && dto.media && dto.media.kind !== 'webpage'
    ? MEDIA_ICONS[dto.media.kind] ?? '📎' : undefined;
  const prefix = icon ? `${icon} ` : '';
  const entities = buildProxyEntities(dto.entities, dto.accountId)
    .map((entity) => ({ ...entity, offset: entity.offset + prefix.length }));
  const text = prefix || dto.text ? { text: `${prefix}${dto.text}`.trimEnd(), entities } : undefined;

  return {
    id: dto.msgId,
    chatId,
    date: toUnix(dto.date),
    isOutgoing: dto.isOutgoing,
    senderId: dto.senderId ? String(dto.senderId) : undefined,
    content: { ...media, text },
    pxgMediaFallback: dto.isMediaUnavailable ? { fileName: dto.media?.fileName, isUnavailable: true } : undefined,
    editDate: dto.editDate ? toUnix(dto.editDate) : undefined,
    isEdited: Boolean(dto.editDate) || undefined,
    pxgDeletedAt: dto.deleted ? toUnix(dto.deleted.at) : toUnix(dto.date),
    pxgDeletedBy: dto.deleted?.byName || undefined,
  };
}

/**
 * Вставляет надгробия (с сервера или из локального архива) в ленту основного потока чата:
 * в сообщения, в список загруженных и в видимое окно — те, что попадают между уже показанными
 * сообщениями, а если окно дошло до конца чата, то и удалённые после последнего живого сообщения.
 */
export function insertTombstones<T extends GlobalState>(
  global: T,
  chatId: string,
  tombstones: ApiMessage[],
  options: { isAtEnd?: boolean; isFromServer?: boolean },
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): T {
  const fresh: ApiMessage[] = [];
  tombstones.forEach((message) => {
    const existing = selectChatMessage(global, chatId, message.id);
    if (!existing) {
      fresh.push(message);
      return;
    }
    // The server knows who deleted the message and has its file; the device keeps only what it saw
    if (options.isFromServer && existing.pxgDeletedAt) {
      global = updateChatMessage(global, chatId, message.id, message.pxgMediaFallback
        ? { pxgDeletedBy: message.pxgDeletedBy }
        : { pxgDeletedBy: message.pxgDeletedBy, content: message.content });
    }
  });
  if (fresh.length === 0) return global;

  const byId: Record<number, ApiMessage> = {};
  fresh.forEach((message) => {
    byId[message.id] = message;
  });
  const ids = fresh.map((message) => message.id);

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
