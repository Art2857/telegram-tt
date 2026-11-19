import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageDto } from '../../proxygram/server/types';

import {
  forgetMessages, forgetUserHistory, historyKey, keepOnlyChats, readHistory, readMessage, rememberMessages,
} from './messageStore';

const store = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  const update = vi.fn((key: string, change: (current: unknown) => unknown) => {
    records.set(key, change(records.get(key)));
    return Promise.resolve();
  });
  return { records, update };
});

vi.mock('../../util/browser/idb', () => ({
  PXG_MESSAGES_IDB_STORE: {
    update: store.update,
    keys: () => Promise.resolve([...store.records.keys()]),
    get: (key: string) => Promise.resolve(store.records.get(key)),
    delMany: (keys: string[]) => {
      keys.forEach((key) => store.records.delete(key));
      return Promise.resolve();
    },
  },
}));

const USER_ID = 'guest';
const ACCOUNT_ID = 'owner-archive';
const DROPPED_PEER = 1;
const KEPT_PEER = 2;
const DROPPED = historyKey(USER_ID, ACCOUNT_ID, DROPPED_PEER);
const KEPT = historyKey(USER_ID, ACCOUNT_ID, KEPT_PEER);
const MESSAGE = { msgId: 7, text: 'Сообщение из архива' } as MessageDto;

describe('локальная история после смены доступа', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.records.clear();
    store.update.mockClear();
  });

  afterEach(async () => {
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it('удаляет ожидающую порцию отозванного чата и сохраняет запись другого чата', async () => {
    rememberMessages(DROPPED, [MESSAGE]);
    rememberMessages(KEPT, [MESSAGE]);
    await keepOnlyChats(USER_ID, new Set([`${ACCOUNT_ID}:${KEPT_PEER}`]));

    expect(await readHistory(DROPPED, undefined, 0, 1)).toBeUndefined();
    expect(await readMessage(KEPT, MESSAGE.msgId)).toEqual(MESSAGE);
  });

  it('после выхода начатая запись истории не оставляет сообщения предыдущего пользователя', async () => {
    const writing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    store.update.mockImplementationOnce(async (key, updater) => {
      writing.resolve();
      await release.promise;
      store.records.set(key, updater(store.records.get(key)));
    });
    rememberMessages(DROPPED, [MESSAGE]);
    const flush = readHistory(DROPPED, undefined, 0, 1);
    await writing.promise;
    const purge = forgetUserHistory(USER_ID);
    await Promise.resolve();
    release.resolve();
    await Promise.all([flush, purge]);

    expect(await readMessage(DROPPED, MESSAGE.msgId)).toBeUndefined();
  });

  it('удаляет скрытое сообщение из ожидающей записи чата и темы, сохраняя остальные сообщения', async () => {
    const topic = historyKey(USER_ID, ACCOUNT_ID, DROPPED_PEER, 5);
    const visible = { ...MESSAGE, msgId: MESSAGE.msgId + 1 };
    rememberMessages(DROPPED, [MESSAGE, visible]);
    rememberMessages(topic, [MESSAGE, visible]);

    forgetMessages(USER_ID, ACCOUNT_ID, DROPPED_PEER, [MESSAGE.msgId]);

    expect(await readHistory(DROPPED, undefined, 0, 10)).toEqual([visible]);
    expect(await readHistory(topic, undefined, 0, 10)).toEqual([visible]);
  });
});
