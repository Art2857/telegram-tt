import type { AccessChat, MessageDto } from '../../proxygram/server/types';
import type { ApiChat, ApiMessage, ApiReactionCount, ApiUser } from '../types';

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
      sendPolls: true, sendVoices: true, sendRoundvideos: true,
    },
    pxgProxy: { accountId: chat.accountId, peerId: chat.peerId, permissions: chat.permissions },
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
  const mediaFallback = !media && dto.media && dto.media.kind !== 'webpage' ? {
    fileName: dto.media.fileName, isUnavailable: dto.isMediaUnavailable,
  } : undefined;
  return {
    id: dto.msgId,
    sendingState: undefined,
    chatId: chat.id,
    date: parseDate(dto.date),
    isOutgoing: dto.isOutgoing,
    senderId: dto.senderId ? getProxyPeerId(dto.accountId, dto.senderId) : undefined,
    content: { ...media, text: dto.text ? {
      text: dto.text, entities: buildProxyEntities(dto.entities, dto.accountId),
    } : undefined },
    pxgMediaFallback: mediaFallback,
    editDate: dto.editDate ? parseDate(dto.editDate) : undefined,
    isEdited: dto.version > 1 || undefined,
    pxgDeletedAt: dto.deleted ? parseDate(dto.deleted.at) : undefined,
    pxgSentByUserId: dto.sentByUserId || undefined,
    pxgIsOwn: dto.sentByUserId === getPxgState().session?.user.id,
    isProtected: !chat.pxgProxy?.permissions.forwardOut,
    isForwardingAllowed: false,
    replyInfo: dto.replyTo?.replyToMsgId ? {
      type: 'message', replyToMsgId: dto.replyTo.replyToMsgId,
      quoteText: dto.replyTo.quoteText ? { text: dto.replyTo.quoteText } : undefined,
    } : undefined,
    reactions: reactions?.length ? { results: reactions } : undefined,
  };
}

function parseDate(date: string) {
  return Math.floor(Date.parse(date) / 1000);
}
