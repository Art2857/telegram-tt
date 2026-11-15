import type { MethodArgs } from '../gramjs/methods/types';
import type { ApiAttachment, ApiMessage } from '../types';

import { PXG_SEND_QUEUE_IDB_STORE } from '../../util/browser/idb';

type SendParams = MethodArgs<'sendMessage'>[0];
export type SendRequest = NonNullable<ApiMessage['pxgSendRequest']>;

/** The attachment as the device keeps it: blob URLs die with the page, the bytes stay */
type StoredAttachment = Omit<ApiAttachment, 'blobUrl' | 'compressedBlobUrl' | 'previewBlobUrl'> & {
  blob: Blob;
  previewBlob?: Blob;
};

/** What a send needs to start again after a reload: the parameters without the chat and the local message */
export type StoredDraft = Omit<SendParams, 'chat' | 'localMessage' | 'attachment'> & {
  attachment?: StoredAttachment;
};

/**
 * A send of the guest waiting on this device (docs/spec/11 C9): it shows with the clock in the feed, outlives closing
 * the tab and goes by itself when the server is reachable again, in the order it was written. The key of the request
 * (`requestId` = `clientRequestId`) makes the server send it once however often it is repeated
 */
export type QueuedSend = {
  userId: string;
  requestId: string;
  chatId: string;
  createdAt: number;
  localMessage: ApiMessage;
  /** The fixed request once the file is on the server: a retry repeats it byte for byte */
  request?: SendRequest;
  /** How to build the request again, for a file whose upload did not finish or whose upload the server dropped */
  draft?: StoredDraft;
  /** The started upload: the next attempt continues it instead of uploading from the start */
  uploadId?: string;
  groupedId?: string;
  /** The guest repeated a refused send: the server may run its failed job again */
  isRetry?: boolean;
  /** The server refused: the message stays failed with its reason until the guest repeats or deletes it */
  error?: string;
};

const items = new Map<string, QueuedSend>();
let loadedUserId: string | undefined;
let loading: Promise<void> | undefined;

function storageKey(userId: string, requestId: string) {
  return `${userId}:${requestId}`;
}

/** Without a working storage the queue still lives in this tab: only surviving a reload is lost */
function persist(item: QueuedSend) {
  PXG_SEND_QUEUE_IDB_STORE.set(storageKey(item.userId, item.requestId), item).catch(() => {
    // A full or blocked storage keeps the send in memory only
  });
}

export function loadSendQueue(userId: string): Promise<void> {
  if (loadedUserId === userId) return loading || Promise.resolve();
  loadedUserId = userId;
  items.clear();
  loading = (async () => {
    try {
      const entries = await PXG_SEND_QUEUE_IDB_STORE.entries();
      entries.forEach(([key, value]) => {
        const item = value as QueuedSend;
        if (typeof key !== 'string' || !key.startsWith(`${userId}:`) || item?.userId !== userId) return;
        // A send started in this tab before the load finished is newer than the stored one
        if (!items.has(item.requestId)) items.set(item.requestId, item);
      });
    } catch {
      // The queue of the previous session is lost; new sends still work
    }
  })();
  return loading;
}

export function getQueuedSends(): QueuedSend[] {
  return [...items.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function getQueuedSend(requestId: string) {
  return items.get(requestId);
}

export function findQueuedSendByLocalId(chatId: string, localId: number) {
  return [...items.values()].find((item) => item.chatId === chatId && item.localMessage.id === localId);
}

export function putQueuedSend(item: QueuedSend) {
  if (loadedUserId !== item.userId) return;
  items.set(item.requestId, item);
  persist(item);
}

export function updateQueuedSend(requestId: string, change: Partial<QueuedSend>) {
  const item = items.get(requestId);
  if (!item) return;
  const updated = { ...item, ...change };
  // `undefined` in the change removes the field, as IndexedDB keeps no undefined values anyway
  (Object.keys(change) as (keyof QueuedSend)[]).forEach((key) => {
    if (change[key] === undefined) delete updated[key];
  });
  items.set(requestId, updated);
  persist(updated);
}

export function dropQueuedSend(requestId: string) {
  const item = items.get(requestId);
  if (!item) return;
  items.delete(requestId);
  PXG_SEND_QUEUE_IDB_STORE.del(storageKey(item.userId, requestId)).catch(() => {
    // The next load finds a sent message: the server answers it as already sent
  });
}

/** Signing out takes this person's unsent messages off the device */
export async function forgetUserSends(userId: string) {
  if (loadedUserId === userId) items.clear();
  try {
    const keys = (await PXG_SEND_QUEUE_IDB_STORE.keys()) as string[];
    await PXG_SEND_QUEUE_IDB_STORE.delMany(keys.filter((key) => key.startsWith(`${userId}:`)));
  } catch {
    // Storage can be unavailable
  }
}

/** Blob URLs of the page cannot be kept: the bytes are read once, while the page still has them */
export async function storeDraft(params: SendParams): Promise<StoredDraft | undefined> {
  const {
    chat: _chat, localMessage: _localMessage, attachment, ...rest
  } = params;
  if (!attachment) return rest;
  try {
    const blob = attachment.blob || await (await fetch(attachment.compressedBlobUrl || attachment.blobUrl)).blob();
    const previewBlob = attachment.previewBlobUrl
      ? await (await fetch(attachment.previewBlobUrl)).blob().catch(() => undefined) : undefined;
    const {
      blobUrl: _blobUrl, compressedBlobUrl: _compressed, previewBlobUrl: _preview, ...meta
    } = attachment;
    return { ...rest, attachment: { ...meta, blob, previewBlob } };
  } catch {
    return undefined;
  }
}

/** The stored attachment as Web A wants it: fresh blob URLs for the bytes */
export function restoreAttachment(stored: StoredAttachment): ApiAttachment {
  const { blob, previewBlob, ...meta } = stored;
  return {
    ...meta,
    blob,
    blobUrl: URL.createObjectURL(blob),
    previewBlobUrl: previewBlob ? URL.createObjectURL(previewBlob) : undefined,
  };
}
