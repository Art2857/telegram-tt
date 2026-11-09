import type { ApiChat, ApiMessage, ApiUser } from '../api/types';
import type { DownloadedChat } from './downloadedChat';

/** Зарезервированный диапазон ID локальных скачанных чатов: не пересекается с Telegram и прокси */
const BASE_ID = 8_900_000_000_000_000;
const USER_OFFSET = 1_000_000_000;

const messagesByChatId = new Map<string, ApiMessage[]>();

function fnv(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function buildDownloadedChatState(downloaded: DownloadedChat): {
  chat: ApiChat;
  chatId: string;
  users: ApiUser[];
  messages: ApiMessage[];
} {
  const hash = fnv(`${downloaded.title}:${downloaded.exportedAt}:${downloaded.peerId}`);
  const chatId = String(BASE_ID + (hash % 1_000_000_000));
  const isPrivate = downloaded.peerId > 0;
  const chat: ApiChat = {
    id: chatId,
    type: isPrivate ? 'chatTypePrivate' : 'chatTypeSuperGroup',
    title: downloaded.title,
    isListed: true,
    isMin: false,
    pxgDownloaded: true,
  };

  const names = new Map<number, string>(downloaded.users.map((user) => [user.userId, user.name]));
  for (const message of downloaded.messages) {
    if (message.senderId && message.senderName && !names.has(message.senderId)) {
      names.set(message.senderId, message.senderName);
    }
  }
  const userByTgId = new Map<number, ApiUser>();
  const users: ApiUser[] = [];
  for (const [tgUserId, name] of names) {
    const user: ApiUser = {
      id: String(BASE_ID + USER_OFFSET + (tgUserId % 1_000_000_000)),
      type: 'userTypeRegular',
      firstName: name,
      phoneNumber: '',
      isMin: false,
      noStatus: true,
    };
    userByTgId.set(tgUserId, user);
    users.push(user);
  }

  const messages: ApiMessage[] = [];
  for (const message of downloaded.messages) {
    const sender = message.senderId ? userByTgId.get(message.senderId) : undefined;
    const body = message.text
      || (message.mediaKind ? `[${message.mediaKind}]` : '');
    const date = Math.floor(Date.parse(message.date) / 1000);
    const media = message.mediaKey ? downloaded.media[message.mediaKey] : undefined;
    const content: ApiMessage['content'] = {};
    if (message.text) content.text = { text: message.text, entities: [] };
    if (media?.mimeType.startsWith('image/')) {
      content.photo = {
        mediaType: 'photo',
        id: `pxg-downloaded-${message.id}`,
        date,
        sizes: [{
          type: 'x',
          width: media.width ?? 1000,
          height: media.height ?? 1000,
        }],
        blobUrl: media.url,
      };
    } else if (media?.mimeType.startsWith('video/')) {
      content.video = {
        mediaType: 'video',
        id: `pxg-downloaded-${message.id}`,
        mimeType: media.mimeType,
        duration: media.duration ?? 0,
        fileName: media.fileName ?? 'video.mp4',
        width: media.width,
        height: media.height,
        size: media.size ?? 0,
        blobUrl: media.url,
        supportsStreaming: true,
        isGif: media.kind === 'gif',
      };
    } else if (media?.kind === 'voice') {
      content.voice = {
        mediaType: 'voice',
        id: `pxg-downloaded-${message.id}`,
        duration: media.duration ?? 0,
        size: media.size ?? 0,
        blobUrl: media.url,
      };
    } else if (media?.mimeType.startsWith('audio/')) {
      content.audio = {
        mediaType: 'audio',
        id: `pxg-downloaded-${message.id}`,
        mimeType: media.mimeType,
        fileName: media.fileName ?? 'audio',
        duration: media.duration ?? 0,
        size: media.size ?? 0,
        blobUrl: media.url,
      };
    } else if (media?.kind === 'sticker' || media?.kind === 'emoji') {
      content.sticker = {
        mediaType: 'sticker',
        id: `pxg-downloaded-${message.id}`,
        stickerSetInfo: { isMissing: true },
        isLottie: media.mimeType.includes('tgsticker'),
        isVideo: media.mimeType.includes('webm'),
        width: media.width,
        height: media.height,
        blobUrl: media.url,
      };
    } else if (media) {
      content.document = {
        mediaType: 'document',
        id: `pxg-downloaded-${message.id}`,
        fileName: media.fileName ?? 'file',
        size: media.size ?? 0,
        mimeType: media.mimeType,
        blobUrl: media.url,
      };
    }
    if (
      !content.text && !content.photo && !content.video && !content.voice && !content.audio
      && !content.sticker && !content.document
    ) {
      content.text = { text: body, entities: [] };
    }
    messages.push({
      id: message.id,
      chatId,
      date,
      ...(message.isOutgoing ? {} : { senderId: sender?.id }),
      isOutgoing: message.isOutgoing,
      ...(message.isDeleted ? { pxgDeletedAt: date } : {}),
      content,
    });
  }

  messagesByChatId.set(chatId, messages);
  return { chat, chatId, users, messages };
}

export function getDownloadedChatMessages(chatId: string): ApiMessage[] | undefined {
  return messagesByChatId.get(chatId);
}
