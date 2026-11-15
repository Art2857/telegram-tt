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

export function historyKey(userId: string, accountId: string, peerId: number, topicId?: number) {
  return `${userId}:${accountId}:${peerId}:${topicId || 0}`;
}

function chatPrefix(userId: string, accountId: string, peerId: number) {
  return `${userId}:${accountId}:${peerId}:`;
}

function schedule(key: string, add: MessageDto[], remove: number[] = []) {
  const entry = pending.get(key) || { add: [], remove: new Set<number>() };
  entry.add.push(...add);
  remove.forEach((id) => entry.remove.add(id));
  pending.set(key, entry);
  writeTimer ??= setTimeout(() => {
    writeTimer = undefined;
    void flush();
  }, WRITE_DELAY_MS);
}

async function flush() {
  const batch = [...pending];
  pending.clear();
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
      // A full or blocked storage only means the history comes from the server again
    }
  }
  void trim();
}

let isTrimming = false;
async function trim() {
  if (isTrimming) return;
  isTrimming = true;
  try {
    const keys = (await PXG_MESSAGES_IDB_STORE.keys()) as string[];
    if (keys.length <= MAX_CHATS) return;
    const records = await PXG_MESSAGES_IDB_STORE.getMany<ChatHistory | undefined>(keys);
    const byAge = keys.map((key, index) => ({ key, usedAt: records[index]?.usedAt || 0 }))
      .sort((a, b) => a.usedAt - b.usedAt);
    await PXG_MESSAGES_IDB_STORE.delMany(byAge.slice(0, keys.length - MAX_CHATS).map(({ key }) => key));
  } catch {
    // Trimming waits for the next write
  } finally {
    isTrimming = false;
  }
}

/** A page of the feed, a single message or a change that came while the guest was away */
export function rememberMessages(key: string, messages: MessageDto[]) {
  if (messages.length) schedule(key, messages);
}

/** Deleted or hidden: gone from the device too, in the chat and its topics */
export function forgetMessages(userId: string, accountId: string, peerId: number, msgIds: number[]) {
  if (!msgIds.length) return;
  void PXG_MESSAGES_IDB_STORE.keys().then((keys) => {
    (keys as string[]).filter((key) => key.startsWith(chatPrefix(userId, accountId, peerId)))
      .forEach((key) => schedule(key, [], msgIds));
  }).catch(() => undefined);
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
export async function keepOnlyChats(userId: string, keep: ReadonlySet<string>) {
  try {
    const keys = (await PXG_MESSAGES_IDB_STORE.keys()) as string[];
    const gone = keys.filter((key) => {
      const [owner, accountId, peerId] = key.split(':');
      return owner === userId && !keep.has(`${accountId}:${peerId}`);
    });
    if (gone.length) await PXG_MESSAGES_IDB_STORE.delMany(gone);
  } catch {
    // The next load tries again
  }
}

/** Signing out takes the person's history off the device */
export async function forgetUserHistory(userId: string) {
  try {
    const keys = (await PXG_MESSAGES_IDB_STORE.keys()) as string[];
    await PXG_MESSAGES_IDB_STORE.delMany(keys.filter((key) => key.startsWith(`${userId}:`)));
  } catch {
    // Nothing to do without storage
  }
}
