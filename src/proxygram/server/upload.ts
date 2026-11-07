import { PxgError } from './types';

import { PXG_SERVER_URL } from './http';
import { getAccessToken } from './session';

export interface UploadResult {
  uploadId: string;
  size: number;
  fileName: string | null;
  mimeType: string | null;
}

/**
 * Файл гостя на сервер (POST /upload) с прогрессом: fetch не умеет показывать прогресс отправки,
 * поэтому XMLHttpRequest. Дальше — messages.send с полученным uploadId.
 */
export async function uploadFile(
  file: File,
  target: { accountId: string; peerId: number },
  maxBytes: number,
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  return sendUpload(file, '/upload', new URLSearchParams({
    accountId: target.accountId, peerId: String(target.peerId), name: file.name.slice(0, 255),
  }), maxBytes, onProgress);
}

/** Personal files need no shared chat or owner's Telegram account */
export function uploadSavedFile(file: File, maxBytes: number, onProgress?: (fraction: number) => void) {
  return sendUpload(
    file, '/saved/upload', new URLSearchParams({ name: file.name.slice(0, 255) }), maxBytes, onProgress,
  );
}

async function sendUpload(
  file: File, path: string, query: URLSearchParams, maxBytes: number, onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  // Checked here too, so a file over the limit does not travel to the server for nothing
  if (file.size > maxBytes) throw new PxgError('too_large');
  const token = await getAccessToken();
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
}
