import { ASSET_CACHE_NAME } from '../config';
import { pause } from '../util/schedulers';

declare const self: ServiceWorkerGlobalScope;

// An attempt to fix freezing UI on iOS
const TIMEOUT = 3000;
const CACHE_UPDATE_TIMEOUT = 30000;

/**
 * `ignoreSearch` — the app page itself: every account slot (`?account=2`) gets the same `index.html`, so offline
 * a slot not opened since the last update still starts from the page cached for another slot
 */
export async function respondWithCacheNetworkFirst(e: FetchEvent, ignoreSearch = false) {
  const abortController = new AbortController();
  const cachePromise = self.caches.open(ASSET_CACHE_NAME);
  const remotePromise = fetchAsset(e.request, abortController.signal);

  e.waitUntil(cacheAssetResponse(e.request, cachePromise, remotePromise, abortController));

  const remote = await resolveWithTimeout(remotePromise, TIMEOUT);
  if (remote?.response.ok) {
    return remote.response;
  }

  const cached = await resolveCachedResponse(e.request, cachePromise)
    || (ignoreSearch ? await resolveCachedResponse(e.request, cachePromise, true) : undefined);
  if (cached) {
    abortController.abort();
    return cached;
  }

  return remote ? remote.response : (await remotePromise).response;
}

/**
 * Proxygram: hashed files never change, so an update no longer wipes the cache — the app must start offline right
 * after a new version arrived (the wiped cache left a white page). Only entries untouched for a month go
 */
export async function pruneAssetCache(maxAgeMs: number) {
  const cache = await self.caches.open(ASSET_CACHE_NAME);
  const now = Date.now();
  await Promise.all((await cache.keys()).map(async (request) => {
    const response = await cache.match(request);
    const date = Date.parse(response?.headers.get('date') || '');
    if (!response || !Number.isFinite(date) || now - date > maxAgeMs) await cache.delete(request);
  }));
}

/**
 * Proxygram: the page and every file it names (`compatTest.js` above all — without it Web A does not start) are
 * cached as soon as a new version installs, not only once something requests them
 */
export async function precacheAppShell(scope: string) {
  const cache = await self.caches.open(ASSET_CACHE_NAME);
  const page = await fetch(scope, { cache: 'no-store' });
  if (!page.ok) return;
  const html = await page.clone().text();
  await cache.put(scope, page);
  const files = new Set<string>();
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)) {
    if (!path.endsWith('.html')) files.add(new URL(path, scope).href);
  }
  await Promise.all([...files].map(async (url) => {
    try {
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    } catch {
      // The next start fetches it again
    }
  }));
}

export function respondWithCache(e: FetchEvent) {
  const abortController = new AbortController();
  const cachePromise = self.caches.open(ASSET_CACHE_NAME);
  const responsePromise = resolveCacheFirst(e.request, cachePromise, abortController.signal);

  e.waitUntil(cacheAssetResponse(e.request, cachePromise, responsePromise, abortController));

  return responsePromise.then(({ response }) => response);
}

export function clearAssetCache() {
  return self.caches.delete(ASSET_CACHE_NAME);
}

interface AssetResponse {
  response: Response;
  responseToCache?: Response;
}

async function resolveCacheFirst(
  request: Request,
  cachePromise: Promise<Cache>,
  abortSignal: AbortSignal,
): Promise<AssetResponse> {
  const cached = await resolveCachedResponse(request, cachePromise);
  if (cached) return { response: cached };

  return fetchAsset(request, abortSignal);
}

async function resolveCachedResponse(request: Request, cachePromise: Promise<Cache>, ignoreSearch = false) {
  const cached = await resolveWithTimeout(
    cachePromise.then((cache) => cache.match(request, ignoreSearch ? { ignoreSearch } : undefined)),
    TIMEOUT,
  );

  if (!cached) return undefined;
  if (cached.ok) return cached;

  const cache = await cachePromise;
  await cache.delete(request);
  return undefined;
}

async function fetchAsset(request: Request, abortSignal: AbortSignal): Promise<AssetResponse> {
  const response = await fetch(request, { signal: abortSignal });

  return {
    response,
    responseToCache: response.ok ? response.clone() : undefined,
  };
}

async function cacheAssetResponse(
  request: Request,
  cachePromise: Promise<Cache>,
  responsePromise: Promise<AssetResponse>,
  abortController: AbortController,
) {
  const isCompleted = await Promise.race([
    updateAssetCache(request, cachePromise, responsePromise).then(
      () => true,
      () => true,
    ),
    pause(CACHE_UPDATE_TIMEOUT).then(() => false),
  ]);

  if (!isCompleted) abortController.abort();
}

async function updateAssetCache(
  request: Request,
  cachePromise: Promise<Cache>,
  responsePromise: Promise<AssetResponse>,
) {
  const { responseToCache } = await responsePromise;
  if (!responseToCache) return;

  const cache = await cachePromise;
  await cache.put(request, responseToCache);
}

async function resolveWithTimeout<T>(promise: Promise<T>, timeout: number) {
  let isResolved = false;

  try {
    return await Promise.race([
      pause(timeout).then(() => (isResolved ? undefined : Promise.reject(new Error('TIMEOUT')))),
      promise,
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return undefined;
  } finally {
    isResolved = true;
  }
}
