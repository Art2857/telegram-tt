import type {
  AccessChat, DraftDto, InlineButtonDto, MessageDto, PeerBadgesDto, ReactionCountDto, SponsoredMessageDto, TopicDto,
  UserStatusDto,
} from '../../proxygram/server/types';
import type {
  ApiChat, ApiChatFullInfo, ApiCommentsInfo, ApiDraft, ApiKeyboardButton, ApiKeyboardButtons, ApiMessage,
  ApiMessagePoll, ApiMessageReplyInfo, ApiPeerReaction, ApiPhoneCallDiscardReason, ApiReaction, ApiReactionCount,
  ApiReactionWithPaid, ApiSponsoredMessage, ApiTopicWithState, ApiUser, ApiUserStatus, ApiWebPageFull,
} from '../types';
import type { ApiMessageAction } from '../types/messageActions';
import type { ProxyPeer } from './ids';

import { ARCHIVED_FOLDER_ID, SPONSORED_MESSAGE_CACHE_MS } from '../../config';
import { getServerTime } from '../../util/serverTime';
import { getPxgState } from '../../proxygram/server/store';
import { buildProxyEntities } from './entities';
import { getProxySponsoredId } from './ids';
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

/** A channel shown only as an author or a send-as choice: it is neither in the list nor open to the guest */
export function buildProxyAuthorChat(
  accountId: string, peerId: number, name?: string, photoId?: string | null,
): ApiChat {
  return {
    id: getProxyPeerId(accountId, peerId),
    type: 'chatTypeChannel',
    title: name || String(peerId),
    avatarPhotoId: photoId || undefined,
  };
}

export function buildProxyChat(chat: AccessChat): ApiChat {
  const usernames = chat.info?.usernames?.length ? chat.info.usernames : chat.username ? [chat.username] : undefined;
  const bans = new Set(chat.telegramBans);
  const hasMediaBan = !chat.permissions.sendMedia || bans.has('sendMedia');
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
    isLinkedInDiscussion: chat.hasLinkedChat || undefined,
    // Telegram's "Restrict saving content" of the whole chat: nothing in it is forwarded, copied or saved
    isProtected: chat.isProtected || undefined,
    ...buildProxyBadges(chat.accountId, chat.badges),
    membersCount: chat.info?.participantsCount,
    // Telegram charges the owner for every message; the guest confirms the price and spends only with `spendStars`
    paidMessagesStars: chat.info?.paidMessagesStars,
    usernames: usernames?.map((username) => ({ username, isActive: true })),
    hasUsername: Boolean(usernames?.length) || undefined,
    ...buildProxyAdminRights(chat),
    currentUserBannedRights: {
      sendMessages: bans.has('sendMessages') ? true : undefined,
      sendPlain: bans.has('sendPlain') ? true : undefined,
      embedLinks: bans.has('embedLinks') ? true : undefined,
      sendReactions: chat.permissions.react ? undefined : true,
      sendMedia: hasMediaBan ? true : undefined,
      sendPhotos: hasMediaBan || bans.has('sendPhotos') ? true : undefined,
      sendVideos: hasMediaBan || bans.has('sendVideos') ? true : undefined,
      sendAudios: hasMediaBan || bans.has('sendAudios') ? true : undefined,
      sendDocs: hasMediaBan || bans.has('sendDocs') ? true : undefined,
      sendStickers: hasMediaBan || !chat.permissions.useOwnerStickers || bans.has('sendStickers') ? true : undefined,
      sendGifs: hasMediaBan || !chat.permissions.useOwnerStickers || bans.has('sendGifs') ? true : undefined,
      sendVoices: hasMediaBan || bans.has('sendVoices') ? true : undefined,
      sendRoundvideos: hasMediaBan || bans.has('sendRoundvideos') ? true : undefined,
      sendPolls: !chat.permissions.write || hasMediaBan || bans.has('sendPolls') ? true : undefined,
      sendGames: hasMediaBan || bans.has('sendGames') ? true : undefined,
      // A bot's result is often a file, and the bot decides which
      sendInline: hasMediaBan || bans.has('sendInline') ? true : undefined,
      // Topics are created as the owner: only with the admin permission
      manageTopics: chat.permissions.admin ? undefined : true,
      // Inviting people into the owner's chat is not a guest action
      inviteUsers: true,
    },
    pxgProxy: {
      accountId: chat.accountId, peerId: chat.peerId, permissions: chat.permissions, shareIds: chat.shareIds,
      restricted: chat.restricted || undefined,
      label: chat.label || undefined,
      isOwn: chat.isOwn || undefined,
      isSavedMessages: chat.isSavedMessages || undefined,
      providerName: (!chat.isOwn && chat.providerName) || undefined,
      providerUserId: chat.providerUserId || undefined,
      providerUsername: chat.providerUsername || undefined,
      isProviderPremium: chat.providerPremium || undefined,
      maxUploadBytes: chat.maxUploadBytes,
      starsPerDay: chat.starsPerDay,
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
): Pick<
  ApiChatFullInfo,
  'about' | 'slowMode' | 'inviteLink' | 'canViewMembers' | 'linkedChatId' | 'sendAsId' | 'isPaidReactionAvailable'
> {
  const { info } = chat;
  const sendAsPeerId = chat.sendAsPeerId || chat.providerUserId;
  // The owner spends their own Stars; a guest needs both the right to react and a daily Stars limit
  const canSpendStars = chat.isOwn || (chat.permissions.spendStars && (chat.starsPerDay ?? 0) > 0);
  return {
    // A guest writes as the owner unless they chose one of the owner's channels
    sendAsId: sendAsPeerId ? getProxyPeerId(chat.accountId, sendAsPeerId) : undefined,
    // Members of a group are visible as to the owner; subscribers of a channel — to its admins only
    canViewMembers: (chat.peerId < 0 && (chat.type !== 'channel' || chat.permissions.admin)) || undefined,
    about: info?.about,
    slowMode: !chat.isOwnerAdmin && info?.slowmodeSeconds ? { seconds: info.slowmodeSeconds } : undefined,
    // The server sends the owner's invite link only to a guest with the admin permission
    inviteLink: info?.inviteLink,
    // The server names the discussion group only when it is shared too: then posts show their comments
    linkedChatId: info?.linkedChatId ? getProxyPeerId(chat.accountId, info.linkedChatId) : undefined,
    // Paid Star reactions: Telegram allows them in this channel, and the guest may spend the owner's Stars
    isPaidReactionAvailable: (info?.paidReactionsAvailable && chat.permissions.react && canSpendStars) || undefined,
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

export function buildProxySponsoredMessage(
  dto: SponsoredMessageDto, chatId: string, peer: ProxyPeer,
): ApiSponsoredMessage {
  return {
    chatId,
    randomId: getProxySponsoredId(peer, dto.randomId),
    expiresAt: Math.round(Date.now() / 1000) + SPONSORED_MESSAGE_CACHE_MS,
    isRecommended: dto.isRecommended || undefined,
    sponsorInfo: dto.sponsorInfo ?? undefined,
    additionalInfo: dto.additionalInfo ?? undefined,
    buttonText: dto.buttonText,
    title: dto.title,
    url: dto.url,
    content: { text: { text: dto.text, entities: buildProxyEntities(dto.entities, peer.accountId) } },
  };
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
/**
 * Phones the server revealed under `seePhones`. Any rebuild of the user keeps them, since an update replaces
 * the whole profile; the accesses reload starts over, so a revoked permission takes them away
 */
const phoneByUserId = new Map<string, string>();

export function setProxyUserPhone(accountId: string, userId: number, phone?: string | null) {
  const id = getProxyPeerId(accountId, userId);
  if (phone) phoneByUserId.set(id, phone);
  else phoneByUserId.delete(id);
}

/**
 * What the other side of a private chat charges the owner a message. Web A asks the user for it before every send,
 * so any rebuild of the user keeps it, like the phone
 */
const paidStarsByUserId = new Map<string, number>();

export function setProxyUserPaidStars(accountId: string, userId: number, stars?: number | null) {
  const id = getProxyPeerId(accountId, userId);
  if (stars) paidStarsByUserId.set(id, stars);
  else paidStarsByUserId.delete(id);
}

export function clearProxyUserPhones() {
  phoneByUserId.clear();
  paidStarsByUserId.clear();
}

export function buildProxyUser(
  accountId: string, userId: number, name?: string, photoId?: string | null, badges?: PeerBadgesDto | null,
): ApiUser {
  const id = getProxyPeerId(accountId, userId);
  const user: ApiUser = {
    id,
    type: 'userTypeRegular',
    isMin: false,
    firstName: name || String(userId),
    phoneNumber: phoneByUserId.get(id) || '',
    noStatus: true,
    paidMessagesStars: paidStarsByUserId.get(id),
  };
  if (photoId !== undefined) user.avatarPhotoId = photoId || undefined;
  if (badges !== undefined) Object.assign(user, buildProxyBadges(accountId, badges), { isPremium: badges?.premium });
  return user;
}

/** A custom emoji reaction is read through the provider's account, like custom emoji in text */
export function buildProxyReaction(
  accountId: string,
  { emoticon, documentId, _: kind }: Pick<ReactionCountDto['reaction'], 'emoticon' | 'documentId'> & { _?: string },
): ApiReactionWithPaid | undefined {
  // A paid reaction is a Star: as many people sent Stars as it says, and the stars are the owner's
  if (kind === 'reactionPaid') return { type: 'paid' };
  if (emoticon) return { type: 'emoji', emoticon };
  const userId = getPxgState().session?.user.id;
  if (!documentId || !userId) return undefined;
  return { type: 'custom', documentId: buildProxyCatalogMediaId(userId, accountId, documentId) };
}

/**
 * Who reacted last. Telegram's `unread` is about the owner reading it, so the guest's mark comes from the server;
 * a reaction of the owner's account looks like the guest's own, since a guest reacts through that account
 */
function buildProxyRecentReactions(dto: MessageDto, chat: ApiChat): ApiPeerReaction[] | undefined {
  const providerUserId = chat.pxgProxy?.providerUserId;
  const recent = dto.reactions?.recentReactions?.filter(({ peerId }) => peerId.userId);
  const unreadIndex = dto.hasUnreadReaction ? recent?.findIndex(({ peerId }) => peerId.userId !== providerUserId) : -1;
  return recent?.flatMap(({ peerId, reaction: raw, date, big }, index): ApiPeerReaction[] => {
    const reaction = buildProxyReaction(dto.accountId, raw);
    // Paid reactions live in the top senders, not among the people who reacted last
    if (!reaction || reaction.type === 'paid') return [];
    return [{
      peerId: getProxyPeerId(dto.accountId, peerId.userId!),
      reaction,
      addedDate: date,
      isBig: big || undefined,
      isOwn: peerId.userId === providerUserId || undefined,
      isUnread: index === unreadIndex || undefined,
    }];
  });
}

export function buildProxyMessage(dto: MessageDto, chat: ApiChat): ApiMessage {
  const reactions = dto.reactions?.results?.flatMap((item): ApiReactionCount[] => {
    const reaction = buildProxyReaction(dto.accountId, item.reaction);
    return reaction ? [{ count: item.count, chosenOrder: item.chosenOrder, reaction }] : [];
  });
  const permissions = dto.permissions || chat.pxgProxy!.permissions;
  const media = permissions.download && !dto.isMediaUnavailable
    ? buildProxyMedia(dto, chat.id) : undefined;
  const attachment = buildProxyAttachment(dto, chat.id);
  const mediaFallback = dto.attachment?.type === 'other' ? { attachmentKind: dto.attachment.kind }
    : !media && dto.media?.id ? {
      fileName: dto.media.fileName, isUnavailable: dto.isMediaUnavailable, size: dto.media.size,
    } : undefined;
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
    pxgSentByName: dto.sentByName || undefined,
    pxgIsOwn: dto.sentByUserId === getPxgState().session?.user.id,
    pxgPermissions: permissions,
    transcriptionId: dto.transcription?.id,
    // Without `forwardOut` a guest still copies and saves what they read; only Telegram's own protection forbids it
    isProtected: dto.isProtected || undefined,
    isSilent: dto.isSilent || undefined,
    effectId: dto.effectId,
    summaryLanguageCode: dto.summaryLanguage,
    fromRank: dto.senderRank,
    viaBotId: dto.viaBot ? getProxyPeerId(dto.accountId, dto.viaBot.peerId) : undefined,
    // Parts of an album show together, photos and videos as one grid, as Telegram groups them
    groupedId: dto.groupedId || undefined,
    isInAlbum: (dto.groupedId && (media?.photo || media?.video)) ? true : undefined,
    isForwardingAllowed: (permissions.forwardOut && !dto.isProtected && !chat.isProtected) || undefined,
    forwardInfo: buildForwardInfo(dto),
    replyInfo: buildReplyInfo(dto),
    reactions: reactions?.length ? {
      results: reactions,
      recentReactions: buildProxyRecentReactions(dto, chat),
      canSeeList: dto.reactions?.canSeeList,
    } : undefined,
    isPinned: dto.isPinned || undefined,
    hasUnreadMention: dto.hasUnreadMention || undefined,
    viewsCount: dto.post?.views,
    forwardsCount: dto.post?.forwards,
    postAuthorTitle: dto.post?.author,
  };
}

/** The comments button of a channel post: the count comes from the archive of the shared discussion group */
export function buildProxyCommentsInfo(dto: MessageDto): ApiCommentsInfo | undefined {
  const {
    commentsPeerId, replies, lastReplyId, recentRepliers, hasUnreadComments,
  } = dto.post || {};
  if (!commentsPeerId) return undefined;
  return {
    isCommentsInfo: true,
    chatId: getProxyPeerId(dto.accountId, commentsPeerId),
    originChannelId: getProxyPeerId(dto.accountId, dto.peerId),
    originMessageId: dto.msgId,
    messagesCount: replies || 0,
    lastMessageId: lastReplyId,
    hasUnread: hasUnreadComments || undefined,
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
    // The old group and its supergroup link to each other; the guest opens the one shared with them
    case 'channelMigrateFrom':
      return {
        mediaType: 'action',
        type: 'channelMigrateFrom',
        title: action.title,
        chatId: action.chatId ? getProxyPeerId(dto.accountId, action.chatId) : '',
      };
    case 'chatMigrateTo':
      return { mediaType: 'action', type: 'chatMigrateTo', channelId: getProxyPeerId(dto.accountId, action.channelId) };
    case 'noForwardsToggle':
      return { mediaType: 'action', type: 'noForwardsToggle', prevValue: action.prevValue, newValue: action.newValue };
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
      lastReadOutboxMessageId: dto.readOutboxMaxId ?? undefined,
      unreadMentionsCount: dto.unreadMentionsCount,
      unreadReactionsCount: dto.unreadReactionsCount,
    },
    lastMessageId: dto.lastMsgId ?? undefined,
  };
}

/** "via @bot" under a message needs the bot's username; opening the bot's chat stays with the owner */
export function buildProxyViaBot(
  accountId: string, { peerId, username }: { peerId: number; username: string },
): ApiUser {
  return {
    ...buildProxyUser(accountId, peerId, username),
    type: 'userTypeBot',
    hasUsername: true,
    usernames: [{ username, isActive: true }],
  };
}

/** Bot callbacks act on behalf of the owner and need `interact`; links open like any other link */
function buildInlineButtons(dto: MessageDto, chat: ApiChat): ApiKeyboardButtons | undefined {
  if (!dto.buttons?.length) return undefined;
  const permissions = dto.permissions || chat.pxgProxy?.permissions;
  return dto.buttons.map((row) => row.map((button): ApiKeyboardButton => {
    const { text, style } = button;
    return { text, style, action: buildInlineButtonAction(button, permissions) };
  }));
}

function buildInlineButtonAction(
  button: InlineButtonDto, permissions: Partial<Record<string, boolean>> | undefined,
): ApiKeyboardButton['action'] {
  switch (button.kind) {
    case 'url':
      return { type: 'url', url: button.url };
    case 'copy':
      return { type: 'copy', copyText: button.copyText };
    case 'callback':
      return permissions?.interact ? { type: 'callback', data: button.data } : { type: 'unsupported' };
    // The bot's inline query goes into this chat's composer, as any inline bot the guest uses here
    case 'switchInline':
      return permissions?.write
        ? { type: 'switchBotInline', query: button.query, isSamePeer: true }
        : { type: 'unsupported' };
    default:
      return { type: 'unsupported' };
  }
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
