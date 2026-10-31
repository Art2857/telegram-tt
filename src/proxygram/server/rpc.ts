import type { ServerEvent, SessionUser } from './types';
import { PxgError } from './types';

import { getWebSocketUrl } from './http';
import { getAccessToken } from './session';
import { getPxgState, setPxgState, subscribePxg } from './store';

const CALL_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number };

/**
 * WebSocket RPC к серверу Proxygram (PLAN.md, 11). Одно соединение на вкладку:
 * вход токеном первым сообщением, продление токена без разрыва, переподключение с паузой.
 */
class PxgRpc {
  #ws: WebSocket | undefined;
  #seq = 0;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Set<(event: ServerEvent) => void>();
  #readyWaiters: { resolve: NoneToVoidFunction; reject: (error: Error) => void }[] = [];
  #isReady = false;
  #isStopped = true;
  #attempt = 0;
  #reconnectTimer: number | undefined;
  #refreshTimer: number | undefined;

  start() {
    if (!this.#isStopped) return;
    this.#isStopped = false;
    void this.#open();
  }

  stop() {
    this.#isStopped = true;
    window.clearTimeout(this.#reconnectTimer);
    window.clearTimeout(this.#refreshTimer);
    this.#ws?.close(1000);
    this.#ws = undefined;
    this.#failAll(new PxgError('disconnected'));
    setPxgState({ connection: 'offline' });
  }

  on(listener: (event: ServerEvent) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    await this.#whenReady();
    const id = ++this.#seq;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id);
        reject(new PxgError('timeout'));
      }, CALL_TIMEOUT_MS);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.#ws!.send(JSON.stringify({ t: 'req', id, m: method, p: params }));
    });
  }

  #whenReady(): Promise<void> {
    if (this.#isReady) return Promise.resolve();
    if (this.#isStopped) return Promise.reject(new PxgError('unauthorized'));
    return new Promise((resolve, reject) => this.#readyWaiters.push({ resolve, reject }));
  }

  async #open() {
    const token = await getAccessToken();
    if (this.#isStopped) return;
    if (!token) {
      this.#scheduleReconnect();
      return;
    }

    setPxgState({ connection: 'connecting' });
    const ws = new WebSocket(getWebSocketUrl());
    this.#ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
    ws.onmessage = (event) => this.#onMessage(String(event.data));
    ws.onclose = (event) => {
      if (this.#ws !== ws) return;
      this.#ws = undefined;
      this.#isReady = false;
      window.clearTimeout(this.#refreshTimer);
      this.#failAll(new PxgError('disconnected'));
      setPxgState({ connection: 'offline' });

      if (event.code === 4403) {
        // сессию завершили в админке
        this.#emit({ e: 'session.revoked', d: {} });
        return;
      }
      if (event.code === 4401) void getAccessToken(true);
      this.#scheduleReconnect();
    };
  }

  #onMessage(raw: string) {
    let message: {
      t: string; id?: number; ok?: boolean; r?: unknown; e?: unknown; d?: unknown; user?: SessionUser;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.t === 'ready') {
      this.#isReady = true;
      this.#attempt = 0;
      const { session } = getPxgState();
      // роль могли сменить в админке — берём свежую
      if (session && message.user) setPxgState({ session: { ...session, user: { ...session.user, ...message.user } } });
      setPxgState({ connection: 'online' });
      this.#readyWaiters.splice(0).forEach((waiter) => waiter.resolve());
      this.#scheduleTokenRefresh();
      return;
    }

    if (message.t === 'res' && message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.ok) {
        pending.resolve(message.r);
      } else {
        const error = message.e as { code: string; message: string };
        pending.reject(new PxgError(error.code, error.message));
      }
      return;
    }

    if (message.t === 'ev') this.#emit({ e: message.e, d: message.d } as ServerEvent);
  }

  #emit(event: ServerEvent) {
    this.#listeners.forEach((listener) => listener(event));
  }

  /** Новый токен отправляется в то же соединение — сервер продлевает его без разрыва */
  #scheduleTokenRefresh() {
    window.clearTimeout(this.#refreshTimer);
    const { session } = getPxgState();
    if (!session) return;
    const delay = Math.max(session.accessExpiresAt - Date.now() - 90_000, 5_000);
    this.#refreshTimer = window.setTimeout(async () => {
      const token = await getAccessToken(true);
      if (token && this.#ws?.readyState === WebSocket.OPEN) {
        this.#ws.send(JSON.stringify({ t: 'auth', token }));
      }
    }, delay);
  }

  #scheduleReconnect() {
    if (this.#isStopped || !getPxgState().session) return;
    window.clearTimeout(this.#reconnectTimer);
    const delay = Math.min(1000 * 2 ** this.#attempt, MAX_RECONNECT_DELAY_MS);
    this.#attempt += 1;
    this.#reconnectTimer = window.setTimeout(() => void this.#open(), delay);
  }

  #failAll(error: Error) {
    this.#pending.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.#pending.clear();
    this.#readyWaiters.splice(0).forEach((waiter) => waiter.reject(error));
  }
}

export const pxgRpc = new PxgRpc();

// Соединение живёт, пока есть системная сессия
let hadSession = false;
function syncConnection() {
  const hasSession = Boolean(getPxgState().session);
  if (hasSession === hadSession) return;
  hadSession = hasSession;
  if (hasSession) pxgRpc.start();
  else pxgRpc.stop();
}
subscribePxg(syncConnection);
syncConnection();

pxgRpc.on((event) => {
  if (event.e === 'session.revoked') setPxgState({ session: undefined, accounts: undefined, isAdminOpen: false });
});
