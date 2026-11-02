import type {
  AccessChat, DraftDto, MessageDto, PeerBadgesDto, TopicDto, UserStatusDto,
} from '../../proxygram/server/types';
import type {
  ApiChat, ApiChatFullInfo, ApiCommentsInfo, ApiDraft, ApiKeyboardButton, ApiKeyboardButtons, ApiMessage,
  ApiMessagePoll, ApiMessageReplyInfo, ApiPhoneCallDiscardReason, ApiReaction, ApiReactionCount, ApiTopicWithState,
  ApiUser, ApiUserStatus, ApiWebPageFull,
} from '../types';
import type { ApiMessageAction } from '../types/messageActions';

import { ARCHIVED_FOLDER_ID } from '../../config';
import { getServerTime } from '../../util/serverTime';
import { getPxgState } from '../../proxygram/server/store';
import { buildProxyEntities } from './entities';
import { getProxyPeerId, isProxyGuest } from './index';
import { buildProxyAttachment, buildProxyMedia } from './media';
import { buildProxyCatalogMediaId } from './mediaIds';

/** Telegram's blue topic icon, used when the topic has no color */
const DEFAULT_TOPIC_COLOR = 0x6FB9F0;
const CALL_DISCARD_REASONS: Record<string, ApiPhoneCallDiscardReason> = {
  phoneCallDiscardReasonMissed: 'missed',
  phoneCallDiscardReasonDisconnect: 'disconnect',
  phoneCallDiscardReasonHangup: 'hangup',
  phoneCallDiscardReasonBusy: 'busy',
};

export function buildProxyChat(chat: AccessChat): ApiChat {
  return {
    id: getProxyPeerId(chat.accountId, chat.peerId),
    type: chat.peerId > 0 ? 'chatTypePrivate'
      : chat.type === 'channel' ? 'chatTypeChannel' : 'chatTypeSuperGroup',
    title: chat.title || chat.username || String(chat.peerId),
    avatarPhotoId: chat.photoId || undefined,
    // The guest's own archive; a full login keeps shared chats in their local folder
    folderId: chat.archivedAt && isProxyGuest() ? ARCHIVED_FOLDER_ID : undefined,
    isForum: chat.type === 'forum' || undefined,
    isListed: true,
    ...buildProxyBadges(chat.accountId, chat.badges),
    membersCount: chat.info?.participantsCount,
    usernames: chat.info?.usernames?.map((username) => ({ username, isActive: true })),
    hasUsername: Boolean(chat.info?.usernames?.length) || undefined,
    ...buildProxyAdminRights(chat),
    currentUserBannedRights: {
      sendReactions: chat.permissions.react ? undefined : true,
      sendMedia: chat.permissions.sendMedia ? undefined : true,
      sendPhotos: chat.permissions.sendMedia ? undefined : true,
      sendVideos: chat.permissions.sendMedia ? undefined : true,
      sendAudios: chat.permissions.sendMedia ? undefined : true,
      sendDocs: chat.permissions.sendMedia ? undefined : true,
      sendStickers: chat.permissions.useOwnerStickers ? undefined : true,
      sendGifs: chat.permissions.useOwnerStickers ? undefined : true,
      sendVoices: chat.permissions.sendMedia ? undefined : true,
      sendRoundvideos: chat.permissions.sendMedia ? undefined : true,
      sendPolls: chat.permissions.write ? undefined : true,
      // Topics are created as the owner: only with the admin permission
      manageTopics: chat.permissions.admin ? undefined : true,
      // Inviting people into the owner's chat is not a guest action
      inviteUsers: true,
    },
    pxgProxy: {
      accountId: chat.accountId, peerId: chat.peerId, permissions: chat.permissions, shareIds: chat.shareIds,
      restricted: chat.restricted || undefined,
      providerName: chat.providerName || undefined,
      providerUserId: chat.providerUserId || undefined,
      providerUsername: chat.providerUsername || undefined,
      isProviderPremium: chat.providerPremium || undefined,
    },
  };
}

/** Admin actions the guest makes as the owner: rights the guest supports, only with the `admin` permission */
const PROXY_ADMIN_RIGHTS = [
  'changeInfo', 'pinMessages', 'editMessages', 'manageTopics', 'deleteMessages', 'banUsers',
] as const;

function buildProxyAdminRights(chat: AccessChat): Pick<ApiChat, 'adminRights' | 'isOwner' | 'defaultBannedRights'> {
  const { info } = chat;
  // Members' default rights decide whether anyone may pin or create topics in a group
  const banned = new Set(info?.defaultBannedRights);
  const defaultBannedRights = banned.has('pinMessages') || banned.has('manageTopics') ? {
    pinMessages: banned.has('pinMessages') ? true as const : undefined,
    manageTopics: banned.has('manageTopics') ? true as const : undefined,
  } : undefined;
  if (!chat.permissions.admin || !info || (!info.isCreator && !info.adminRights)) return { defaultBannedRights };
  const rights = PROXY_ADMIN_RIGHTS.filter((right) => info.isCreator || info.adminRights?.includes(right));
  return {
    adminRights: rights.length ? Object.fromEntries(rights.map((right) => [right, true])) : undefined,
    defaultBannedRights,
  };
}

/** Profile of a group or channel: its description and slow mode, as members see them */
export function buildProxyChatInfo(
  chat: AccessChat,
): Pick<ApiChatFullInfo, 'about' | 'slowMode' | 'inviteLink' | 'canViewMembers' | 'linkedChatId'> {
  const { info } = chat;
  return {
    // Members of a group are visible as to the owner; subscribers of a channel — to its admins only
    canViewMembers: (chat.peerId < 0 && (chat.type !== 'channel' || chat.permissions.admin)) || undefined,
    about: info?.about,
    slowMode: info?.slowmodeSeconds ? { seconds: info.slowmodeSeconds } : undefined,
    // The server sends the owner's invite link only to a guest with the admin permission
    inviteLink: info?.inviteLink,
    // The server names the discussion group only when it is shared too: then posts show their comments
    linkedChatId: info?.linkedChatId ? getProxyPeerId(chat.accountId, info.linkedChatId) : undefined,
  };
}

/**
 * The reactions a guest may put in a shared chat: the chat's own Telegram settings, read by the provider's worker.
 * Custom ones need the owner's Premium and the owner's emoji; until the settings are known, any plain reaction goes
 */
export function buildProxyChatReactions(
  chat: AccessChat,
): Pick<ApiChatFullInfo, 'enabledReactions' | 'reactionsLimit'> {
  const { reactions, permissions } = chat;
  if (!permissions.react || reactions?.type === 'none') return { enabledReactions: undefined };
  const userId = getPxgState().session?.user.id;
  const canUseCustom = Boolean(chat.providerPremium && permissions.useOwnerStickers && userId);
  if (reactions?.type !== 'some') {
    return {
      enabledReactions: { type: 'all', areCustomAllowed: reactions?.allowCustom && canUseCustom ? true : undefined },
      reactionsLimit: reactions?.limit,
    };
  }
  const allowed = (reactions.allowed || []).flatMap((reaction): ApiReaction[] => {
    if ('emoji' in reaction) return [{ type: 'emoji', emoticon: reaction.emoji }];
    return canUseCustom
      ? [{ type: 'custom', documentId: buildProxyCatalogMediaId(userId!, chat.accountId, reaction.documentId) }] : [];
  });
  return { enabledReactions: { type: 'some', allowed }, reactionsLimit: reactions.limit };
}

const USER_STATUS_TYPES: Record<UserStatusDto['type'], ApiUserStatus['type']> = {
  online: 'userStatusOnline',
  offline: 'userStatusOffline',
  recently: 'userStatusRecently',
  lastWeek: 'userStatusLastWeek',
  lastMonth: 'userStatusLastMonth',
  empty: 'userStatusEmpty',
};

export function buildProxyUserStatus({ type, expires, wasOnline }: UserStatusDto): ApiUserStatus {
  return { type: USER_STATUS_TYPES[type], expires, wasOnline };
}

export function buildProxyDraft({ text, entities, replyToMsgId, topicId, date }: DraftDto): ApiDraft {
  return {
    text: text ? { text, entities } : undefined,
    replyInfo: replyToMsgId ? { type: 'message', replyToMsgId, replyToTopId: topicId || undefined } : undefined,
    date,
  };
}

/** An emoji status is read through the provider's account, like custom emoji in text */
function buildProxyBadges(
  accountId: string, badges?: PeerBadgesDto | null,
): Pick<ApiChat, 'isVerified' | 'fakeType' | 'emojiStatus'> {
  const { verified, fake, emojiStatus } = badges || {};
  const userId = getPxgState().session?.user.id;
  const isStatusActive = emojiStatus && userId && (!emojiStatus.until || emojiStatus.until > getServerTime());
  return {
    isVerified: verified,
    fakeType: fake,
    emojiStatus: isStatusActive ? {
      type: 'regular',
      documentId: buildProxyCatalogMediaId(userId, accountId, emojiStatus.documentId),
      until: emojiStatus.until,
    } : undefined,
  };
}

/**
 * `null` means the user has no photo or no badges;
 * an omitted `photoId` or `badges` keeps what is already known from other messages
 */
export function buildProxyUser(
  accountId: string, userId: number, name?: string, photoId?: string | null, badges?: PeerBadgesDto | null,
): ApiUser {
  const user: ApiUser = {
    id: getProxyPeerId(accountId, userId),
    type: 'userTypeRegular',
    isMin: false,
    firstName: name || String(userId),
    phoneNumber: '',
    noStatus: true,
  };
  if (photoId !== undefined) user.avatarPhotoId = photoId || undefined;
  if (badges !== undefined) Object.assign(user, buildProxyBadges(accountId, badges), { isPremium: badges?.premium });
  return user;
}

export function buildProxyMessage(dto: MessageDto, chat: ApiChat): ApiMessage {
  const reactions = dto.reactions?.results?.flatMap((reaction): ApiReactionCount[] => {
    const { emoticon, documentId } = reaction.reaction;
    if (!emoticon && !documentId) return [];
    const userId = getPxgState().session?.user.id;
    if (!emoticon && !userId) return [];
    return [{
      count: reaction.count,
      chosenOrder: reaction.chosenOrder,
      // A custom emoji reaction is read through the provider's account, like custom emoji in text
      reaction: emoticon
        ? { type: 'emoji', emoticon }
        : { type: 'custom', documentId: buildProxyCatalogMediaId(userId!, dto.accountId, documentId!) },
    }];
  });
  const permissions = dto.permissions || chat.pxgProxy!.permissions;
  const media = permissions.download && !dto.isMediaUnavailable
    ? buildProxyMedia(dto, chat.id) : undefined;
  const attachment = buildProxyAttachment(dto, chat.id);
  const mediaFallback = dto.attachment?.type === 'other' ? { attachmentKind: dto.attachment.kind }
    : !media && dto.media?.id ? { fileName: dto.media.fileName, isUnavailable: dto.isMediaUnavailable } : undefined;
  return {
    id: dto.msgId,
    sendingState: undefined,
    chatId: chat.id,
    date: parseDate(dto.date),
    isOutgoing: dto.isOutgoing,
    senderId: dto.senderId ? getProxyPeerId(dto.accountId, dto.senderId) : undefined,
    content: {
      ...media,
      pollId: dto.poll?.id,
      action: buildProxyAction(dto),
      text: dto.text ? { text: dto.text, entities: buildProxyEntities(dto.entities, dto.accountId) } : undefined,
      webPage: dto.webPage ? { id: buildProxyWebPageId(chat.id, dto.msgId) } : undefined,
      ...attachment,
    },
    inlineButtons: buildInlineButtons(dto, chat),
    pxgMediaFallback: mediaFallback,
    editDate: dto.editDate ? parseDate(dto.editDate) : undefined,
    isEdited: dto.version > 1 || undefined,
    pxgDeletedAt: dto.deleted ? parseDate(dto.deleted.at) : undefined,
    pxgSentByUserId: dto.sentByUserId || undefined,
    pxgIsOwn: dto.sentByUserId === getPxgState().session?.user.id,
    pxgPermissions: permissions,
    transcriptionId: dto.transcription?.id,
    // Without `forwardOut` a guest still copies and saves what they read; only Telegram's own protection forbids it
    isProtected: dto.isProtected || undefined,
    isForwardingAllowed: (permissions.forwardOut && !dto.isProtected) || undefined,
    forwardInfo: buildForwardInfo(dto),
    replyInfo: buildReplyInfo(dto),
    reactions: reactions?.length ? { results: reactions } : undefined,
    isPinned: dto.isPinned || undefined,
    hasUnreadMention: dto.hasUnreadMention || undefined,
    viewsCount: dto.post?.views,
    forwardsCount: dto.post?.forwards,
    postAuthorTitle: dto.post?.author,
  };
}

/** The comments button of a channel post: the count comes from the archive of the shared discussion group */
export function buildProxyCommentsInfo(dto: MessageDto): ApiCommentsInfo | undefined {
  const { commentsPeerId, replies, lastReplyId, recentRepliers } = dto.post || {};
  if (!commentsPeerId) return undefined;
  return {
    isCommentsInfo: true,
    chatId: getProxyPeerId(dto.accountId, commentsPeerId),
    originChannelId: getProxyPeerId(dto.accountId, dto.peerId),
    originMessageId: dto.msgId,
    messagesCount: replies || 0,
    lastMessageId: lastReplyId,
    // Users only: a channel signing a comment is not a chat the guest knows
    recentReplierIds: recentRepliers?.filter(({ peerId }) => peerId > 0)
      .map(({ peerId }) => getProxyPeerId(dto.accountId, peerId)),
  };
}

/** A link preview belongs to its message: the guest gets no Telegram web page IDs */
export function buildProxyWebPageId(chatId: string, msgId: number) {
  return `pxg_${chatId}_${msgId}`;
}

export function buildProxyWebPage(dto: MessageDto, chatId: string): ApiWebPageFull | undefined {
  const { webPage } = dto;
  if (!webPage) return undefined;
  return {
    mediaType: 'webpage',
    webpageType: 'full',
    id: buildProxyWebPageId(chatId, dto.msgId),
    hash: 0,
    url: webPage.url,
    displayUrl: webPage.displayUrl,
    siteName: webPage.siteName,
    title: webPage.title,
    description: webPage.description,
  };
}

/** A message in a forum topic replies to the topic's first message, so the thread is known without an explicit reply */
function buildReplyInfo(dto: MessageDto): ApiMessageReplyInfo | undefined {
  const { replyToMsgId, replyToTopId, forumTopic, quoteText } = dto.replyTo || {};
  if (!replyToMsgId) return undefined;
  return {
    type: 'message',
    replyToMsgId,
    replyToTopId,
    isForumTopic: forumTopic || undefined,
    quoteText: quoteText ? { text: quoteText } : undefined,
  };
}

/** Participants of an action are users of the provider account, like message senders */
function buildProxyAction(dto: MessageDto): ApiMessageAction | undefined {
  const { action } = dto;
  if (!action) return dto.isService ? { mediaType: 'action', type: 'unsupported' } : undefined;
  const userIdsOf = (users: { id: number }[]) => users.map((user) => getProxyPeerId(dto.accountId, user.id));
  switch (action.type) {
    case 'chatCreate':
      return { mediaType: 'action', type: 'chatCreate', title: action.title, userIds: userIdsOf(action.users) };
    case 'chatAddUser':
      return { mediaType: 'action', type: 'chatAddUser', userIds: userIdsOf(action.users) };
    case 'chatDeleteUser':
      return { mediaType: 'action', type: 'chatDeleteUser', userId: userIdsOf(action.users)[0] };
    case 'chatJoinedByLink':
      return { mediaType: 'action', type: 'chatJoinedByLink', inviterId: userIdsOf(action.users)[0] };
    case 'channelCreate':
    case 'chatEditTitle':
      return { mediaType: 'action', type: action.type, title: action.title };
    case 'channelMigrateFrom':
      return { mediaType: 'action', type: 'channelMigrateFrom', title: action.title, chatId: '' };
    case 'setMessagesTtl':
      return { mediaType: 'action', type: 'setMessagesTtl', period: action.period };
    case 'customAction':
      return { mediaType: 'action', type: 'customAction', message: action.message };
    case 'phoneCall':
      return {
        mediaType: 'action',
        type: 'phoneCall',
        callId: String(dto.msgId),
        isVideo: action.isVideo || undefined,
        duration: action.duration ?? undefined,
        reason: action.reason ? CALL_DISCARD_REASONS[action.reason] : undefined,
      };
    case 'topicCreate':
      return {
        mediaType: 'action',
        type: 'topicCreate',
        title: action.title,
        iconColor: action.iconColor,
        iconEmojiId: action.iconEmojiId ?? undefined,
      };
    case 'topicEdit':
      return {
        mediaType: 'action',
        type: 'topicEdit',
        title: action.title ?? undefined,
        iconEmojiId: action.iconEmojiId ?? undefined,
        isClosed: action.isClosed ?? undefined,
        isHidden: action.isHidden ?? undefined,
      };
    default:
      return { mediaType: 'action', type: action.type };
  }
}

/** A deleted topic stays readable from the archive but cannot be written to */
export function buildProxyTopic(dto: TopicDto, chatId: string): ApiTopicWithState {
  return {
    topic: {
      id: dto.id,
      title: dto.title,
      iconColor: dto.iconColor ?? DEFAULT_TOPIC_COLOR,
      iconEmojiId: dto.iconEmojiId ?? undefined,
      isClosed: dto.isClosed || dto.isDeleted || undefined,
      isPinned: dto.isPinned || undefined,
      isHidden: dto.isHidden || undefined,
      date: parseDate(dto.date),
      fromId: chatId,
      // The guest's own topic mute; the owner's settings in Telegram stay as they are
      notifySettings: { mutedUntil: dto.mutedUntil ?? undefined },
      pxgPermissions: dto.permissions,
    },
    // The guest's own read state: reading a shared topic does not mark it read for the owner
    readState: {
      unreadCount: dto.unreadCount,
      lastReadInboxMessageId: dto.readMaxId,
      unreadMentionsCount: dto.unreadMentionsCount,
    },
    lastMessageId: dto.lastMsgId ?? undefined,
  };
}

/** Bot callbacks act on behalf of the owner and need `interact`; links open like any other link */
function buildInlineButtons(dto: MessageDto, chat: ApiChat): ApiKeyboardButtons | undefined {
  if (!dto.buttons?.length) return undefined;
  const canInteract = (dto.permissions || chat.pxgProxy?.permissions)?.interact;
  return dto.buttons.map((row) => row.map((button): ApiKeyboardButton => {
    if (button.kind === 'url') return { text: button.text, action: { type: 'url', url: button.url } };
    if (button.kind === 'callback' && canInteract) {
      return { text: button.text, action: { type: 'callback', data: button.data } };
    }
    return { text: button.text, action: { type: 'unsupported' } };
  }));
}

export function buildProxyPoll(dto: MessageDto): ApiMessagePoll | undefined {
  const { poll } = dto;
  if (!poll) return undefined;
  return {
    mediaType: 'poll',
    summary: {
      id: poll.id,
      hash: poll.id,
      isClosed: poll.isClosed || undefined,
      isPublic: poll.isPublic || undefined,
      isMultipleChoice: poll.isMultipleChoice || undefined,
      isQuiz: poll.isQuiz || undefined,
      question: { text: poll.question, entities: buildProxyEntities(poll.questionEntities, dto.accountId) },
      answers: poll.answers.map(({ text, option }) => ({ text: { text }, option })),
    },
    results: {
      totalVoters: poll.results?.totalVoters,
      solution: poll.results?.solution || undefined,
      resultByOption: poll.results ? Object.fromEntries(poll.results.answers.map((answer) => [answer.option, {
        option: answer.option,
        votersCount: answer.voters,
        isChosen: answer.isChosen || undefined,
        isCorrect: answer.isCorrect || undefined,
      }])) : undefined,
    },
  };
}

function buildForwardInfo(dto: MessageDto): ApiMessage['forwardInfo'] {
  const header = dto.fwdFrom as { date?: number; channelPost?: number } | null;
  if (!header) return undefined;
  // The original author is shown by name only: their Telegram ID belongs to the provider's session
  return {
    date: header.date || parseDate(dto.date),
    isChannelPost: Boolean(header.channelPost),
    hiddenUserName: dto.forwardName || '?',
  };
}

function parseDate(date: string) {
  return Math.floor(Date.parse(date) / 1000);
}
