import type { AccessChat, MessageDto } from '../../proxygram/server/types';
import type { MethodArgs, MethodResponse, Methods } from '../gramjs/methods/types';
import type { ApiChat, ApiMessage, ApiUser } from '../types';
import { MAIN_THREAD_ID } from '../types';
import { PROXY_REACTION_EMOJIS } from './types';

import { pause } from '../../util/schedulers';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { buildProxyChat, buildProxyMessage, buildProxyPoll, buildProxyUser } from './builders';
import { emitProxyUpdate, getProxyPeerId, resolveProxyPeer } from './index';
import { downloadMedia } from './media';
import { runProxyJob } from './outbox';
import {
  fetchCustomEmojiSets, fetchFavoriteStickers, fetchRecentStickers, fetchSavedGifs, fetchStickers,
  fetchStickerSets, fetchStickersForEmoji,
} from './stickers';
import {
  answerCallbackButton, deleteMessages, editMessage, forwardMessages, markMessageListRead, sendMessage,
  sendMessageAction, sendPollVote, sendReaction,
} from './writes';

type WindowResult = { messages: MessageDto[]; count: number };
const HISTORY_WAIT_MS = 10_000;
const SEARCH_FILTERS = new Set(['text', 'media', 'documents', 'links', 'audio', 'voice', 'gif', 'polls']);

const methods = {
  fetchChats,
  fetchChat,
  searchChats,
  searchMessagesInChat,
  searchMessagesGlobal,
  fetchSavedChats: fetchEmptyChats,
  fetchMessages,
  fetchMessage,
  fetchFullChat,
  fetchFullUser,
  fetchMessagesById,
  sendMessage,
  editMessage,
  deleteMessages,
  forwardMessages,
  answerCallbackButton,
  sendPollVote,
  sendReaction,
  markMessageListRead,
  sendMessageAction,
  downloadMedia,
  fetchStickerSets,
  fetchCustomEmojiSets,
  fetchRecentStickers,
  fetchFavoriteStickers,
  fetchSavedGifs,
  fetchStickers,
  fetchStickersForEmoji,
  fetchAvailableReactions: () => Promise.resolve(PROXY_REACTION_EMOJIS.map((emoticon) => ({
    reaction: { type: 'emoji' as const, emoticon }, title: emoticon,
  }))),
} satisfies Partial<Methods>;

function fetchEmptyChats() {
  return Promise.resolve({
    chats: [], users: [], messages: [], chatIds: [], threadInfos: [], totalChatCount: 0,
    lastMessageByChatId: {}, userStatusesById: {}, draftsById: {}, notifyExceptionById: {},
    orderedPinnedIds: undefined, isFullyLoaded: true as const,
  });
}

export async function callProxyApi<T extends keyof Methods>(
  name: T, ...args: MethodArgs<T>
): Promise<Awaited<MethodResponse<T>>> {
  const method = methods[name as keyof typeof methods] as ((...params: unknown[]) => unknown) | undefined;
  // Unsupported methods never fall back to Telegram
  return await method?.(...args) as Awaited<MethodResponse<T>>;
}

export async function fetchProxyChats() {
  const sessionId = getPxgState().session?.user.id;
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  if (sessionId !== getPxgState().session?.user.id) return undefined;
  const chats = access.map(buildProxyChat);
  const users: ApiUser[] = access.filter((chat) => chat.peerId > 0).map((chat) => (
    buildProxyUser(chat.accountId, chat.peerId, chat.title || chat.username || undefined)
  ));
  const pages = await Promise.all(chats.map(async (chat) => {
    try {
      return await pxgRpc.call<WindowResult>('messages.window', { ...chat.pxgProxy, limit: 1 });
    } catch {
      // A revoked or temporarily unavailable chat does not hide the other accesses
      return undefined;
    }
  }));
  if (sessionId !== getPxgState().session?.user.id) return undefined;
  const messages = pages.flatMap((page, index) => (
    page?.messages.map((dto) => buildProxyMessage(dto, chats[index])) || []
  ));
  pages.forEach((page) => page?.messages.forEach((dto) => emitRelated(dto)));
  return {
    chats, users, messages,
    chatIds: chats.map((chat) => chat.id),
    lastMessageByChatId: Object.fromEntries(messages.map((message) => [message.chatId, message.id])),
    userStatusesById: {},
    draftsById: {},
    notifyExceptionById: {},
    threadInfos: chats.map((chat, index) => ({
      chatId: chat.id, threadId: MAIN_THREAD_ID, isCommentsInfo: false as const,
      lastMessageId: pages[index]?.messages[0]?.msgId, messagesCount: pages[index]?.count,
    })),
    orderedPinnedIds: undefined,
    totalChatCount: chats.length,
    isFullyLoaded: true as const,
  };
}

async function fetchChats({ archived }: MethodArgs<'fetchChats'>[0]) {
  return archived ? fetchEmptyChats() : fetchProxyChats();
}

async function fetchMessages({ chat, offsetId, addOffset = 0, limit }: MethodArgs<'fetchMessages'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  let result = await pxgRpc.call<WindowResult>('messages.window', {
    ...peer, offsetId, addOffset, limit: Math.min(limit, 200),
  });
  const oldestId = result.messages.at(-1)?.msgId;
  if (result.messages.length < limit && (!offsetId || !oldestId || oldestId <= offsetId)) {
    // A paused account must still display its existing archive. Completion events refresh late imports
    await Promise.race([
      runProxyJob('messages.loadOlder', { ...peer, beforeMsgId: oldestId || offsetId }).catch(() => undefined),
      pause(HISTORY_WAIT_MS),
    ]);
    result = await pxgRpc.call<WindowResult>('messages.window', {
      ...peer, offsetId, addOffset, limit: Math.min(limit, 200),
    });
  }
  const users = result.messages.filter((dto) => dto.senderId && dto.senderId > 0).map((dto) => (
    buildProxyUser(dto.accountId, dto.senderId!, dto.senderName || undefined)
  ));
  result.messages.forEach((dto) => emitRelated(dto));
  return {
    messages: result.messages.map((dto) => buildProxyMessage(dto, chat)),
    users, chats: [], count: result.count, topics: [],
  };
}

async function fetchMessage({ chat, messageId }: MethodArgs<'fetchMessage'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.window', { ...peer, msgIds: [messageId] });
  result.messages.forEach((dto) => emitRelated(dto));
  return result.messages[0] ? { message: buildProxyMessage(result.messages[0], chat) } : undefined;
}

async function fetchMessagesById({ chat, messageIds }: MethodArgs<'fetchMessagesById'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.window', { ...peer, msgIds: messageIds });
  result.messages.forEach((dto) => emitRelated(dto));
  return result.messages.map((dto) => buildProxyMessage(dto, chat));
}

/** The sender profile and the poll live in their own parts of the global state */
function emitRelated(dto: MessageDto) {
  const poll = buildProxyPoll(dto);
  if (poll) emitProxyUpdate({ '@type': 'updateMessagePoll', pollId: poll.summary.id, pollUpdate: poll });
  if (!dto.senderId || dto.senderId < 0) return;
  const user = buildProxyUser(dto.accountId, dto.senderId, dto.senderName || undefined);
  emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
}

async function fetchFullChat(chat: ApiChat) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  // Revalidate access before exposing even minimal profile data
  const chats = await pxgRpc.call<AccessChat[]>('access.chats');
  const current = chats.find((item) => item.accountId === peer.accountId && item.peerId === peer.peerId);
  if (!current) return undefined;
  return {
    fullInfo: { enabledReactions: current.permissions.react ? { type: 'all' as const } : undefined },
    chats: [buildProxyChat(current)], userStatusesById: {},
  };
}

async function fetchFullUser({ id }: MethodArgs<'fetchFullUser'>[0]) {
  const peer = resolveProxyPeer(id);
  if (!peer) return undefined;
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  const chat = access.find((item) => getProxyPeerId(item.accountId, item.peerId) === id);
  if (!chat) return undefined;
  const user = buildProxyUser(peer.accountId, peer.peerId, chat.title || chat.username || undefined);
  return { user, fullInfo: {}, users: [user], chats: [], userStatusesById: {} };
}

async function fetchChat({ user, type }: MethodArgs<'fetchChat'>[0]) {
  if (type !== 'user' || !user) return undefined;
  const peer = resolveProxyPeer(user.id);
  if (!peer) return undefined;
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  const current = access.find((chat) => chat.accountId === peer.accountId && chat.peerId === peer.peerId);
  if (!current) return undefined;
  const chat = buildProxyChat(current);
  emitProxyUpdate({ '@type': 'updateChat', id: chat.id, chat });
  return { chatId: chat.id };
}

async function searchChats({ query }: MethodArgs<'searchChats'>[0]) {
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  const search = query.trim().toLocaleLowerCase();
  const chats = access.filter((chat) => [chat.title, chat.username].some((value) => (
    value?.toLocaleLowerCase().includes(search)
  ))).map(buildProxyChat);
  chats.forEach((chat) => emitProxyUpdate({ '@type': 'updateChat', id: chat.id, chat }));
  return { accountResultIds: chats.map((chat) => chat.id), globalResultIds: [] };
}

async function searchMessagesInChat({
  peer: target, fromPeer, type = 'text', query = '', limit, offsetId, addOffset, minDate, maxDate, savedTag,
}: MethodArgs<'searchMessagesInChat'>[0]) {
  const peer = resolveProxyPeer(target.id);
  if (!peer || savedTag || !SEARCH_FILTERS.has(type)) return undefined;
  const sender = fromPeer && resolveProxyPeer(fromPeer.id);
  if (fromPeer && (!sender || sender.accountId !== peer.accountId)) return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.search', {
    ...peer, query, filter: type, limit: Math.min(limit, 200), offsetId, addOffset, minDate, maxDate,
    senderId: sender?.peerId,
  });
  return buildSearchResult(result);
}

async function searchMessagesGlobal({
  query, type = 'text', limit, offsetRate = 0, minDate, maxDate, context = 'all',
}: MethodArgs<'searchMessagesGlobal'>[0]) {
  if (!SEARCH_FILTERS.has(type) && type !== 'channels') return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.search', {
    query, filter: type === 'channels' ? 'text' : type,
    context: type === 'channels' ? 'channels' : context,
    limit: Math.min(limit, 200), offset: offsetRate, minDate, maxDate,
  });
  const next = offsetRate + result.messages.length;
  return { ...await buildSearchResult(result), nextOffsetRate: next < result.count ? next : undefined };
}

async function buildSearchResult(result: WindowResult) {
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  const chats = access.map(buildProxyChat);
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const messages = result.messages.flatMap((dto): ApiMessage[] => {
    const chat = byId.get(getProxyPeerId(dto.accountId, dto.peerId));
    if (!chat) return [];
    emitRelated(dto);
    return [buildProxyMessage(dto, chat)];
  });
  chats.forEach((chat) => emitProxyUpdate({ '@type': 'updateChat', id: chat.id, chat }));
  return {
    messages, totalCount: result.count, topics: [], userStatusesById: {},
    nextOffsetId: messages.at(-1)?.id,
  };
}
