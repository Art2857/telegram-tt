import type {
  AccessChat, ChatUnreadDto, MemberDto, MessageDto, TopicsListResult,
} from '../../proxygram/server/types';
import type { ThreadId, ThreadReadState } from '../../types';
import type { MethodArgs, MethodResponse, Methods } from '../gramjs/methods/types';
import type { ApiChat, ApiChatMember, ApiMessage, ApiPeer, ApiPhoto, ApiUser } from '../types';
import { MAIN_THREAD_ID } from '../types';

import { ARCHIVED_FOLDER_ID, TOPICS_SLICE } from '../../config';
import { pause } from '../../util/schedulers';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import {
  buildProxyChat, buildProxyChatInfo, buildProxyChatReactions, buildProxyMessage, buildProxyPoll, buildProxyTopic,
  buildProxyUser, buildProxyWebPage,
} from './builders';
import {
  deleteChatFolder, editChatFolder, fetchChatFolders, fetchRecommendedChatFolders, sortChatFolders,
  toggleDialogFilterTags,
} from './folders';
import { emitProxyUpdate, getProxyPeerId, isProxyGuest, resolveProxyPeer } from './index';
import { fetchLangDifference, fetchLangPack, fetchLanguage, fetchLanguages } from './langpacks';
import { downloadMedia } from './media';
import { buildProxyProfilePhotoId } from './mediaIds';
import { runProxyJob } from './outbox';
import {
  fetchAvailableReactions, fetchCustomEmoji, fetchCustomEmojiSets, fetchFavoriteStickers, fetchRecentStickers,
  fetchSavedGifs, fetchStickers, fetchStickerSets, fetchStickersForEmoji,
} from './stickers';
import { translateRichMessage, translateText } from './translations';
import {
  answerCallbackButton, createTopic, deleteMessages, deleteTopic, editChatPhoto, editMessage, editTopic,
  forwardMessages, markMessageListRead, pinMessage, sendMessage, sendMessageAction, sendPollVote, sendReaction,
  toggleChatArchived, toggleChatPinned, togglePinnedTopic, updateChatAbout, updateChatNotifySettings,
  updateChatTitle,
} from './writes';

type WindowResult = { messages: MessageDto[]; count: number };
const HISTORY_WAIT_MS = 10_000;
const SEARCH_FILTERS = new Set(['text', 'media', 'documents', 'links', 'audio', 'voice', 'gif', 'polls']);
/** The server returns at most this many topics per page */
const MAX_TOPICS = 100;
/** As many members as Web A loads at once */
const MEMBERS_SLICE = 50;
/** Telegram's big profile photo is 640 px */
const PROFILE_PHOTO_SIZE = 640;
/** As many pinned messages as Telegram lists */
const MAX_PINNED = 100;
/** Admin actions of a guest and speech-to-text: Telegram may refuse them, and Web A waits for their result */
const ERROR_DIALOG_METHODS = new Set<keyof Methods>([
  'pinMessage', 'updateChatTitle', 'updateChatAbout', 'editChatPhoto', 'createTopic', 'editTopic',
  'togglePinnedTopic', 'deleteTopic', 'transcribeAudio',
]);

const methods = {
  fetchChatFolders,
  editChatFolder,
  deleteChatFolder,
  sortChatFolders,
  fetchRecommendedChatFolders,
  toggleDialogFilterTags,
  fetchLanguages,
  fetchLanguage,
  fetchLangPack,
  fetchLangDifference,
  transcribeAudio,
  translateText,
  translateRichMessage,
  updateTopicMutedState,
  fetchChats,
  fetchChat,
  searchChats,
  searchMessagesInChat,
  searchMessagesGlobal,
  fetchSavedChats: fetchEmptyChats,
  fetchMessages,
  fetchMessage,
  fetchTopics,
  fetchTopicById,
  fetchFullChat,
  fetchFullUser,
  fetchMessagesById,
  sendMessage,
  editMessage,
  deleteMessages,
  forwardMessages,
  answerCallbackButton,
  sendPollVote,
  updateChatNotifySettings,
  toggleChatPinned,
  toggleChatArchived,
  sendReaction,
  pinMessage,
  fetchPinnedMessages,
  fetchProfilePhotos,
  fetchMembers,
  updateChatTitle,
  updateChatAbout,
  editChatPhoto,
  createTopic,
  editTopic,
  togglePinnedTopic,
  deleteTopic,
  markMessageListRead,
  sendMessageAction,
  downloadMedia,
  fetchStickerSets,
  fetchCustomEmojiSets,
  fetchCustomEmoji,
  fetchRecentStickers,
  fetchFavoriteStickers,
  fetchSavedGifs,
  fetchStickers,
  fetchStickersForEmoji,
  fetchAvailableReactions,
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
  if (!ERROR_DIALOG_METHODS.has(name)) return await method?.(...args) as Awaited<MethodResponse<T>>;
  try {
    return await method?.(...args) as Awaited<MethodResponse<T>>;
  } catch (err) {
    // As with Telegram's own errors: a dialog explains why, and the screen that waits for the result moves on
    emitProxyUpdate({ '@type': 'error', error: { message: err instanceof Error ? err.message : String(err) } });
    return undefined as Awaited<MethodResponse<T>>;
  }
}

export async function fetchProxyChats() {
  const sessionId = getPxgState().session?.user.id;
  const [access, unread] = await Promise.all([
    pxgRpc.call<AccessChat[]>('access.chats'),
    pxgRpc.call<ChatUnreadDto[]>('chats.unread').catch(() => []),
  ]);
  if (sessionId !== getPxgState().session?.user.id) return undefined;
  const chats = access.map(buildProxyChat);
  const users: ApiUser[] = access.filter((chat) => chat.peerId > 0).map((chat) => (
    buildProxyUser(chat.accountId, chat.peerId, chat.title || chat.username || undefined, chat.photoId)
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
    // A guest mutes a shared chat only for themselves; the server keeps it for every device and for pushes
    notifyExceptionById: Object.fromEntries(access.flatMap((item, index) => (
      item.mutedUntil ? [[chats[index].id, { mutedUntil: item.mutedUntil }]] : []
    ))),
    threadInfos: chats.map((chat, index) => ({
      chatId: chat.id, threadId: MAIN_THREAD_ID, isCommentsInfo: false as const,
      lastMessageId: pages[index]?.messages[0]?.msgId, messagesCount: pages[index]?.count,
    })),
    threadReadStatesById: buildProxyReadStates(unread),
    fullInfoById: Object.fromEntries(access.map((item, index) => [
      chats[index].id, { ...buildProxyChatInfo(item), ...buildProxyChatReactions(item) },
    ])),
    archivedChatIds: chats.filter((chat) => chat.folderId === ARCHIVED_FOLDER_ID).map((chat) => chat.id),
    // Pins belong to the guest's own list; the latest pinned chat goes first, as in Telegram
    pinnedChatIds: isProxyGuest() ? access.map((item, index) => ({ id: chats[index].id, pinnedAt: item.pinnedAt }))
      .filter((item) => item.pinnedAt)
      .sort((a, b) => b.pinnedAt! - a.pinnedAt!)
      .map((item) => item.id) : [],
    totalChatCount: chats.length,
    isFullyLoaded: true as const,
  };
}

/** The guest's own counters, kept by the server for every device and independent of the owner's read state */
export function buildProxyReadStates(unread: ChatUnreadDto[]): Record<string, ThreadReadState> {
  return Object.fromEntries(unread.map((item) => [getProxyPeerId(item.accountId, item.peerId), {
    unreadCount: item.unreadCount, lastReadInboxMessageId: item.readMaxId,
  }]));
}

/** The main list and the archive are slices of the same accesses */
async function fetchChats({ archived }: MethodArgs<'fetchChats'>[0]) {
  const result = await fetchProxyChats();
  if (!result) return undefined;
  const archivedIds = new Set(result.archivedChatIds);
  const isInList = (id: string) => archivedIds.has(id) === Boolean(archived);
  const chatIds = result.chatIds.filter(isInList);
  return {
    ...result, chatIds, orderedPinnedIds: result.pinnedChatIds.filter(isInList), totalChatCount: chatIds.length,
  };
}

async function fetchMessages({
  chat, threadId, offsetId, addOffset = 0, limit,
}: MethodArgs<'fetchMessages'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const topicId = getTopicId(chat, threadId);
  let result = await pxgRpc.call<WindowResult>('messages.window', {
    ...peer, topicId, offsetId, addOffset, limit: Math.min(limit, 200),
  });
  const oldestId = result.messages.at(-1)?.msgId;
  if (result.messages.length < limit && (!offsetId || !oldestId || oldestId <= offsetId)) {
    // A paused account must still display its existing archive. Completion events refresh late imports
    await Promise.race([
      runProxyJob('messages.loadOlder', { ...peer, topicId, beforeMsgId: oldestId || offsetId })
        .catch(() => undefined),
      pause(HISTORY_WAIT_MS),
    ]);
    result = await pxgRpc.call<WindowResult>('messages.window', {
      ...peer, topicId, offsetId, addOffset, limit: Math.min(limit, 200),
    });
  }
  const users = result.messages.filter((dto) => dto.senderId && dto.senderId > 0).map((dto) => (
    buildProxyUser(dto.accountId, dto.senderId!, dto.senderName || undefined, dto.senderPhotoId)
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

/** A forum topic thread reads only that topic; any other thread of a forum is the whole chat */
function getTopicId(peer: ApiPeer, threadId?: ThreadId) {
  const isForum = 'isForum' in peer && peer.isForum;
  return isForum && threadId !== undefined && threadId !== MAIN_THREAD_ID ? Number(threadId) : undefined;
}

/**
 * Members of a shared group, as the owner sees them: the guest sees who is there, but opens a member's chat
 * only if someone shared it
 */
async function fetchMembers({ chat, memberFilter = 'recent', offset, query }: MethodArgs<'fetchMembers'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer || memberFilter === 'kicked') return undefined;
  const result = await pxgRpc.call<{ count: number; members: MemberDto[] }>('chats.members', {
    ...peer, offset: offset || 0, limit: MEMBERS_SLICE, query: memberFilter === 'search' ? query : undefined,
  });
  const members = result.members.filter((member) => memberFilter !== 'admin' || member.role !== 'member');
  members.forEach((member) => {
    const user = buildProxyUser(peer.accountId, member.userId, member.name || member.username || undefined,
      member.photoId);
    if (member.isBot) user.type = 'userTypeBot';
    emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
  });
  return {
    members: members.map((member): ApiChatMember => ({
      userId: getProxyPeerId(peer.accountId, member.userId),
      rank: member.rank || undefined,
      joinedDate: member.joinedAt ? Math.floor(Date.parse(member.joinedAt) / 1000) : undefined,
      isAdmin: member.role === 'admin' || undefined,
      isOwner: member.role === 'creator' || undefined,
    })),
    userStatusesById: {},
  };
}

/** The current photo of a shared chat or user; the viewer opens it at full size */
/** The whole profile gallery, newest first, as the owner sees it in Telegram */
async function fetchProfilePhotos({ peer }: MethodArgs<'fetchProfilePhotos'>[0]) {
  const proxyPeer = resolveProxyPeer(peer.id);
  if (!proxyPeer) return undefined;
  const { photos } = await pxgRpc.call<{ photos: { id: string; date: number }[] }>('media.photos', proxyPeer)
    .catch(() => ({ photos: peer.avatarPhotoId ? [{ id: peer.avatarPhotoId, date: 0 }] : [] }));
  const result = photos.map(({ id, date }): ApiPhoto => ({
    mediaType: 'photo',
    id: buildProxyProfilePhotoId(peer.id, id),
    date,
    sizes: [{ type: 'x', width: PROFILE_PHOTO_SIZE, height: PROFILE_PHOTO_SIZE }],
  }));
  return { count: result.length, photos: result, nextOffsetId: undefined };
}

/** Pinned messages the guest may see; in a forum topic — only that topic's */
async function fetchPinnedMessages({ chat, threadId }: MethodArgs<'fetchPinnedMessages'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.search', {
    ...peer, query: '', filter: 'pinned', limit: MAX_PINNED, topicId: getTopicId(chat, threadId),
  });
  result.messages.forEach((dto) => emitRelated(dto));
  return { messages: result.messages.map((dto) => buildProxyMessage(dto, chat)) };
}

async function fetchTopics({ chat, query, offsetTopicId, limit = TOPICS_SLICE }: MethodArgs<'fetchTopics'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  // Search matches titles locally: a forum shared with a guest has few visible topics
  const result = await pxgRpc.call<TopicsListResult>('topics.list', {
    ...peer, offsetTopicId: query ? undefined : offsetTopicId, limit: query ? MAX_TOPICS : Math.min(limit, MAX_TOPICS),
  });
  const search = query?.trim().toLocaleLowerCase();
  const topics = search
    ? result.topics.filter((topic) => topic.title.toLocaleLowerCase().includes(search)) : result.topics;
  result.messages.forEach((dto) => emitRelated(dto));
  return {
    topics: topics.map((topic) => buildProxyTopic(topic, chat.id)),
    messages: result.messages.map((dto) => buildProxyMessage(dto, chat)),
    count: search ? topics.length : result.count,
    draftsById: {},
  };
}

async function fetchTopicById({ chat, topicId }: MethodArgs<'fetchTopicById'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<TopicsListResult>('topics.list', { ...peer, topicIds: [topicId] });
  const topic = result.topics[0];
  if (!topic) return undefined;
  result.messages.forEach((dto) => emitRelated(dto));
  return {
    topic: buildProxyTopic(topic, chat.id),
    messages: result.messages.map((dto) => buildProxyMessage(dto, chat)),
  };
}

/** The sender profile, action participants, the poll and the link preview live in their own parts of the state */
function emitRelated(dto: MessageDto) {
  if (dto.transcription) emitTranscription(dto.transcription);
  const poll = buildProxyPoll(dto);
  if (poll) emitProxyUpdate({ '@type': 'updateMessagePoll', pollId: poll.summary.id, pollUpdate: poll });
  const webPage = buildProxyWebPage(dto, getProxyPeerId(dto.accountId, dto.peerId));
  if (webPage) emitProxyUpdate({ '@type': 'updateWebPage', webPage });
  const actionUsers = dto.action && 'users' in dto.action ? dto.action.users : [];
  actionUsers.forEach(({ id, name }) => {
    const user = buildProxyUser(dto.accountId, id, name || undefined);
    emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
  });
  if (!dto.senderId || dto.senderId < 0) return;
  const user = buildProxyUser(dto.accountId, dto.senderId, dto.senderName || undefined, dto.senderPhotoId);
  emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
}

function emitTranscription({ id, text, pending }: NonNullable<MessageDto['transcription']>) {
  emitProxyUpdate({ '@type': 'updateTranscribedAudio', transcriptionId: id, text, isPending: pending || undefined });
}

/** Speech-to-text costs the owner's Premium, as in Telegram; a pending result arrives as a message change */
async function transcribeAudio({ chat, messageId }: MethodArgs<'transcribeAudio'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const transcription = await pxgRpc.call<NonNullable<MessageDto['transcription']>>('messages.transcribe', {
    ...peer, msgId: messageId,
  });
  emitTranscription(transcription);
  return transcription.id;
}

/** A guest mutes a topic only for themselves, as with whole chats */
async function updateTopicMutedState({ chat, topicId, mutedUntil }: MethodArgs<'updateTopicMutedState'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  const result = await pxgRpc.call<{ mutedUntil: number | null }>('topics.mute', { ...peer, topicId, mutedUntil });
  emitProxyUpdate({
    '@type': 'updateTopicNotifySettings',
    chatId: chat.id,
    topicId,
    settings: { mutedUntil: result.mutedUntil ?? undefined },
  });
}

async function fetchFullChat(chat: ApiChat) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  // Revalidate access before exposing even minimal profile data
  const chats = await pxgRpc.call<AccessChat[]>('access.chats');
  const current = chats.find((item) => item.accountId === peer.accountId && item.peerId === peer.peerId);
  if (!current) return undefined;
  return {
    fullInfo: { ...buildProxyChatInfo(current), ...buildProxyChatReactions(current) },
    chats: [buildProxyChat(current)], userStatusesById: {},
  };
}

async function fetchFullUser({ id }: MethodArgs<'fetchFullUser'>[0]) {
  const peer = resolveProxyPeer(id);
  if (!peer) return undefined;
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  const chat = access.find((item) => getProxyPeerId(item.accountId, item.peerId) === id);
  if (!chat) return undefined;
  const user = buildProxyUser(peer.accountId, peer.peerId, chat.title || chat.username || undefined, chat.photoId);
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
  peer: target, fromPeer, type = 'text', query = '', threadId, limit, offsetId, addOffset, minDate, maxDate,
  savedTag,
}: MethodArgs<'searchMessagesInChat'>[0]) {
  const peer = resolveProxyPeer(target.id);
  if (!peer || savedTag || !SEARCH_FILTERS.has(type)) return undefined;
  const sender = fromPeer && resolveProxyPeer(fromPeer.id);
  if (fromPeer && (!sender || sender.accountId !== peer.accountId)) return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.search', {
    ...peer, query, filter: type, limit: Math.min(limit, 200), offsetId, addOffset, minDate, maxDate,
    senderId: sender?.peerId, topicId: getTopicId(target, threadId),
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
