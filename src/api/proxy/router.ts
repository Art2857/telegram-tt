import type { Methods } from '../gramjs/methods/types';

import { isProxyPeerId } from './ids';
import { parseProxyCatalogHash, parseProxyMediaHash } from './mediaIds';

const PEER_ID_KEY = /^(?:(?:chat|user|peer|channel|bot|sender)Ids?|.*(?:Chat|User|Peer|Channel|Bot|Sender)Ids?)$/;
const PEER_KEY = /^(?:(?:chat|user|peer|channel|bot)s?|.*(?:Chat|User|Peer|Channel|Bot)s?|sendAs)$/;
const PEER_TYPE = /^(?:chatType|userType)/;
const PEER_ARGUMENT_METHODS = new Set<keyof Methods>([
  'fetchFullUser', 'updateContact', 'deleteContact',
  'requestChannelDifference', 'setOpenedChannelIds', 'saveCloseFriends',
]);
const MEDIA_METHODS = new Set<keyof Methods>(['downloadMedia']);
const PROXY_MEDIA_PREFIX = 'pxg:';
const PEER_MEDIA_HASH = /^(?:avatar|profile)(-?\d+)(?:[?:]|$)/;

/** Routes only peer references, leaving numeric message text and document IDs alone */
export function shouldRouteToProxy(fnName: keyof Methods, args: readonly unknown[], isGuest?: boolean): boolean {
  if (isGuest) return true;

  const visited = new WeakMap<object, boolean>();
  return args.some((arg) => hasProxyPeer(arg, PEER_ARGUMENT_METHODS.has(fnName), MEDIA_METHODS.has(fnName), visited));
}

function hasProxyPeer(value: unknown, isPeer: boolean, isMedia: boolean, visited: WeakMap<object, boolean>): boolean {
  if (isPeer && isProxyPeerId(value)) return true;
  if (!value || typeof value !== 'object') return false;

  const wasPeer = visited.get(value);
  if (wasPeer !== undefined && (wasPeer || !isPeer)) return false;
  visited.set(value, isPeer);
  if (Array.isArray(value)) {
    return value.some((item) => hasProxyPeer(item, isPeer, isMedia, visited));
  }

  // Files, buffers and progress callbacks are opaque to the router
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  const params = value as Record<string, unknown>;
  const hasPeerType = typeof params.type === 'string' && PEER_TYPE.test(params.type);
  if ((isPeer || hasPeerType) && isProxyPeerId(params.id)) return true;

  return Object.entries(params).some(([key, item]) => {
    if (isMedia && key === 'url' && typeof item === 'string') {
      if (item.startsWith(PROXY_MEDIA_PREFIX)) return true;
      if (parseProxyMediaHash(item) || parseProxyCatalogHash(item)) return true;
      const peerId = item.match(PEER_MEDIA_HASH)?.[1];
      if (isProxyPeerId(peerId)) return true;
    }
    return hasProxyPeer(item, PEER_ID_KEY.test(key) || PEER_KEY.test(key), isMedia, visited);
  });
}
