import type { MessageDto, ScheduledMessageDto } from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type {
  ApiAttachment, ApiChat, ApiMessage, ApiMessageEntity, ApiOnProgress, ApiPeer,
} from '../types';
import { PxgError } from '../../proxygram/server/types';
import { MAIN_THREAD_ID } from '../types';

import { ARCHIVED_FOLDER_ID, LOCAL_MESSAGES_LIMIT } from '../../config';
import { pause } from '../../util/schedulers';
import { getServerTime } from '../../util/serverTime';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { uploadFile } from '../../proxygram/server/upload';
import { buildProxyMessage, buildProxyPoll } from './builders';
import { buildProxyEntities, buildProxyInputEntities } from './entities';
import { emitProxyUpdate, resolveProxyPeer } from './index';
import { parseProxyCatalogId } from './mediaIds';
import { runProxyJob } from './outbox';

const DELETE_BATCH_SIZE = 20;
const MAX_WAVEFORM_LENGTH = 100;
const MAX_CHAT_PHOTO_BYTES = 50 * 1024 * 1024;
/** The server accepts this many messages per `messages.readReactions` */
const MAX_READ_REACTIONS = 200;
const COPY_WAIT_MS = 15 * 60_000;
const COPY_WAIT_INTERVAL_MS = 1000;
const COPY_WAIT_MAX_INTERVAL_MS = 8000;
const COPY_WAIT_BACKOFF = 1.5;
let localCounter = 0;

type SendParams = MethodArgs<'sendMessage'>[0];
type SendRequest = NonNullable<ApiMessage['pxgSendRequest']>;

/** Sends that failed before their request was fixed, e.g. during the upload: a retry needs the file again */
const unsentParams = new Map<string, SendParams>();

type AlbumPart = { localMessage: ApiMessage; request: SendRequest };
/** Albums being uploaded: how many parts Web A has started and which of them are ready */
const albums = new Map<string, { expected: number; parts: Map<number, AlbumPart> }>();

export async function sendMessage(params: SendParams, onProgress?: ApiOnProgress): Promise<void> {
  const {
    chat, attachment, text, entities, replyInfo, sticker, gif, poll, dice, scheduledAt, scheduleRepeatPeriod, effectId,
    sendAs,
  } = params;
  const peer = chat && resolveProxyPeer(chat.id);
  if (!chat || !peer) return;
  // Web A starts every part of an album at once; the slot is taken before any of them uploads
  const albumSlot = params.groupedId && attachment && !params.localMessage
    ? reserveAlbumSlot(params.groupedId) : undefined;
  const isScheduled = Boolean(scheduledAt);
  // The key stays with the local message: the server sends one message per key however often it is repeated
  const requestId = params.localMessage?.pxgSendRequest?.id || crypto.randomUUID();
  // In a forum topic Web A replies to the topic's first message: that is the topic, not a quoted reply
  const messageReply = replyInfo?.type === 'message' ? replyInfo : undefined;
  const topicId = chat.isForum ? messageReply?.replyToTopId : undefined;
  // Outside a forum it is a comment thread: the reply itself places the message, and the chat's draft stays
  const threadId = !chat.isForum ? messageReply?.replyToTopId : undefined;
  // "Reply in another chat": the replied message lives in that chat. A chat that is not a proxy chat (the full login's
  // own Telegram) has nothing the owner's account could quote, so such a reply is dropped rather than misread here
  const otherChatId = messageReply?.replyToPeerId && messageReply.replyToPeerId !== chat.id
    ? messageReply.replyToPeerId : undefined;
  const replyToPeer = otherChatId ? resolveProxyPeer(otherChatId) : undefined;
  const hasReply = !otherChatId || Boolean(replyToPeer);
  const replyToMsgId = hasReply && messageReply?.replyToMsgId !== topicId ? messageReply?.replyToMsgId : undefined;
  const quoteText = replyToMsgId ? messageReply?.quoteText : undefined;
  const quote = quoteText?.text ? {
    text: quoteText.text,
    // The quote carries the source chat's custom emoji: they map back through that chat's account
    entities: buildProxyInputEntities(quoteText.entities, (replyToPeer ?? peer).accountId, true),
    offset: messageReply?.quoteOffset,
  } : undefined;
  const localMessage: ApiMessage = params.localMessage || {
    id: (params.lastMessageId || 0) + (++localCounter / LOCAL_MESSAGES_LIMIT),
    chatId: chat.id, date: scheduledAt || getServerTime(), isOutgoing: true,
    isScheduled: isScheduled || undefined,
    scheduleRepeatPeriod: isScheduled ? scheduleRepeatPeriod : undefined,
    pxgSentByUserId: getPxgState().session?.user.id,
    pxgIsOwn: true,
    content: sticker ? { sticker } : gif ? { video: gif } : {
      // A poll and a dice appear as they are once Telegram has them; until then their text stands in
      text: { text: poll?.summary.question.text || dice || text || attachment?.filename || '', entities },
    },
    sendingState: 'messageSendingStatePending',
    replyInfo: messageReply && { ...messageReply, isForumTopic: topicId ? true : undefined },
    effectId,
    senderId: sendAs?.id,
    pxgSendRequest: { id: requestId },
  };
  if (!params.localMessage) {
    emitProxyUpdate({
      '@type': isScheduled ? 'newScheduledMessage' : 'newMessage',
      id: localMessage.id,
      chatId: chat.id,
      message: localMessage,
    });
  } else if (!params.localMessage.pxgSendRequest) {
    updateLocalMessage(localMessage, { pxgSendRequest: { id: requestId } });
  }
  let request: SendRequest | undefined;
  try {
    if (params.todo || params.richMessage) {
      throw new PxgError('unsupported');
    }
    // The owner's sticker or GIF must come from the catalog of the chat's provider account
    const catalogItem = sticker || gif ? parseProxyCatalogId((sticker || gif)!.id) : undefined;
    if ((sticker || gif) && catalogItem?.accountId !== peer.accountId) throw new PxgError('unsupported');
    let file: Record<string, unknown> | undefined;
    if (attachment) {
      // Self-destructing media is never sent through the server: the archive could not honor the timer
      if (attachment.ttlSeconds) throw new PxgError('unsupported');
      const uploaded = await uploadAttachment(chat, attachment, onProgress);
      const { voice, quick, isRoundVideo } = attachment;
      file = {
        uploadId: uploaded.uploadId,
        kind: voice ? 'voice' : isRoundVideo ? 'round' : undefined,
        duration: voice?.duration ?? (isRoundVideo ? quick?.duration : undefined),
        waveform: voice?.waveform.slice(0, MAX_WAVEFORM_LENGTH),
        width: isRoundVideo ? quick?.width : undefined,
        height: isRoundVideo ? quick?.height : undefined,
      };
    }
    if (onProgress?.isCanceled) throw new PxgError('canceled');
    request = {
      id: requestId,
      params: {
        ...peer,
        text: text || '',
        entities: buildProxyInputEntities(entities, peer.accountId, chat.pxgProxy?.permissions.useOwnerStickers),
        file,
        document: catalogItem ? { documentId: catalogItem.documentId } : undefined,
        poll: poll && {
          question: poll.summary.question.text,
          answers: poll.summary.answers.map(({ text: answer }) => answer.text),
          isPublic: poll.summary.isPublic,
          isMultipleChoice: poll.summary.isMultipleChoice,
          canAddAnswers: poll.summary.canAddAnswers,
          isRevoteDisabled: poll.summary.isRevoteDisabled,
          shouldShuffleAnswers: poll.summary.shouldShuffleAnswers,
          shouldHideResults: poll.summary.shouldHideResultsUntilClose,
          correctAnswer: poll.summary.isQuiz ? poll.correctAnswers?.[0] : undefined,
          solution: poll.solution,
        },
        dice,
        replyToMsgId,
        replyToPeer,
        quote,
        topicId,
        threadId,
        silent: params.isSilent,
        scheduleDate: scheduledAt,
        scheduleRepeatPeriod: isScheduled ? scheduleRepeatPeriod : undefined,
        effectId,
        sendAsPeerId: getSendAsPeerId(sendAs),
      },
    };
    unsentParams.delete(requestId);
    if (albumSlot !== undefined) {
      await joinAlbum(chat, params.groupedId!, albumSlot, { localMessage, request });
      return;
    }
    // The exact request survives a reload: a retry repeats it byte for byte, so the server recognizes the key
    updateLocalMessage(localMessage, { pxgSendRequest: request });
    await completeSend(chat, localMessage, request);
  } catch (err) {
    // A part that did not upload leaves the album; the rest still go together
    if (albumSlot !== undefined && !request) void joinAlbum(chat, params.groupedId!, albumSlot);
    const isFinal = err instanceof PxgError && (err.code === 'unsupported' || err.code === 'canceled');
    if (!request && !isFinal) unsentParams.set(requestId, params);
    emitSendFailed(chat, localMessage, err);
  }
}

function reserveAlbumSlot(groupedId: string) {
  const album = albums.get(groupedId) || { expected: 0, parts: new Map<number, AlbumPart>() };
  albums.set(groupedId, album);
  return album.expected++;
}

/**
 * The last part of an album to finish its upload sends all of them as one Telegram message, as GramJS does.
 * A failed album fails every part; a single part left goes as an ordinary message
 */
async function joinAlbum(chat: ApiChat, groupedId: string, slot: number, part?: AlbumPart) {
  const album = albums.get(groupedId);
  if (!album) return;
  if (part) album.parts.set(slot, part);
  else album.expected--;
  if (album.parts.size < album.expected) return;
  albums.delete(groupedId);
  const parts = [...album.parts].sort(([a], [b]) => a - b).map(([, ready]) => ready);
  if (parts.length === 1) {
    const [{ localMessage, request }] = parts;
    updateLocalMessage(localMessage, { pxgSendRequest: request });
    await completeSend(chat, localMessage, request).catch((err) => emitSendFailed(chat, localMessage, err));
    return;
  }
  if (!parts.length) return;
  const {
    text: firstText, entities: firstEntities, file: firstFile, ...common
  } = parts[0].request.params!;
  try {
    const { msgIds } = await runProxyJob('messages.send', {
      ...common,
      text: '',
      album: parts.map(({ request }) => {
        const { text, entities, file } = request.params!;
        return { file, text, entities };
      }),
      clientRequestId: parts[0].request.id,
    }) as { msgIds: number[] };
    for (const [index, { localMessage }] of parts.entries()) {
      await emitSent(chat, localMessage, msgIds[index]);
    }
  } catch (err) {
    parts.forEach(({ localMessage }) => emitSendFailed(chat, localMessage, err));
  }
}

/**
 * Repeats a failed send with its key. A job the server already has is reused, so a message that did go out is
 * not sent twice; the server checks the guest's rights again. Returns the error of a repeated failure.
 */
export async function retrySendMessage(chat: ApiChat, message: ApiMessage): Promise<string | undefined> {
  const request = message.pxgSendRequest;
  if (!request || !canRetrySendMessage(message)) return undefined;
  updateLocalMessage(message, { sendingState: 'messageSendingStatePending' });
  const pending = { ...message, sendingState: 'messageSendingStatePending' as const };
  if (!request.params) {
    // The upload did not finish: send the retained file again under the same key
    await sendMessage({ ...unsentParams.get(request.id)!, localMessage: pending });
    return undefined;
  }
  try {
    await completeSend(chat, pending, request, true);
    return undefined;
  } catch (err) {
    emitSendFailed(chat, pending, err);
    return getErrorMessage(err);
  }
}

/** Without the fixed request only a file still held by this page can be sent again */
export function canRetrySendMessage(message: ApiMessage) {
  const request = message.pxgSendRequest;
  return Boolean(request && (request.params || unsentParams.has(request.id)));
}

async function completeSend(chat: ApiChat, localMessage: ApiMessage, request: SendRequest, isRetry?: boolean) {
  const result = await runProxyJob('messages.send', {
    ...request.params, clientRequestId: request.id, retry: isRetry,
  }) as { msgId: number };
  await emitSent(chat, localMessage, result.msgId);
}

/** The local message gives way to the one Telegram has */
async function emitSent(chat: ApiChat, localMessage: ApiMessage, msgId: number | undefined) {
  if (msgId === undefined) throw new PxgError('not_found');
  if (localMessage.isScheduled) {
    // A scheduled message reaches the archive when Telegram sends it
    emitProxyUpdate({
      '@type': 'updateScheduledMessageSendSucceeded',
      chatId: chat.id,
      localId: localMessage.id,
      message: { ...localMessage, id: msgId, sendingState: undefined, pxgSendRequest: undefined },
    });
    return;
  }
  const saved = await readSentMessage(chat, msgId);
  if (!saved) throw new PxgError('not_found');
  emitProxyUpdate({
    '@type': 'updateMessageSendSucceeded', chatId: chat.id, localId: localMessage.id, message: saved,
  });
}

function updateLocalMessage(localMessage: ApiMessage, change: Partial<ApiMessage>) {
  const { chatId, id } = localMessage;
  if (localMessage.isScheduled) emitProxyUpdate({ '@type': 'updateScheduledMessage', chatId, id, message: change });
  else emitProxyUpdate({ '@type': 'updateMessage', chatId, id, message: change });
}

function emitSendFailed(chat: ApiChat, localMessage: ApiMessage, err: unknown) {
  emitProxyUpdate({
    '@type': localMessage.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
    chatId: chat.id,
    localId: localMessage.id,
    error: getErrorMessage(err),
  });
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Send failed';
}

async function uploadAttachment(chat: ApiChat, attachment: ApiAttachment, onProgress?: ApiOnProgress) {
  const blob = attachment.blob || await (await fetch(attachment.compressedBlobUrl || attachment.blobUrl)).blob();
  const upload = new File([blob], attachment.filename, { type: blob.type || attachment.mimeType });
  const maxBytes = chat.pxgProxy?.maxUploadBytes ?? 0;
  return uploadFile(upload, resolveProxyPeer(chat.id)!, maxBytes, (fraction) => onProgress?.(fraction));
}

/** The guest's own scheduled messages; the owner's other ones stay private unless they may manage them */
export async function fetchScheduledHistory({ chat }: MethodArgs<'fetchScheduledHistory'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await runProxyJob('scheduled.list', peer) as { messages?: ScheduledMessageDto[] };
  return {
    messages: (result.messages || []).map((item): ApiMessage => ({
      id: item.msgId,
      chatId: chat.id,
      date: item.date,
      isOutgoing: true,
      isScheduled: true,
      pxgIsOwn: true,
      content: {
        text: item.text ? { text: item.text, entities: buildProxyEntities(item.entities, peer.accountId) } : undefined,
      },
      pxgMediaFallback: item.mediaKind ? { fileName: item.fileName || undefined } : undefined,
      replyInfo: item.replyToMsgId ? { type: 'message', replyToMsgId: item.replyToMsgId } : undefined,
      scheduleRepeatPeriod: item.repeatPeriod || undefined,
    })),
  };
}

export async function sendScheduledMessages({ chat, ids }: MethodArgs<'sendScheduledMessages'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('scheduled.send', { ...peer, msgIds: ids });
    emitProxyUpdate({ '@type': 'deleteScheduledMessages', chatId: chat.id, ids });
  } catch (err) {
    emitProxyError(err);
  }
}

export function deleteScheduledMessages({ chat, messageIds }: MethodArgs<'deleteScheduledMessages'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  void runProxyJob('scheduled.delete', { ...peer, msgIds: messageIds })
    .then(() => emitProxyUpdate({ '@type': 'deleteScheduledMessages', chatId: chat.id, ids: messageIds }))
    .catch(emitProxyError);
}

export async function rescheduleMessage({
  chat, message, scheduledAt, scheduleRepeatPeriod,
}: MethodArgs<'rescheduleMessage'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('scheduled.reschedule', {
      ...peer, msgId: message.id, date: scheduledAt, repeatPeriod: scheduleRepeatPeriod,
    });
    emitProxyUpdate({
      '@type': 'updateScheduledMessage',
      chatId: chat.id,
      id: message.id,
      message: { date: scheduledAt, scheduleRepeatPeriod },
    });
  } catch (err) {
    emitProxyError(err);
  }
}

export async function editMessage({
  chat, message, attachment, text, entities,
}: MethodArgs<'editMessage'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  if (message.isScheduled) {
    await editScheduledMessage(chat, message, text, entities);
    return;
  }
  try {
    await runProxyJob('messages.edit', {
      ...peer,
      msgId: message.id,
      text,
      entities: buildProxyInputEntities(entities, peer.accountId, chat.pxgProxy?.permissions.useOwnerStickers),
      file: attachment && { uploadId: (await uploadAttachment(chat, attachment)).uploadId },
    });
    const saved = await readSentMessage(chat, message.id);
    if (saved) {
      emitProxyUpdate({ '@type': 'updateMessage', id: saved.id, chatId: chat.id, message: saved, isFull: true });
    }
  } catch (err) {
    emitProxyUpdate({ '@type': 'updateMessage', id: message.id, chatId: chat.id, message, isFull: true });
    emitProxyError(err);
  }
}

async function editScheduledMessage(
  chat: ApiChat, message: ApiMessage, text: string, entities?: ApiMessageEntity[],
) {
  const peer = resolveProxyPeer(chat.id)!;
  try {
    await runProxyJob('scheduled.edit', {
      ...peer,
      msgId: message.id,
      date: message.date,
      // Telegram drops the repeat of a scheduled message edited without it
      repeatPeriod: message.scheduleRepeatPeriod,
      text,
      entities: buildProxyInputEntities(entities, peer.accountId, chat.pxgProxy?.permissions.useOwnerStickers),
    });
    emitProxyUpdate({
      '@type': 'updateScheduledMessage',
      chatId: chat.id,
      id: message.id,
      message: { content: { text: { text, entities } } },
    });
  } catch (err) {
    emitProxyUpdate({ '@type': 'updateScheduledMessage', chatId: chat.id, id: message.id, message });
    emitProxyError(err);
  }
}

export async function deleteMessages({ chat, messageIds }: MethodArgs<'deleteMessages'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    for (let offset = 0; offset < messageIds.length; offset += DELETE_BATCH_SIZE) {
      const ids = messageIds.slice(offset, offset + DELETE_BATCH_SIZE);
      await runProxyJob('messages.delete', { ...peer, msgIds: ids });
      for (const id of ids) {
        const saved = await readSentMessage(chat, id);
        if (saved) emitProxyUpdate({ '@type': 'updateMessage', id, chatId: chat.id, message: saved, isFull: true });
        else emitProxyUpdate({ '@type': 'deleteMessages', chatId: chat.id, ids: [id] });
      }
    }
  } catch (err) {
    emitProxyError(err);
  }
}

export async function sendReaction({ chat, messageId, reactions }: MethodArgs<'sendReaction'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  // The whole set of the owner's reactions: several and custom ones are allowed by the owner's Premium
  const items = (reactions || []).flatMap((reaction): ({ emoji: string } | { documentId: string })[] => {
    if (reaction.type === 'emoji') return [{ emoji: reaction.emoticon }];
    if (reaction.type !== 'custom') return [];
    const catalog = parseProxyCatalogId(reaction.documentId);
    return catalog?.accountId === peer.accountId ? [{ documentId: catalog.documentId }] : [];
  });
  if (items.length !== (reactions?.length ?? 0)) throw new PxgError('unsupported');
  await runProxyJob('messages.react', { ...peer, msgId: messageId, reactions: items });
  return true as const;
}

/** The guest's own mark: for the owner reactions stay unread until the owner sees them in Telegram */
export async function readAllReactions({ chat, threadId }: MethodArgs<'readAllReactions'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  const topicId = chat.isForum && threadId ? Number(threadId) : undefined;
  await pxgRpc.call('messages.readReactions', { ...peer, topicId }).catch(() => undefined);
}

/** Web A reports messages seen on screen: of those only reactions have a mark, mentions follow the read pointer */
export async function markMessagesRead({ chat, messageIds }: MethodArgs<'markMessagesRead'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  await pxgRpc.call('messages.readReactions', { ...peer, msgIds: messageIds.slice(0, MAX_READ_REACTIONS) })
    .catch(() => undefined);
}

export async function markMessageListRead({
  chat, threadId, maxId,
}: MethodArgs<'markMessageListRead'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  // A comment thread has a pointer of its own: reading it does not read the whole group
  if (!chat.isForum && threadId !== MAIN_THREAD_ID) {
    if (maxId) {
      await pxgRpc.call('messages.read', { ...peer, maxId, threadId: Number(threadId) }).catch(() => undefined);
    }
    return;
  }
  // A forum topic is read on its own, like `messages.readDiscussion` in Telegram
  const topicId = chat.isForum && threadId !== MAIN_THREAD_ID ? Number(threadId) : undefined;
  // Without `maxId` the whole chat is read from the chat list, up to the latest message the guest can see
  const readMaxId = maxId || (await pxgRpc.call<{ messages: MessageDto[] }>('messages.window', {
    ...peer, topicId, limit: 1,
  }).catch(() => undefined))?.messages[0]?.msgId;
  if (!readMaxId) return;
  // The server always keeps the guest's own counters and marks the chat read for the owner only with `markRead`
  const isRead = await pxgRpc.call('messages.read', { ...peer, maxId: readMaxId, topicId })
    .then(() => true, () => false);
  if (isRead && !maxId) {
    emitProxyUpdate({
      '@type': 'updateThreadReadState',
      chatId: chat.id,
      threadId,
      readState: { unreadCount: 0, lastReadInboxMessageId: readMaxId },
    });
  }
}

export async function sendMessageAction({ peer: target, action }: MethodArgs<'sendMessageAction'>[0]) {
  const peer = resolveProxyPeer(target.id);
  if (!peer || !('pxgProxy' in target) || !target.pxgProxy?.permissions.typing) return undefined;
  if (action.type !== 'typing' && action.type !== 'cancel') return undefined;
  await pxgRpc.call('messages.typing', { ...peer, action: action.type }).catch(() => undefined);
  return true as const;
}

/** Only a channel is named: the owner's own account is what Telegram uses anyway */
export function getSendAsPeerId(sendAs?: ApiPeer) {
  const peer = sendAs && resolveProxyPeer(sendAs.id);
  return peer && peer.peerId < 0 ? peer.peerId : undefined;
}

/** Between chats of one provider account Telegram forwards natively, another owner's chat gets copies */
export async function forwardMessages({
  fromChat, toChat, toThreadId, messages, isSilent, noAuthors, noCaptions, sendAs,
}: MethodArgs<'forwardMessages'>[0]): Promise<void> {
  const source = resolveProxyPeer(fromChat.id);
  const target = resolveProxyPeer(toChat.id);
  try {
    if (!source || !target) throw new PxgError('unsupported');
    const topicId = toChat.isForum && toThreadId && toThreadId !== MAIN_THREAD_ID ? Number(toThreadId) : undefined;
    const sendAsPeerId = getSendAsPeerId(sendAs);
    if (source.accountId !== target.accountId) {
      for (const { id } of messages) {
        const copied = await runCopyJob({
          fromAccountId: source.accountId, fromPeerId: source.peerId, msgId: id,
          accountId: target.accountId, peerId: target.peerId,
          silent: isSilent, noCaptions, topicId, sendAsPeerId,
        }) as { msgId: number };
        const saved = await readSentMessage(toChat, copied.msgId);
        if (saved) emitProxyUpdate({ '@type': 'newMessage', id: saved.id, chatId: toChat.id, message: saved });
      }
      return;
    }
    const result = await runProxyJob('messages.forward', {
      accountId: target.accountId, fromPeerId: source.peerId, peerId: target.peerId,
      msgIds: messages.map(({ id }) => id), silent: isSilent, noAuthors, noCaptions, topicId, sendAsPeerId,
    }) as { msgIds: number[] };
    const forwarded = await pxgRpc.call<{ messages: MessageDto[] }>('messages.window', {
      ...target, msgIds: result.msgIds,
    });
    forwarded.messages.forEach((dto) => {
      emitProxyUpdate({
        '@type': 'newMessage', id: dto.msgId, chatId: toChat.id, message: buildProxyMessage(dto, toChat),
      });
    });
  } catch (err) {
    emitProxyError(err);
  }
}

/** A file outside the source's archive is downloaded for the copy first: it takes as long as the file is big */
async function runCopyJob(params: unknown) {
  const deadline = Date.now() + COPY_WAIT_MS;
  let interval = COPY_WAIT_INTERVAL_MS;
  while (true) {
    try {
      return await runProxyJob('messages.copy', params);
    } catch (err) {
      if (!(err instanceof PxgError) || err.code !== 'media_pending' || Date.now() + interval > deadline) throw err;
      await pause(interval);
      interval = Math.min(interval * COPY_WAIT_BACKOFF, COPY_WAIT_MAX_INTERVAL_MS);
    }
  }
}

/** The bot's answer arrives through the owner's session: a toast, an alert or a link */
export async function answerCallbackButton({ chatId, messageId, data }: MethodArgs<'answerCallbackButton'>[0]) {
  const peer = resolveProxyPeer(chatId);
  if (!peer || !data) return undefined;
  try {
    const answer = await runProxyJob('messages.botCallback', { ...peer, msgId: messageId, data }) as {
      message: string | null; alert: boolean; url: string | null;
    };
    return {
      message: answer.message || undefined,
      alert: answer.alert || undefined,
      url: answer.url || undefined,
      cacheTime: 0,
    };
  } catch (err) {
    emitProxyError(err);
    return undefined;
  }
}

/** The vote is the owner's single vote; fresh results replace the poll in the state */
export async function sendPollVote({ chat, messageId, options }: MethodArgs<'sendPollVote'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('polls.vote', { ...peer, msgId: messageId, options });
    const result = await pxgRpc.call<{ messages: MessageDto[] }>('messages.window', {
      ...peer, msgIds: [messageId],
    });
    const poll = result.messages[0] && buildProxyPoll(result.messages[0]);
    if (poll) emitProxyUpdate({ '@type': 'updateMessagePoll', pollId: poll.summary.id, pollUpdate: poll });
  } catch (err) {
    emitProxyError(err);
  }
}

/** Muting stays with the guest: the owner's notification settings never change */
export async function updateChatNotifySettings({ chat, settings }: MethodArgs<'updateChatNotifySettings'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer || settings.mutedUntil === undefined) return;
  emitProxyUpdate({ '@type': 'updateChatNotifySettings', chatId: chat.id, settings });
  await pxgRpc.call('chats.mute', { ...peer, mutedUntil: settings.mutedUntil }).catch(emitProxyError);
}

/** Pins and the archive belong to the guest's own chat list and are shared by all of their devices */
export async function toggleChatPinned({ chat, shouldBePinned }: MethodArgs<'toggleChatPinned'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await pxgRpc.call('chats.pin', { ...peer, pinned: shouldBePinned });
    emitProxyUpdate({ '@type': 'updateChatPinned', id: chat.id, isPinned: shouldBePinned });
  } catch (err) {
    emitProxyError(err);
  }
}

/** Moving between the list and the archive drops the pin: each list has its own pinned chats */
export async function toggleChatArchived({ chat, folderId }: MethodArgs<'toggleChatArchived'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  try {
    await pxgRpc.call('chats.archive', { ...peer, archived: folderId === ARCHIVED_FOLDER_ID });
  } catch (err) {
    emitProxyError(err);
    return undefined;
  }
  emitProxyUpdate({ '@type': 'updateChatPinned', id: chat.id, isPinned: false });
  emitProxyUpdate({ '@type': 'updateChatListType', id: chat.id, folderId });
  return true as const;
}

/** «Unread» is the guest's own mark: the owner's Telegram stays as it is */
export async function toggleDialogUnread({ chat, hasUnreadMark }: MethodArgs<'toggleDialogUnread'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await pxgRpc.call('chats.markUnread', { ...peer, unread: Boolean(hasUnreadMark) });
    emitProxyUpdate({
      '@type': 'updateThreadReadState', chatId: chat.id, threadId: MAIN_THREAD_ID, readState: { hasUnreadMark },
    });
  } catch (err) {
    emitProxyError(err);
  }
}

/** A draft stays with the guest on all of their devices and never reaches the owner's Telegram */
export async function saveDraft({ chat, draft }: MethodArgs<'saveDraft'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const replyInfo = draft?.replyInfo?.type === 'message' ? draft.replyInfo : undefined;
  // A comment thread's draft stays on this device: the server keeps drafts of chats and forum topics only
  if (!chat.isForum && replyInfo?.replyToTopId) return true;
  const topicId = chat.isForum ? replyInfo?.replyToTopId : undefined;
  const replyToMsgId = replyInfo?.replyToMsgId !== topicId ? replyInfo?.replyToMsgId : undefined;
  await pxgRpc.call('drafts.save', {
    ...peer, topicId, text: draft?.text?.text || '', entities: draft?.text?.entities, replyToMsgId,
  });
  return true;
}

export function emitProxyError(err: unknown) {
  emitProxyUpdate({ '@type': 'error', error: { message: err instanceof Error ? err.message : 'Unknown error' } });
}

async function readSentMessage(chat: NonNullable<MethodArgs<'sendMessage'>[0]['chat']>, msgId: number) {
  const peer = resolveProxyPeer(chat.id)!;
  const result = await pxgRpc.call<{ messages: MessageDto[] }>('messages.window', { ...peer, msgIds: [msgId] });
  const dto = result.messages[0];
  if (!dto) return undefined;
  // A poll lives in its own part of the state: the message alone would show an empty one
  const poll = buildProxyPoll(dto);
  if (poll) emitProxyUpdate({ '@type': 'updateMessagePoll', pollId: poll.summary.id, pollUpdate: poll });
  return buildProxyMessage(dto, chat);
}

/** In a private chat either side pins; in a group or channel the server checks the owner's admin rights */
export async function pinMessage({ chat, messageId, isUnpin, isSilent }: MethodArgs<'pinMessage'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  await runProxyJob('messages.pin', { ...peer, msgId: messageId, unpin: isUnpin, silent: isSilent || undefined });
  emitProxyUpdate({ '@type': 'updatePinnedIds', chatId: chat.id, messageIds: [messageId], isPinned: !isUnpin });
}

/** Title, description and photo of the owner's group or channel: an admin action of the guest */
export async function updateChatTitle(chat: MethodArgs<'updateChatTitle'>[0], title: string) {
  await editProxyChat(chat.id, { title });
}

export async function updateChatAbout(chat: MethodArgs<'updateChatAbout'>[0], about: string) {
  await editProxyChat(chat.id, { about });
}

export async function editChatPhoto({ chatId, photo }: MethodArgs<'editChatPhoto'>[0]) {
  const peer = resolveProxyPeer(chatId);
  // Only a new file: restoring an old photo needs its Telegram ID
  if (!peer || !(photo instanceof File)) return undefined;
  const { uploadId } = await uploadFile(photo, peer, MAX_CHAT_PHOTO_BYTES);
  await editProxyChat(chatId, { photo: { uploadId } });
  return true;
}

async function editProxyChat(chatId: string, changes: Record<string, unknown>) {
  const peer = resolveProxyPeer(chatId);
  if (!peer) return;
  await runProxyJob('chats.edit', { ...peer, ...changes });
}

/** Removing a member is banning them from viewing the chat; partial restrictions are not exposed to a guest */
export async function updateChatMemberBannedRights({
  chat, peer, bannedRights,
}: MethodArgs<'updateChatMemberBannedRights'>[0]) {
  const proxy = resolveProxyPeer(chat.id);
  const target = resolveProxyPeer(peer.id);
  if (!proxy || !target) return undefined;
  await runProxyJob('chats.ban', { ...proxy, userId: target.peerId, banned: Boolean(bannedRights.viewMessages) });
  return true as const;
}

/** Topics of the owner's forum: the guest manages them with the owner's rights there */
export async function createTopic({
  chat, title, iconColor, iconEmojiId,
}: MethodArgs<'createTopic'>[0]): Promise<number | undefined> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  const result = await runProxyJob('topics.create', {
    ...peer, title, iconColor, iconEmojiId: parseOwnerEmojiId(iconEmojiId, peer.accountId),
  }) as { topicId?: number } | undefined;
  return result?.topicId;
}

export async function editTopic({
  chat, topicId, title, iconEmojiId, isClosed, isHidden,
}: MethodArgs<'editTopic'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  await runProxyJob('topics.edit', {
    ...peer,
    topicId,
    title,
    // Web A passes '0' to remove the icon, as Telegram does
    iconEmojiId: iconEmojiId === '0' ? iconEmojiId : parseOwnerEmojiId(iconEmojiId, peer.accountId),
    closed: isClosed,
    hidden: isHidden,
  });
  return true as const;
}

export async function togglePinnedTopic({ chat, topicId, isPinned }: MethodArgs<'togglePinnedTopic'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  await runProxyJob('topics.pin', { ...peer, topicId, pinned: isPinned });
  return true as const;
}

export async function deleteTopic({ chat, topicId }: MethodArgs<'deleteTopic'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  await runProxyJob('topics.delete', { ...peer, topicId });
}

/** A topic icon from the owner's emoji is sent as its Telegram document ID */
function parseOwnerEmojiId(id: string | undefined, accountId: string) {
  if (!id) return undefined;
  const catalog = parseProxyCatalogId(id);
  return catalog?.accountId === accountId ? catalog.documentId : undefined;
}
