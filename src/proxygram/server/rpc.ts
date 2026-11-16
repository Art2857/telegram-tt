import type { AccessChat, ServerEvent, SessionUser } from './types';
import { PxgError } from './types';

import { registerProxyResult } from '../../api/proxy';
import { getWebSocketUrl } from './http';
import { getAccessToken } from './session';
import { getPxgState, setPxgState, subscribePxg } from './store';

const CALL_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_CONNECTION_WAITERS = 128;
const MAX_RECONNECT_DELAY_MS = 30_000;
const ACCESS_READ_METHODS = new Set(['access.chats', 'messages.history', 'messages.window',
  'messages.versions', 'messages.search', 'sync.changes', 'media.url']);

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number };
type ReadyWaiter = { resolve: NoneToVoidFunction; reject: (error: Error) => void; timer: number };

/**
 * WebSocket RPC к серверу Proxygram (PLAN.md, 11). Одно соединение на вкладку:
 * вход токеном первым сообщением, продление токена без разрыва, переподключение с паузой.
 */
class PxgRpc {
  #ws: WebSocket | undefined;
  #seq = 0;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Set<(event: ServerEvent) => void>();
  readonly #readyWaiters = new Set<ReadyWaiter>();
  #isReady = false;
  #isStopped = true;
  #attempt = 0;
  #reconnectTimer: number | undefined;
  #refreshTimer: number | undefined;
  #connectTimer: number | undefined;
  #connectionGeneration = 0;
  #accessGeneration = 0;
  #accessList: { userId: string; hash: string; data: AccessChat[]; requestId: number } | undefined;

  start() {
    if (!this.#isStopped) return;
    this.#isStopped = false;
    void this.#open();
  }

  stop() {
    this.#isStopped = true;
    this.#isReady = false;
    this.#connectionGeneration++;
    this.#accessList = undefined;
    window.clearTimeout(this.#reconnectTimer);
    window.clearTimeout(this.#refreshTimer);
    window.clearTimeout(this.#connectTimer);
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
    const userId = getPxgState().session?.user.id;
    const connectionGeneration = this.#connectionGeneration;
    const accessGeneration = this.#accessGeneration;
    const knownAccess = method === 'access.chats' && this.#accessList?.userId === userId
      ? this.#accessList : undefined;
    const requestParams = method === 'access.chats' ? { hash: knownAccess?.hash ?? '' } : params;
    await this.#whenReady();
    this.#checkConnection(connectionGeneration, userId);
    const ws = this.#ws;
    if (!this.#isReady || ws?.readyState !== WebSocket.OPEN) throw new PxgError('disconnected');
    const id = ++this.#seq;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id);
        reject(new PxgError('timeout'));
      }, CALL_TIMEOUT_MS);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        ws.send(JSON.stringify({ t: 'req', id, m: method, p: requestParams }));
      } catch (error) {
        this.#pending.delete(id);
        window.clearTimeout(timer);
        reject(error);
      }
    }).then(async (result) => {
      this.#checkConnection(connectionGeneration, userId);
      if (ACCESS_READ_METHODS.has(method) && accessGeneration !== this.#accessGeneration) {
        throw new PxgError('access_changed');
      }
      let data: unknown = result;
      // Старый сервер отдаёт массив; новый — только изменившийся список
      if (method === 'access.chats' && !Array.isArray(result)) {
        const response = result as { hash: string; data?: AccessChat[] };
        data = response.data ?? (response.hash === knownAccess?.hash ? knownAccess.data : undefined);
        if (!data) throw new PxgError('access_changed');
        if (userId && (!this.#accessList || id >= this.#accessList.requestId)) {
          this.#accessList = { userId, hash: response.hash, data: data as AccessChat[], requestId: id };
        }
      }
      await registerProxyResult(method, data);
      this.#checkConnection(connectionGeneration, userId);
      if (ACCESS_READ_METHODS.has(method) && accessGeneration !== this.#accessGeneration) {
        throw new PxgError('access_changed');
      }
      return data as T;
    });
  }

  /** Connected and signed in: a call goes out at once instead of waiting for the connection */
  get isConnected() {
    return this.#isReady;
  }

  #checkConnection(generation: number, userId?: string) {
    if (getPxgState().session?.user.id !== userId) throw new PxgError('unauthorized');
    if (generation !== this.#connectionGeneration) throw new PxgError('disconnected');
  }

  #whenReady(): Promise<void> {
    if (this.#isReady) return Promise.resolve();
    if (this.#isStopped) return Promise.reject(new PxgError('unauthorized'));
    if (this.#readyWaiters.size >= MAX_CONNECTION_WAITERS) return Promise.reject(new PxgError('disconnected'));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#readyWaiters.delete(waiter);
        reject(new PxgError('timeout'));
      }, CONNECT_TIMEOUT_MS);
      const waiter = { resolve, reject, timer };
      this.#readyWaiters.add(waiter);
    });
  }

  async #open() {
    const generation = this.#connectionGeneration;
    const token = await getAccessToken().catch(() => undefined);
    if (this.#isStopped || generation !== this.#connectionGeneration) return;
    if (!token) {
      this.#scheduleReconnect();
      return;
    }

    setPxgState({ connection: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(getWebSocketUrl());
    } catch {
      this.#failAll(new PxgError('disconnected'));
      setPxgState({ connection: 'offline' });
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;
    this.#connectTimer = window.setTimeout(() => {
      if (this.#ws !== ws || this.#isReady) return;
      this.#disconnect(ws, new PxgError('timeout'));
      ws.close();
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.#ws === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'auth', token }));
    };
    ws.onmessage = (event) => {
      if (this.#ws === ws) this.#onMessage(String(event.data));
    };
    ws.onclose = (event) => this.#disconnect(ws, new PxgError('disconnected'), event.code);
  }

  #disconnect(ws: WebSocket, error: PxgError, code?: number) {
    if (this.#ws !== ws) return;
    this.#ws = undefined;
    this.#isReady = false;
    this.#connectionGeneration++;
    window.clearTimeout(this.#connectTimer);
    window.clearTimeout(this.#refreshTimer);
    this.#failAll(error);
    setPxgState({ connection: 'offline' });

    if (code === 4403) {
      this.#emit({ e: 'session.revoked', d: {} });
      return;
    }
    if (code === 4401) void getAccessToken(true).catch(() => undefined);
    this.#scheduleReconnect();
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
    if (!message || typeof message.t !== 'string') return;

    if (message.t === 'ready') {
      window.clearTimeout(this.#connectTimer);
      this.#isReady = true;
      this.#attempt = 0;
      const { session } = getPxgState();
      // роль могли сменить в админке — берём свежую; передавшему права админка больше не нужна
      if (session && message.user) {
        const user = { ...session.user, ...message.user };
        setPxgState({ session: { ...session, user }, ...(user.role !== 'admin' && { isAdminOpen: false }) });
      }
      setPxgState({ connection: 'online' });
      this.#settleConnectionWaiters();
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
        const error = message.e as {
          code: string; message: string; reason?: string; params?: Record<string, string | number>;
        } | undefined;
        pending.reject(new PxgError(error?.code || 'internal', error?.message, error?.reason, error?.params));
      }
      return;
    }

    if (message.t === 'ev') this.#emit({ e: message.e, d: message.d } as ServerEvent);
  }

  #emit(event: ServerEvent) {
    // A late history response cannot restore data cleared by an access change
    if (event.e === 'access.changed') {
      this.#accessGeneration++;
      this.#accessList = undefined;
    }
    this.#listeners.forEach((listener) => listener(event));
  }

  /** Новый токен отправляется в то же соединение — сервер продлевает его без разрыва */
  #scheduleTokenRefresh() {
    window.clearTimeout(this.#refreshTimer);
    const { session } = getPxgState();
    const ws = this.#ws;
    if (!session || !ws) return;
    const delay = Math.max(session.accessExpiresAt - Date.now() - 90_000, 5_000);
    this.#refreshTimer = window.setTimeout(async () => {
      const token = await getAccessToken(true).catch(() => undefined);
      if (this.#ws !== ws) return;
      if (token && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'auth', token }));
      }
      // Сетевой сбой продления не должен оставлять клиент без следующей попытки
      if (getPxgState().session) this.#scheduleTokenRefresh();
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
    this.#settleConnectionWaiters(error);
  }

  #settleConnectionWaiters(error?: Error) {
    this.#readyWaiters.forEach((waiter) => {
      window.clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve();
    });
    this.#readyWaiters.clear();
  }
}

export const pxgRpc = new PxgRpc();

// Соединение живёт, пока есть системная сессия
let sessionIdentity: string | undefined;
function syncConnection() {
  const { session } = getPxgState();
  const identity = session ? `${session.level}:${session.user.id}` : undefined;
  if (identity === sessionIdentity) return;
  sessionIdentity = identity;
  pxgRpc.stop();
  if (identity) pxgRpc.start();
}
subscribePxg(syncConnection);
syncConnection();

pxgRpc.on((event) => {
  if (event.e === 'session.revoked') {
    setPxgState({
      session: undefined, accounts: undefined, isAdminOpen: false, isSessionRevoked: true,
    });
  }
});
