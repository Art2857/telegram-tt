import type {
  ApiFormattedText, ApiMessage, MediaContent, PxgEditVersion,
} from '../../api/types';

import { PXG_ARCHIVE_IDB_STORE } from '../../util/browser/idb';
import { unique } from '../../util/iteratees';
import { MEDIA_ICONS } from './serverTombstones';

/** PLAN.md 9.4: without a server the device keeps deleted messages and edits for a limited time */
const RETENTION_SECONDS = 30 * 24 * 60 * 60;

type LocalTombstone = Pick<ApiMessage, 'id' | 'date' | 'isOutgoing' | 'senderId' | 'editDate'> & {
  text?: ApiFormattedText;
  deletedAt: number;
};

export type LocalChatArchive = {
  deleted: Record<number, LocalTombstone>;
  versions: Record<number, PxgEditVersion[]>;
};

/**
 * Local anti-delete archive (L1, PLAN.md 5.2 item 4). A deleted message and the previous versions of an edited one
 * survive a reload on this device, also without a connected server. Keys are `<own user>:<chat>`.
 */
export function archiveDeletedMessages(ownerId: string, messages: ApiMessage[]) {
  const chatIds = unique(messages.map((message) => message.chatId));
  return Promise.all(chatIds.map((chatId) => updateChatArchive(ownerId, chatId, (archive) => {
    messages.filter((message) => message.chatId === chatId).forEach((message) => {
      archive.deleted[message.id] = buildLocalTombstone(message);
    });
  }))).catch(() => undefined);
}

export function archiveEditVersions(ownerId: string, message: ApiMessage) {
  const versions = message.pxgEditHistory;
  if (!versions?.length) return Promise.resolve();
  return updateChatArchive(ownerId, message.chatId, (archive) => {
    archive.versions[message.id] = versions;
  }).catch(() => undefined);
}

export async function readChatArchive(ownerId: string, chatId: string) {
  try {
    return await PXG_ARCHIVE_IDB_STORE.get<LocalChatArchive>(getKey(ownerId, chatId));
  } catch {
    return undefined;
  }
}

/** Deleted messages of the range as Web A messages marked deleted */
export function selectLocalTombstones(
  archive: LocalChatArchive, chatId: string, minId: number, maxId: number,
): ApiMessage[] {
  return Object.values(archive.deleted)
    .filter(({ id }) => id >= minId && id <= maxId)
    .map(({ deletedAt, text, ...fields }) => ({
      ...fields,
      chatId,
      content: { text },
      isEdited: Boolean(fields.editDate) || undefined,
      pxgDeletedAt: deletedAt,
    }));
}

export async function removeFromLocalArchive(ownerId: string, chatId: string, ids: number[]) {
  try {
    await updateChatArchive(ownerId, chatId, (archive) => {
      ids.forEach((id) => {
        delete archive.deleted[id];
        delete archive.versions[id];
      });
    });
  } catch {
    // Storage may be unavailable; the archive then lives only in memory
  }
}

/** Drops what is older than the retention period: by deletion time and by the time a version was captured */
export async function pruneLocalArchive(ownerId: string, now: number) {
  const threshold = now - RETENTION_SECONDS;
  try {
    const keys = (await PXG_ARCHIVE_IDB_STORE.keys()).map(String).filter((key) => key.startsWith(`${ownerId}:`));
    await Promise.all(keys.map((key) => PXG_ARCHIVE_IDB_STORE.update<LocalChatArchive | undefined>(key, (archive) => {
      if (!archive) return undefined;
      const deleted = Object.fromEntries(Object.entries(archive.deleted)
        .filter(([, tombstone]) => tombstone.deletedAt >= threshold));
      const versions = Object.fromEntries(Object.entries(archive.versions)
        .filter(([, list]) => list.some(({ capturedAt }) => capturedAt >= threshold)));
      return { deleted, versions };
    })));
  } catch {
    // Storage may be unavailable; the archive then lives only in memory
  }
}

function updateChatArchive(ownerId: string, chatId: string, apply: (archive: LocalChatArchive) => void) {
  return PXG_ARCHIVE_IDB_STORE.update<LocalChatArchive>(getKey(ownerId, chatId), (current) => {
    const archive = { deleted: { ...current?.deleted }, versions: { ...current?.versions } };
    apply(archive);
    return archive;
  });
}

/** The media object cannot be stored; the text keeps an attachment icon and the caption */
function buildLocalTombstone(message: ApiMessage): LocalTombstone {
  const icon = getMediaIcon(message.content);
  const caption = message.content.text;
  const prefix = icon ? `${icon} ` : '';
  const text = icon || caption ? {
    text: `${prefix}${caption?.text ?? ''}`.trimEnd(),
    entities: caption?.entities?.map((entity) => ({ ...entity, offset: entity.offset + prefix.length })),
  } : undefined;
  return {
    id: message.id,
    date: message.date,
    isOutgoing: message.isOutgoing,
    senderId: message.senderId,
    editDate: message.editDate,
    text,
    deletedAt: message.pxgDeletedAt ?? message.date,
  };
}

function getMediaIcon(content: MediaContent) {
  if (content.photo) return MEDIA_ICONS.photo;
  if (content.video) {
    return content.video.isRound ? MEDIA_ICONS.round : content.video.isGif ? MEDIA_ICONS.gif : MEDIA_ICONS.video;
  }
  if (content.sticker) return MEDIA_ICONS.sticker;
  if (content.voice) return MEDIA_ICONS.voice;
  if (content.audio) return MEDIA_ICONS.audio;
  if (content.document) return MEDIA_ICONS.document;
  if (content.pollId) return MEDIA_ICONS.poll;
  if (content.location) return MEDIA_ICONS.geo;
  if (content.contact) return MEDIA_ICONS.contact;
  return undefined;
}

function getKey(ownerId: string, chatId: string) {
  return `${ownerId}:${chatId}`;
}
