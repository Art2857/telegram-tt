import type { AccessChat, MessageDto } from '../../proxygram/server/types';
import type {
  ApiChat, ApiKeyboardButton, ApiKeyboardButtons, ApiMessage, ApiMessagePoll, ApiReactionCount, ApiUser,
} from '../types';

import { getPxgState } from '../../proxygram/server/store';
import { buildProxyEntities } from './entities';
import { getProxyPeerId } from './index';
import { buildProxyMedia } from './media';

export function buildProxyChat(chat: AccessChat): ApiChat {
  return {
    id: getProxyPeerId(chat.accountId, chat.peerId),
    type: chat.peerId > 0 ? 'chatTypePrivate'
      : chat.type === 'channel' ? 'chatTypeChannel' : 'chatTypeSuperGroup',
    title: chat.title || chat.username || String(chat.peerId),
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
    content: { ...media, pollId: dto.poll?.id, text: dto.text ? {
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
    replyInfo: dto.replyTo?.replyToMsgId ? {
      type: 'message', replyToMsgId: dto.replyTo.replyToMsgId,
      quoteText: dto.replyTo.quoteText ? { text: dto.replyTo.quoteText } : undefined,
    } : undefined,
    reactions: reactions?.length ? { results: reactions } : undefined,
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
