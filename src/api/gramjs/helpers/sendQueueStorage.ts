import type { SendMessageParams } from '../../../types';
import type { ApiAttachment, ApiMessage, ApiSessionData } from '../../types';

import { NATIVE_SEND_FILES_IDB_STORE, NATIVE_SEND_QUEUE_IDB_STORE } from '../../../util/browser/idb';

export type SendQueueKey = { prefix: string; key: CryptoKey };
type EncryptedValue = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer; createdAt?: number };
type StoredFile = { id: string; chunks: number; type: string };
type AttachmentName = 'attachment' | 'pollMedia' | 'solutionMedia';
type StoredFiles = Partial<Record<AttachmentName, { file: StoredFile; preview?: StoredFile }>>;

export type StoredNativeSend = {
  userId: string;
  randomId: string;
  createdAt: number;
  params: SendMessageParams;
  message: ApiMessage;
  files?: StoredFiles;
  error?: string;
  isAcknowledged?: boolean;
};

const FILE_CHUNK_BYTES = 1024 * 1024;
const AES_KEY_BITS = 256;
const IV_BYTES = 12;
const ORPHAN_RETENTION_MS = 24 * 60 * 60 * 1000;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const DOMAIN = 'Proxygram native send queue v1';

export async function deriveSendQueueKeys(session: ApiSessionData): Promise<SendQueueKey[]> {
  const dcIds = [session.mainDcId, ...Object.keys(session.keys).map(Number).filter((id) => id !== session.mainDcId)];
  return Promise.all(dcIds.filter((id) => session.keys[id]).map(async (dcId) => {
    const authKey = Uint8Array.from(session.keys[dcId].match(/.{2}/g)!, (byte) => parseInt(byte, 16));
    const material = await crypto.subtle.importKey('raw', authKey, 'HKDF', false, ['deriveKey']);
    const salt = ENCODER.encode(`${DOMAIN}:${Boolean(session.isTest)}`);
    const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', authKey));
    const hex = Array.from(fingerprint, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const prefix = `${Boolean(session.isTest)}:${hex}:`;
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: ENCODER.encode(DOMAIN) },
      material, { name: 'AES-GCM', length: AES_KEY_BITS }, false, ['encrypt', 'decrypt']);
    return { prefix, key };
  }));
}

export async function readNativeSends(key: SendQueueKey): Promise<StoredNativeSend[]> {
  const keys = (await NATIVE_SEND_QUEUE_IDB_STORE.keys()).filter((id): id is string => (
    typeof id === 'string' && id.startsWith(key.prefix)
  ));
  const result: StoredNativeSend[] = [];
  for (const id of keys) {
    const encrypted = await NATIVE_SEND_QUEUE_IDB_STORE.get<EncryptedValue>(id);
    if (!encrypted) continue;
    // Повреждённая запись не мешает восстановлению остальных отправок
    try {
      result.push(JSON.parse(DECODER.decode(await decryptValue(key, id, encrypted))));
    } catch {
      // Чужой ключ или повреждённый шифротекст никогда не открывает очередь
    }
  }
  return result;
}

export async function writeNativeSend(key: SendQueueKey, item: StoredNativeSend) {
  const id = `${key.prefix}${item.randomId}`;
  const data = ENCODER.encode(JSON.stringify(item, (_name, value) => (
    typeof value === 'string' && value.startsWith('blob:') ? undefined : value
  )));
  await NATIVE_SEND_QUEUE_IDB_STORE.set(id, await encryptValue(key, id, data));
}

export async function hasNativeSend(key: SendQueueKey, randomId: string) {
  return Boolean(await NATIVE_SEND_QUEUE_IDB_STORE.get(`${key.prefix}${randomId}`));
}

export async function storeNativeSendFiles(
  key: SendQueueKey, item: StoredNativeSend, isCurrent: () => boolean,
): Promise<{ files: StoredFiles; urls: string[] }> {
  const files: StoredFiles = {};
  const urls: string[] = [];
  try {
    for (const [name, attachment] of getAttachments(item.params)) {
      if (!attachment || attachment.gif) continue;
      const blob = attachment.blob || (attachment.blobUrl ? await (await fetch(attachment.blobUrl)).blob() : undefined);
      if (!blob) throw new Error('LOCAL_QUEUE_FILE_MISSING');
      attachment.blob = blob;
      attachment.blobUrl = URL.createObjectURL(blob);
      urls.push(attachment.blobUrl);
      attachment.compressedBlob = undefined;
      attachment.compressedBlobUrl = undefined;
      const previewBlob = attachment.previewBlob || (attachment.previewBlobUrl
        ? await (await fetch(attachment.previewBlobUrl)).blob() : undefined);
      if (previewBlob) {
        attachment.previewBlob = previewBlob;
        attachment.previewBlobUrl = URL.createObjectURL(previewBlob);
        urls.push(attachment.previewBlobUrl);
      }
      const file = await storeFile(key, `${item.randomId}:${name}`, blob, isCurrent);
      const preview = previewBlob
        ? await storeFile(key, `${item.randomId}:${name}:preview`, previewBlob, isCurrent) : undefined;
      files[name] = { file, preview };
    }
    return { files, urls };
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    await removeNativeSend(key, item.randomId);
    throw error;
  }
}

export async function restoreNativeSendFiles(key: SendQueueKey, item: StoredNativeSend): Promise<string[]> {
  const urls: string[] = [];
  try {
    for (const [name, attachment] of getAttachments(item.params)) {
      const stored = item.files?.[name];
      if (!attachment || !stored) continue;
      attachment.blob = await restoreFile(key, stored.file);
      attachment.blobUrl = URL.createObjectURL(attachment.blob);
      urls.push(attachment.blobUrl);
      if (stored.preview) {
        attachment.previewBlob = await restoreFile(key, stored.preview);
        attachment.previewBlobUrl = URL.createObjectURL(attachment.previewBlob);
        urls.push(attachment.previewBlobUrl);
      }
    }
    return urls;
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}

export async function removeNativeSend(key: SendQueueKey, randomId: string) {
  await NATIVE_SEND_QUEUE_IDB_STORE.del(`${key.prefix}${randomId}`);
  const prefix = `${key.prefix}${randomId}:`;
  const chunks = (await NATIVE_SEND_FILES_IDB_STORE.keys()).filter((id): id is string => (
    typeof id === 'string' && id.startsWith(prefix)
  ));
  await NATIVE_SEND_FILES_IDB_STORE.delMany(chunks);
}

export async function clearNativeSends(session: ApiSessionData) {
  const keys = await deriveSendQueueKeys(session);
  for (const store of [NATIVE_SEND_QUEUE_IDB_STORE, NATIVE_SEND_FILES_IDB_STORE]) {
    const entries = (await store.keys()).filter((id): id is string => (
      typeof id === 'string' && keys.some(({ prefix }) => id.startsWith(prefix))
    ));
    await store.delMany(entries);
  }
}

/** Части, записанные до аварийного закрытия и без готового сообщения, не занимают место бессрочно */
export async function cleanNativeSendOrphans(key: SendQueueKey) {
  const saved = new Set(await NATIVE_SEND_QUEUE_IDB_STORE.keys());
  const chunkIds = (await NATIVE_SEND_FILES_IDB_STORE.keys()).filter((id): id is string => (
    typeof id === 'string' && id.startsWith(key.prefix)
  ));
  const groups = new Map<string, { latest: number; ids: string[] }>();
  for (const id of chunkIds) {
    const randomId = id.slice(key.prefix.length).split(':')[0];
    if (saved.has(`${key.prefix}${randomId}`)) continue;
    const chunk = await NATIVE_SEND_FILES_IDB_STORE.get<EncryptedValue>(id);
    if (!chunk) continue;
    const group = groups.get(randomId) || { latest: 0, ids: [] };
    group.latest = Math.max(group.latest, chunk.createdAt || 0);
    group.ids.push(id);
    groups.set(randomId, group);
  }
  for (const [randomId, group] of groups) {
    if (group.latest >= Date.now() - ORPHAN_RETENTION_MS || await hasNativeSend(key, randomId)) continue;
    await NATIVE_SEND_FILES_IDB_STORE.delMany(group.ids);
  }
}

function getAttachments(params: SendMessageParams): [AttachmentName, ApiAttachment | undefined][] {
  return [['attachment', params.attachment], ['pollMedia', params.poll?.attachedMedia],
    ['solutionMedia', params.poll?.solutionMedia]];
}

async function storeFile(
  key: SendQueueKey, fileId: string, blob: Blob, isCurrent: () => boolean,
): Promise<StoredFile> {
  const chunks = Math.ceil(blob.size / FILE_CHUNK_BYTES);
  for (let index = 0; index < chunks; index++) {
    if (!isCurrent()) throw new Error('LOCAL_QUEUE_CANCELED');
    const id = `${key.prefix}${fileId}:${index}`;
    const part = blob.slice(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
    const data = new Uint8Array(await part.arrayBuffer());
    await NATIVE_SEND_FILES_IDB_STORE.set(id, await encryptValue(key, id, data));
  }
  if (!isCurrent()) throw new Error('LOCAL_QUEUE_CANCELED');
  return { id: fileId, chunks, type: blob.type };
}

async function restoreFile(key: SendQueueKey, file: StoredFile): Promise<Blob> {
  const parts: Blob[] = [];
  for (let index = 0; index < file.chunks; index++) {
    const id = `${key.prefix}${file.id}:${index}`;
    const encrypted = await NATIVE_SEND_FILES_IDB_STORE.get<EncryptedValue>(id);
    if (!encrypted) throw new Error('LOCAL_QUEUE_FILE_MISSING');
    parts.push(new Blob([await decryptValue(key, id, encrypted)]));
  }
  return new Blob(parts, { type: file.type });
}

async function encryptValue(key: SendQueueKey, id: string, data: Uint8Array<ArrayBuffer>): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const dataEncrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: ENCODER.encode(id) }, key.key, data,
  );
  return { iv, data: dataEncrypted, createdAt: Date.now() };
}

function decryptValue(key: SendQueueKey, id: string, value: EncryptedValue) {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: value.iv, additionalData: ENCODER.encode(id) }, key.key, value.data,
  );
}
