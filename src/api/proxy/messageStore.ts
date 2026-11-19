import type { MessageDto } from '../../proxygram/server/types';

import { PXG_MESSAGES_IDB_STORE } from '../../util/browser/idb';

/**
 * The guest's chat history on the device (docs/spec/11 C6). Every page the server sent is kept per chat and topic, so
 * the feed scrolls without a network and a reload shows it at once; the server's answer replaces it when it comes.
 * Only what the guest has already seen is kept, and a chat whose access ended or changed is wiped with it
 */
type ChatHistory = {
  /** Newest first, unique by msgId */
  messages: MessageDto[];
  usedAt: number;
};

/** Enough to scroll a long chat offline; older pages come from the server again */
const MAX_MESSAGES_PER_CHAT = 3000;
/** Least recently opened chats go first beyond this */
const MAX_CHATS = 300;
const WRITE_DELAY_MS = 400;

const pending = new Map<string, { add: MessageDto[]; remove: Set<number> }>();
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let storageWrites = Promise.resolve();

export function historyKey(userId: string, accountId: string, peerId: number, topicId?: number) {
  return `${userId}:${accountId}:${peerId}:${topicId || 0}`;
}

function chatPrefix(userId: string, accountId: string, peerId: number) {
  return `${userId}:${accountId}:${peerId}:`;
}

function schedule(key: string, add: MessageDto[]) {
  const entry = pending.get(key) || { add: [], remove: new Set<number>() };
  entry.add.push(...add);
  pending.set(key, entry);
  writeTimer ??= setTimeout(() => {
    writeTimer = undefined;
    void flush();
  }, WRITE_DELAY_MS);
}

// A purge sits after any write already started, and before later batches
function writeInOrder(work: () => Promise<void>) {
  storageWrites = storageWrites.then(work, work);
  return storageWrites;
}

function flush() {
  const batch = [...pending];
  pending.clear();
  if (!batch.length) return storageWrites;
  return writeInOrder(async () => {
    for (const [key, { add, remove }] of batch) {
      try {
        await PXG_MESSAGES_IDB_STORE.update<ChatHistory | undefined>(key, (current) => {
          const byId = new Map((current?.messages || []).map((dto) => [dto.msgId, dto]));
          add.forEach((dto) => byId.set(dto.msgId, dto));
          remove.forEach((id) => byId.delete(id));
          const messages = [...byId.values()].sort((a, b) => b.msgId - a.msgId).slice(0, MAX_MESSAGES_PER_CHAT);
          return { messages, usedAt: Date.now() };
        });
      } catch {
        // The history comes from the server when the storage is full or blocked
      }
    }
    await trim();
  });
}

async function trim() {
  try {
    const keys = (await PXG_MESSAGES_IDB_STORE.keys()) as string[];
    if (keys.length <= MAX_CHATS) return;
    const records = await PXG_MESSAGES_IDB_STORE.getMany<ChatHistory | undefined>(keys);
    const byAge = keys.map((key, index) => ({ key, usedAt: records[index]?.usedAt || 0 }))
      .sort((a, b) => a.usedAt - b.usedAt);
    await PXG_MESSAGES_IDB_STORE.delMany(byAge.slice(0, keys.length - MAX_CHATS).map(({ key }) => key));
  } catch {
    // Trimming waits for the next write
  }
}

/** A page of the feed, a single message or a change that came while the guest was away */
export function rememberMessages(key: string, messages: MessageDto[]) {
  if (messages.length) schedule(key, messages);
}

/** Deleted or hidden: gone from the device too, in the chat and its topics */
export function forgetMessages(userId: string, accountId: string, peerId: number, msgIds: number[]) {
  if (!msgIds.length) return;
  const prefix = chatPrefix(userId, accountId, peerId);
  const removed = new Set(msgIds);
  for (const [key, record] of pending) {
    if (key.startsWith(prefix)) removed.forEach((id) => record.remove.add(id));
  }
  void writeInOrder(async () => {
    try {
      const keys = (await PXG_MESSAGES_IDB_STORE.keys()) as string[];
      for (const key of keys.filter((item) => item.startsWith(prefix))) {
        await PXG_MESSAGES_IDB_STORE.update<ChatHistory | undefined>(key, (record) => record && {
          ...record, messages: record.messages.filter(({ msgId }) => !removed.has(msgId)),
        });
      }
    } catch {
      // The history from the server reflects the deletion on the next load
    }
  });
}

/**
 * The page Web A asks for, from what the device has: messages older than `offsetId` with `addOffset` newer ones,
 * newest first like the server. Nothing saved — undefined, and the error of the server stays
 */
export async function readHistory(
  key: string, offsetId: number | undefined, addOffset: number, limit: number,
): Promise<MessageDto[] | undefined> {
  try {
    await flush();
    const record = await PXG_MESSAGES_IDB_STORE.get<ChatHistory | undefined>(key);
    if (!record?.messages.length) return undefined;
    const { messages } = record;
    // The first message not newer than the offset; no offset — the newest
    let start = offsetId ? messages.findIndex((dto) => dto.msgId <= offsetId) : 0;
    if (start === -1) start = messages.length;
    const from = Math.max(0, start + addOffset);
    return messages.slice(from, from + limit);
  } catch {
    return undefined;
  }
}

/** One saved message: a reply or a pinned one opened offline */
export async function readMessage(key: string, msgId: number): Promise<MessageDto | undefined> {
  try {
    await storageWrites;
    const record = await PXG_MESSAGES_IDB_STORE.get<ChatHistory | undefined>(key);
    return record?.messages.find((dto) => dto.msgId === msgId);
  } catch {
    return undefined;
  }
}

/**
 * A chat whose access ended, paused or narrowed leaves the device with everything the guest had of it;
 * `keep` is every chat (`${accountId}:${peerId}`) that stays as it was
 */
export function keepOnlyChats(userId: string, keep: ReadonlySet<string>) {
  return purge((key) => {
    const [owner, accountId, peerId] = key.split(':');
    return owner === userId && !keep.has(`${accountId}:${peerId}`);
  });
}

/** Signing out takes the person's history off the device */
export function forgetUserHistory(userId: string) {
  return purge((key) => key.startsWith(`${userId}:`));
}

function purge(shouldRemove: (key: string) => boolean) {
  for (const key of pending.keys()) {
    if (shouldRemove(key)) pending.delete(key);
  }
  return writeInOrder(async () => {
    try {
      const keys = (await PXG_MESSAGES_IDB_STORE.keys()) as string[];
      const removed = keys.filter(shouldRemove);
      if (removed.length) await PXG_MESSAGES_IDB_STORE.delMany(removed);
    } catch {
      // The next load tries again
    }
  });
}
