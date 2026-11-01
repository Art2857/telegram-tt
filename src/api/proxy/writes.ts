import type { MessageDto } from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type { ApiMessage, ApiOnProgress } from '../types';
import { PxgError } from '../../proxygram/server/types';

import { LOCAL_MESSAGES_LIMIT } from '../../config';
import { getServerTime } from '../../util/serverTime';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState } from '../../proxygram/server/store';
import { uploadFile } from '../../proxygram/server/upload';
import { buildProxyMessage } from './builders';
import { buildProxyInputEntities } from './entities';
import { emitProxyUpdate, resolveProxyPeer } from './index';
import { runProxyJob } from './outbox';

const DELETE_BATCH_SIZE = 20;
let localCounter = 0;

export async function sendMessage(params: MethodArgs<'sendMessage'>[0], onProgress?: ApiOnProgress): Promise<void> {
  const { chat, attachment, text, entities, replyInfo } = params;
  const peer = chat && resolveProxyPeer(chat.id);
  if (!chat || !peer) return;
  const localMessage: ApiMessage = params.localMessage || {
    id: (params.lastMessageId || 0) + (++localCounter / LOCAL_MESSAGES_LIMIT),
    chatId: chat.id, date: getServerTime(), isOutgoing: true,
    pxgSentByUserId: getPxgState().session?.user.id,
    pxgIsOwn: true,
    content: { text: { text: text || attachment?.filename || '', entities } },
    sendingState: 'messageSendingStatePending',
    replyInfo: replyInfo?.type === 'message' ? replyInfo : undefined,
  };
  if (!params.localMessage) {
    emitProxyUpdate({ '@type': 'newMessage', id: localMessage.id, chatId: chat.id, message: localMessage });
  }
  try {
    if (params.scheduledAt || params.sticker || params.gif || params.poll || params.todo || params.richMessage) {
      throw new PxgError('unsupported');
    }
    let file: { uploadId: string } | undefined;
    if (attachment) {
      const blob = attachment.blob || await (await fetch(attachment.compressedBlobUrl || attachment.blobUrl)).blob();
      const upload = new File([blob], attachment.filename, { type: blob.type || attachment.mimeType });
      const uploaded = await uploadFile(upload, peer, (fraction) => onProgress?.(fraction));
      file = { uploadId: uploaded.uploadId };
    }
    if (onProgress?.isCanceled) throw new PxgError('canceled');
    const result = await runProxyJob('messages.send', {
      ...peer, text: text || '', entities: buildProxyInputEntities(entities, peer.accountId), file,
      replyToMsgId: replyInfo?.type === 'message' ? replyInfo.replyToMsgId : undefined,
      silent: params.isSilent,
    }) as { msgId: number };
    const saved = await readSentMessage(chat, result.msgId);
    if (!saved) throw new PxgError('not_found');
    emitProxyUpdate({
      '@type': 'updateMessageSendSucceeded', chatId: chat.id, localId: localMessage.id, message: saved,
    });
  } catch (err) {
    emitProxyUpdate({
      '@type': 'updateMessageSendFailed', chatId: chat.id, localId: localMessage.id,
      error: err instanceof Error ? err.message : 'Send failed',
    });
  }
}

export async function editMessage({ chat, message, text, entities }: MethodArgs<'editMessage'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return;
  try {
    await runProxyJob('messages.edit', {
      ...peer, msgId: message.id, text, entities: buildProxyInputEntities(entities, peer.accountId),
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
  const reaction = reactions?.at(-1);
  if (reaction && reaction.type !== 'emoji') throw new PxgError('unsupported');
  await runProxyJob('messages.react', {
    ...peer, msgId: messageId, emoji: reaction?.type === 'emoji' ? reaction.emoticon : undefined,
  });
  return true as const;
}

export async function markMessageListRead({ chat, maxId }: MethodArgs<'markMessageListRead'>[0]): Promise<void> {
  const peer = resolveProxyPeer(chat.id);
  if (!peer || !maxId || !chat.pxgProxy?.permissions.markRead) return;
  await pxgRpc.call('messages.read', { ...peer, maxId }).catch(() => undefined);
}

export async function sendMessageAction({ peer: target, action }: MethodArgs<'sendMessageAction'>[0]) {
  const peer = resolveProxyPeer(target.id);
  if (!peer || !('pxgProxy' in target) || !target.pxgProxy?.permissions.typing) return undefined;
  if (action.type !== 'typing' && action.type !== 'cancel') return undefined;
  await pxgRpc.call('messages.typing', { ...peer, action: action.type }).catch(() => undefined);
  return true as const;
}

function emitProxyError(err: unknown) {
  emitProxyUpdate({ '@type': 'error', error: { message: err instanceof Error ? err.message : 'Unknown error' } });
}

async function readSentMessage(chat: NonNullable<MethodArgs<'sendMessage'>[0]['chat']>, msgId: number) {
  const peer = resolveProxyPeer(chat.id)!;
  const result = await pxgRpc.call<{ messages: MessageDto[] }>('messages.window', { ...peer, msgIds: [msgId] });
  return result.messages[0] ? buildProxyMessage(result.messages[0], chat) : undefined;
}
