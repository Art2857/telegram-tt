const RETENTION_KEY = 'pxg-file-cache-keep-days';
const DAY_MS = 24 * 60 * 60 * 1000;

export const FILE_CACHE_RETENTION_DAYS = [7, 30, 0] as const;
export const FILE_CACHE_MAX_BYTES = 50 * 1024 * 1024;
const NO_CACHE_QUERY = 'pxgNoCache';

export function restrictMediaCache(hash: string | undefined) {
  if (!hash || !/^(photo|document|sticker)-?\d/.test(hash) || isMediaCacheRestricted(hash)) return hash;
  return `${hash}${hash.includes('?') ? '&' : '?'}${NO_CACHE_QUERY}=1`;
}

export function isMediaCacheRestricted(hash: string) {
  const query = hash.indexOf('?');
  return query >= 0 && new URLSearchParams(hash.slice(query + 1)).get(NO_CACHE_QUERY) === '1';
}

export function stripMediaCacheRestriction(hash: string) {
  const [base, query] = hash.split('?');
  const remainder = query?.split('&').filter((part) => !new URLSearchParams(part).has(NO_CACHE_QUERY)).join('&');
  return remainder ? `${base}?${remainder}` : base;
}

/** Ноль означает хранение до вытеснения по общему пределу кэша */
export function getFileCacheRetentionDays(): number {
  try {
    const value = Number(localStorage.getItem(RETENTION_KEY) ?? 30);
    return FILE_CACHE_RETENTION_DAYS.some((days) => days === value) ? value : 30;
  } catch {
    return 30;
  }
}

export function setFileCacheRetentionDays(days: number) {
  if (!FILE_CACHE_RETENTION_DAYS.some((value) => value === days)) return;
  try {
    localStorage.setItem(RETENTION_KEY, String(days));
  } catch {
    // Без хранилища остаётся срок по умолчанию
  }
}

export function getFileCacheRetentionMs() {
  return getFileCacheRetentionDays() * DAY_MS;
}
