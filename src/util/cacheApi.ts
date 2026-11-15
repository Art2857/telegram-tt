import {
  CUSTOM_BG_CACHE_NAME,
  FILE_CACHE_WRITE_CHANNEL,
  MEDIA_CACHE_NAME,
  MEDIA_CACHE_NAME_AVATARS,
  MEDIA_PROGRESSIVE_CACHE_NAME,
} from '../config';
import { getFileCacheRetentionMs } from '../proxygram/fileCachePolicy';
import { yieldToMain } from './browser/scheduler';
import { loadPasscodeMeta, requestPasscodeStateLock } from './passcode/meta';
import { ACCOUNT_SLOT } from './multiaccount';

const cacheApi = self.caches;
const cacheWrites = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel(FILE_CACHE_WRITE_CHANNEL) : undefined;

export type CachedFile = { cacheName: string; request: Request; size: number; lastAccess: number };

const LAST_ACCESS_HEADER = 'X-Last-Access';
const CACHE_TTL = 5 * 24 * 60 * 60 * 1000; // 5 days
const ACCESS_THROTTLE = 24 * 60 * 60 * 1000; // 1 day
const CLEANUP_INTERVAL = 1 * 60 * 60 * 1000; // 1 hour

const CLEARABLE_CACHE_NAMES = [MEDIA_CACHE_NAME, MEDIA_CACHE_NAME_AVATARS, MEDIA_PROGRESSIVE_CACHE_NAME];
const CACHE_KEY_BASE = `${self.location.origin}/`;

// Выбранный срок читается из localStorage страницы; worker не заменяет «Всегда» своим сроком по умолчанию
if (typeof window !== 'undefined') {
  void cleanup(CLEARABLE_CACHE_NAMES).catch(() => undefined);
  setInterval(() => {
    void cleanup(CLEARABLE_CACHE_NAMES).catch(() => undefined);
  }, CLEANUP_INTERVAL);
}

let isSupported: boolean | undefined;

export async function isCacheApiSupported() {
  if (!cacheApi) return false;

  isSupported = isSupported ?? await cacheApi.has('test').then(() => true).catch(() => false);
  return isSupported;
}

export enum Type {
  Text,
  Blob,
  Json,
  ArrayBuffer,
}

function getAccountScopedCacheName(cacheName: string) {
  const suffix = ACCOUNT_SLOT ? `_${ACCOUNT_SLOT}` : '';
  return `${cacheName}${suffix}`;
}

export async function fetch(
  cacheName: string, key: string, type: Type, isHtmlAllowed = false,
) {
  return fetchFromCache(getAccountScopedCacheName(cacheName), key, type, isHtmlAllowed);
}

export async function fetchShared(
  cacheName: string, key: string, type: Type, isHtmlAllowed = false,
) {
  return fetchFromCache(cacheName, key, type, isHtmlAllowed);
}

export async function fetchFromAccountScopes(
  cacheName: string, key: string, type: Type, isHtmlAllowed = false,
) {
  const accountCacheNames = await getAccountScopedCacheNames(cacheName);
  for (const accountCacheName of accountCacheNames) {
    const result = await fetchFromCache(accountCacheName, key, type, isHtmlAllowed);
    if (result !== undefined) return result;
  }

  return undefined;
}

export async function fetchFromCurrentAccountScope(
  cacheName: string, key: string, type: Type, isHtmlAllowed = false,
) {
  return fetchFromCache(getAccountScopedCacheName(cacheName), key, type, isHtmlAllowed);
}

async function fetchFromCache(
  resolvedCacheName: string, key: string, type: Type, isHtmlAllowed: boolean,
) {
  if (!cacheApi) {
    return undefined;
  }
  if (isPasscodeProtectedCache(resolvedCacheName)) {
    const hasPasscode = await loadPasscodeMeta().then(Boolean).catch(() => true);
    if (hasPasscode) return undefined;
  }

  try {
    const request = buildCacheRequest(key);
    const cache = await cacheApi.open(resolvedCacheName);
    const response = await cache.match(request);
    if (!response) {
      return undefined;
    }

    const lastAccess = Number(response.headers.get(LAST_ACCESS_HEADER));
    const now = Date.now();
    if (!lastAccess || now - lastAccess > ACCESS_THROTTLE) {
      updateAccessTime(cache, request, response);
    }

    const contentType = response.headers.get('Content-Type');

    switch (type) {
      case Type.Text:
        return await response.text();
      case Type.Blob: {
        // Ignore deprecated data-uri avatars
        if (key.startsWith('avatar') && contentType && contentType.startsWith('text')) {
          return undefined;
        }

        const blob = await response.blob();
        const shouldRecreate = !blob.type || (!isHtmlAllowed && blob.type.includes('html'));
        // iOS Safari fails to preserve `type` in cache
        let resolvedType = blob.type || contentType;

        if (!(shouldRecreate && resolvedType)) {
          return blob;
        }

        // Prevent HTML-in-video attacks (for files that were cached before fix)
        if (!isHtmlAllowed) {
          resolvedType = resolvedType.replace(/html/gi, '');
        }

        return new Blob([blob], { type: resolvedType });
      }
      case Type.Json:
        return await response.json();
      case Type.ArrayBuffer:
        return await response.arrayBuffer();
      default:
        return undefined;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
    return undefined;
  }
}

export async function save(cacheName: string, key: string, data: AnyLiteral | Blob | ArrayBuffer | string) {
  if (!cacheApi) {
    return false;
  }

  const resolvedCacheName = getAccountScopedCacheName(cacheName);
  if (isPasscodeProtectedCache(resolvedCacheName)) {
    return requestPasscodeStateLock(async () => {
      if (await loadPasscodeMeta()) return false;
      return saveToCache(resolvedCacheName, key, data);
    });
  }

  return saveToCache(resolvedCacheName, key, data);
}

async function saveToCache(
  resolvedCacheName: string,
  key: string,
  data: AnyLiteral | Blob | ArrayBuffer | string,
) {
  try {
    const cacheData = typeof data === 'string' || data instanceof Blob || data instanceof ArrayBuffer
      ? data
      : JSON.stringify(data);
    const request = buildCacheRequest(key);
    const response = new Response(cacheData);
    const size = cacheData instanceof Blob ? cacheData.size
      : cacheData instanceof ArrayBuffer ? cacheData.byteLength : new TextEncoder().encode(cacheData).byteLength;
    response.headers.set('Content-Length', String(size));
    response.headers.set(LAST_ACCESS_HEADER, Date.now().toString());
    const cache = await cacheApi.open(resolvedCacheName);
    await cache.put(request, response);
    if (isFileCache(resolvedCacheName)) cacheWrites?.postMessage('saved');

    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
    return false;
  }
}

export async function remove(cacheName: string, key: string) {
  return removeFromCache(getAccountScopedCacheName(cacheName), key);
}

export async function removeShared(cacheName: string, key: string) {
  return removeFromCache(cacheName, key);
}

export async function removeFromAccountScopes(cacheName: string, key: string) {
  const accountCacheNames = await getAccountScopedCacheNames(cacheName);
  return Promise.all(accountCacheNames.map((accountCacheName) => removeFromCache(accountCacheName, key)));
}

async function removeFromCache(resolvedCacheName: string, key: string) {
  try {
    if (!cacheApi) {
      return undefined;
    }

    const cache = await cacheApi.open(resolvedCacheName);
    return await cache.delete(buildCacheRequest(key));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
    return undefined;
  }
}

/** PXG: removes the slot's entries whose key matches — a guest's files of chats that are no longer shared */
export async function removeMatching(cacheName: string, isMatch: (url: string) => boolean) {
  if (!cacheApi) return;
  try {
    const cache = await cacheApi.open(getAccountScopedCacheName(cacheName));
    for (const request of await cache.keys()) {
      if (isMatch(request.url)) await cache.delete(request);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
  }
}

/** PXG: the slot's entries whose key matches, with their size and last access — for the guest's storage settings */
export async function listMatching(cacheName: string, isMatch: (url: string) => boolean) {
  return listMatchingFromCache(getAccountScopedCacheName(cacheName), isMatch);
}

/** Общий бюджет устройства учитывает файлы каждого профиля, включая прежний кэш без суффикса */
export async function listFilesFromAllAccounts() {
  if (!cacheApi) return [];
  const names = (await cacheApi.keys()).filter(isFileCache);
  return (await Promise.all(names.map((name) => listMatchingFromCache(name, () => true)))).flat();
}

async function listMatchingFromCache(resolvedCacheName: string, isMatch: (url: string) => boolean) {
  const result: CachedFile[] = [];
  if (!cacheApi) return result;
  try {
    const cache = await cacheApi.open(resolvedCacheName);
    for (const request of await cache.keys()) {
      if (!isMatch(request.url)) continue;
      const response = await cache.match(request);
      if (!response) continue;
      const declaredSize = Number(response.headers.get('Content-Length'));
      const size = response.headers.has('Content-Length') && Number.isFinite(declaredSize) && declaredSize >= 0
        ? declaredSize : (await response.blob()).size;
      result.push({
        cacheName: resolvedCacheName, request, size, lastAccess: Number(response.headers.get(LAST_ACCESS_HEADER)) || 0,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
  }
  return result;
}

export async function removeCachedFiles(files: CachedFile[]) {
  if (!cacheApi || !files.length) return 0;
  let removed = 0;
  const names = new Set(files.map((file) => file.cacheName));
  for (const name of names) {
    const cache = await cacheApi.open(name);
    for (const file of files) {
      if (file.cacheName !== name) continue;
      if (await cache.delete(file.request)) removed++;
      if (name === MEDIA_PROGRESSIVE_CACHE_NAME || name.startsWith(`${MEDIA_PROGRESSIVE_CACHE_NAME}_`)) {
        const url = new URL(file.request.url);
        const type = url.searchParams.get('type');
        if (type === 'headers' || type === 'arrayBuffer') {
          url.searchParams.set('type', type === 'headers' ? 'arrayBuffer' : 'headers');
          if (await cache.delete(url)) removed++;
        }
      }
    }
  }
  return removed;
}

/** PXG: removes the given entries of the slot's cache */
export async function removeRequests(cacheName: string, requests: Request[]) {
  if (!cacheApi || !requests.length) return;
  try {
    const cache = await cacheApi.open(getAccountScopedCacheName(cacheName));
    for (const request of requests) await cache.delete(request);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
  }
}

export async function clear(cacheName: string) {
  return clearCache(getAccountScopedCacheName(cacheName));
}

export async function clearShared(cacheName: string) {
  return clearCache(cacheName);
}

export async function clearAccountScopes(cacheName: string) {
  const accountCacheNames = await getAccountScopedCacheNames(cacheName);
  return Promise.all(accountCacheNames.map(clearCache));
}

async function clearCache(resolvedCacheName: string) {
  try {
    if (!cacheApi) {
      return undefined;
    }

    return await cacheApi.delete(resolvedCacheName);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
    return undefined;
  }
}

export async function cleanup(cacheNames: string[]) {
  if (!cacheApi) return;
  if (await loadPasscodeMeta()) return;

  try {
    for (const cacheName of cacheNames) {
      const cache = await cacheApi.open(getAccountScopedCacheName(cacheName));
      const keys = await cache.keys();
      const now = Date.now();

      for (const request of keys) {
        await yieldToMain();
        const response = await cache.match(request);
        if (!response) continue;

        const lastAccess = Number(response.headers.get(LAST_ACCESS_HEADER));
        const ttl = isFileCache(getAccountScopedCacheName(cacheName)) ? getFileCacheRetentionMs() : CACHE_TTL;
        if (ttl && lastAccess && now - lastAccess > ttl) {
          await cache.delete(request);
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
  }
}

export async function purgeClearableCache() {
  if (!cacheApi) return;
  await Promise.all(CLEARABLE_CACHE_NAMES.map((cacheName) => cacheApi.delete(getAccountScopedCacheName(cacheName))));
}

export async function purgePasscodeCaches() {
  if (!cacheApi) return;

  const cacheNames = await cacheApi.keys();
  await Promise.all(cacheNames.filter(isPasscodeProtectedCache).map((cacheName) => cacheApi.delete(cacheName)));
}

async function getAccountScopedCacheNames(cacheName: string) {
  if (!cacheApi) return [];

  try {
    return (await cacheApi.keys()).filter((name) => name.startsWith(`${cacheName}_`));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
    return [];
  }
}

function isFileCache(cacheName: string) {
  return [MEDIA_CACHE_NAME, MEDIA_PROGRESSIVE_CACHE_NAME]
    .some((name) => cacheName === name || cacheName.startsWith(`${name}_`));
}

function buildCacheRequest(key: string) {
  // To avoid the error "Request scheme 'webdocument' is unsupported"
  const normalizedKey = key.replace(/:/g, '_');
  return new Request(new URL(normalizedKey, CACHE_KEY_BASE));
}

function isPasscodeProtectedCache(cacheName: string) {
  return [
    ...CLEARABLE_CACHE_NAMES,
    CUSTOM_BG_CACHE_NAME,
  ].some((name) => cacheName === name || cacheName.startsWith(`${name}_`));
}

async function updateAccessTime(cache: Cache, request: Request, response: Response) {
  try {
    const headers = new Headers(response.headers);
    headers.set(LAST_ACCESS_HEADER, Date.now().toString());
    const newResponse = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await cache.put(request, newResponse);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(err);
  }
}
