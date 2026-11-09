import type {
  AccessChat, ChatUnreadDto, ContactRequirementsDto, DiscussionDto, DraftDto, InlineBotDto, InlineResultsDto,
  MemberDto, MessageDto, PeerBriefDto, PollVotesDto, ReactorsDto, SeenByDto, SendAsPeerDto, SponsoredMessageDto,
  TopicsListResult,
} from '../../proxygram/server/types';
import type { ThreadId, ThreadReadState } from '../../types';
import type { MethodArgs, MethodResponse, Methods } from '../gramjs/methods/types';
import type {
  ApiChat, ApiChatMember, ApiMessage, ApiNotifyPeerType, ApiPeer, ApiPeerNotifySettings, ApiPeerReaction, ApiPhoto,
  ApiUser,
} from '../types';
import { MAIN_THREAD_ID } from '../types';
import { PROXY_REACTION_EMOJIS } from './types';

import { ARCHIVED_FOLDER_ID, TOPICS_SLICE } from '../../config';
import { getMessageLink } from '../../global/helpers/messages';
import { getTranslationFn } from '../../util/localization';
import { getPxgErrorMessage } from '../../proxygram/errorReasons';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import {
  buildProxyAuthorChat, buildProxyChat, buildProxyChatInfo, buildProxyChatReactions, buildProxyCommentsInfo,
  buildProxyDraft,
  buildProxyMessage, buildProxyPoll, buildProxyReaction, buildProxySponsoredMessage, buildProxyTopic, buildProxyUser,
  buildProxyUserStatus,
  buildProxyViaBot, buildProxyWebPage, clearProxyUserPhones, setProxyUserPaidStars, setProxyUserPhone,
} from './builders';
import {
  deleteChatFolder, editChatFolder, fetchChatFolders, fetchRecommendedChatFolders, sortChatFolders,
  toggleDialogFilterTags,
} from './folders';
import { parseProxySponsoredId } from './ids';
import { emitProxyUpdate, getProxyPeerId, isProxyGuest, resolveProxyPeer } from './index';
import { fetchLangDifference, fetchLangPack, fetchLanguage, fetchLanguages } from './langpacks';
import { downloadMedia } from './media';
import { buildProxyProfilePhotoId, parseProxyCatalogId } from './mediaIds';
import { runProxyJob } from './outbox';
import {
  buildGuestSavedChat, fetchSavedById, fetchSavedChats, fetchSavedHistory, fetchSavedTags, getSavedOrigin, isSavedPeer,
  renameSavedTag, searchSaved,
} from './saved';
import {
  buildInlineResult, fetchAvailableEffects, fetchAvailableReactions, fetchCustomEmoji, fetchCustomEmojiSets,
  fetchFavoriteStickers,
  fetchRecentStickers, fetchSavedGifs, fetchStickers, fetchStickerSets, fetchStickersForEmoji,
} from './stickers';
import { fetchMessageSummary, translateRichMessage, translateText } from './translations';
import {
  answerCallbackButton, appendPollAnswer, createTopic, deleteMessages, deleteScheduledMessages, deleteTopic,
  editChatPhoto, editMessage, editTopic, emitProxyError, fetchScheduledHistory, forwardMessages, forwardMessagesLocal,
  getSendAsPeerId,
  markMessageListRead, markMessagesRead, pinMessage,
  readAllReactions, rescheduleMessage, saveDraft, sendMessage, sendMessageAction, sendMessageLocal, sendPaidReaction,
  sendPollVote,
  sendReaction,
  sendScheduledMessages, toggleChatArchived, toggleChatPinned, toggleDialogUnread, togglePinnedTopic, updateChatAbout,
  updateChatMemberBannedRights, updateChatNotifySettings, updateChatTitle,
  updateProxyPaidStars,
} from './writes';

type WindowResult = { messages: MessageDto[]; count: number };
type SyncChangesResult = {
  messages: MessageDto[];
  removed: { accountId: string; peerId: number; msgId: number }[];
  next: string;
  hasMore: boolean;
};
/** Chats the guest has open: a channel known only as an author must not overwrite one of them */
let sharedChatIds = new Set<string>();
const HISTORY_WAIT_MS = 10_000;
const SEARCH_FILTERS = new Set(['text', 'media', 'documents', 'links', 'audio', 'voice', 'gif', 'polls']);
/** The server returns at most this many topics per page */
const MAX_TOPICS = 100;
/** Private chats whose message price this tab has already asked Telegram for */
const paidPriceAsked = new Set<string>();
/** As many members as Web A loads at once */
const MEMBERS_SLICE = 50;
/** Telegram's big profile photo is 640 px */
const PROFILE_PHOTO_SIZE = 640;
/** Telegram's marked channel IDs: -(10^12 + channel ID) */
const CHANNEL_ID_BASE = 1_000_000_000_000;
/** As many pinned messages as Telegram lists */
const MAX_PINNED = 100;
/** Admin actions of a guest and speech-to-text: Telegram may refuse them, and Web A waits for their result */
const ERROR_DIALOG_METHODS = new Set<keyof Methods>([
  'pinMessage', 'updateChatTitle', 'updateChatAbout', 'editChatPhoto', 'createTopic', 'editTopic',
  'togglePinnedTopic', 'deleteTopic', 'transcribeAudio', 'updateChatMemberBannedRights', 'sendPaidReaction',
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
  fetchMessageSummary,
  updateTopicMutedState,
  fetchChats,
  fetchChat,
  searchChats,
  searchMessagesInChat,
  searchMessagesGlobal,
  fetchSavedChats: fetchSavedSections,
  fetchSavedReactionTags: fetchSavedTags,
  updateSavedReactionTag: ({ reaction, title }: MethodArgs<'updateSavedReactionTag'>[0]) => (
    renameSavedTag(reaction, title).then(() => true as const)
  ),
  fetchDefaultTagReactions: () => Promise.resolve({
    hash: '', reactions: PROXY_REACTION_EMOJIS.map((emoticon) => ({ type: 'emoji' as const, emoticon })),
  }),
  fetchMessages,
  fetchMessage,
  fetchDiscussionMessage,
  fetchMessageViews,
  fetchTopics,
  fetchTopicById,
  fetchFullChat,
  fetchFullUser,
  fetchPaidMessagesStarsAmount,
  fetchMessagesById,
  sendMessage,
  sendMessageLocal,
  editMessage,
  deleteMessages,
  forwardMessages,
  forwardMessagesLocal,
  answerCallbackButton,
  sendPollVote,
  appendPollAnswer,
  loadPollOptionResults,
  updateChatNotifySettings,
  toggleChatPinned,
  toggleChatArchived,
  toggleDialogUnread,
  fetchInlineBotResults,
  sendInlineBotResult,
  fetchSeenBy,
  fetchMessageReactionsList,
  fetchSponsoredMessages,
  viewSponsoredMessage,
  clickSponsoredMessage,
  fetchSendAs,
  saveDefaultSendAs,
  fetchUnreadMentions,
  fetchUnreadReactions,
  readAllReactions,
  markMessagesRead,
  updateChatMemberBannedRights,
  fetchScheduledHistory,
  sendScheduledMessages,
  deleteScheduledMessages,
  rescheduleMessage,
  saveDraft,
  fetchNotifyDefaultSettings,
  updateNotificationSettings,
  exportMessageLink,
  sendReaction,
  sendPaidReaction,
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
  fetchAvailableEffects,
  fetchAvailableReactions,
} satisfies Partial<Methods>;

/** The guest's Saved Messages with the newest message, if there is any */
async function fetchSavedChatEntry() {
  if (!buildGuestSavedChat()) return undefined;
  const info = await pxgRpc.call<{ maxUploadBytes: number }>('saved.info');
  const chat = buildGuestSavedChat(info.maxUploadBytes)!;
  const { messages: [lastMessage] } = await fetchSavedHistory(chat, undefined, 0, 1).catch(() => ({ messages: [] }));
  return { chat, lastMessage: lastMessage as ApiMessage | undefined };
}

/** A full login keeps its saved chats in Telegram; a guest's sections of Saved Messages are on the server */
function fetchSavedSections({ withPinned }: MethodArgs<'fetchSavedChats'>[0]) {
  const savedChat = buildGuestSavedChat();
  return savedChat ? fetchSavedChats(savedChat, withPinned) : fetchEmptyChats();
}

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
    emitProxyUpdate({ '@type': 'error', error: { message: getPxgErrorMessage(getTranslationFn(), err) } });
    return undefined as Awaited<MethodResponse<T>>;
  }
}

export async function fetchProxyChats() {
  const sessionId = getPxgState().session?.user.id;
  const [access, unread, drafts] = await Promise.all([
    pxgRpc.call<AccessChat[]>('access.chats'),
    pxgRpc.call<ChatUnreadDto[]>('chats.unread').catch(() => []),
    pxgRpc.call<DraftDto[]>('drafts.list').catch(() => []),
  ]);
  if (sessionId !== getPxgState().session?.user.id) return undefined;
  const chats = access.map(buildProxyChat);
  sharedChatIds = new Set(chats.map((chat) => chat.id));
  const savedChat = await fetchSavedChatEntry();
  if (sessionId !== getPxgState().session?.user.id) return undefined;
  clearProxyUserPhones();
  access.forEach((chat) => {
    if (chat.peerId <= 0) return;
    setProxyUserPhone(chat.accountId, chat.peerId, chat.phone);
    setProxyUserPaidStars(chat.accountId, chat.peerId, chat.info?.paidMessagesStars);
  });
  const users: ApiUser[] = access.filter((chat) => chat.peerId > 0).map((chat) => (
    buildProxyUser(chat.accountId, chat.peerId, chat.title || chat.username || undefined, chat.photoId, chat.badges)
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
  // Saved Messages stand in the list once there is something in them, as in Telegram
  if (savedChat?.lastMessage) {
    chats.push(savedChat.chat);
    messages.push(savedChat.lastMessage);
  }
  pages.forEach((page) => page?.messages.forEach((dto) => emitRelated(dto)));
  // A full reload clears proxy users after this returns: whoever the last messages show has to come back with them.
  // The chat's own user goes last, it knows more than a message does
  const messageUsers = pages.flatMap((page) => page?.messages.flatMap(buildMessageUsers) || []);
  const authorChats = pages.flatMap((page) => page?.messages.flatMap(buildAuthorChats) || []);
  return {
    chats,
    // Saved Messages open even while empty: the chat is known, the list shows it once it has messages
    savedChat: savedChat?.chat,
    authorChats,
    users: [...messageUsers, ...users],
    messages,
    chatIds: chats.map((chat) => chat.id),
    lastMessageByChatId: Object.fromEntries(messages.map((message) => [message.chatId, message.id])),
    userStatusesById: Object.fromEntries(access.flatMap((item, index) => (
      item.userStatus ? [[chats[index].id, buildProxyUserStatus(item.userStatus)]] : []
    ))),
    draftsById: Object.fromEntries(drafts.filter((draft) => !draft.topicId).map((draft) => [
      getProxyPeerId(draft.accountId, draft.peerId), buildProxyDraft(draft),
    ])),
    // A guest mutes a shared chat only for themselves; the server keeps it for every device and for pushes
    notifyExceptionById: Object.fromEntries(access.flatMap((item, index) => (
      typeof item.mutedUntil === 'number' ? [[chats[index].id, { mutedUntil: item.mutedUntil }]] : []
    ))),
    threadInfos: chats.map((chat, index) => ({
      chatId: chat.id, threadId: MAIN_THREAD_ID, isCommentsInfo: false as const,
      lastMessageId: pages[index]?.messages[0]?.msgId
        ?? (chat === savedChat?.chat ? savedChat.lastMessage?.id : undefined),
      messagesCount: pages[index]?.count,
    })),
    threadReadStatesById: withReadOutbox(buildProxyReadStates(unread), access),
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
    // Every later change has a greater sequence number: a reconnect catches up from here
    changeSeq: getMaxChangeSeq(pages.flatMap((page) => page?.messages.map((dto) => dto.changeSeq) || [])),
  };
}

/** What changed in the open chats after the cursor, built against the chats the client has */
export async function fetchProxyChanges(since: string, chatsById: Record<string, ApiChat>) {
  const result = await pxgRpc.call<SyncChangesResult>('sync.changes', { since });
  const messages = result.messages.flatMap((dto) => {
    const chat = chatsById[getProxyPeerId(dto.accountId, dto.peerId)];
    if (!chat?.pxgProxy) return [];
    buildMessageUsers(dto).forEach((user) => emitProxyUpdate({ '@type': 'updateUser', id: user.id, user }));
    emitRelated(dto);
    return [buildProxyMessage(dto, chat)];
  });
  return {
    messages,
    removed: result.removed.map(({ accountId, peerId, msgId }) => ({
      chatId: getProxyPeerId(accountId, peerId), msgId,
    })),
    next: result.next,
    hasMore: result.hasMore,
  };
}

export function getMaxChangeSeq(changeSeqs: (string | null | undefined)[]) {
  return changeSeqs.reduce<string | undefined>((max, seq) => (
    seq && (!max || BigInt(seq) > BigInt(max)) ? seq : max
  ), undefined);
}

/** The guest's own counters, kept by the server for every device and independent of the owner's read state */
export function buildProxyReadStates(unread: ChatUnreadDto[]): Record<string, ThreadReadState> {
  return Object.fromEntries(unread.map((item) => [getProxyPeerId(item.accountId, item.peerId), {
    unreadCount: item.unreadCount,
    lastReadInboxMessageId: item.readMaxId,
    hasUnreadMark: item.hasUnreadMark || undefined,
    unreadMentionsCount: item.unreadMentionsCount,
    unreadReactionsCount: item.unreadReactionsCount,
  }]));
}

/** Up to where others read the account's outgoing messages: Telegram's double check marks */
function withReadOutbox(readStates: Record<string, ThreadReadState>, access: AccessChat[]) {
  access.forEach(({ accountId, peerId, readOutboxMaxId }) => {
    if (!readOutboxMaxId) return;
    const id = getProxyPeerId(accountId, peerId);
    readStates[id] = { ...readStates[id], lastReadOutboxMessageId: readOutboxMaxId };
  });
  return readStates;
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

/**
 * Web A puts the price of a message on the send button: a private chat asks Telegram for it once per tab.
 * The server keeps the answer for a day, so the first open of a chat costs one request through the owner's queue
 */
function prefetchProxyPaidPrice(accountId: string, peerId: number) {
  if (peerId <= 0) return;
  const key = `${accountId}:${peerId}`;
  if (paidPriceAsked.has(key)) return;
  paidPriceAsked.add(key);
  void pxgRpc.call<ContactRequirementsDto>('users.requirements', { accountId, peerId }).then(({ paidStars }) => {
    if (!paidStars) return;
    updateProxyPaidStars(getProxyPeerId(accountId, peerId), paidStars);
  }, () => undefined);
}

async function fetchMessages({
  chat, threadId, offsetId, addOffset = 0, limit, isSavedDialog,
}: MethodArgs<'fetchMessages'>[0]) {
  const peer = chat && resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  if (isSavedDialog) {
    // A section of Saved Messages comes with its source chat; the messages belong to Saved Messages
    const savedChat = buildGuestSavedChat();
    const origin = savedChat && getSavedOrigin(savedChat, chat.id);
    if (origin === undefined) return undefined;
    const saved = await fetchSavedHistory(savedChat!, offsetId, addOffset, limit, origin);
    return { ...saved, users: [], chats: [], topics: [] };
  }
  if (isSavedPeer(peer)) {
    const saved = await fetchSavedHistory(chat, offsetId, addOffset, limit);
    return { ...saved, users: [], chats: [], topics: [] };
  }
  // Only a guest who may write pays, and only to a person: a group's price comes with the chat
  if (chat.pxgProxy?.permissions.write) prefetchProxyPaidPrice(peer.accountId, peer.peerId);
  const thread = { topicId: getTopicId(chat, threadId), threadId: getReplyThreadId(chat, threadId) };
  let result = await pxgRpc.call<WindowResult>('messages.window', {
    ...peer, ...thread, offsetId, addOffset, limit: Math.min(limit, 200),
  });
  const oldestId = result.messages.at(-1)?.msgId;
  if (result.messages.length < limit && (!offsetId || !oldestId || oldestId <= offsetId)) {
    // A paused account must still display its existing archive. Completion events refresh late imports
    await runProxyJob('messages.loadOlder', { ...peer, ...thread, beforeMsgId: oldestId || offsetId }, HISTORY_WAIT_MS)
      .catch(() => undefined);
    result = await pxgRpc.call<WindowResult>('messages.window', {
      ...peer, ...thread, offsetId, addOffset, limit: Math.min(limit, 200),
    });
  }
  const users = result.messages.filter((dto) => dto.senderId && dto.senderId > 0).map((dto) => (
    buildProxyUser(dto.accountId, dto.senderId!, dto.senderName || undefined, dto.senderPhotoId, dto.senderBadges)
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
  if (isSavedPeer(peer)) {
    const [message] = await fetchSavedById(chat, [messageId]);
    return message ? { message } : undefined;
  }
  const result = await pxgRpc.call<WindowResult>('messages.window', { ...peer, msgIds: [messageId] });
  result.messages.forEach((dto) => emitRelated(dto));
  return result.messages[0] ? { message: buildProxyMessage(result.messages[0], chat) } : undefined;
}

async function fetchMessagesById({ chat, messageIds }: MethodArgs<'fetchMessagesById'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  if (isSavedPeer(peer)) return fetchSavedById(chat, messageIds);
  const result = await pxgRpc.call<WindowResult>('messages.window', { ...peer, msgIds: messageIds });
  result.messages.forEach((dto) => emitRelated(dto));
  return result.messages.map((dto) => buildProxyMessage(dto, chat));
}

/** A forum topic thread reads only that topic; any other thread of a forum is the whole chat */
function getTopicId(peer: ApiPeer, threadId?: ThreadId) {
  const isForum = 'isForum' in peer && peer.isForum;
  return isForum && threadId !== undefined && threadId !== MAIN_THREAD_ID ? Number(threadId) : undefined;
}

/** Outside a forum a thread is the replies to one message, such as the comments of a channel post */
function getReplyThreadId(peer: ApiPeer, threadId?: ThreadId) {
  const isForum = 'isForum' in peer && peer.isForum;
  return !isForum && threadId !== undefined && threadId !== MAIN_THREAD_ID ? Number(threadId) : undefined;
}

/**
 * Comments of a channel post: a thread of replies to the post's copy in the discussion group, which must be shared
 * with the guest too. The server finds the copy in the archive; only a copy it has never seen costs a Telegram request
 */
async function fetchDiscussionMessage({ chat, messageId }: MethodArgs<'fetchDiscussionMessage'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const params = { ...peer, msgId: messageId };
  let discussion = await pxgRpc.call<DiscussionDto | null>('messages.discussion', params);
  if (!discussion) {
    await runProxyJob('messages.loadDiscussion', params, HISTORY_WAIT_MS).catch(() => undefined);
    discussion = await pxgRpc.call<DiscussionDto | null>('messages.discussion', params);
  }
  if (!discussion) return undefined;
  const access = await pxgRpc.call<AccessChat[]>('access.chats');
  const groupAccess = access.find((item) => item.accountId === peer.accountId && item.peerId === discussion.peerId);
  if (!groupAccess) return undefined;
  const group = buildProxyChat(groupAccess);
  emitProxyUpdate({ '@type': 'updateChat', id: group.id, chat: group });
  const { threadId } = discussion;
  // The first comment marks the thread's beginning, as `firstMessageId` does in Web A
  const first = await pxgRpc.call<WindowResult>('messages.window', {
    accountId: groupAccess.accountId, peerId: groupAccess.peerId, threadId, offsetId: 1, addOffset: -1, limit: 1,
  });
  const dtos = [...discussion.messages, ...first.messages];
  dtos.forEach((dto) => emitRelated(dto));
  const topMessages = discussion.messages.map((dto) => buildProxyMessage(dto, group));
  const lastMessageId = discussion.lastMsgId ?? undefined;
  // The post itself is never unread; as in Telegram, a thread the guest never read opens from its start
  const readMaxId = Math.max(threadId, discussion.readMaxId || 0, ...topMessages.map(({ id }) => id));
  // A thread opened by its own link starts with the post's copy, which tells whose comments these are
  const origin = discussion.peerId === peer.peerId
    ? getSavedFromPost(discussion.messages[0]) : { chatId: chat.id, msgId: messageId };
  return {
    messages: dtos.map((dto) => buildProxyMessage(dto, group)),
    topMessages,
    threadId,
    chatId: group.id,
    threadInfo: {
      isCommentsInfo: false as const,
      chatId: group.id,
      threadId,
      messagesCount: discussion.count,
      lastMessageId,
      fromChannelId: origin?.chatId,
      fromMessageId: origin?.msgId,
    },
    // The guest's own pointer of the thread, kept by the server apart from the group's
    threadReadState: {
      unreadCount: discussion.unreadCount || 0,
      lastReadInboxMessageId: readMaxId,
      lastReadOutboxMessageId: discussion.readOutboxMaxId ?? undefined,
    },
    lastMessageId,
    firstMessageId: first.messages[0]?.msgId,
  };
}

/** The channel post a copy in its discussion group was made from */
function getSavedFromPost(dto?: MessageDto) {
  const header = dto?.fwdFrom as { savedFromPeer?: { channelId?: number }; savedFromMsgId?: number } | null;
  const channelId = header?.savedFromPeer?.channelId;
  if (!dto || !channelId || !header.savedFromMsgId) return undefined;
  return { chatId: getProxyPeerId(dto.accountId, -CHANNEL_ID_BASE - channelId), msgId: header.savedFromMsgId };
}

/** Counters of channel posts as the archive has them; the comment count follows the shared discussion group */
async function fetchMessageViews({ chat, ids }: MethodArgs<'fetchMessageViews'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<WindowResult>('messages.window', { ...peer, msgIds: ids.slice(0, 200) });
  result.messages.forEach((dto) => emitPeerBriefs(dto.accountId, dto.post?.recentRepliers));
  return {
    viewsInfo: result.messages.map((dto) => ({
      id: dto.msgId,
      views: dto.post?.views,
      forwards: dto.post?.forwards,
      threadInfo: buildProxyCommentsInfo(dto),
    })),
  };
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
    setProxyUserPhone(peer.accountId, member.userId, member.phone);
    const user = buildProxyUser(peer.accountId, member.userId, member.name || member.username || undefined,
      member.photoId, member.badges);
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

/** Pinned messages the guest may see; in a forum topic — only that topic's, a comment thread has none */
async function fetchPinnedMessages({ chat, threadId }: MethodArgs<'fetchPinnedMessages'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  if (isSavedPeer(peer)) return { messages: await searchSaved(chat, { filter: 'pinned', limit: MAX_PINNED }) };
  if (getReplyThreadId(chat, threadId)) return { messages: [] };
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
  const drafts = await pxgRpc.call<DraftDto[]>('drafts.list').catch(() => []);
  return {
    topics: topics.map((topic) => buildProxyTopic(topic, chat.id)),
    messages: result.messages.map((dto) => buildProxyMessage(dto, chat)),
    count: search ? topics.length : result.count,
    draftsById: Object.fromEntries(drafts
      .filter((draft) => draft.topicId && draft.accountId === peer.accountId && draft.peerId === peer.peerId)
      .map((draft) => [draft.topicId!, buildProxyDraft(draft)])),
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

/** Everyone a message shows besides its text: the sender, participants of an action, commenters and reactors */
function buildMessageUsers(dto: MessageDto): ApiUser[] {
  const actionUsers = dto.action && 'users' in dto.action ? dto.action.users : [];
  return [
    ...actionUsers.map(({ id, name }) => buildProxyUser(dto.accountId, id, name || undefined)),
    ...(dto.viaBot ? [buildProxyViaBot(dto.accountId, dto.viaBot)] : []),
    ...[...(dto.post?.recentRepliers || []), ...(dto.reactors || [])].filter(({ peerId }) => peerId > 0)
      .map(({ peerId, name, photoId }) => buildProxyUser(dto.accountId, peerId, name || undefined, photoId)),
    ...(dto.senderId && dto.senderId > 0 ? [buildProxyUser(
      dto.accountId, dto.senderId, dto.senderName || undefined, dto.senderPhotoId, dto.senderBadges,
    )] : []),
  ];
}

/** Channels a message shows as its sender or among its commenters and reactors, unless they are shared themselves */
function buildAuthorChats(dto: MessageDto): ApiChat[] {
  const { senderId, senderName, senderPhotoId } = dto;
  const authors = [
    ...(dto.post?.recentRepliers || []),
    ...(dto.reactors || []),
    ...(senderId ? [{ peerId: senderId, name: senderName, photoId: senderPhotoId }] : []),
  ];
  return authors.filter(({ peerId }) => peerId < 0 && !sharedChatIds.has(getProxyPeerId(dto.accountId, peerId)))
    .map(({ peerId, name, photoId }) => buildProxyAuthorChat(dto.accountId, peerId, name || undefined, photoId));
}

/** The sender profile, action participants, the poll and the link preview live in their own parts of the state */
function emitRelated(dto: MessageDto) {
  if (dto.transcription) emitTranscription(dto.transcription);
  emitPeerBriefs(dto.accountId, dto.post?.recentRepliers);
  emitPeerBriefs(dto.accountId, dto.reactors);
  buildAuthorChats(dto).forEach((chat) => emitProxyUpdate({ '@type': 'updateChat', id: chat.id, chat }));
  if (dto.viaBot) {
    const bot = buildProxyViaBot(dto.accountId, dto.viaBot);
    emitProxyUpdate({ '@type': 'updateUser', id: bot.id, user: bot });
  }
  const commentsInfo = buildProxyCommentsInfo(dto);
  if (commentsInfo) emitProxyUpdate({ '@type': 'updateThreadInfo', threadInfo: commentsInfo });
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
  const user = buildProxyUser(
    dto.accountId, dto.senderId, dto.senderName || undefined, dto.senderPhotoId, dto.senderBadges,
  );
  emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
}

/** Goes before the message and the thread info: reactions and the comments button read the profiles only once */
function emitPeerBriefs(accountId: string, peers?: PeerBriefDto[]) {
  peers?.forEach(({ peerId, name, photoId }) => {
    if (peerId < 0) return;
    const user = buildProxyUser(accountId, peerId, name || undefined, photoId);
    emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
  });
}

function emitTranscription({ id, text, pending }: NonNullable<MessageDto['transcription']>) {
  emitProxyUpdate({ '@type': 'updateTranscribedAudio', transcriptionId: id, text, isPending: pending || undefined });
}

/** Who voted in a public poll: profiles come with the page, as in the reaction list */
async function loadPollOptionResults({
  chat, messageId, option, offset, limit, shouldResetVoters,
}: MethodArgs<'loadPollOptionResults'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<PollVotesDto>('polls.voters', {
    ...peer, msgId: messageId, option: option || undefined, offset: offset || undefined, limit: limit || 50,
  }).catch(() => undefined);
  if (!result) return undefined;
  emitPeerBriefs(peer.accountId, result.votes);
  return {
    count: result.count,
    nextOffset: result.nextOffset || undefined,
    shouldResetVoters,
    votes: result.votes.map(({ peerId, date }) => ({ peerId: getProxyPeerId(peer.accountId, peerId), date })),
  };
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

/**
 * An inline bot is resolved through the account of the chat it is used in. `getChatByUsername` knows no chat and
 * would ask Telegram for someone a guest has no session to reach
 */
export async function fetchProxyInlineBot(chat: ApiChat, username: string) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer || !chat.pxgProxy?.permissions.write) return undefined;
  const bot = await pxgRpc.call<InlineBotDto | null>('bots.inlineInfo', { ...peer, username }).catch(() => undefined);
  if (!bot) return undefined;
  const user: ApiUser = {
    ...buildProxyUser(peer.accountId, bot.peerId, bot.name || bot.username, bot.photoId),
    type: 'userTypeBot',
    usernames: [{ username: bot.username, isActive: true }],
    botPlaceholder: bot.placeholder,
  };
  emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
  return { user };
}

async function fetchInlineBotResults({ bot, chat, query, offset }: MethodArgs<'fetchInlineBotResults'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  const username = bot.usernames?.[0]?.username;
  if (!peer || !username) return undefined;
  const result = await pxgRpc.call<InlineResultsDto>('bots.inlineQuery', {
    ...peer, username, query, offset: offset || undefined,
  }).catch(() => undefined);
  if (!result) return undefined;
  return {
    isGallery: result.isGallery,
    help: bot.botPlaceholder,
    nextOffset: result.nextOffset,
    // Both lead to the bot's own chat with the owner, which a guest does not have
    switchPm: undefined,
    switchWebview: undefined,
    results: result.results.map((item) => buildInlineResult(peer.accountId, item)),
    cacheTime: result.cacheTime,
  };
}

/** The bot's message is written by Telegram, so unlike `sendMessage` it appears when the job is done */
async function sendInlineBotResult({
  chat, replyInfo, resultId, queryId, sendAs, isSilent, scheduleDate,
}: MethodArgs<'sendInlineBotResult'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  const messageReply = replyInfo?.type === 'message' ? replyInfo : undefined;
  const topicId = chat.isForum ? messageReply?.replyToTopId : undefined;
  const replyToMsgId = messageReply?.replyToMsgId !== topicId ? messageReply?.replyToMsgId : undefined;
  try {
    const { msgId } = await runProxyJob('messages.send', {
      ...peer,
      text: '',
      inline: { queryId, resultId },
      replyToMsgId,
      topicId,
      threadId: !chat.isForum ? messageReply?.replyToTopId : undefined,
      silent: isSilent,
      scheduleDate,
      sendAsPeerId: getSendAsPeerId(sendAs),
    }) as { msgId: number };
    if (scheduleDate) return;
    const sent = await pxgRpc.call<WindowResult>('messages.window', { ...peer, msgIds: [msgId] });
    sent.messages.forEach((dto) => {
      emitRelated(dto);
      emitProxyUpdate({ '@type': 'newMessage', id: dto.msgId, chatId: chat.id, message: buildProxyMessage(dto, chat) });
    });
  } catch (err) {
    emitProxyError(err);
  }
}

/** Who the owner may write as, as Telegram lists it; the guest's choice stays on the server and the owner's setting stays */
async function fetchSendAs({ chat, isForPaidReactions }: MethodArgs<'fetchSendAs'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer || isForPaidReactions || !chat.pxgProxy?.permissions.write) return undefined;
  const peers = await pxgRpc.call<SendAsPeerDto[]>('chats.sendAs', peer).catch(() => undefined);
  if (!peers) return undefined;
  peers.forEach(({ peerId, name, photoId }) => {
    const id = getProxyPeerId(peer.accountId, peerId);
    if (peerId > 0) {
      const user = buildProxyUser(peer.accountId, peerId, name || undefined, photoId);
      emitProxyUpdate({ '@type': 'updateUser', id, user });
    } else if (!sharedChatIds.has(id)) {
      emitProxyUpdate({
        '@type': 'updateChat', id, chat: buildProxyAuthorChat(peer.accountId, peerId, name || undefined, photoId),
      });
    }
  });
  const result = peers.map(({ peerId, isPremium }) => ({
    id: getProxyPeerId(peer.accountId, peerId), isPremium: isPremium || undefined,
  }));
  // Telegram may list only the group itself: the guest needs a way back to writing as the owner
  const { providerUserId, providerName } = chat.pxgProxy;
  if (result.length && providerUserId && !peers.some(({ peerId }) => peerId === providerUserId)) {
    const owner = buildProxyUser(peer.accountId, providerUserId, providerName);
    emitProxyUpdate({ '@type': 'updateUser', id: owner.id, user: owner });
    result.unshift({ id: owner.id, isPremium: undefined });
  }
  return result;
}

async function saveDefaultSendAs({ sendAs, chat }: MethodArgs<'saveDefaultSendAs'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  const sendAsPeer = resolveProxyPeer(sendAs.id);
  if (!peer || !sendAsPeer) return undefined;
  // eslint-disable-next-line no-null/no-null
  const sendAsPeerId = sendAsPeer.peerId < 0 ? sendAsPeer.peerId : null;
  await pxgRpc.call('chats.setSendAs', { ...peer, sendAsPeerId }).catch(() => undefined);
  return true;
}

/** Who read a message: Telegram answers for the owner's account, the profiles come with the answer */
async function fetchSeenBy({ chat, messageId }: MethodArgs<'fetchSeenBy'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const readers = await pxgRpc.call<SeenByDto[]>('messages.seenBy', { ...peer, msgId: messageId })
    .catch(() => undefined);
  if (!readers) return undefined;
  emitPeerBriefs(peer.accountId, readers);
  return Object.fromEntries(readers.map(({ peerId, date }) => [getProxyPeerId(peer.accountId, peerId), date]));
}

/** Who reacted to a message: Telegram answers for the owner's account, the profiles come with the answer */
async function fetchMessageReactionsList({
  chat, messageId, reaction, offset,
}: MethodArgs<'fetchMessageReactionsList'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const documentId = reaction?.type === 'custom' ? parseProxyCatalogId(reaction.documentId)?.documentId : undefined;
  const filter = reaction?.type === 'emoji' ? { emoji: reaction.emoticon } : documentId ? { documentId } : undefined;
  const result = await pxgRpc.call<ReactorsDto>('messages.reactors', {
    ...peer, msgId: messageId, reaction: filter, offset,
  }).catch(() => undefined);
  if (!result) return undefined;
  emitPeerBriefs(peer.accountId, result.reactions);
  return {
    count: result.count,
    nextOffset: result.nextOffset ?? undefined,
    reactions: result.reactions.flatMap(({
      peerId, reaction: raw, date, isBig, isOwn,
    }): ApiPeerReaction[] => {
      const built = buildProxyReaction(peer.accountId, raw);
      return built && built.type !== 'paid' ? [{
        peerId: getProxyPeerId(peer.accountId, peerId),
        reaction: built,
        addedDate: date,
        isBig: isBig || undefined,
        isOwn: isOwn || undefined,
      }] : [];
    }),
  };
}

/** Telegram's own ads in the channel, the ones it would show the owner */
async function fetchSponsoredMessages({ peer }: MethodArgs<'fetchSponsoredMessages'>[0]) {
  const target = resolveProxyPeer(peer.id);
  if (!target) return undefined;
  const messages = await pxgRpc.call<SponsoredMessageDto[]>('messages.sponsored', target).catch(() => undefined);
  if (!messages?.length) return undefined;
  return { messages: messages.map((message) => buildProxySponsoredMessage(message, peer.id, target)) };
}

function viewSponsoredMessage({ random }: MethodArgs<'viewSponsoredMessage'>[0]) {
  const ad = parseProxySponsoredId(random);
  if (!ad) return Promise.resolve();
  return pxgRpc.call('messages.sponsoredView', ad).then(() => undefined, () => undefined);
}

function clickSponsoredMessage({ random, isMedia, isFullscreen }: MethodArgs<'clickSponsoredMessage'>[0]) {
  const ad = parseProxySponsoredId(random);
  if (!ad) return Promise.resolve(undefined);
  return pxgRpc.call('messages.sponsoredClick', { ...ad, isMedia, isFullscreen }).then(() => true, () => undefined);
}

/** Mentions of the owner that the guest has not read yet, by the guest's own read pointer */
function fetchUnreadMentions({ chat, threadId }: MethodArgs<'fetchUnreadMentions'>[0]) {
  return fetchUnreadList('messages.unreadMentions', chat, threadId);
}

/** Reactions to the guest's own messages that the guest has not seen yet; the owner reads them separately */
function fetchUnreadReactions({ chat, threadId }: MethodArgs<'fetchUnreadReactions'>[0]) {
  return fetchUnreadList('messages.unreadReactions', chat, threadId);
}

async function fetchUnreadList(
  method: 'messages.unreadMentions' | 'messages.unreadReactions', chat: ApiChat, threadId?: ThreadId,
) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await pxgRpc.call<WindowResult>(method, { ...peer, topicId: getTopicId(chat, threadId) });
  result.messages.forEach((dto) => emitRelated(dto));
  return {
    totalCount: result.count,
    messages: result.messages.map((dto) => buildProxyMessage(dto, chat)),
    topics: [],
  };
}

/** Notifications by chat type are the guest's own: they are saved with the guest's settings */
async function fetchNotifyDefaultSettings() {
  type NotifyDefaults = Record<ApiNotifyPeerType, ApiPeerNotifySettings>;
  const stored = await pxgRpc.call<{ data: { notifyDefaults?: NotifyDefaults } } | undefined>('settings.get')
    .catch(() => undefined);
  const enabled: ApiPeerNotifySettings = { mutedUntil: 0, shouldShowPreviews: true };
  return stored?.data.notifyDefaults || { users: enabled, groups: enabled, channels: enabled };
}

function updateNotificationSettings() {
  return Promise.resolve(true);
}

/** A link to the real message in Telegram: it opens for those who have that chat in their own Telegram */
function exportMessageLink({ chat, id }: MethodArgs<'exportMessageLink'>[0]) {
  return Promise.resolve(getMessageLink(chat, undefined, id));
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
  const paidStars = chat.info?.paidMessagesStars;
  setProxyUserPaidStars(peer.accountId, peer.peerId, paidStars);
  const user = buildProxyUser(
    peer.accountId, peer.peerId, chat.title || chat.username || undefined, chat.photoId, chat.badges,
  );
  // What a message to this person costs the owner: Telegram is asked through the owner's queue, once a day.
  // The profile does not wait for it; the price comes as an update
  if (chat.permissions.write && chat.type === 'user' && !chat.isSavedMessages) {
    void pxgRpc.call<ContactRequirementsDto>('users.requirements', peer).then(({ paidStars: fresh }) => {
      if ((fresh ?? undefined) !== paidStars) updateProxyPaidStars(id, fresh ?? undefined);
    }, () => undefined);
  }
  return { user, fullInfo: { paidMessagesStars: paidStars }, users: [user], chats: [], userStatusesById: {} };
}

/** Before a send to a person whose profile is not loaded Web A asks the price on its own */
async function fetchPaidMessagesStarsAmount(user: ApiUser) {
  const peer = resolveProxyPeer(user.id);
  if (!peer || peer.peerId <= 0) return undefined;
  const result = await pxgRpc.call<ContactRequirementsDto>('users.requirements', peer).catch(() => undefined);
  if (!result) return undefined;
  setProxyUserPaidStars(peer.accountId, peer.peerId, result.paidStars);
  return result.paidStars ?? undefined;
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
  savedTag, isSavedDialog,
}: MethodArgs<'searchMessagesInChat'>[0]) {
  const peer = resolveProxyPeer(target.id);
  if (!peer || !SEARCH_FILTERS.has(type)) return undefined;
  if (isSavedDialog || isSavedPeer(peer)) {
    // Tags of Saved Messages are emoji: Telegram's custom emoji tags are not on the server
    if (savedTag && savedTag.type !== 'emoji') return undefined;
    // Search in a section of Saved Messages comes with its source chat
    const savedChat = isSavedDialog ? buildGuestSavedChat() : target as ApiChat;
    const origin = isSavedDialog && savedChat ? getSavedOrigin(savedChat, target.id) : undefined;
    if (!savedChat || (isSavedDialog && origin === undefined)) return undefined;
    const messages = await searchSaved(savedChat, {
      query, filter: type, limit, offsetId, minDate, maxDate, origin, tag: savedTag?.emoticon,
    });
    return {
      messages, totalCount: messages.length, topics: [], userStatusesById: {},
      nextOffsetId: messages.length === limit ? messages.at(-1)?.id : undefined,
    };
  }
  if (savedTag) return undefined;
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
