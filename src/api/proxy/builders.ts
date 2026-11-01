import type { AccessChat, MessageDto, TopicDto } from '../../proxygram/server/types';
import type {
  ApiChat, ApiKeyboardButton, ApiKeyboardButtons, ApiMessage, ApiMessagePoll, ApiMessageReplyInfo,
  ApiPhoneCallDiscardReason, ApiReactionCount, ApiTopicWithState, ApiUser,
} from '../types';
import type { ApiMessageAction } from '../types/messageActions';

import { getPxgState } from '../../proxygram/server/store';
import { buildProxyEntities } from './entities';
import { getProxyPeerId } from './index';
import { buildProxyMedia } from './media';

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
    isForum: chat.type === 'forum' || undefined,
    isListed: true,
    isProtected: !chat.permissions.forwardOut,
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
      sendPolls: true,
    },
    pxgProxy: {
      accountId: chat.accountId, peerId: chat.peerId, permissions: chat.permissions,
      restricted: chat.restricted || undefined,
    },
  };
}

export function buildProxyUser(accountId: string, userId: number, name?: string): ApiUser {
  return {
    id: getProxyPeerId(accountId, userId),
    type: 'userTypeRegular',
    isMin: false,
    firstName: name || String(userId),
    phoneNumber: '',
    noStatus: true,
  };
}

export function buildProxyMessage(dto: MessageDto, chat: ApiChat): ApiMessage {
  const reactions = dto.reactions?.results?.flatMap((reaction): ApiReactionCount[] => {
    const { emoticon, documentId } = reaction.reaction;
    if (!emoticon && !documentId) return [];
    return [{
      count: reaction.count,
      chosenOrder: reaction.chosenOrder,
      reaction: emoticon ? { type: 'emoji', emoticon } : { type: 'custom', documentId: documentId! },
    }];
  });
  const media = chat.pxgProxy?.permissions.download && !dto.isMediaUnavailable
    ? buildProxyMedia(dto, chat.id) : undefined;
  const mediaFallback = !media && dto.media?.id ? {
    fileName: dto.media.fileName, isUnavailable: dto.isMediaUnavailable,
  } : undefined;
  return {
    id: dto.msgId,
    sendingState: undefined,
    chatId: chat.id,
    date: parseDate(dto.date),
    isOutgoing: dto.isOutgoing,
    senderId: dto.senderId ? getProxyPeerId(dto.accountId, dto.senderId) : undefined,
    content: { ...media, pollId: dto.poll?.id, action: buildProxyAction(dto), text: dto.text ? {
      text: dto.text, entities: buildProxyEntities(dto.entities, dto.accountId),
    } : undefined },
    inlineButtons: buildInlineButtons(dto, chat),
    pxgMediaFallback: mediaFallback,
    editDate: dto.editDate ? parseDate(dto.editDate) : undefined,
    isEdited: dto.version > 1 || undefined,
    pxgDeletedAt: dto.deleted ? parseDate(dto.deleted.at) : undefined,
    pxgSentByUserId: dto.sentByUserId || undefined,
    pxgIsOwn: dto.sentByUserId === getPxgState().session?.user.id,
    isProtected: !chat.pxgProxy?.permissions.forwardOut,
    isForwardingAllowed: chat.pxgProxy?.permissions.forwardOut || undefined,
    forwardInfo: buildForwardInfo(dto),
    replyInfo: buildReplyInfo(dto),
    reactions: reactions?.length ? { results: reactions } : undefined,
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
      notifySettings: {},
    },
    lastMessageId: dto.lastMsgId ?? undefined,
  };
}

/** Bot callbacks act on behalf of the owner and need `interact`; links open like any other link */
function buildInlineButtons(dto: MessageDto, chat: ApiChat): ApiKeyboardButtons | undefined {
  if (!dto.buttons?.length) return undefined;
  const canInteract = chat.pxgProxy?.permissions.interact;
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
