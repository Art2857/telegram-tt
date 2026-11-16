import { PxgError } from './server/types';

import { MEDIA_CACHE_DISABLED, MEDIA_CACHE_NAME_AVATARS } from '../config';
import * as cacheApi from '../util/cacheApi';
import { resizeImageInBackground } from '../util/imageResize';
import { getProxyCacheGeneration } from '../api/proxy/fileCache';
import { buildPersonalPhotoId } from '../api/proxy/mediaIds';
import { PXG_SERVER_URL } from './server/http';
import { getAccessToken } from './server/session';
import { getPxgState } from './server/store';

const PHOTO_SIZE = 640;
const MAX_PHOTO_BYTES = 512 * 1024;
const PHOTO_TIMEOUT_MS = 30_000;
const downloads = new Map<string, Promise<Blob | undefined>>();

export async function uploadPersonalContactPhoto(tgUserId: number, file: File) {
  const userId = getPxgState().session?.user.id;
  if (!userId) throw new PxgError('unauthorized');
  const url = await resizeImageInBackground(file, PHOTO_SIZE, PHOTO_SIZE, 'image/jpeg').catch(() => {
    throw new PxgError('bad_request', undefined, 'contact_photo_invalid');
  });
  try {
    const blob = await fetch(url).then((response) => response.blob());
    if (blob.size > MAX_PHOTO_BYTES) throw new PxgError('bad_request', undefined, 'contact_photo_invalid');
    const token = await getAccessToken();
    if (getPxgState().session?.user.id !== userId) throw new PxgError('unauthorized');
    const response = await fetch(`${PXG_SERVER_URL}/contacts/photo?tgUserId=${tgUserId}`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
      body: blob, signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    }).catch((err: Error) => {
      throw new PxgError(err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'network');
    });
    const result = await response.json();
    if (!response.ok) throw new PxgError(result.error, undefined, result.reason, result.params);
    if (getPxgState().session?.user.id !== userId) throw new PxgError('unauthorized');
    return result as { id: string; width: number; height: number };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Один файл кэша для всех источников собеседника; ключ включает владельца личного фото */
export function downloadPersonalContactPhoto(userId: string, id: string): Promise<Blob | undefined> {
  if (getPxgState().session?.user.id !== userId) return Promise.resolve(undefined);
  const key = `${userId}:${id}:${getProxyCacheGeneration(userId)}`;
  const pending = downloads.get(key);
  if (pending) return pending;
  const request = readPersonalContactPhoto(userId, id).catch(() => undefined).finally(() => {
    if (downloads.get(key) === request) downloads.delete(key);
  });
  downloads.set(key, request);
  return request;
}

async function readPersonalContactPhoto(userId: string, id: string) {
  if (getPxgState().session?.user.id !== userId) return undefined;
  const generation = getProxyCacheGeneration(userId);
  const isCurrent = () => getPxgState().session?.user.id === userId
    && getProxyCacheGeneration(userId) === generation;
  const key = buildPersonalPhotoId(userId, id);
  if (!MEDIA_CACHE_DISABLED) {
    const cached = await cacheApi.fetchShared(MEDIA_CACHE_NAME_AVATARS, key, cacheApi.Type.Blob)
      || await cacheApi.fetchFromAccountScopes(MEDIA_CACHE_NAME_AVATARS, key, cacheApi.Type.Blob);
    if (cached && isCurrent()) return cached as Blob;
  }
  const token = await getAccessToken();
  if (!isCurrent()) return undefined;
  const response = await fetch(`${PXG_SERVER_URL}/contacts/photo/${id}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const blob = await response.blob();
  if (!isCurrent() || blob.size > MAX_PHOTO_BYTES || blob.type !== 'image/jpeg') return undefined;
  if (!MEDIA_CACHE_DISABLED) {
    await cacheApi.save(MEDIA_CACHE_NAME_AVATARS, key, blob).catch(() => undefined);
    if (!isCurrent()) {
      await cacheApi.remove(MEDIA_CACHE_NAME_AVATARS, key);
      return undefined;
    }
  }
  return blob;
}

export function forgetPersonalContactPhoto(userId: string, id: string) {
  const key = buildPersonalPhotoId(userId, id);
  return Promise.all([
    cacheApi.removeShared(MEDIA_CACHE_NAME_AVATARS, key),
    cacheApi.removeFromAccountScopes(MEDIA_CACHE_NAME_AVATARS, key),
  ]);
}
