import type {
  MessageDto, Permissions, SavedDialogDto, SavedMessageDto,
} from '../../proxygram/server/types';
import type { ApiChat, ApiMessage, ApiThreadInfo, ApiUser } from '../types';
import type { ProxyPeer } from './ids';

import { PERMISSION_KEYS } from '../../proxygram/permissions';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { buildProxyMessage, buildProxyUser } from './builders';
import {
  emitProxyUpdate, getProxyPeerId, isProxyGuest, resolveProxyPeer,
} from './index';

/**
 * The guest's own Saved Messages (docs/spec/05-guest-saved.md). A guest has no Telegram of their own, so Web A's
 * chat with the current user is backed by the server's `saved.*`: notes, and messages saved from shared chats
 */

/** The current user of a guest is the peer of this account: `self:<user ID>` */
export const SAVED_ACCOUNT_PREFIX = 'self:';

/** One's own notes: write, edit and delete them, save files and forward from them */
export const SAVED_PERMISSIONS = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, [
  'read', 'write', 'sendMedia', 'download', 'editOwn', 'deleteOwn', 'forwardOut', 'markRead',
].includes(key)])) as Permissions;

const MAX_LIST = 100;
const DEFAULT_UPLOAD_BYTES = 2048 * 1024 * 1024;

/** A section of Saved Messages: `null` is one's own notes, otherwise messages saved from that chat */
export type SavedOrigin = { accountId: string; peerId: number } | null;

export type SavedNoteInput = {
  text: string; entities?: unknown[]; file?: Record<string, unknown>; groupedId?: string; clientRequestId?: string;
  /** A sticker or a GIF from an owner's catalog */
  sticker?: { accountId: string; documentId: string };
};

export function isSavedPeer(peer?: ProxyPeer): boolean {
  return Boolean(peer?.accountId.startsWith(SAVED_ACCOUNT_PREFIX));
}

export function isSavedChatId(chatId?: string) {
  return Boolean(chatId) && isSavedPeer(resolveProxyPeer(chatId));
}

/** Saved Messages of the signed-in guest, the chat with the current user */
export function buildGuestSavedChat(maxUploadBytes?: number) {
  const session = getPxgState().session;
  if (!session || !isProxyGuest()) return undefined;
  const peer = { accountId: `${SAVED_ACCOUNT_PREFIX}${session.user.id}`, peerId: session.user.tgUserId };
  return buildSavedChat(
    getProxyPeerId(peer.accountId, peer.peerId), peer, session.user.firstName || '', maxUploadBytes,
  );
}

/**
 * Web A asks for a section of Saved Messages with the source chat itself; the guest's own chat is the notes
 */
export function getSavedOrigin(savedChat: ApiChat, sourceChatId: string): SavedOrigin | undefined {
  // eslint-disable-next-line no-null/no-null -- the server's filter for one's own notes
  if (sourceChatId === savedChat.id) return null;
  const peer = resolveProxyPeer(sourceChatId);
  return peer && !isSavedPeer(peer) ? { accountId: peer.accountId, peerId: peer.peerId } : undefined;
}

/** The chat Web A knows as Saved Messages: the one with the current user */
export function buildSavedChat(
  id: string, peer: ProxyPeer, title: string, maxUploadBytes = DEFAULT_UPLOAD_BYTES,
): ApiChat {
  return {
    id,
    type: 'chatTypePrivate',
    title,
    pxgProxy: { ...peer, permissions: SAVED_PERMISSIONS, shareIds: [], isOwn: true, maxUploadBytes },
  };
}

/* eslint-disable no-null/no-null -- the server's message DTO keeps nulls */
/** A saved message as a message of the guest's own chat: the native builders show it, its source as a forward */
export function buildSavedDto(dto: SavedMessageDto, peer: ProxyPeer): MessageDto {
  const { origin } = dto;
  const source = origin && (!origin.senderName || origin.senderName === origin.chatTitle
    ? origin.chatTitle : [origin.chatTitle, origin.senderName].filter(Boolean).join(' · '));
  return {
    permissions: { ...SAVED_PERMISSIONS, editOwn: !origin },
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
    version: dto.editDate ? 2 : 1,
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
  const message = {
    ...buildProxyMessage(buildSavedDto(dto, chat.pxgProxy!), chat),
    // All entries belong to this user's Saved Messages; snapshots carry no permission to edit their content
    pxgIsOwn: true,
  };
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
 * History of Saved Messages, newest first. The server builds the window around any message, including old ones
 */
export async function fetchSavedHistory(
  chat: ApiChat, offsetId: number | undefined, addOffset: number, limit: number, origin?: SavedOrigin,
) {
  const page = await pxgRpc.call<SavedMessageDto[]>('saved.list', {
    offsetId, addOffset: Math.max(-MAX_LIST, Math.min(addOffset, MAX_LIST)), limit: Math.min(limit, MAX_LIST), origin,
  });
  // Web A shows the count in the header of Saved Messages and of each of its sections
  const dialogs = await fetchSavedDialogs();
  const count = dialogs.filter((dialog) => origin === undefined || isSameOrigin(dialog.origin, origin))
    .reduce((sum, dialog) => sum + dialog.count, 0);
  return { messages: page.map((dto) => buildSavedMessage(dto, chat)), count };
}

/**
 * Sections of Saved Messages by source, as Telegram's saved chats: one's own notes are the chat with oneself, a
 * source chat keeps its name even after the access ends
 */
export async function fetchSavedChats(savedChat: ApiChat, withPinned?: boolean) {
  const dialogs = await fetchSavedDialogs();
  const chats: ApiChat[] = [];
  const users: ApiUser[] = [];
  const lastMessageByChatId: Record<string, number> = {};
  const threadInfos: ApiThreadInfo[] = [];
  const chatIds = dialogs.map(({ origin, lastId, count }) => {
    const id = origin ? getProxyPeerId(origin.accountId, origin.peerId) : savedChat.id;
    if (origin) {
      // A minimal chat never replaces a shared one: Web A ignores `isMin` updates of a full chat
      chats.push({ id, type: getSavedSourceType(origin), title: origin.chatTitle || '', isMin: true });
      if (origin.peerId > 0) {
        users.push({ ...buildProxyUser(origin.accountId, origin.peerId, origin.chatTitle || undefined), isMin: true });
      }
    }
    lastMessageByChatId[id] = lastId;
    const threadInfo = {
      isCommentsInfo: false as const, chatId: savedChat.id, threadId: id, lastMessageId: lastId, messagesCount: count,
    };
    threadInfos.push(threadInfo);
    // As in Telegram, nothing in Saved Messages is unread: no "Unread Messages" line above saved messages
    emitProxyUpdate({ '@type': 'updateThreadInfo', threadInfo });
    emitProxyUpdate({
      '@type': 'updateThreadReadState', chatId: savedChat.id, threadId: id, readState: buildSavedReadState(lastId),
    });
    return id;
  });
  const messages = await fetchSavedById(savedChat, dialogs.map(({ lastId }) => lastId));
  return {
    chatIds, chats, users, messages, lastMessageByChatId, threadInfos,
    userStatusesById: {}, draftsById: {}, notifyExceptionById: {},
    threadReadStatesById: { [savedChat.id]: buildSavedReadState(dialogs[0]?.lastId ?? 0) },
    orderedPinnedIds: withPinned ? [] : undefined,
    totalChatCount: chatIds.length,
    isFullyLoaded: true as const,
  };
}

/** Web A counts unread from the last read message; with nothing unread it takes the newest message instead */
function buildSavedReadState(lastId: number) {
  return { lastReadInboxMessageId: Math.max(1, lastId), unreadCount: 0 };
}

function getSavedSourceType({ peerId, peerType }: NonNullable<SavedDialogDto['origin']>): ApiChat['type'] {
  if (peerId > 0) return 'chatTypePrivate';
  if (peerType === 'channel') return 'chatTypeChannel';
  return peerType === 'chat' ? 'chatTypeBasicGroup' : 'chatTypeSuperGroup';
}

function isSameOrigin(a: SavedDialogDto['origin'], b: SavedOrigin) {
  return a === b || Boolean(a && b && a.accountId === b.accountId && a.peerId === b.peerId);
}

export async function fetchSavedById(chat: ApiChat, ids: number[]) {
  const messages: ApiMessage[] = [];
  for (let offset = 0; offset < ids.length; offset += MAX_LIST) {
    const list = await pxgRpc.call<SavedMessageDto[]>('saved.get', { ids: ids.slice(offset, offset + MAX_LIST) });
    messages.push(...list.map((dto) => buildSavedMessage(dto, chat)));
  }
  return messages;
}

export async function searchSaved(chat: ApiChat, params: {
  query?: string; filter?: string; limit: number; offsetId?: number; minDate?: number; maxDate?: number;
  origin?: SavedOrigin;
}) {
  const list = await pxgRpc.call<SavedMessageDto[]>('saved.search', {
    ...params, limit: Math.min(params.limit, MAX_LIST),
  });
  return list.map((dto) => buildSavedMessage(dto, chat));
}

export async function sendSavedNote(chat: ApiChat, params: SavedNoteInput) {
  const dto = await pxgRpc.call<SavedMessageDto>('saved.note', params);
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
