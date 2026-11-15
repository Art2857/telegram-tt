import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { Api as GramJs } from '../../../lib/gramjs';
import { UpdateConnectionState } from '../../../lib/gramjs/network';

import localDb from '../localDb';
import * as manager from './updateManager';

import { buildLocalUpdatePts, LocalUpdatePts } from './UpdatePts';

const applied = vi.hoisted(() => [] as unknown[]);
const sent = vi.hoisted(() => [] as { '@type': string }[]);

vi.mock('./mtpUpdateHandler', () => ({
  updater: (update: unknown) => {
    applied.push(update);
  },
}));
vi.mock('./apiUpdateEmitter', () => ({
  sendApiUpdate: (update: { '@type': string }) => {
    sent.push(update);
  },
}));

const state = (pts: number) => new GramJs.updates.State({
  pts, qts: 0, date: 1_790_000_000 + pts, seq: 1, unreadCount: 0,
});

const difference = (pts: number, otherUpdates: GramJs.TypeUpdate[] = []) => new GramJs.updates.Difference({
  newMessages: [],
  newEncryptedMessages: [],
  otherUpdates,
  chats: [],
  users: [],
  state: state(pts),
});

const appliedPts = () => applied.filter((update): update is LocalUpdatePts => update instanceof LocalUpdatePts)
  .map(({ pts }) => pts);

type Invoke = (request: unknown) => Promise<unknown>;

/**
 * Пропавшие сообщения (STATUS 2026-11-15): после одного неудачного или зависшего запроса менеджер обновлений
 * переставал запрашивать пропущенное, и новые сообщения не появлялись до перезапуска приложения.
 */
describe('updateManager: пропущенное догоняется всегда', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    applied.length = 0;
    sent.length = 0;
    // The module keeps its state between tests
    manager.reset();
    localDb.commonBoxState = {};
  });
  afterEach(() => {
    manager.reset();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('состояние, не загрузившееся без связи, загружается повторно, и обновления снова применяются', async () => {
    let attempts = 0;
    const invoke: Invoke = (request) => {
      if (request instanceof GramJs.updates.GetState) {
        attempts++;
        return Promise.resolve(attempts === 1 ? undefined : state(100));
      }
      return Promise.resolve(new GramJs.updates.DifferenceEmpty({ date: 1_790_000_100, seq: 1 }));
    };
    await manager.init(invoke as never);
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(attempts).toBe(2);

    manager.processUpdate(buildLocalUpdatePts(101, 1));
    expect(appliedPts()).toEqual([101]);
  });

  it('связь вернулась раньше повтора — состояние запрашивается сразу', async () => {
    let attempts = 0;
    const invoke: Invoke = (request) => {
      if (request instanceof GramJs.updates.GetState) {
        attempts++;
        return Promise.resolve(attempts === 1 ? undefined : state(100));
      }
      return Promise.resolve(new GramJs.updates.DifferenceEmpty({ date: 1_790_000_100, seq: 1 }));
    };
    await manager.init(invoke as never);
    manager.processUpdate(new UpdateConnectionState(UpdateConnectionState.connected));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
  });

  it('зависший запрос пропущенного бросается по таймеру и повторяется, разрыв заполняется', async () => {
    let differenceCalls = 0;
    const invoke: Invoke = (request) => {
      if (request instanceof GramJs.updates.GetState) return Promise.resolve(state(100));
      differenceCalls++;
      // Первый запрос ушёл в оборвавшееся соединение и не ответит никогда
      if (differenceCalls <= 2) return new Promise(() => undefined);
      return Promise.resolve(difference(103, [
        new GramJs.UpdateReadHistoryOutbox({
          peer: new GramJs.PeerUser({ userId: 1n }), maxId: 1, pts: 102, ptsCount: 1,
        }),
      ]));
    };
    await manager.init(invoke as never);
    // первый getDifference после init
    await vi.advanceTimersByTimeAsync(600);
    expect(differenceCalls).toBe(1);

    // Пришло сообщение с разрывом: раньше запрос не повторялся, пока висел первый
    manager.processUpdate(buildLocalUpdatePts(105, 1));
    // через 30 с запрос считается потерянным, через секунду — повтор
    await vi.advanceTimersByTimeAsync(32_000);
    expect(differenceCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(differenceCalls).toBeGreaterThanOrEqual(3);
    expect(localDb.commonBoxState.pts).toBeGreaterThanOrEqual(103);
  });

  it('обновление, пришедшее во время запроса пропущенного, применяется сразу после него', async () => {
    let resolveDifference: ((value: unknown) => void) | undefined;
    let differenceCalls = 0;
    const invoke: Invoke = (request) => {
      if (request instanceof GramJs.updates.GetState) return Promise.resolve(state(100));
      differenceCalls++;
      if (differenceCalls === 1) return Promise.resolve(new GramJs.updates.DifferenceEmpty({ date: 1, seq: 1 }));
      return new Promise((resolve) => {
        resolveDifference = resolve;
      });
    };
    await manager.init(invoke as never);
    await vi.advanceTimersByTimeAsync(600);

    // Разрыв: 102 без 101 — запрашивается пропущенное
    manager.processUpdate(buildLocalUpdatePts(102, 1));
    await vi.advanceTimersByTimeAsync(600);
    expect(differenceCalls).toBe(2);
    // Пока запрос идёт, приходит следующее сообщение
    manager.processUpdate(buildLocalUpdatePts(103, 1));

    // Ответ: состояние на 101 — 102 и 103 из очереди должны встать сами, без следующего обновления
    resolveDifference!(difference(101));
    await vi.advanceTimersByTimeAsync(0);
    expect(appliedPts()).toEqual([102, 103]);
    expect(localDb.commonBoxState.pts).toBe(103);
  });

  it('сетевая ошибка запроса пропущенного повторяется с паузой, а не теряется', async () => {
    let differenceCalls = 0;
    const invoke: Invoke = (request) => {
      if (request instanceof GramJs.updates.GetState) return Promise.resolve(state(100));
      differenceCalls++;
      if (differenceCalls <= 2) return Promise.reject(new Error('Request was unsuccessful 5 time(s)'));
      return Promise.resolve(difference(110));
    };
    await manager.init(invoke as never);
    await vi.advanceTimersByTimeAsync(600);
    expect(differenceCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(differenceCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(differenceCalls).toBe(3);
    expect(localDb.commonBoxState.pts).toBe(110);
  });

  it('requestDifference при возврате в приложение запрашивает пропущенное сразу', async () => {
    let differenceCalls = 0;
    const invoke: Invoke = (request) => {
      if (request instanceof GramJs.updates.GetState) return Promise.resolve(state(100));
      differenceCalls++;
      return Promise.resolve(new GramJs.updates.DifferenceEmpty({ date: 1, seq: 1 }));
    };
    await manager.init(invoke as never);
    await vi.advanceTimersByTimeAsync(600);
    expect(differenceCalls).toBe(1);
    manager.requestDifference();
    await vi.advanceTimersByTimeAsync(0);
    expect(differenceCalls).toBe(2);
  });
});

describe('updateManager: пересоздание API в той же странице', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    applied.length = 0;
    manager.reset();
  });
  afterEach(() => {
    manager.reset();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('известное состояние догоняет пропущенное, а не заменяется свежим (оно бы его потеряло)', async () => {
    localDb.commonBoxState = {
      pts: 100, date: 1_790_000_100, qts: 0, seq: 1,
    };
    const requests: string[] = [];
    const invoke: Invoke = (request) => {
      requests.push((request as { className: string }).className);
      return Promise.resolve(difference(108));
    };
    await manager.init(invoke as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toEqual(['updates.GetDifference']);
    expect(localDb.commonBoxState.pts).toBe(108);
  });
});
