import type { MethodArgs, MethodResponse, Methods } from '../gramjs/methods/types';
import type { ApiUpdate, OnApiUpdate } from '../types';
import type { ProxyPeer, ProxyPeerEntry } from './ids';

import { ACCOUNT_SLOT } from '../../util/multiaccount';
import { hasStoredSession } from '../../util/sessions';
import { getPxgState, subscribePxg } from '../../proxygram/server/store';
import { ProxyPeerRegistry } from './ids';
import { shouldRouteToProxy } from './router';

const REGISTRY_KEY_PREFIX = `pxg-peer-ids-${ACCOUNT_SLOT || 1}-`;

let registryUserId: string | undefined;
let registry = new ProxyPeerRegistry();
let updateHandler: OnApiUpdate | undefined;

export function setProxyUpdateHandler(handler: OnApiUpdate) {
  updateHandler = handler;
}

export function emitProxyUpdate(update: ApiUpdate) {
  updateHandler?.(update);
}

/** Returns a promise for intercepted calls, including unsupported methods */
export function tryCallProxyApi<T extends keyof Methods>(
  fnName: T, ...args: MethodArgs<T>
): Promise<Awaited<MethodResponse<T>>> | undefined {
  const isGuest = isProxyGuest();
  if (!shouldRouteToProxy(fnName, args, isGuest)) return undefined;

  return import('./methods').then(({ callProxyApi }) => callProxyApi(fnName, ...args));
}

export function getProxyPeerId(accountId: string, peerId: number): string {
  return registry.registerPeer({ accountId, peerId });
}

export function isProxyGuest(): boolean {
  return getPxgState().session?.level === 'guest' && !hasStoredSession();
}

export function resolveProxyPeer(id: string): ProxyPeer | undefined {
  return registry.getPeer(id);
}

/** Seeds peer identities before the native builders consume authorized RPC results */
export async function registerProxyResult(method: string, result: unknown): Promise<void> {
  if (!['access.chats', 'messages.history', 'messages.window', 'messages.search', 'topics.list'].includes(method)) {
    return;
  }
  const entries = method === 'messages.window' || method === 'messages.search' || method === 'topics.list'
    ? (result as { messages: unknown[] }).messages : result;
  if (!registryUserId || !Array.isArray(entries)) return;

  const userId = registryUserId;
  const key = `${REGISTRY_KEY_PREFIX}${userId}`;
  const register = () => {
    if (registryUserId !== userId) return;

    // Other tabs in this slot allocate IDs under the same lock
    const stored = readRegistry(key);
    if (stored) {
      registry.getEntries().forEach(([, peer]) => stored.registerPeer(peer));
      registry = stored;
    }
    entries.forEach((item: { accountId: string; peerId: number; senderId?: number }) => {
      registry.registerPeer({ accountId: item.accountId, peerId: item.peerId });
      if (item.senderId) registry.registerPeer({ accountId: item.accountId, peerId: item.senderId });
    });
    try {
      // Persist collision resolution so reloads and list reordering keep the same IDs
      localStorage.setItem(key, JSON.stringify(registry.getEntries()));
    } catch {
      // Private browsing keeps the registry in memory
    }
  };
  if (navigator.locks) await navigator.locks.request(key, register);
  else register();
}

function readRegistry(key: string): ProxyPeerRegistry | undefined {
  try {
    const stored = localStorage.getItem(key);
    return stored ? new ProxyPeerRegistry(JSON.parse(stored) as ProxyPeerEntry[]) : undefined;
  } catch {
    // A corrupt or outdated local registry does not prevent signing in
    return undefined;
  }
}

function syncRegistry() {
  const userId = getPxgState().session?.user.id;
  if (userId === registryUserId) return;

  if (registryUserId) {
    try {
      localStorage.removeItem(`${REGISTRY_KEY_PREFIX}${registryUserId}`);
    } catch {
      // Storage can be unavailable
    }
  }
  registryUserId = userId;
  registry = new ProxyPeerRegistry();
  if (!userId) return;

  registry = readRegistry(`${REGISTRY_KEY_PREFIX}${userId}`) ?? registry;
}

subscribePxg(syncRegistry);
syncRegistry();
