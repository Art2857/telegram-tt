import { MEDIA_CACHE_NAME } from '../../config';
import * as cacheApi from '../../util/cacheApi';
import { scheduleTrimDeviceFiles, trimDeviceFiles } from '../../proxygram/deviceStorage';
import { FILE_CACHE_MAX_BYTES } from '../../proxygram/fileCachePolicy';
import { parseProxyMediaHash } from './mediaIds';

const PARTS_MEMORY_LIMIT = 2 * FILE_CACHE_MAX_BYTES;
const PARTS_TTL_MS = 5 * 60_000;
const generations = new Map<string, number>();
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
const streams = new Map<string, {
  userId: string; chatId: string; size: number; touchedAt: number; parts: Map<number, ArrayBuffer>;
}>();

export function getProxyCacheGeneration(userId: string) {
  return generations.get(userId) ?? 0;
}

export function invalidateProxyFileCache(userId: string, keepChatIds?: ReadonlySet<string>) {
  generations.set(userId, getProxyCacheGeneration(userId) + 1);
  streams.forEach((stream, key) => {
    if (stream.userId === userId && !keepChatIds?.has(stream.chatId)) streams.delete(key);
  });
}

function scheduleCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setTimeout(() => {
    cleanupTimer = undefined;
    const now = Date.now();
    streams.forEach((stream, key) => {
      if (now - stream.touchedAt >= PARTS_TTL_MS) streams.delete(key);
    });
    if (streams.size) scheduleCleanup();
  }, PARTS_TTL_MS);
}

function getCacheKey(url: string) {
  return /^https?:\/\//.test(url) ? new URL(url).pathname.split('/').pop()! : url;
}

/** Поток читает уже сохранённый целиком файл, не запрашивая новую подписанную ссылку */
export async function readProxyFileRange(url: string, start = 0, end?: number) {
  const blob = await cacheApi.fetch(MEDIA_CACHE_NAME, getCacheKey(url), cacheApi.Type.Blob) as Blob | undefined;
  if (!blob || start >= blob.size) return undefined;
  return {
    dataBlob: '', arrayBuffer: await blob.slice(start, end === undefined ? undefined : end + 1).arrayBuffer(),
    mimeType: blob.type || 'application/octet-stream', fullSize: blob.size,
  };
}

export async function cacheProxyFile(key: string, blob: Blob, userId: string, generation: number) {
  if (getProxyCacheGeneration(userId) !== generation) return;
  let isSaved = await cacheApi.save(MEDIA_CACHE_NAME, key, blob);
  if (!isSaved && getProxyCacheGeneration(userId) === generation) {
    await trimDeviceFiles(blob.size);
    if (getProxyCacheGeneration(userId) !== generation) return;
    isSaved = await cacheApi.save(MEDIA_CACHE_NAME, key, blob);
  }
  if (getProxyCacheGeneration(userId) !== generation) {
    await cacheApi.remove(MEDIA_CACHE_NAME, key);
    return;
  }
  if (isSaved) scheduleTrimDeviceFiles();
}

/** Только уже полученные части; полное покрытие файла превращается в обычную запись кэша */
export async function cacheProxyFilePart(
  url: string, start: number, buffer: ArrayBuffer, fullSize: number, mimeType: string,
  userId: string, generation: number,
) {
  if (!fullSize || fullSize > FILE_CACHE_MAX_BYTES || start + buffer.byteLength > fullSize
    || getProxyCacheGeneration(userId) !== generation) return;
  const key = getCacheKey(url);
  const media = parseProxyMediaHash(key);
  if (!media || media.userId !== userId) return;
  if (!start && buffer.byteLength === fullSize) {
    streams.delete(key);
    await cacheProxyFile(key, new Blob([buffer], { type: mimeType }), userId, generation);
    return;
  }
  const now = Date.now();
  let totalBytes = 0;
  streams.forEach((stream, streamKey) => {
    if (now - stream.touchedAt > PARTS_TTL_MS) streams.delete(streamKey);
    else {
      stream.parts.forEach((part) => {
        totalBytes += part.byteLength;
      });
    }
  });
  // Память ограничена и при перемотках нескольких незавершённых видео
  while (totalBytes + buffer.byteLength > PARTS_MEMORY_LIMIT && streams.size) {
    const oldestKey = streams.keys().next().value!;
    streams.get(oldestKey)!.parts.forEach((part) => {
      totalBytes -= part.byteLength;
    });
    streams.delete(oldestKey);
  }
  const existing = streams.get(key);
  const stream = existing?.size === fullSize ? existing : {
    userId, chatId: media.chatId, size: fullSize, touchedAt: now, parts: new Map<number, ArrayBuffer>(),
  };
  // Web A передаёт исходный буфер service worker и отсоединяет его от страницы
  stream.parts.set(start, buffer.slice(0));
  stream.touchedAt = now;
  streams.delete(key);
  streams.set(key, stream);
  scheduleCleanup();
  const parts = [...stream.parts.entries()].sort(([a], [b]) => a - b);
  let covered = 0;
  for (const [offset, part] of parts) {
    if (offset > covered) return;
    covered = Math.max(covered, offset + part.byteLength);
  }
  if (covered !== fullSize) return;
  streams.delete(key);
  const complete = new Uint8Array(fullSize);
  parts.forEach(([offset, part]) => complete.set(new Uint8Array(part), offset));
  await cacheProxyFile(key, new Blob([complete], { type: mimeType }), userId, generation);
}
