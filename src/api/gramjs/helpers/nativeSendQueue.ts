import type { SendMessageParams } from '../../../types';
import type { ApiMessage, ApiOnProgress, ApiSessionData } from '../../types';
import type { SendQueueKey, StoredNativeSend } from './sendQueueStorage';

import { sendApiUpdate } from '../updates/apiUpdateEmitter';
import {
  cleanNativeSendOrphans, clearNativeSends, deriveSendQueueKeys, hasNativeSend, readNativeSends, removeNativeSend,
  restoreNativeSendFiles, storeNativeSendFiles, writeNativeSend,
} from './sendQueueStorage';

type QueueAdapter = {
  send: (params: SendMessageParams, message: ApiMessage, progress: ApiOnProgress) => Promise<void> | undefined;
  restore: (params: SendMessageParams, message: ApiMessage) => ApiMessage;
  reserveId: (id: number) => void;
};
type QueueItem = {
  data: StoredNativeSend;
  key: SendQueueKey;
  urls: string[];
  progress: ApiOnProgress;
  mutation: Promise<void>;
  resolve?: NoneToVoidFunction;
  isSaved?: boolean;
  isRunning?: boolean;
  retryAt?: number;
};

const RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60 * 1000;
const NETWORK_ERROR = new RegExp(
  'Disconnect|not connected|disconnected|TIMEOUT|TIME_OUT|timed out|NETWORK|NetworkError|Failed to fetch', 'i',
);
const items = new Map<string, QueueItem>();
const canceledIds = new Set<string>();
const messageGenerations = new WeakMap<ApiMessage, number>();
let adapter: QueueAdapter;
let keys: SendQueueKey[] = [];
let userId: string | undefined;
let generation = 0;
let loading = Promise.resolve();
let isVerified = false;
let isConnected = false;
let isPumping = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

export function configureNativeSendQueue(value: QueueAdapter) {
  adapter = value;
}

export function initNativeSendQueue(session?: ApiSessionData, cachedUserId?: string) {
  const stopping = stopNativeSendQueue();
  userId = cachedUserId;
  const ownGeneration = generation;
  loading = (async () => {
    await stopping;
    if (!session || !cachedUserId) return;
    const loadedKeys = await deriveSendQueueKeys(session);
    if (generation !== ownGeneration) return;
    keys = loadedKeys;
    for (const key of loadedKeys) {
      void cleanNativeSendOrphans(key).catch(() => undefined);
      const stored = await readNativeSends(key);
      for (const data of stored) {
        if (generation !== ownGeneration) return;
        if (data.userId !== cachedUserId || items.has(data.randomId)) continue;
        adapter.reserveId(data.message.id);
        const item: QueueItem = {
          data, key, urls: [], progress: () => undefined, isSaved: true, mutation: Promise.resolve(),
        };
        try {
          item.urls = await restoreNativeSendFiles(key, data);
        } catch {
          data.error = 'LOCAL_QUEUE_FILE_MISSING';
        }
        if (generation !== ownGeneration) {
          item.urls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        items.set(data.randomId, item);
        if (!data.isAcknowledged) data.message = adapter.restore(data.params, data.message);
        messageGenerations.set(data.message, ownGeneration);
        if (data.error && !data.isAcknowledged) emitFailure(item, data.error);
      }
    }
    // Незавершённое сохранение альбома требует явного повтора оставшихся файлов
    for (const item of items.values()) {
      if (getGroup(item).every((member) => member.data.isAcknowledged)) {
        finishNativeSend(item.data.message);
        continue;
      }
      const { groupedId, localGroupSize } = item.data.params;
      if (groupedId && localGroupSize && getGroup(item).length < localGroupSize) {
        item.data.error = 'LOCAL_QUEUE_INCOMPLETE_ALBUM';
        emitFailure(item, item.data.error);
      }
    }
  })().catch(() => {
    // Новый запрос сообщает об отказе хранилища; повреждение одной очереди не прерывает вход
  });
  return loading;
}

export function awaitNativeSendQueue() {
  return loading;
}

export async function verifyNativeSendQueue(verifiedUserId: string, session: ApiSessionData) {
  const ownGeneration = generation;
  await loading;
  if (generation !== ownGeneration) return;
  if (userId !== verifiedUserId || !keys.length) await initNativeSendQueue(session, verifiedUserId);
  if (userId !== verifiedUserId) return;
  isVerified = true;
  isConnected = true;
  requestPump();
}

export function setNativeSendQueueConnected(value: boolean) {
  isConnected = value;
  if (value) requestPump();
}

export async function enqueueNativeSend(params: SendMessageParams, message: ApiMessage, progress?: ApiOnProgress) {
  await loading;
  const key = keys[0];
  if (!userId || !key) return false;
  const randomId = params.clientRandomId!;
  const existing = items.get(randomId);
  if (existing) return true;
  const ownGeneration = generation;
  const data: StoredNativeSend = {
    userId, randomId, createdAt: Date.now(),
    params: { ...params, attachments: undefined, localMessage: undefined }, message,
  };
  const item: QueueItem = {
    data, key, urls: [], progress: progress || (() => undefined), mutation: Promise.resolve(),
  };
  items.set(randomId, item);
  messageGenerations.set(message, ownGeneration);
  const completed = new Promise<void>((resolve) => {
    item.resolve = resolve;
  });
  await saveItem(item, ownGeneration);
  if (generation !== ownGeneration || items.get(randomId) !== item) return true;
  requestPump();
  await completed;
  return true;
}

export function finishNativeSend(message: ApiMessage) {
  const id = message.nativeSendId;
  if (!id) return true;
  const item = items.get(id);
  if (!item) return true;
  const wasAcknowledged = item.data.isAcknowledged;
  item.data.isAcknowledged = true;
  item.resolve?.();
  item.progress = () => undefined;
  const group = getGroup(item);
  if (group.every((member) => member.data.isAcknowledged)) {
    for (const member of group) {
      releaseItem(member);
      void mutateItem(member, () => removeNativeSend(member.key, member.data.randomId)).catch(() => undefined);
    }
  } else {
    // До полного подтверждения сохраняется весь альбом: повтор использует те же random_id для каждой части
    void persistItem(item).catch(() => undefined);
  }
  return !wasAcknowledged;
}

export function failNativeSend(message: ApiMessage, error: Error): boolean {
  const item = message.nativeSendId && items.get(message.nativeSendId);
  if (!item) return false;
  if (item.data.isAcknowledged) return true;
  if (item.data.error) {
    emitFailure(item, item.data.error);
    return true;
  }
  if (item.progress.isCanceled) {
    cancelNativeSends(message.chatId, [message.id]);
    return true;
  }
  const { errorMessage, code } = error as Error & { errorMessage?: string; code?: number };
  const reason = errorMessage || error.message;
  const wait = reason.match(/(?:FLOOD(?:_PREMIUM)?_WAIT|SLOWMODE_WAIT)_(\d+)/);
  const isTransient = Boolean(wait) || (code !== undefined && (code >= 500 || code < 0))
    || reason === 'RANDOM_ID_DUPLICATE'
    || NETWORK_ERROR.test(reason);
  if (isTransient) {
    item.retryAt = Date.now() + (wait ? Number(wait[1]) * 1000 : RETRY_DELAY_MS);
    emitPending(item);
  } else {
    item.data.error = reason;
    emitFailure(item, reason);
    void persistItem(item).catch(() => undefined);
    item.resolve?.();
  }
  return true;
}

export async function retryNativeSend({ id }: { id: string }) {
  await loading;
  const item = items.get(id);
  if (!item) return false;
  const group = getGroup(item);
  if (group.some((member) => member.isRunning || member.data.error === 'LOCAL_QUEUE_FILE_MISSING')) return false;
  for (const member of group) {
    member.data.error = undefined;
    member.retryAt = undefined;
    member.progress = () => undefined;
    if (member.data.params.groupedId) {
      member.data.params.localGroupSize = group.length;
      if (group.length === 1) member.data.params.groupedId = undefined;
    }
    if (!member.data.isAcknowledged) emitPending(member);
    if (!member.isSaved) await saveItem(member, generation);
    else await persistItem(member).catch(() => undefined);
  }
  requestPump();
  return true;
}

export function cancelNativeSends(chatId: string, messageIds: number[]) {
  for (const item of items.values()) {
    if (item.data.message.chatId !== chatId || !messageIds.includes(item.data.message.id)) continue;
    const group = getGroup(item);
    canceledIds.add(item.data.randomId);
    item.progress.isCanceled = true;
    releaseItem(item);
    void mutateItem(item, () => removeNativeSend(item.key, item.data.randomId)).catch(() => undefined);
    emitDeletion(item);
    for (const member of group) {
      if (member === item) continue;
      member.data.params.localGroupSize = group.length - 1;
      if (group.length - 1 === 1) member.data.params.groupedId = undefined;
      if (item.isRunning) {
        member.progress.isCanceled = true;
        member.data.error = 'LOCAL_QUEUE_INCOMPLETE_ALBUM';
        emitFailure(member, member.data.error);
      }
      void persistItem(member).catch(() => undefined);
    }
  }
  requestPump();
}

export function isNativeSendCanceled(message: ApiMessage) {
  const messageGeneration = messageGenerations.get(message);
  return Boolean(message.nativeSendId && (canceledIds.has(message.nativeSendId)
    || (messageGeneration !== undefined && messageGeneration !== generation)));
}

export function stopNativeSendQueue(shouldClear?: boolean, session?: ApiSessionData) {
  generation++;
  isVerified = false;
  isConnected = false;
  isPumping = false;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  const pending = [...items.values()];
  for (const item of pending) {
    item.progress.isCanceled = true;
    releaseItem(item);
  }
  keys = [];
  userId = undefined;
  canceledIds.clear();
  return Promise.allSettled(pending.map((item) => item.mutation)).then(async () => {
    if (shouldClear && session) await clearNativeSends(session).catch(() => undefined);
  });
}

function saveItem(item: QueueItem, ownGeneration: number) {
  return mutateItem(item, () => saveItemNow(item, ownGeneration));
}

async function saveItemNow(item: QueueItem, ownGeneration: number) {
  const isCurrent = () => generation === ownGeneration && items.get(item.data.randomId) === item;
  try {
    item.data.files = await storeNativeSendFiles(item.key, item.data, isCurrent);
    if (!isCurrent()) {
      await removeNativeSend(item.key, item.data.randomId);
      return;
    }
    await writeNativeSend(item.key, item.data);
    item.isSaved = true;
  } catch {
    if (!isCurrent()) return;
    item.data.error = 'LOCAL_QUEUE_STORAGE_FAILED';
    emitFailure(item, item.data.error);
    item.resolve?.();
  }
}

function requestPump() {
  if (!isVerified || !isConnected || isPumping) return;
  clearTimeout(retryTimer);
  const ownGeneration = generation;
  isPumping = true;
  void pump(ownGeneration).catch(() => undefined).finally(() => {
    if (generation !== ownGeneration) return;
    isPumping = false;
    if ([...items.values()].some((item) => !item.data.error)) {
      retryTimer = setTimeout(requestPump, RETRY_DELAY_MS);
    }
  });
}

async function pump(ownGeneration: number) {
  const ordered = [...items.values()].sort((a, b) => a.data.createdAt - b.data.createdAt);
  for (const item of ordered) {
    if (generation !== ownGeneration || !isConnected) return;
    if (items.get(item.data.randomId) !== item || item.data.error || item.isRunning
      || item.data.isAcknowledged) continue;
    const group = getGroup(item);
    if (group.length < (item.data.params.localGroupSize || 1)) continue;
    if (group.some((member) => !member.isSaved || member.data.error || member.isRunning
      || (member.retryAt && member.retryAt > Date.now()))) continue;
    const send = async () => {
      if (generation !== ownGeneration || !isConnected || !isVerified) return;
      // Пока ожидали блокировку, другая вкладка могла уже получить подтверждение
      for (const member of group) {
        const isStored = await hasNativeSend(member.key, member.data.randomId);
        if (generation !== ownGeneration || items.get(member.data.randomId) !== member) return;
        if (isStored) continue;
        releaseItem(member);
        emitDeletion(member);
      }
      if (group.some((member) => items.get(member.data.randomId) !== member)) return;
      group.forEach((member) => {
        member.isRunning = true;
      });
      await Promise.all(group.map(async (member) => {
        try {
          await adapter.send(member.data.params, member.data.message, member.progress);
          // Отсутствие подтверждения не означает доставку
          if (items.get(member.data.randomId) === member && !member.data.error) {
            member.retryAt ||= Date.now() + MAX_RETRY_DELAY_MS;
          }
        } catch (error) {
          failNativeSend(member.data.message, error as Error);
        } finally {
          member.isRunning = false;
        }
      }));
    };
    // Одинаковый аккаунт в разных слотах не выполняет одну отправку одновременно
    if (navigator.locks) await navigator.locks.request(`pxg-native-send:${userId}`, send);
    else await send();
  }
}

function getGroup(item: QueueItem) {
  const { groupedId } = item.data.params;
  return groupedId ? [...items.values()].filter((member) => member.data.params.groupedId === groupedId) : [item];
}

function emitPending(item: QueueItem) {
  sendApiUpdate({
    '@type': item.data.message.isScheduled ? 'updateScheduledMessage' : 'updateMessage',
    chatId: item.data.message.chatId, id: item.data.message.id,
    message: { sendingState: 'messageSendingStatePending', nativeSendError: undefined }, isFull: false,
  });
}

function emitDeletion(item: QueueItem) {
  sendApiUpdate({
    '@type': item.data.message.isScheduled ? 'deleteScheduledMessages' : 'deleteMessages',
    chatId: item.data.message.chatId, ids: [item.data.message.id],
  });
}

function emitFailure(item: QueueItem, error: string) {
  sendApiUpdate({
    '@type': item.data.message.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
    chatId: item.data.message.chatId, localId: item.data.message.id, error,
  });
}

function releaseItem(item: QueueItem) {
  if (items.get(item.data.randomId) === item) items.delete(item.data.randomId);
  item.urls.forEach((url) => URL.revokeObjectURL(url));
  item.resolve?.();
}

function persistItem(item: QueueItem) {
  return mutateItem(item, async () => {
    if (items.get(item.data.randomId) !== item) return;
    await writeNativeSend(item.key, item.data);
  });
}

function mutateItem(item: QueueItem, operation: () => Promise<void>) {
  item.mutation = item.mutation.catch(() => undefined).then(operation);
  return item.mutation;
}
