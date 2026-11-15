import { DEBUG } from '../config';
import { pause } from '../util/schedulers';
import { precacheAppShell, pruneAssetCache, respondWithCache, respondWithCacheNetworkFirst } from './assetCache';
import { respondForDownload } from './download';
import { respondForProgressive } from './progressive';
import {
  handleClientMessage as handleNotificationMessage,
  handleNotificationClick,
  handlePush,
} from './pushNotification';
import { handleClientMessage as handleShareMessage, respondForShare } from './share';

declare const self: ServiceWorkerGlobalScope;

const CACHE_FIRST_ASSET_EXTENSIONS = 'js|css|woff2|svg|png|jpe?g|webp|gif|tgs|bin|json|wasm';
const RE_NETWORK_FIRST_ASSETS = /\.(wasm|html)$/;
const RE_CACHE_FIRST_ASSETS = new RegExp(
  `(?:/assets/[^/]+|/(?:[^/]+\\.)?worker|/index)-[\\w-]{8}`
  + `\\.(${CACHE_FIRST_ASSET_EXTENSIONS})$`,
);
// Proxygram: files of the app shell without a hash in the name (`compatTest.js`, `redirect.js`, the manifest, styles,
// sounds, icons) change in place — fresh from the network, the cached copy offline
// Proxygram: emoji images never change and are needed offline too
const RE_CACHE_FIRST_EMOJI = /\/img-apple-\d+\/[\w-]+\.png$/;
const RE_NETWORK_FIRST_SHELL = /^[^/]+\.(js|css|webmanifest|mp3|mp4|svg|png|ico)$/;
const ACTIVATE_TIMEOUT = 3000;
const PRECACHE_TIMEOUT = 15000;
const ASSET_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

self.addEventListener('install', (e) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('ServiceWorker installed');
  }

  // Activate worker immediately, once the new shell is cached for offline starts
  e.waitUntil(Promise.race([
    precacheAppShell(self.registration.scope).catch(() => undefined),
    pause(PRECACHE_TIMEOUT),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('ServiceWorker activated');
  }

  e.waitUntil(
    Promise.race([
      // An attempt to fix freezing UI on iOS
      pause(ACTIVATE_TIMEOUT),
      Promise.all([
        pruneAssetCache(ASSET_MAX_AGE),
        // Become available to all pages
        self.clients.claim(),
      ]),
    ]),
  );
});

self.addEventListener('fetch', (e: FetchEvent) => {
  const { url } = e.request;
  const { scope } = self.registration;
  if (!url.startsWith(scope)) {
    return false;
  }

  const { pathname, protocol } = new URL(url);
  const { pathname: scopePathname } = new URL(scope);

  if (pathname.includes('/progressive/')) {
    e.respondWith(respondForProgressive(e));
    return true;
  }

  if (pathname.includes('/download/')) {
    e.respondWith(respondForDownload(e));
    return true;
  }

  if (pathname.includes('/share/')) {
    e.respondWith(respondForShare(e));
  }

  if (protocol === 'http:' || protocol === 'https:') {
    if (pathname === scopePathname || pathname.match(RE_NETWORK_FIRST_ASSETS)) {
      e.respondWith(respondWithCacheNetworkFirst(e, pathname === scopePathname));
      return true;
    }

    if (pathname.match(RE_CACHE_FIRST_ASSETS) || RE_CACHE_FIRST_EMOJI.test(pathname)) {
      e.respondWith(respondWithCache(e));
      return true;
    }

    if (pathname.startsWith(scopePathname) && RE_NETWORK_FIRST_SHELL.test(pathname.slice(scopePathname.length))) {
      e.respondWith(respondWithCacheNetworkFirst(e));
      return true;
    }
  }

  return false;
});

self.addEventListener('push', handlePush);
self.addEventListener('notificationclick', handleNotificationClick);
self.addEventListener('message', (event) => {
  handleNotificationMessage(event);
  handleShareMessage(event);
});
