import { getActions, getGlobal } from '../../global';

import type { PersonalContactDto, PersonalContactNameDto } from '../../proxygram/server/types';
import type { ApiPhoto } from '../types';

import { forgetPersonalContactPhoto } from '../../proxygram/contactPhotos';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { emitProxyUpdate, resolveProxyPeer } from './index';
import { buildPersonalPhotoId, buildProxyProfilePhotoId } from './mediaIds';

let ownerId: string | undefined;
let names = new Map<number, PersonalContactNameDto>();
let listGeneration = 0;
let hasLoadedNames = false;
const reads = new Map<number, Promise<PersonalContactDto>>();

function syncIdentity() {
  const next = getPxgState().session?.user.id;
  if (next === ownerId) return;
  ownerId = next;
  names = new Map();
  hasLoadedNames = false;
  reads.clear();
  listGeneration++;
}

export function getPersonalContactName(tgUserId: number) {
  syncIdentity();
  const contact = names.get(tgUserId);
  if (contact) return contact.name;
  // null — сервер подтвердил отсутствие переименования, undefined — пока известен только кэш устройства
  // eslint-disable-next-line no-null/no-null
  return hasLoadedNames ? null : undefined;
}

export function getPersonalContactPhoto(tgUserId: number) {
  syncIdentity();
  const contact = names.get(tgUserId);
  if (contact) return contact.photo;
  // eslint-disable-next-line no-null/no-null
  return hasLoadedNames ? null : undefined;
}

export function buildPersonalContactPhoto(
  peerId: string, photo: PersonalContactNameDto['photo'],
): ApiPhoto | undefined {
  const userId = getPxgState().session?.user.id;
  if (!userId || !photo) return undefined;
  return { mediaType: 'photo', id: buildProxyProfilePhotoId(peerId, buildPersonalPhotoId(userId, photo.id)),
    sizes: [{ type: 'x', width: photo.width, height: photo.height }], date: 0 };
}

/** Список не содержит заметок; тексты загружаются только вместе с профилем */
export async function loadPersonalContactNames() {
  syncIdentity();
  const userId = ownerId;
  if (!userId) return;
  const generation = ++listGeneration;
  const rows = await pxgRpc.call<PersonalContactNameDto[]>('contacts.names');
  syncIdentity();
  if (ownerId !== userId || generation !== listGeneration) return;
  for (const row of rows) {
    if ((names.get(row.tgUserId)?.revision || 0) <= row.revision) names.set(row.tgUserId, row);
  }
  hasLoadedNames = true;
  applyNames();
  // Уже открытый профиль мог пропустить событие во время разрыва связи
  const loaded = new Set(Object.keys(getGlobal().users.fullInfoById)
    .map((id) => resolveProxyPeer(id)?.peerId).filter((id): id is number => Boolean(id && id > 0)));
  for (const tgUserId of loaded) void loadPersonalContact(tgUserId).catch(() => undefined);
}

export function loadPersonalContact(tgUserId: number): Promise<PersonalContactDto> {
  syncIdentity();
  const pending = reads.get(tgUserId);
  if (pending) return pending;
  const userId = ownerId;
  const request = pxgRpc.call<PersonalContactDto>('contacts.get', { tgUserId }).then((result) => {
    syncIdentity();
    if (userId === ownerId && (reads.get(tgUserId) !== request
      || (names.get(tgUserId)?.revision || 0) > result.revision)) {
      if (reads.get(tgUserId) === request) reads.delete(tgUserId);
      return loadPersonalContact(tgUserId);
    }
    if (userId === ownerId) applyContact(result);
    return result;
  }).finally(() => {
    if (reads.get(tgUserId) === request) reads.delete(tgUserId);
  });
  reads.set(tgUserId, request);
  return request;
}

export function refreshPersonalContact(tgUserId: number) {
  syncIdentity();
  reads.delete(tgUserId);
  return loadPersonalContact(tgUserId);
}

export async function savePersonalContact(tgUserId: number, patch: {
  name?: PersonalContactDto['name']; note?: string; photoId?: string | null;
}) {
  syncIdentity();
  const userId = ownerId;
  reads.delete(tgUserId);
  const result = await pxgRpc.call<PersonalContactDto>('contacts.set', { tgUserId, ...patch });
  syncIdentity();
  if (ownerId === userId) {
    reads.delete(tgUserId);
    applyContact(result);
  }
  return result;
}

function applyContact(contact: PersonalContactDto) {
  if ((names.get(contact.tgUserId)?.revision || 0) > contact.revision) return;
  names.set(contact.tgUserId, contact);
  applyNames(contact.tgUserId);
  const global = getGlobal();
  for (const id of Object.keys(global.users.fullInfoById)) {
    if (resolveProxyPeer(id)?.peerId !== contact.tgUserId) continue;
    const personalPhoto = buildPersonalContactPhoto(id, contact.photo);
    const hasChangedPhoto = global.users.fullInfoById[id].personalPhoto?.id !== personalPhoto?.id;
    emitProxyUpdate({ '@type': 'updateUserFullInfo', id,
      fullInfo: { note: contact.note ? { text: contact.note } : undefined, personalPhoto } });
    if (hasChangedPhoto) getActions().loadMoreProfilePhotos({ peerId: id, shouldInvalidateCache: true });
  }
}

function applyNames(tgUserId?: number) {
  const global = getGlobal();
  for (const user of Object.values(global.users.byId)) {
    const peer = resolveProxyPeer(user.id);
    if (!peer || peer.peerId <= 0 || (tgUserId !== undefined && tgUserId !== peer.peerId)) continue;
    const name = names.get(peer.peerId)?.name;
    const firstName = name ? name.firstName : user.pxgOriginalName || user.firstName || String(peer.peerId);
    const lastName = name?.lastName || undefined;
    const photo = names.get(peer.peerId)?.photo;
    const originalPhotoId = user.pxgOriginalPhotoId || (!user.pxgPersonalPhoto ? user.avatarPhotoId : undefined);
    const avatarPhotoId = photo && ownerId ? buildPersonalPhotoId(ownerId, photo.id) : originalPhotoId;
    if (user.pxgPersonalPhoto && user.pxgPersonalPhoto.id !== photo?.id && ownerId) {
      void forgetPersonalContactPhoto(ownerId, user.pxgPersonalPhoto.id).catch(() => undefined);
    }
    if (user.firstName !== firstName || user.lastName !== lastName
      || Boolean(user.pxgPersonalName) !== Boolean(name) || user.avatarPhotoId !== avatarPhotoId
      || user.pxgPersonalPhoto?.id !== photo?.id) {
      emitProxyUpdate({ '@type': 'updateUser', id: user.id,
        user: { firstName, lastName, pxgPersonalName: name || undefined, avatarPhotoId,
          pxgOriginalPhotoId: originalPhotoId, pxgPersonalPhoto: photo || undefined } });
    }
  }
  for (const chat of Object.values(global.chats.byId)) {
    const peer = chat.pxgProxy;
    if (!peer || peer.peerId <= 0 || (tgUserId !== undefined && tgUserId !== peer.peerId)) continue;
    const name = names.get(peer.peerId)?.name;
    const photo = names.get(peer.peerId)?.photo;
    const originalPhotoId = peer.originalPhotoId || (!peer.personalPhoto ? chat.avatarPhotoId : undefined);
    const avatarPhotoId = photo && ownerId ? buildPersonalPhotoId(ownerId, photo.id) : originalPhotoId;
    const title = name ? [name.firstName, name.lastName].filter(Boolean).join(' ')
      : peer.originalTitle || global.users.byId[chat.id]?.pxgOriginalName || String(peer.peerId);
    if (chat.title !== title || peer.personalName?.firstName !== name?.firstName
      || peer.personalName?.lastName !== name?.lastName || chat.avatarPhotoId !== avatarPhotoId
      || peer.personalPhoto?.id !== photo?.id) {
      emitProxyUpdate({ '@type': 'updateChat', id: chat.id,
        chat: { title, avatarPhotoId, pxgProxy: { ...peer, personalName: name || undefined,
          personalPhoto: photo || undefined, originalPhotoId } } });
    }
  }
}
