const RETENTION_KEY = 'pxg-file-cache-keep-days';
const DAY_MS = 24 * 60 * 60 * 1000;

export const FILE_CACHE_RETENTION_DAYS = [7, 30, 0] as const;
export const FILE_CACHE_MAX_BYTES = 50 * 1024 * 1024;

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
