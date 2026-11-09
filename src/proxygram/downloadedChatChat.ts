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
    messages.push({
      id: message.id,
      chatId,
      date: Math.floor(Date.parse(message.date) / 1000),
      ...(message.isOutgoing ? {} : { senderId: sender?.id }),
      isOutgoing: message.isOutgoing,
      ...(message.isDeleted ? { pxgDeletedAt: Math.floor(Date.parse(message.date) / 1000) } : {}),
      content: {
        text: { text: body, entities: [] },
      },
    });
  }

  messagesByChatId.set(chatId, messages);
  return { chat, chatId, users, messages };
}

export function getDownloadedChatMessages(chatId: string): ApiMessage[] | undefined {
  return messagesByChatId.get(chatId);
}
