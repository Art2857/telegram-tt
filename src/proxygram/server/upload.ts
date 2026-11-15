import { PxgError } from './types';

import { PXG_SERVER_URL } from './http';
import { getAccessToken } from './session';

export interface UploadResult {
  uploadId: string;
  size: number;
  fileName: string | null;
  mimeType: string | null;
}

interface UploadChunkResult extends UploadResult {
  offset: number;
  complete: boolean;
  totalSize: number | null;
}

/** Сколько раз пробуем продолжить прерванную загрузку, прежде чем сдаться */
const MAX_RESUME_ATTEMPTS = 5;
const RESUME_DELAY_MS = 700;

/**
 * Файл гостя на сервер (POST /upload) с прогрессом и докачкой. Сначала создаётся черновик (`totalSize`),
 * дальше шлются куски; после обрыва сервер отдаёт уже принятый размер, и загрузка продолжается с него.
 * Дальше — messages.send с полученным uploadId.
 */
export async function uploadFile(
  file: File,
  target: { accountId: string; peerId: number },
  maxBytes: number,
  onProgress?: (fraction: number) => void,
  options?: ResumeOptions,
): Promise<UploadResult> {
  return sendResumableUpload(
    file, '/upload', new URLSearchParams({
      accountId: target.accountId, peerId: String(target.peerId), name: file.name.slice(0, 255),
    }), maxBytes, onProgress, options,
  );
}

/** An upload of a message waiting on the device: it continues the started one, also after a reload */
export type ResumeOptions = {
  resumeUploadId?: string;
  onStarted?: (uploadId: string) => void;
  isCanceled?: () => boolean;
};

/** Personal files need no shared chat or owner's Telegram account */
export function uploadSavedFile(file: File, maxBytes: number, onProgress?: (fraction: number) => void) {
  return sendSingleUpload(
    file, '/saved/upload', new URLSearchParams({ name: file.name.slice(0, 255) }), maxBytes, onProgress,
  );
}

async function sendResumableUpload(
  file: File, path: string, query: URLSearchParams, maxBytes: number, onProgress?: (fraction: number) => void,
  options?: ResumeOptions,
): Promise<UploadResult> {
  // Checked here too, so a file over the limit does not travel to the server for nothing
  if (file.size > maxBytes) throw new PxgError('too_large');
  const token = await getAccessToken();
  if (!token) throw new PxgError('unauthorized');

  const started = await resumeUpload(options?.resumeUploadId, file.size, token)
    ?? await startUpload(path, withTotalSize(query, file.size), token, file.type);
  options?.onStarted?.(started.uploadId);
  let offset = started.offset;
  let complete = started.complete;
  let attempts = 0;

  while (!complete) {
    if (offset >= file.size) break;
    if (options?.isCanceled?.()) throw new PxgError('canceled');
    try {
      const chunk = file.slice(offset);
      const chunkQuery = new URLSearchParams(query);
      chunkQuery.set('uploadId', started.uploadId);
      chunkQuery.set('offset', String(offset));
      chunkQuery.set('totalSize', String(file.size));
      const result = await sendChunk(path, chunkQuery, chunk, token, (loaded) => {
        onProgress?.((offset + loaded) / file.size);
      });
      offset = result.offset;
      complete = result.complete;
      attempts = 0;
    } catch (err) {
      if (!(err instanceof PxgError) || err.code !== 'network') throw err;
      attempts++;
      if (attempts > MAX_RESUME_ATTEMPTS) throw err;
      await pause(RESUME_DELAY_MS);
      // Обрыв: сервер уже принял часть куска — узнаём, сколько, и продолжаем с этого места
      const status = await fetchUploadStatus(started.uploadId, token);
      offset = status.offset;
      complete = status.complete;
    }
  }

  onProgress?.(1);
  return {
    uploadId: started.uploadId,
    size: complete ? file.size : offset,
    fileName: file.name.slice(0, 255),
    mimeType: file.type || 'application/octet-stream',
  };
}

function withTotalSize(query: URLSearchParams, size: number) {
  const result = new URLSearchParams(query);
  result.set('totalSize', String(size));
  return result;
}

/**
 * The upload started before: the server tells how much it has. A network failure is passed on (the message keeps
 * waiting); an upload the server no longer knows starts anew
 */
async function resumeUpload(uploadId: string | undefined, size: number, token: string) {
  if (!uploadId) return undefined;
  try {
    const status = await fetchUploadStatus(uploadId, token);
    // A draft knows its size; a different one is another file under the same key
    return !status.totalSize || status.totalSize === size ? status : undefined;
  } catch (err) {
    if (err instanceof PxgError && err.code === 'network') throw err;
    return undefined;
  }
}

/** Первый запрос создаёт черновик и ничего не отправляет: id нужен до первого куска */
async function startUpload(
  path: string, query: URLSearchParams, token: string, mimeType: string,
): Promise<UploadChunkResult> {
  // The type goes with the draft: by it the server sends a picture as a photo, not as a file
  const response = await fetchOrNetworkError(`${PXG_SERVER_URL}${path}?${query.toString()}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': mimeType || 'application/octet-stream' },
  });
  return parseUploadResponse(response);
}

async function fetchUploadStatus(uploadId: string, token: string): Promise<UploadChunkResult> {
  const response = await fetchOrNetworkError(`${PXG_SERVER_URL}/upload/${uploadId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return parseUploadResponse(response);
}

/** No connection is a network failure, not an unknown error: the send waits for the network */
async function fetchOrNetworkError(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    throw new PxgError('network');
  }
}

async function parseUploadResponse(response: Response): Promise<UploadChunkResult> {
  let body: {
    error?: string; message?: string; reason?: string; params?: Record<string, string | number>;
  } & Partial<UploadChunkResult> = {};
  try {
    body = await response.json();
  } catch {
    // ответ не JSON — ниже ошибка по статусу
  }
  if (response.ok && body.uploadId) return body as UploadChunkResult;
  throw new PxgError(body.error ?? `http_${response.status}`, body.message, body.reason, body.params);
}

/** Один кусок файла: XHR показывает прогресс, fetch — нет */
function sendChunk(
  path: string, query: URLSearchParams, chunk: Blob, token: string, onLoaded: (loaded: number) => void,
): Promise<UploadChunkResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PXG_SERVER_URL}${path}?${query.toString()}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', chunk.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onLoaded(event.loaded);
    };
    xhr.onerror = () => reject(new PxgError('network'));
    xhr.onload = () => {
      let body: {
        error?: string; message?: string; reason?: string; params?: Record<string, string | number>;
      } & Partial<UploadChunkResult> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ответ не JSON — ниже ошибка по статусу
      }
      if (xhr.status === 200 && body.uploadId) {
        resolve(body as UploadChunkResult);
      } else {
        reject(new PxgError(body.error ?? `http_${xhr.status}`, body.message, body.reason, body.params));
      }
    };
    xhr.send(chunk);
  });
}

/** Заметки в «Избранное»: один запрос, без черновика — файл маленький и личный */
function sendSingleUpload(
  file: File, path: string, query: URLSearchParams, maxBytes: number, onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  if (file.size > maxBytes) throw new PxgError('too_large');
  return getAccessToken().then((token) => {
    if (!token) throw new PxgError('unauthorized');
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${PXG_SERVER_URL}${path}?${query.toString()}`);
      xhr.setRequestHeader('authorization', `Bearer ${token}`);
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new PxgError('network'));
      xhr.onload = () => {
        let body: {
          error?: string; message?: string; reason?: string; params?: Record<string, string | number>;
        } & Partial<UploadResult> = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          // ответ не JSON — ниже ошибка по статусу
        }
        if (xhr.status === 200 && body.uploadId) {
          resolve(body as UploadResult);
        } else {
          reject(new PxgError(body.error ?? `http_${xhr.status}`, body.message, body.reason, body.params));
        }
      };
      xhr.send(file);
    });
  });
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
