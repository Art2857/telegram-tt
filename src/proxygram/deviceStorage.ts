import { MEDIA_CACHE_NAME } from '../config';
import { listMatching, removeRequests } from '../util/cacheApi';
import { parseProxyMediaHash } from '../api/proxy/mediaIds';
import { forgetUserHistory } from '../api/proxy/messageStore';

/**
 * Files and history of shared chats on this device (docs/spec/11 C4): how much they take, how much they may take,
 * and clearing them. Kept only what the guest has already seen; the server gives everything again
 */
const LIMIT_KEY = 'pxg-file-cache-limit';
const GB = 1024 ** 3;
/** Choices offered in settings; 0 — no limit */
export const FILE_CACHE_LIMITS = [GB, 2 * GB, 4 * GB, 8 * GB, 16 * GB, 0];
const DEFAULT_MAX_LIMIT = 8 * GB;
/** The limit never takes more than this share of what the browser allows the site */
const QUOTA_SHARE = 0.5;
const TRIM_DELAY_MS = 30_000;

export type DeviceStorageUsage = {
  /** Everything the site keeps on the device, as the browser counts it */
  usageBytes?: number;
  quotaBytes?: number;
  /** Files of shared chats of this person */
  files: number;
  fileBytes: number;
  isPersisted?: boolean;
};

function isOwnFile(userId: string) {
  return (url: string) => parseProxyMediaHash(url)?.userId === userId;
}

/** `undefined` — the default: the smaller of 8 GB and half of the browser's quota */
export function getStoredFileCacheLimit(): number | undefined {
  try {
    const stored = localStorage.getItem(LIMIT_KEY) ?? undefined;
    if (stored === undefined) return undefined;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setStoredFileCacheLimit(bytes: number | undefined) {
  try {
    if (bytes === undefined) localStorage.removeItem(LIMIT_KEY);
    else localStorage.setItem(LIMIT_KEY, String(bytes));
  } catch {
    // Without storage the default stays
  }
}

export async function getEffectiveFileCacheLimit(): Promise<number> {
  const stored = getStoredFileCacheLimit();
  const quota = (await navigator.storage?.estimate?.().catch(() => undefined))?.quota;
  const cap = quota ? quota * QUOTA_SHARE : DEFAULT_MAX_LIMIT;
  if (stored === undefined) return Math.min(DEFAULT_MAX_LIMIT, cap);
  // "No limit" still stays within what the browser gives the site
  return stored === 0 ? cap : Math.min(stored, cap);
}

export async function measureDeviceStorage(userId: string): Promise<DeviceStorageUsage> {
  const [estimate, isPersisted, files] = await Promise.all([
    navigator.storage?.estimate?.().catch(() => undefined),
    navigator.storage?.persisted?.().catch(() => undefined),
    listMatching(MEDIA_CACHE_NAME, isOwnFile(userId)),
  ]);
  return {
    usageBytes: estimate?.usage,
    quotaBytes: estimate?.quota,
    files: files.length,
    fileBytes: files.reduce((sum, file) => sum + file.size, 0),
    isPersisted,
  };
}

/** Asks the browser not to clear the site's storage by itself; true — the storage is persistent */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Beyond the limit the files opened longest ago go first */
export async function trimProxyFiles(userId: string) {
  const limit = await getEffectiveFileCacheLimit();
  const files = await listMatching(MEDIA_CACHE_NAME, isOwnFile(userId));
  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= limit) return 0;
  const byAge = [...files].sort((a, b) => a.lastAccess - b.lastAccess);
  const removed = [];
  for (const file of byAge) {
    if (total <= limit) break;
    removed.push(file.request);
    total -= file.size;
  }
  await removeRequests(MEDIA_CACHE_NAME, removed);
  return removed.length;
}

let trimTimer: ReturnType<typeof setTimeout> | undefined;

/** After new files the cache is checked against its limit, not after every one of them */
export function scheduleTrimProxyFiles(userId: string) {
  if (trimTimer) return;
  trimTimer = setTimeout(() => {
    trimTimer = undefined;
    void trimProxyFiles(userId);
  }, TRIM_DELAY_MS);
}

/** "Clear cache": files and saved history of this person leave the device; the server gives them again */
export async function clearProxyDeviceCache(userId: string) {
  await removeRequests(
    MEDIA_CACHE_NAME, (await listMatching(MEDIA_CACHE_NAME, isOwnFile(userId))).map((file) => file.request),
  );
  await forgetUserHistory(userId);
}
