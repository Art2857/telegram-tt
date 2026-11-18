import { getGlobal } from '../../global';

import type { MessageDto, ScheduledMessageDto } from '../../proxygram/server/types';
import type { MethodArgs, Methods } from '../gramjs/methods/types';
import type {
  ApiAttachment, ApiChat, ApiMessage, ApiMessageEntity, ApiOnProgress, ApiPeer,
} from '../types';
import type { SavedNoteInput } from './saved';
import type { QueuedSend, SendRequest } from './sendQueue';
import { PxgError } from '../../proxygram/server/types';
import { MAIN_THREAD_ID } from '../types';

import { ARCHIVED_FOLDER_ID, LOCAL_MESSAGES_LIMIT } from '../../config';
import buildUploadingMedia from '../../util/buildUploadingMedia';
import { getMessageKey } from '../../util/keys/messageKey';
import { getTranslationFn } from '../../util/localization';
import { pause } from '../../util/schedulers';
import { getServerTime } from '../../util/serverTime';
import { getPxgErrorMessage } from '../../proxygram/errorReasons';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState, subscribePxg } from '../../proxygram/server/store';
import { uploadFile, uploadSavedFile } from '../../proxygram/server/upload';
import { buildProxyMessage, buildProxyPoll, setProxyUserPaidStars } from './builders';
import { buildProxyEntities, buildProxyInputEntities } from './entities';
import { emitProxyUpdate, resolveProxyPeer } from './index';
import { parseProxyCatalogId } from './mediaIds';
import { runProxyJob } from './outbox';
import {
  deleteSaved, editSavedNote, isSavedPeer, pinSaved, saveToSaved, sendSavedNote, tagSaved,
} from './saved';
import {
  dropQueuedSend, findQueuedSendByLocalId, getQueuedSend, getQueuedSends, loadSendQueue, putQueuedSend,
  restoreAttachment, storeDraft, updateQueuedSend,
} from './sendQueue';

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
type SendChat = NonNullable<SendParams['chat']>;
type SendPeer = NonNullable<ReturnType<typeof resolveProxyPeer>>;

/** Parameters of the sends started in this tab: a retry needs the file again, and the page still holds it */
const paramsByRequestId = new Map<string, SendParams>();
/** Sends being delivered now, by this tab's composer or by the queue: nobody starts them a second time */
const inFlight = new Set<string>();

type AlbumPart = { localMessage: ApiMessage; request: SendRequest };
/** Albums being uploaded: how many parts Web A has started and which of them are ready */
const albums = new Map<string, { expected: number; parts: Map<number, AlbumPart> }>();

/** A failure that passes by itself: the message keeps its clock and goes when the server is reachable again */
const TRANSIENT_ERRORS = new Set([
  'disconnected', 'timeout', 'network', 'unauthorized', 'rate_limited', 'access_changed', 'http_0', 'http_408',
  'http_429', 'http_500', 'http_502', 'http_503', 'http_504',
]);
const PUMP_RETRY_MIN_MS = 2000;
const PUMP_RETRY_MAX_MS = 60_000;

/** The message the guest sees until the server confirms it; the same one waits for a paid send to start */
function buildLocalMessage(params: SendParams, chat: ApiChat, requestId: string): ApiMessage {
  const {
    attachment, text, entities, replyInfo, sticker, gif, poll, todo, dice, scheduledAt, scheduleRepeatPeriod, effectId,
    sendAs, groupedId,
  } = params;
  const isScheduled = Boolean(scheduledAt);
  const messageReply = replyInfo?.type === 'message' ? replyInfo : undefined;
  const topicId = chat.isForum ? messageReply?.replyToTopId : undefined;
  // The file shows at once with its upload progress, as in Telegram
  const media = attachment && !attachment.ttlSeconds ? buildUploadingMedia(attachment) : undefined;
  const caption = poll?.summary.question.text || todo?.todo.title.text || dice || text
    || (media ? '' : attachment?.filename) || '';
  return {
    id: (params.lastMessageId || 0) + (++localCounter / LOCAL_MESSAGES_LIMIT),
    chatId: chat.id, date: scheduledAt || getServerTime(), isOutgoing: true,
    isScheduled: isScheduled || undefined,
    scheduleRepeatPeriod: isScheduled ? scheduleRepeatPeriod : undefined,
    pxgSentByUserId: getPxgState().session?.user.id,
    pxgIsOwn: true,
    content: sticker ? { sticker } : gif ? { video: gif } : {
      ...media,
      // A poll, a checklist, a rich message and a dice appear as they are once Telegram has them; until then text stands in
      richMessage: params.richMessage && {
        blocks: params.richMessage.blocks,
        isRtl: params.richMessage.isRtl,
      },
      text: caption ? { text: caption, entities } : undefined,
      todo: todo && { mediaType: 'todo', todo: todo.todo },
    },
    sendingState: 'messageSendingStatePending',
    replyInfo: messageReply && { ...messageReply, isForumTopic: topicId ? true : undefined },
    effectId,
    senderId: sendAs?.id,
    ...(groupedId && { groupedId, ...(media && (media.photo || media.video) && { isInAlbum: true }) }),
    pxgSendRequest: { id: requestId },
  };
}

/**
 * A paid message is shown first and sent once the guest has confirmed the price: Web A sends it with this local
 * message right after, and the key stays with it
 */
export async function sendMessageLocal(params: SendParams) {
  const { chat } = params;
  if (!chat || !resolveProxyPeer(chat.id)) return undefined;
  const localMessage = buildLocalMessage(params, chat, crypto.randomUUID());
  emitProxyUpdate({
    '@type': localMessage.isScheduled ? 'newScheduledMessage' : 'newMessage',
    id: localMessage.id,
    chatId: chat.id,
    message: localMessage,
  });
  // GramJS types the local message narrower than ApiMessage; the shape is the same
  return Promise.resolve(localMessage) as ReturnType<Methods['sendMessageLocal']>;
}

/**
 * The guest's send (docs/spec/11 C9): the message shows at once and is kept on the device until the server confirms
 * it. Without the server it waits with the clock, outlives a reload and goes by itself in the order it was written
 */
export async function sendMessage(params: SendParams, onProgress?: ApiOnProgress): Promise<void> {
  const { chat } = params;
  const peer = chat && resolveProxyPeer(chat.id);
  if (!chat || !peer) return;
  // The key stays with the local message: the server sends one message per key however often it is repeated
  const requestId = params.localMessage?.pxgSendRequest?.id || crypto.randomUUID();
  const localMessage: ApiMessage = params.localMessage || buildLocalMessage(params, chat, requestId);
  if (!params.localMessage) {
    emitProxyUpdate({
      '@type': localMessage.isScheduled ? 'newScheduledMessage' : 'newMessage',
      id: localMessage.id,
      chatId: chat.id,
      message: localMessage,
    });
  } else if (!params.localMessage.pxgSendRequest) {
    updateLocalMessage(localMessage, { pxgSendRequest: { id: requestId } });
  }
  paramsByRequestId.set(requestId, params);
  queueSend(params, chat, localMessage, requestId);
  // An earlier message of this chat still waits, or there is no connection: the queue keeps the order
  if (!pxgRpc.isConnected || hasEarlierWaiting(chat.id, requestId)) {
    void pumpQueue();
    return;
  }
  await deliverSend(params, chat, peer, localMessage, requestId, onProgress);
}

/** The send goes to the device's queue first: closing the tab does not lose it */
function queueSend(params: SendParams, chat: ApiChat, localMessage: ApiMessage, requestId: string) {
  const userId = getPxgState().session?.user.id;
  if (!userId || getQueuedSend(requestId) || (params.attachment && params.attachment.ttlSeconds)) return;
  putQueuedSend({
    userId,
    requestId,
    chatId: chat.id,
    createdAt: Date.now(),
    localMessage: omitBlobUrls(localMessage),
    groupedId: params.groupedId,
  });
  void storeDraft(params).then((draft) => {
    if (draft) updateQueuedSend(requestId, { draft });
  });
}

function hasEarlierWaiting(chatId: string, requestId: string) {
  const own = getQueuedSend(requestId);
  return getQueuedSends().some((item) => (
    item.chatId === chatId && item.requestId !== requestId && !item.error && !inFlight.has(item.requestId)
    && (!own || item.createdAt <= own.createdAt)
  ));
}

/** Blob URLs die with the page: the stored message gets its media back from the stored file */
function omitBlobUrls(message: ApiMessage): ApiMessage {
  const { photo, video, document, audio, voice } = message.content;
  if (!photo && !video && !document && !audio && !voice) return message;
  const {
    photo: _photo, video: _video, document: _document, audio: _audio, voice: _voice, ...content
  } = message.content;
  return { ...message, content };
}

async function deliverSend(
  params: SendParams, chat: SendChat, peer: SendPeer, localMessage: ApiMessage, requestId: string,
  onProgress?: ApiOnProgress, isRetry?: boolean,
): Promise<string | undefined> {
  // Web A starts every part of an album at once; the slot is taken before any of them uploads
  const albumSlot = !isSavedPeer(peer) && params.groupedId && params.attachment
    ? reserveAlbumSlot(params.groupedId) : undefined;
  inFlight.add(requestId);
  let request: SendRequest | undefined;
  try {
    request = await buildSendRequest(params, chat, peer, localMessage, requestId, onProgress);
    if (albumSlot !== undefined) {
      await joinAlbum(chat, params.groupedId!, albumSlot, { localMessage, request });
      return undefined;
    }
    await completeSend(chat, localMessage, request, isRetry);
    return undefined;
  } catch (err) {
    // A part that did not upload leaves the album; the rest still go together
    if (albumSlot !== undefined && !request) void joinAlbum(chat, params.groupedId!, albumSlot);
    return failSend(chat, localMessage, requestId, err);
  } finally {
    inFlight.delete(requestId);
  }
}

/** Uploads the file and fixes the request: from now on a retry repeats it byte for byte */
async function buildSendRequest(
  params: SendParams, chat: SendChat, peer: SendPeer, localMessage: ApiMessage, requestId: string,
  onProgress?: ApiOnProgress,
): Promise<SendRequest> {
  const {
    attachment, text, entities, replyInfo, sticker, gif, poll, todo, dice, scheduledAt, scheduleRepeatPeriod,
    effectId, sendAs,
  } = params;
  const isScheduled = Boolean(scheduledAt);
  const queued = getQueuedSend(requestId);
  if (queued?.request?.params) return queued.request;
  // In a forum topic Web A replies to the topic's first message: that is the topic, not a quoted reply
  const messageReply = replyInfo?.type === 'message' ? replyInfo : undefined;
  // "Reply in another chat": the replied message lives in that chat. Its `replyToTopId` is a topic of the SOURCE
  // chat, not of the target, so it must not leak into the outgoing topic/thread below
  const otherChatId = messageReply?.replyToPeerId && messageReply.replyToPeerId !== chat.id
    ? messageReply.replyToPeerId : undefined;
  const topicId = chat.isForum && !otherChatId ? messageReply?.replyToTopId : undefined;
  // Outside a forum it is a comment thread: the reply itself places the message, and the chat's draft stays
  const threadId = !chat.isForum && !otherChatId ? messageReply?.replyToTopId : undefined;
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
  if (isSavedPeer(peer) && (isScheduled || poll || dice || params.todo || params.richMessage)) {
    throw new PxgError('unsupported');
  }
  // The owner's sticker or GIF must come from the catalog of the chat's provider account; Saved Messages take one
  // from the catalog of any owner who lets the guest use stickers, and the server checks that right
  const catalogItem = sticker || gif ? parseProxyCatalogId((sticker || gif)!.id) : undefined;
  if ((sticker || gif) && (!catalogItem || (!isSavedPeer(peer) && catalogItem.accountId !== peer.accountId))) {
    throw new PxgError('unsupported');
  }
  let file: Record<string, unknown> | undefined;
  if (attachment) {
    // Self-destructing media is never sent through the server: the archive could not honor the timer
    if (attachment.ttlSeconds) throw new PxgError('unsupported');
    const uploaded = await uploadAttachment(chat, attachment, { localMessage, requestId }, onProgress);
    const { voice, quick, isRoundVideo } = attachment;
    file = {
      uploadId: uploaded.uploadId,
      kind: isSavedPeer(peer) ? getSavedFileKind(attachment) : voice ? 'voice' : isRoundVideo ? 'round' : undefined,
      duration: voice?.duration ?? attachment.audio?.duration ?? quick?.duration,
      waveform: voice?.waveform.slice(0, MAX_WAVEFORM_LENGTH),
      width: isRoundVideo || isSavedPeer(peer) ? quick?.width : undefined,
      height: isRoundVideo || isSavedPeer(peer) ? quick?.height : undefined,
    };
  }
  if (onProgress?.isCanceled) throw new PxgError('canceled');
  const request: SendRequest = {
    id: requestId,
    params: {
      ...peer,
      text: text || '',
      entities: buildProxyInputEntities(entities, peer.accountId, chat.pxgProxy?.permissions.useOwnerStickers),
      richMessage: params.richMessage && {
        blocks: params.richMessage.blocks,
        isRtl: params.richMessage.isRtl,
      },
      file,
      groupedId: isSavedPeer(peer) ? params.groupedId : undefined,
      document: catalogItem && !isSavedPeer(peer) ? { documentId: catalogItem.documentId } : undefined,
      sticker: catalogItem && isSavedPeer(peer)
        ? { accountId: catalogItem.accountId, documentId: catalogItem.documentId } : undefined,
      poll: poll && {
        question: poll.summary.question.text,
        answers: poll.summary.answers.map(({ text: answer }) => answer.text),
        isPublic: poll.summary.isPublic,
        isMultipleChoice: poll.summary.isMultipleChoice,
        canAddAnswers: poll.summary.canAddAnswers,
        isRevoteDisabled: poll.summary.isRevoteDisabled,
        shouldShuffleAnswers: poll.summary.shouldShuffleAnswers,
        shouldHideResults: poll.summary.shouldHideResultsUntilClose,
        // Telegram 2026: несколько правильных ответов, срок закрытия, только подписчики, страны
        correctAnswers: poll.correctAnswers,
        correctAnswer: poll.summary.isQuiz ? poll.correctAnswers?.[0] : undefined,
        solution: poll.solution,
        closePeriod: poll.summary.closePeriod,
        closeDate: poll.summary.closeDate,
        subscribersOnly: poll.summary.isRestrictedToSubscribers,
        countriesIso2: poll.summary.allowedCountryCodes,
      },
      todo: todo && {
        title: todo.todo.title.text,
        items: todo.todo.items.map(({ id, title }) => ({ id, title: title.text })),
        othersCanAppend: todo.todo.othersCanAppend,
        othersCanComplete: todo.todo.othersCanComplete,
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
      // The price the guest confirmed: the server spends no more of the owner's Stars than this
      paidStars: isSavedPeer(peer) ? undefined : params.messagePriceInStars,
    },
  };
  // The exact request survives a reload: a retry repeats it byte for byte, so the server recognizes the key
  updateQueuedSend(requestId, { request });
  updateLocalMessage(localMessage, { pxgSendRequest: request });
  return request;
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
async function joinAlbum(chat: SendChat, groupedId: string, slot: number, part?: AlbumPart) {
  const album = albums.get(groupedId);
  if (!album) return;
  if (part) album.parts.set(slot, part);
  else album.expected--;
  if (album.parts.size < album.expected) return;
  albums.delete(groupedId);
  const parts = [...album.parts].sort(([a], [b]) => a - b).map(([, ready]) => ready);
  await sendAlbumParts(chat, parts);
}

/** Returns the error of a final failure; a transient one leaves the parts waiting in the queue */
async function sendAlbumParts(chat: SendChat, parts: AlbumPart[], isRetry?: boolean): Promise<string | undefined> {
  if (!parts.length) return undefined;
  if (parts.length === 1) {
    const [{ localMessage, request }] = parts;
    inFlight.add(request.id);
    try {
      await completeSend(chat, localMessage, request, isRetry);
      return undefined;
    } catch (err) {
      return failSend(chat, localMessage, request.id, err);
    } finally {
      inFlight.delete(request.id);
    }
  }
  const {
    text: firstText, entities: firstEntities, file: firstFile, paidStars: firstPaidStars, ...common
  } = parts[0].request.params!;
  // Telegram charges every part of a paid album
  const paidStars = parts.reduce((sum, { request }) => sum + (Number(request.params!.paidStars) || 0), 0);
  parts.forEach(({ request }) => inFlight.add(request.id));
  try {
    const { msgIds } = await runProxyJob('messages.send', {
      ...common,
      paidStars: paidStars || undefined,
      text: '',
      album: parts.map(({ request }) => {
        const { text, entities, file } = request.params!;
        return { file, text, entities };
      }),
      clientRequestId: parts[0].request.id,
      retry: isRetry,
    }) as { msgIds: number[] };
    for (const [index, { localMessage, request }] of parts.entries()) {
      await emitSent(chat, localMessage, msgIds[index]);
      forgetSend(request.id);
    }
    return undefined;
  } catch (err) {
    return parts.reduce<string | undefined>((error, { localMessage, request }) => (
      failSend(chat, localMessage, request.id, err) ?? error
    ), undefined);
  } finally {
    parts.forEach(({ request }) => inFlight.delete(request.id));
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
  const queued = getQueuedSend(request.id);
  if (queued) {
    updateQueuedSend(request.id, { error: undefined, isRetry: true, localMessage: omitBlobUrls(pending) });
    // An earlier message of this chat still waits: this one goes after it
    if (!pxgRpc.isConnected || hasEarlierWaiting(chat.id, request.id)) {
      void pumpQueue();
      return undefined;
    }
    return deliverQueued(getQueuedSend(request.id)!);
  }
  try {
    await completeSend(chat, pending, request, true);
    return undefined;
  } catch (err) {
    emitSendFailed(chat, pending, err);
    return getErrorMessage(err);
  }
}

/** Without the fixed request only a file still held by this page or the device's queue can be sent again */
export function canRetrySendMessage(message: ApiMessage) {
  const request = message.pxgSendRequest;
  if (!request) return false;
  const queued = getQueuedSend(request.id);
  return Boolean(request.params || paramsByRequestId.has(request.id) || queued?.request || queued?.draft);
}

async function completeSend(chat: SendChat, localMessage: ApiMessage, request: SendRequest, isRetry?: boolean) {
  // A note in one's own Saved Messages goes to the server, not to anybody's Telegram
  if (isSavedPeer(chat.pxgProxy)) {
    const params = request.params as SavedNoteInput;
    const note = await sendSavedNote(chat, {
      text: params.text, entities: params.entities, file: params.file, sticker: params.sticker,
      groupedId: params.groupedId, clientRequestId: request.id,
    });
    emitProxyUpdate({
      '@type': 'updateMessageSendSucceeded', chatId: chat.id, localId: localMessage.id, message: note,
    });
    forgetSend(request.id);
    return;
  }
  const result = await runProxyJob('messages.send', {
    ...request.params, clientRequestId: request.id, retry: isRetry,
  }) as { msgId: number };
  await emitSent(chat, localMessage, result.msgId);
  forgetSend(request.id);
}

/** Sent or given up: nothing of it stays on the device */
function forgetSend(requestId: string) {
  paramsByRequestId.delete(requestId);
  dropQueuedSend(requestId);
}

/**
 * A transient failure keeps the message pending in the queue; a refusal marks it failed with its reason and
 * "Retry". Returns the error shown for a final failure
 */
function failSend(chat: SendChat, localMessage: ApiMessage, requestId: string, err: unknown): string | undefined {
  const code = err instanceof PxgError ? err.code : undefined;
  const reason = getErrorMessage(err);
  const queued = getQueuedSend(requestId);
  if (code === 'canceled' || code === 'unsupported') {
    forgetSend(requestId);
    emitSendFailed(chat, localMessage, err);
    return reason;
  }
  // The server dropped the unfinished upload: the stored file is uploaded again
  if (reason === 'upload_missing' && queued?.draft) {
    updateQueuedSend(requestId, { request: undefined, uploadId: undefined });
    schedulePump();
    return undefined;
  }
  if (queued && code && TRANSIENT_ERRORS.has(code) && getPxgState().session?.user.id === queued.userId) {
    schedulePump();
    return undefined;
  }
  updateQueuedSend(requestId, { error: reason, isRetry: undefined });
  emitSendFailed(chat, localMessage, err);
  return reason;
}

let isPumping = false;
let pumpTimer: ReturnType<typeof setTimeout> | undefined;
let pumpDelay = PUMP_RETRY_MIN_MS;
let isQueueStarted = false;

/** The queue goes when the server answers: right away after a reconnect, otherwise with a growing pause */
function schedulePump() {
  if (pumpTimer) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = undefined;
    void pumpQueue();
  }, pumpDelay);
  pumpDelay = Math.min(pumpDelay * 2, PUMP_RETRY_MAX_MS);
}

/** Waiting sends go one by one in the order they were written; an album goes as one message */
async function pumpQueue() {
  if (isPumping || !isQueueStarted) return;
  isPumping = true;
  try {
    while (pxgRpc.isConnected) {
      const next = getQueuedSends().find((item) => !item.error && !inFlight.has(item.requestId));
      if (!next) {
        pumpDelay = PUMP_RETRY_MIN_MS;
        break;
      }
      await deliverQueued(next);
      // Still waiting after the attempt: the server is not answering, the timer brings the next attempt
      if (getQueuedSend(next.requestId) && !getQueuedSend(next.requestId)!.error) break;
    }
  } finally {
    isPumping = false;
  }
}

/** One waiting send, or the whole album it belongs to. Returns the error of a final failure */
async function deliverQueued(item: QueuedSend): Promise<string | undefined> {
  const chat = getGlobal().chats.byId[item.chatId];
  const peer = chat && resolveProxyPeer(chat.id);
  if (!chat || !peer) {
    // The chat is gone with its access: there is nobody to send it to
    forgetSend(item.requestId);
    return undefined;
  }
  const group = item.groupedId && !isSavedPeer(peer)
    ? getQueuedSends().filter((part) => (
      part.groupedId === item.groupedId && part.chatId === item.chatId && !part.error && !inFlight.has(part.requestId)
    ))
    : [item];
  if (group.length === 1 && !item.groupedId) {
    const params = getSendParams(item, chat);
    if (!item.request?.params && !params) {
      forgetSend(item.requestId);
      emitSendFailed(chat, item.localMessage, new PxgError('upload_missing', undefined, 'upload_missing'));
      return 'upload_missing';
    }
    const localMessage = item.localMessage;
    if (item.request?.params) {
      inFlight.add(item.requestId);
      try {
        await completeSend(chat, localMessage, item.request, item.isRetry);
        return undefined;
      } catch (err) {
        return failSend(chat, localMessage, item.requestId, err);
      } finally {
        inFlight.delete(item.requestId);
      }
    }
    return deliverSend(params!, chat, peer, localMessage, item.requestId, undefined, item.isRetry);
  }
  // Every part uploads first, then the album goes as one message, as in the composer
  const parts: AlbumPart[] = [];
  for (const part of group) {
    if (part.request?.params) {
      parts.push({ localMessage: part.localMessage, request: part.request });
      continue;
    }
    const params = getSendParams(part, chat);
    if (!params) {
      forgetSend(part.requestId);
      emitSendFailed(chat, part.localMessage, new PxgError('upload_missing', undefined, 'upload_missing'));
      continue;
    }
    inFlight.add(part.requestId);
    try {
      const request = await buildSendRequest(params, chat, peer, part.localMessage, part.requestId);
      parts.push({ localMessage: part.localMessage, request });
    } catch (err) {
      const error = failSend(chat, part.localMessage, part.requestId, err);
      // Not uploaded for now: the album waits for this part rather than going without it
      if (!error) return undefined;
    } finally {
      inFlight.delete(part.requestId);
    }
  }
  return sendAlbumParts(chat, parts, group.some((part) => part.isRetry));
}

/** The parameters of a send: the page's own, or the stored ones with the file read back from the device */
function getSendParams(item: QueuedSend, chat: ApiChat): SendParams | undefined {
  const own = paramsByRequestId.get(item.requestId);
  if (own) return { ...own, chat, localMessage: item.localMessage };
  if (!item.draft) return undefined;
  const { attachment, ...rest } = item.draft;
  const params = {
    ...rest, chat, localMessage: item.localMessage, attachment: attachment && restoreAttachment(attachment),
  } as SendParams;
  paramsByRequestId.set(item.requestId, params);
  return params;
}

/**
 * The queue of the previous session shows in the feed: waiting messages with the clock, refused ones with their
 * reason. Called once the chats are on screen, also without a connection
 */
export async function showQueuedSends() {
  const userId = getPxgState().session?.user.id;
  if (!userId) return;
  await loadSendQueue(userId);
  if (getPxgState().session?.user.id !== userId) return;
  const global = getGlobal();
  getQueuedSends().forEach((item) => {
    const chat = global.chats.byId[item.chatId];
    if (!chat || inFlight.has(item.requestId)) return;
    const localId = item.localMessage.id;
    // Local IDs of this page must not collide with the restored ones
    localCounter = Math.max(localCounter, Math.round((localId % 1) * LOCAL_MESSAGES_LIMIT));
    const params = getSendParams(item, chat);
    const media = params?.attachment && buildUploadingMedia(params.attachment);
    const message: ApiMessage = {
      ...item.localMessage,
      content: media ? { ...item.localMessage.content, ...media } : item.localMessage.content,
      sendingState: item.error ? 'messageSendingStateFailed' : 'messageSendingStatePending',
      pxgSendRequest: item.request ?? { id: item.requestId },
    };
    emitProxyUpdate({
      '@type': message.isScheduled ? 'newScheduledMessage' : 'newMessage',
      id: message.id,
      chatId: chat.id,
      message,
    });
    if (item.error) {
      emitProxyUpdate({
        '@type': message.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
        chatId: chat.id,
        localId: message.id,
        error: item.error,
      });
    }
  });
}

/**
 * The chats came from the server: sends to chats that are no longer shared are dropped, the rest go out.
 * From now on a reconnect sends the queue by itself
 */
export async function startSendQueue(allowedChatIds: Set<string>) {
  const userId = getPxgState().session?.user.id;
  if (!userId) return;
  await loadSendQueue(userId);
  if (getPxgState().session?.user.id !== userId) return;
  if (!isQueueStarted) await showQueuedSends();
  getQueuedSends().forEach((item) => {
    if (!allowedChatIds.has(item.chatId)) forgetSend(item.requestId);
  });
  isQueueStarted = true;
  void pumpQueue();
}

/** A failed or waiting message deleted by the guest is never sent */
export function forgetLocalSends(chatId: string, messageIds: number[]) {
  messageIds.forEach((id) => {
    const queued = findQueuedSendByLocalId(chatId, id);
    if (queued) forgetSend(queued.requestId);
  });
}

subscribePxg(() => {
  const { connection, session } = getPxgState();
  if (!session) {
    isQueueStarted = false;
    return;
  }
  if (connection === 'online') {
    pumpDelay = PUMP_RETRY_MIN_MS;
    void pumpQueue();
  }
});

/** The local message gives way to the one Telegram has */
async function emitSent(chat: SendChat, localMessage: ApiMessage, msgId: number | undefined) {
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
  const error = getErrorMessage(err);
  emitProxyUpdate({
    '@type': localMessage.isScheduled ? 'updateScheduledMessageSendFailed' : 'updateMessageSendFailed',
    chatId: chat.id,
    localId: localMessage.id,
    error,
  });
  // Telegram named a higher price: the next send asks the guest to confirm that one
  const price = Number(error.match(/^ALLOW_PAYMENT_REQUIRED_(\d+)$/)?.[1]);
  if (price) updateProxyPaidStars(chat.id, price);
}

/** A new price of a message in the chat: on the chat, and for a person also on the user and the profile */
export function updateProxyPaidStars(chatId: string, stars?: number) {
  const peer = resolveProxyPeer(chatId);
  if (!peer) return;
  emitProxyUpdate({ '@type': 'updateChat', id: chatId, chat: { paidMessagesStars: stars } });
  if (peer.peerId < 0) return;
  setProxyUserPaidStars(peer.accountId, peer.peerId, stars);
  emitProxyUpdate({ '@type': 'updateUser', id: chatId, user: { paidMessagesStars: stars } });
  emitProxyUpdate({ '@type': 'updateUserFullInfo', id: chatId, fullInfo: { paidMessagesStars: stars } });
}

/** A refusal of the server travels as its reason: the failed message shows it in the interface language */
function getErrorMessage(err: unknown) {
  if (err instanceof PxgError && err.reason) return err.reason;
  if (err instanceof PxgError) return err.code;
  return err instanceof Error ? err.message : 'Send failed';
}

/** The upload continues where the previous attempt stopped, also after a reload */
async function uploadAttachment(
  chat: ApiChat, attachment: ApiAttachment, send?: { localMessage: ApiMessage; requestId: string },
  onProgress?: ApiOnProgress,
) {
  const blob = attachment.blob || await (await fetch(attachment.compressedBlobUrl || attachment.blobUrl)).blob();
  const upload = new File([blob], attachment.filename, { type: blob.type || attachment.mimeType });
  const maxBytes = chat.pxgProxy?.maxUploadBytes ?? 0;
  // Web A finds the upload by the message: its progress shows on the message and "Cancel" stops it
  const messageKey = send && getMessageKey(send.localMessage);
  const report = (fraction: number) => onProgress?.(fraction, messageKey);
  if (isSavedPeer(chat.pxgProxy)) return uploadSavedFile(upload, maxBytes, report);
  const requestId = send?.requestId;
  return uploadFile(upload, resolveProxyPeer(chat.id)!, maxBytes, report, requestId ? {
    resumeUploadId: getQueuedSend(requestId)?.uploadId,
    onStarted: (uploadId) => updateQueuedSend(requestId, { uploadId }),
    isCanceled: () => Boolean(onProgress?.isCanceled),
  } : undefined);
}

function getSavedFileKind(attachment: ApiAttachment) {
  if (attachment.voice) return 'voice';
  if (attachment.isRoundVideo) return 'round';
  if (attachment.shouldSendAsFile) return 'document';
  if (attachment.audio) return 'audio';
  if (attachment.mimeType === 'image/gif' || attachment.gif) return 'gif';
  if (attachment.quick && attachment.mimeType.startsWith('image/')) return 'photo';
  if (attachment.quick && attachment.mimeType.startsWith('video/')) return 'video';
  return 'document';
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
  chat, message, attachment, text, entities, richMessage,
}: MethodArgs<'editMessage'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  if (message.isScheduled) {
    if (richMessage) {
      emitProxyError(new PxgError('unsupported'));
      return;
    }
    await editScheduledMessage(chat, message, text, entities);
    return;
  }
  try {
    if (isSavedPeer(peer)) {
      if (attachment || richMessage) throw new PxgError('unsupported');
      const note = await editSavedNote(chat, message.id, text, entities);
      emitProxyUpdate({ '@type': 'updateMessage', id: note.id, chatId: chat.id, message: note, isFull: true });
      return;
    }
    await runProxyJob('messages.edit', {
      ...peer,
      msgId: message.id,
      text,
      entities: buildProxyInputEntities(entities, peer.accountId, chat.pxgProxy?.permissions.useOwnerStickers),
      richMessage: richMessage && { blocks: richMessage.blocks, isRtl: richMessage.isRtl },
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
  // A failed message that is deleted will never be retried: its file leaves the page and the device
  forgetLocalSends(chat.id, messageIds);
  try {
    if (isSavedPeer(peer)) {
      for (let offset = 0; offset < messageIds.length; offset += DELETE_BATCH_SIZE) {
        await deleteSaved(messageIds.slice(offset, offset + DELETE_BATCH_SIZE));
      }
      emitProxyUpdate({ '@type': 'deleteMessages', chatId: chat.id, ids: messageIds });
      return;
    }
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
  if (isSavedPeer(peer)) {
    await tagSaved(messageId, reactions);
    return true as const;
  }
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

/**
 * A paid Star reaction: the guest picks how many of the owner's Stars to send, and the server keeps that number
 * within the daily limit of the access. The message's new reactions come back through the archive
 */
export async function sendPaidReaction({ chat, messageId, count, isPrivate }: MethodArgs<'sendPaidReaction'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  if (isSavedPeer(peer)) throw new PxgError('unsupported');
  await runProxyJob('messages.sendPaidReaction', { ...peer, msgId: messageId, count, isPrivate });
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
  if (!peer || isSavedPeer(peer)) return;
  await pxgRpc.call('messages.readReactions', { ...peer, msgIds: messageIds.slice(0, MAX_READ_REACTIONS) })
    .catch(() => undefined);
}

export async function markMessageListRead({
  chat, threadId, maxId,
}: MethodArgs<'markMessageListRead'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  // Saved Messages have nothing unread: they are one's own
  if (!peer || isSavedPeer(peer)) return;
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
  // This changes the viewer's own read state. Delegating a read to the owner is a separate action.
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
/**
 * Web A shows paid forwards before sending them and lets the toast take them back. A guest's forward goes to the
 * owner's queue at once, after the price was confirmed in the composer: nothing local is left to show
 */
export async function forwardMessagesLocal(params: MethodArgs<'forwardMessages'>[0]) {
  await forwardMessages(params);
  return { messageIds: params.messages.map(({ id }) => id), localMessages: [] };
}

export async function forwardMessages({
  fromChat, toChat, toThreadId, messages, isSilent, noAuthors, noCaptions, sendAs, messagePriceInStars,
}: MethodArgs<'forwardMessages'>[0]): Promise<void> {
  const source = resolveProxyPeer(fromChat.id);
  const target = resolveProxyPeer(toChat.id);
  try {
    if (!source || !target) throw new PxgError('unsupported');
    // To one's own Saved Messages: a snapshot the server keeps, even after the access is revoked
    if (isSavedPeer(target) && !isSavedPeer(source)) {
      const saved = await saveToSaved(toChat, source, messages.map(({ id }) => id));
      saved.forEach((message) => {
        emitProxyUpdate({ '@type': 'newMessage', id: message.id, chatId: toChat.id, message });
      });
      return;
    }
    const topicId = toChat.isForum && toThreadId && toThreadId !== MAIN_THREAD_ID ? Number(toThreadId) : undefined;
    const sendAsPeerId = getSendAsPeerId(sendAs);
    if (source.accountId !== target.accountId) {
      const groups = new Map<string, ApiMessage[]>();
      messages.forEach((message) => {
        const key = message.groupedId ? `album:${message.groupedId}` : `message:${message.id}`;
        const group = groups.get(key) || [];
        group.push(message);
        groups.set(key, group);
      });
      for (const group of groups.values()) {
        // Parts of one album share one job; the server chooses native forwarding or copying
        const sourceParams = isSavedPeer(source) ? { ids: group.map(({ id }) => id) } : {
          fromAccountId: source.accountId, fromPeerId: source.peerId,
          msgId: group.length === 1 ? group[0].id : undefined,
          msgIds: group.length > 1 ? group.map(({ id }) => id) : undefined,
        };
        const sent = await runCopyJob({
          ...sourceParams,
          accountId: target.accountId, peerId: target.peerId,
          silent: isSilent, noCaptions, noAuthors, topicId, sendAsPeerId,
          paidStars: messagePriceInStars ? messagePriceInStars * group.length : undefined,
        }, isSavedPeer(source) ? 'saved.forward' : undefined) as { msgId?: number; msgIds?: number[] };
        for (const msgId of sent.msgIds || (sent.msgId ? [sent.msgId] : [])) {
          const saved = await readSentMessage(toChat, msgId);
          if (saved) emitProxyUpdate({ '@type': 'newMessage', id: saved.id, chatId: toChat.id, message: saved });
        }
      }
      return;
    }
    const result = await runProxyJob('messages.forward', {
      accountId: target.accountId, fromPeerId: source.peerId, peerId: target.peerId,
      msgIds: messages.map(({ id }) => id), silent: isSilent, noAuthors, noCaptions, topicId, sendAsPeerId,
      paidStars: messagePriceInStars ? messagePriceInStars * messages.length : undefined,
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
async function runCopyJob(params: unknown, method = 'messages.copy') {
  const deadline = Date.now() + COPY_WAIT_MS;
  let interval = COPY_WAIT_INTERVAL_MS;
  while (true) {
    try {
      return await runProxyJob(method, params);
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

/** An open poll (Telegram 2026): the guest suggests a new answer instead of voting */
export async function appendPollAnswer({ chat, messageId, text }: MethodArgs<'appendPollAnswer'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('polls.addAnswer', { ...peer, msgId: messageId, text });
    const result = await pxgRpc.call<{ messages: MessageDto[] }>('messages.window', {
      ...peer, msgIds: [messageId],
    });
    const poll = result.messages[0] && buildProxyPoll(result.messages[0]);
    if (poll) emitProxyUpdate({ '@type': 'updateMessagePoll', pollId: poll.summary.id, pollUpdate: poll });
  } catch (err) {
    emitProxyError(err);
  }
}

/**
 * A checklist (Telegram 2026): the guest marks items as the owner's account. Web A shows the mark at once; the
 * archive brings the real state, and a refusal shows its reason
 */
export async function toggleTodoCompleted({
  chat, messageId, completedIds, incompletedIds,
}: MethodArgs<'toggleTodoCompleted'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('todos.toggle', {
      ...peer, msgId: messageId, completed: completedIds, uncompleted: incompletedIds,
    });
  } catch (err) {
    emitProxyError(err);
  }
}

/** A checklist: add items — the list itself changes through the archive */
export async function appendTodoList({ chat, message, items }: MethodArgs<'appendTodoList'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('todos.append', { ...peer, msgId: message.id, titles: items.map(({ title }) => title.text) });
  } catch (err) {
    emitProxyError(err);
  }
}

/** A checklist: title and items change at once in the interface; a refusal restores what Telegram has */
export async function editTodo({ chat, message, todo }: MethodArgs<'editTodo'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  const optimistic: ApiMessage = {
    ...message,
    content: { ...message.content, todo: { mediaType: 'todo', todo: todo.todo } },
  };
  emitProxyUpdate({
    '@type': 'updateMessage', id: message.id, chatId: chat.id, message: optimistic, isFull: true,
  });
  try {
    await runProxyJob('todos.edit', {
      ...peer,
      msgId: message.id,
      title: todo.todo.title.text,
      items: todo.todo.items.map(({ id, title }) => ({ id, title: title.text })),
      othersCanAppend: todo.todo.othersCanAppend,
      othersCanComplete: todo.todo.othersCanComplete,
    });
  } catch (err) {
    emitProxyError(err);
    const actual = await readSentMessage(chat, message.id).catch(() => undefined);
    if (actual) {
      emitProxyUpdate({ '@type': 'updateMessage', id: message.id, chatId: chat.id, message: actual, isFull: true });
    }
  }
}

/** Muting stays with the guest: the owner's notification settings never change */
export async function updateChatNotifySettings({ chat, settings }: MethodArgs<'updateChatNotifySettings'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer || settings.mutedUntil === undefined) return;
  const previous = getGlobal().chats.notifyExceptionById[chat.id];
  emitProxyUpdate({ '@type': 'updateChatNotifySettings', chatId: chat.id, settings });
  try {
    await pxgRpc.call('chats.mute', { ...peer, mutedUntil: settings.mutedUntil });
  } catch (err) {
    // сервер отказал — возвращаем прежнее значение, а не оставляем неверный переключатель
    emitProxyUpdate({
      '@type': 'updateChatNotifySettings',
      chatId: chat.id,
      settings: previous || { mutedUntil: undefined },
    });
    emitProxyError(err);
  }
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
  // Saved Messages have no provider account: their draft stays on this device
  if (isSavedPeer(peer)) return true;
  const replyInfo = draft?.replyInfo?.type === 'message' ? draft.replyInfo : undefined;
  // "Reply in another chat": the replied message's `replyToTopId` is a topic of the SOURCE chat, not of this one
  const otherChatId = replyInfo?.replyToPeerId && replyInfo.replyToPeerId !== chat.id
    ? replyInfo.replyToPeerId : undefined;
  // A comment thread's draft stays on this device: the server keeps drafts of chats and forum topics only
  if (!chat.isForum && replyInfo?.replyToTopId) return true;
  const topicId = chat.isForum && !otherChatId ? replyInfo?.replyToTopId : undefined;
  const replyToMsgId = replyInfo?.replyToMsgId !== topicId ? replyInfo?.replyToMsgId : undefined;
  await pxgRpc.call('drafts.save', {
    ...peer,
    topicId,
    text: draft?.text?.text || '',
    // A mention carries a peer id of the owner's account: the device's own id would mean another person elsewhere
    entities: buildProxyInputEntities(
      draft?.text?.entities, peer.accountId, chat.pxgProxy?.permissions.useOwnerStickers,
    ),
    replyToMsgId,
  });
  return true;
}

export function emitProxyError(err: unknown) {
  emitProxyUpdate({ '@type': 'error', error: { message: getPxgErrorMessage(getTranslationFn(), err) } });
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
  if (isSavedPeer(peer)) {
    await pinSaved(messageId, !isUnpin);
    emitProxyUpdate({ '@type': 'updatePinnedIds', chatId: chat.id, messageIds: [messageId], isPinned: !isUnpin });
    return;
  }
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
