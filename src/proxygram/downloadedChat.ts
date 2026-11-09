import { unzipSync } from 'fflate';

/** Ограничение на файл, который читаем целиком: дальше нужен потоковый разбор ZIP */
const MAX_FILE_BYTES = 512 * 1024 * 1024;

export type DownloadedMessage = {
  id: number;
  date: string;
  senderId?: number;
  senderName?: string;
  text: string;
  isOutgoing: boolean;
  isDeleted: boolean;
  isEdited: boolean;
  mediaKind?: string;
  mediaKey?: string;
  /** Blob URL файла из ZIP; живёт до закрытия окна */
  mediaUrl?: string;
  mediaMime?: string;
};

export type DownloadedChat = {
  title: string;
  peerId: number;
  exportedAt: string;
  messageCount: number;
  messages: DownloadedMessage[];
  media: Record<string, { url: string; mimeType: string }>;
  users: { userId: number; name: string }[];
};

type PxgManifest = {
  format: string;
  version: number;
  exportedAt: string;
  accountId: string;
  peerId: number;
  messageCount: number;
};

type PxgChatFile = {
  peer: { peerId: number; title: string | null };
  users: { userId: number; firstName: string | null; lastName: string | null; username: string | null }[];
};

type PxgIndex = {
  chunks: { file: string }[];
};

type PxgMessageRow = {
  msgId: number;
  date: string;
  senderId: number | null;
  text: string;
  isOutgoing: boolean;
  deletedAt: string | null;
  editDate: string | null;
  media: { key?: string; kind?: string } | null;
  versions?: unknown[];
};

type PxgMediaMap = {
  files: { mediaKey: string; path: string; mimeType: string | null }[];
};

function decode(files: Record<string, Uint8Array>, name: string): string {
  const data = files[name];
  if (!data) throw new Error(`missing ${name}`);
  return new TextDecoder().decode(data);
}

function parseJson<T>(files: Record<string, Uint8Array>, name: string): T {
  return JSON.parse(decode(files, name)) as T;
}

/** Разбор .pxgchat версии 1: только то, что уже лежит в файле, без сервера и Telegram */
export async function parsePxgChatFile(file: File): Promise<DownloadedChat> {
  if (file.size > MAX_FILE_BYTES) throw new Error('too_large');
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => /^(pxg\/|result\.json$)/.test(entry.name),
  });

  const manifest = parseJson<PxgManifest>(files, 'pxg/manifest.json');
  if (manifest.format !== 'pxgchat' || manifest.version !== 1) throw new Error('bad_format');
  const chat = parseJson<PxgChatFile>(files, 'pxg/chat.json');
  const index = parseJson<PxgIndex>(files, 'pxg/index.json');

  const names = new Map<number, string>();
  for (const user of chat.users) {
    names.set(
      user.userId,
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || String(user.userId),
    );
  }

  const messages: DownloadedMessage[] = [];
  for (const chunk of index.chunks) {
    const lines = decode(files, chunk.file).split('\n').filter(Boolean);
    for (const line of lines) {
      const row = JSON.parse(line) as PxgMessageRow;
      messages.push({
        id: row.msgId,
        date: row.date,
        senderId: row.senderId ?? undefined,
        senderName: typeof row.senderId === 'number' ? names.get(row.senderId) ?? undefined : undefined,
        text: row.text,
        isOutgoing: row.isOutgoing,
        isDeleted: Boolean(row.deletedAt),
        isEdited: Boolean(row.editDate) || Boolean(row.versions?.length),
        mediaKind: row.media?.kind ?? undefined,
        mediaKey: row.media?.key,
      });
    }
  }
  messages.sort((left, right) => left.id - right.id);

  const media: Record<string, { url: string; mimeType: string }> = {};
  if (files['pxg/media.json']) {
    const map = parseJson<PxgMediaMap>(files, 'pxg/media.json');
    for (const mediaFile of map.files) {
      const data = files[mediaFile.path];
      if (!data) continue;
      const mimeType = mediaFile.mimeType || 'application/octet-stream';
      media[mediaFile.mediaKey] = {
        url: URL.createObjectURL(new Blob([data], { type: mimeType })),
        mimeType,
      };
    }
    for (const message of messages) {
      if (!message.mediaKey) continue;
      const found = media[message.mediaKey];
      if (!found) continue;
      message.mediaUrl = found.url;
      message.mediaMime = found.mimeType;
    }
  }

  return {
    title: chat.peer.title ?? String(chat.peer.peerId),
    peerId: chat.peer.peerId,
    exportedAt: manifest.exportedAt,
    messageCount: messages.length,
    messages,
    media,
    users: chat.users.map((user) => ({ userId: user.userId, name: names.get(user.userId) ?? String(user.userId) })),
  };
}

/** Закрыть файл: Blob URL больше не нужны */
export function releaseDownloadedChat(chat: DownloadedChat): void {
  for (const item of Object.values(chat.media)) URL.revokeObjectURL(item.url);
}
