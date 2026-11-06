import type {
  MessageDto, Permissions, SavedDialogDto, SavedMessageDto,
} from '../../proxygram/server/types';
import type { ApiChat, ApiMessage } from '../types';
import type { ProxyPeer } from './ids';

import { PERMISSION_KEYS } from '../../proxygram/permissions';
import { pxgRpc } from '../../proxygram/server/rpc';
import { buildProxyMessage } from './builders';
import { getProxyPeerId, resolveProxyPeer } from './index';

/**
 * The guest's own Saved Messages (docs/spec/05-guest-saved.md). A guest has no Telegram of their own, so Web A's
 * chat with the current user is backed by the server's `saved.*`: notes, and messages saved from shared chats
 */

/** The current user of a guest is the peer of this account: `self:<user ID>` */
export const SAVED_ACCOUNT_PREFIX = 'self:';

/** One's own notes: write, edit and delete them, save files and forward from them */
export const SAVED_PERMISSIONS = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, [
  'read', 'write', 'download', 'editOwn', 'deleteOwn', 'forwardOut', 'markRead',
].includes(key)])) as Permissions;

const MAX_LIST = 100;

export function isSavedPeer(peer?: ProxyPeer): boolean {
  return Boolean(peer?.accountId.startsWith(SAVED_ACCOUNT_PREFIX));
}

export function isSavedChatId(chatId?: string) {
  return Boolean(chatId) && isSavedPeer(resolveProxyPeer(chatId));
}

/** The chat Web A knows as Saved Messages: the one with the current user */
export function buildSavedChat(id: string, peer: ProxyPeer, title: string): ApiChat {
  return {
    id,
    type: 'chatTypePrivate',
    title,
    pxgProxy: { ...peer, permissions: SAVED_PERMISSIONS, shareIds: [], isOwn: true },
  };
}

/* eslint-disable no-null/no-null -- the server's message DTO keeps nulls */
/** A saved message as a message of the guest's own chat: the native builders show it, its source as a forward */
export function buildSavedDto(dto: SavedMessageDto, peer: ProxyPeer): MessageDto {
  const { origin } = dto;
  const source = origin && (!origin.senderName || origin.senderName === origin.chatTitle
    ? origin.chatTitle : [origin.chatTitle, origin.senderName].filter(Boolean).join(' · '));
  return {
    permissions: SAVED_PERMISSIONS,
    accountId: peer.accountId,
    peerId: peer.peerId,
    msgId: dto.id,
    topicId: null,
    senderId: peer.peerId,
    date: dto.date,
    editDate: dto.editDate,
    text: dto.text,
    entities: dto.entities,
    media: dto.media,
    replyTo: null,
    fwdFrom: origin ? { _: 'messageFwdHeader', date: Math.floor(Date.parse(origin.date) / 1000) } : null,
    forwardName: source || undefined,
    reactions: null,
    groupedId: dto.groupedId,
    // As in Telegram's Saved Messages: one's own notes are outgoing, saved ones show their original author
    isOutgoing: !origin,
    isPost: false,
    isService: false,
    ttlExpiresAt: null,
    version: 1,
    changeSeq: '0',
    deleted: null,
    sentByUserId: null,
    isPinned: dto.isPinned || undefined,
    poll: dto.poll,
    webPage: dto.webPage,
    attachment: dto.attachment,
  };
}
/* eslint-enable no-null/no-null */

export function buildSavedMessage(dto: SavedMessageDto, chat: ApiChat): ApiMessage {
  const message = buildProxyMessage(buildSavedDto(dto, chat.pxgProxy!), chat);
  if (!dto.origin || !message.forwardInfo) return message;
  // The original message opens from here while the guest still has the chat
  return {
    ...message,
    forwardInfo: {
      ...message.forwardInfo,
      savedFromPeerId: getProxyPeerId(dto.origin.accountId, dto.origin.peerId),
      fromMessageId: dto.origin.msgId,
    },
  };
}

/**
 * History of Saved Messages, newest first as the server keeps it. Web A asks around a message with a negative
 * offset only when jumping to it; the server pages backwards, so newer messages come from the start of the list
 */
export async function fetchSavedHistory(chat: ApiChat, offsetId: number | undefined, addOffset: number, limit: number) {
  const page = offsetId && addOffset < 0
    ? (await pxgRpc.call<SavedMessageDto[]>('saved.list', { limit: MAX_LIST })).filter((dto) => dto.id >= offsetId)
    : await pxgRpc.call<SavedMessageDto[]>('saved.list', { offsetId, limit: Math.min(limit, MAX_LIST) });
  // Web A shows the count in the header of Saved Messages
  const count = offsetId ? page.length
    : (await fetchSavedDialogs()).reduce((sum, dialog) => sum + dialog.count, 0);
  return { messages: page.map((dto) => buildSavedMessage(dto, chat)), count };
}

export async function fetchSavedById(chat: ApiChat, ids: number[]) {
  // Saved Messages are few; the newest page has what a reply or a pinned message points to
  const list = await pxgRpc.call<SavedMessageDto[]>('saved.list', { limit: MAX_LIST });
  return list.filter((dto) => ids.includes(dto.id)).map((dto) => buildSavedMessage(dto, chat));
}

export async function searchSaved(chat: ApiChat, query: string, limit: number) {
  const list = await pxgRpc.call<SavedMessageDto[]>('saved.search', { query, limit: Math.min(limit, MAX_LIST) });
  return list.map((dto) => buildSavedMessage(dto, chat));
}

export async function sendSavedNote(chat: ApiChat, text: string, entities: unknown[] | undefined) {
  const dto = await pxgRpc.call<SavedMessageDto>('saved.note', { text, entities });
  return buildSavedMessage(dto, chat);
}

export async function editSavedNote(chat: ApiChat, id: number, text: string, entities: unknown[] | undefined) {
  const dto = await pxgRpc.call<SavedMessageDto>('saved.edit', { id, text, entities });
  return buildSavedMessage(dto, chat);
}

export function deleteSaved(ids: number[]) {
  return pxgRpc.call('saved.delete', { ids });
}

export function pinSaved(id: number, pinned: boolean) {
  return pxgRpc.call('saved.pin', { id, pinned });
}

/** Messages of a shared chat go to Saved Messages as a snapshot: the server checks the right to forward them */
export async function saveToSaved(chat: ApiChat, source: ProxyPeer, msgIds: number[]) {
  const list = await pxgRpc.call<SavedMessageDto[]>('saved.save', { ...source, msgIds });
  return list.map((dto) => buildSavedMessage(dto, chat));
}

export function fetchSavedDialogs() {
  return pxgRpc.call<SavedDialogDto[]>('saved.dialogs');
}
