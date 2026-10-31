import { PxgError } from './types';

import { PXG_SERVER_URL } from './http';
import { getAccessToken } from './session';

/** Столько принимает сервер (MAX_UPLOAD_BYTES) — проверяем заранее, чтобы не гонять файл зря */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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
  onProgress?: (fraction: number) => void,
): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) throw new PxgError('too_large');
  const token = await getAccessToken();
  if (!token) throw new PxgError('unauthorized');

  const query = new URLSearchParams({
    accountId: target.accountId,
    peerId: String(target.peerId),
    name: file.name.slice(0, 255),
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PXG_SERVER_URL}/upload?${query.toString()}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new PxgError('network'));
    xhr.onload = () => {
      let body: { error?: string; message?: string } & Partial<UploadResult> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ответ не JSON — ниже ошибка по статусу
      }
      if (xhr.status === 200 && body.uploadId) {
        resolve(body as UploadResult);
      } else {
        reject(new PxgError(body.error ?? `http_${xhr.status}`, body.message));
      }
    };
    xhr.send(file);
  });
}
