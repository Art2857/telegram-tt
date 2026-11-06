import type { MethodArgs } from '../gramjs/methods/types';

import { pxgRpc } from '../../proxygram/server/rpc';
import { buildProxyEntities } from './entities';
import { emitProxyUpdate, resolveProxyPeer } from './index';

type TranslationDto = { msgId: number; text: string; entities: unknown[] };

/** «Translate» of a shared chat: Telegram translates on behalf of the owner, as the button does for the owner */
export async function translateText(params: MethodArgs<'translateText'>[0]) {
  if (!('chat' in params)) return undefined;
  const { chat, messageIds, requestId, toLanguageCode, tone } = params;
  const peer = resolveProxyPeer(chat.id);
  try {
    if (!peer) throw new Error('Unknown shared chat');
    const { texts } = await pxgRpc.call<{ texts: TranslationDto[] }>('messages.translate', {
      ...peer, msgIds: messageIds, toLang: toLanguageCode, tone: tone === 'neutral' ? undefined : tone,
    });
    emitProxyUpdate({
      '@type': 'updateMessageTranslations',
      requestId,
      chatId: chat.id,
      messageIds,
      translations: texts.map(({ text, entities }) => ({
        text: { text, entities: buildProxyEntities(entities, peer.accountId) },
      })),
      toLanguageCode,
      tone,
    });
  } catch {
    emitFailure(params);
  }
  return undefined;
}

/** «Summary» of a long post: Telegram summarizes it on behalf of the owner; no result hides the summary */
export async function fetchMessageSummary({ chat, id, toLanguageCode, tone }: MethodArgs<'fetchMessageSummary'>[0]) {
  const peer = resolveProxyPeer(chat.id);
  if (!peer) return undefined;
  try {
    const { text, entities } = await pxgRpc.call<{ text: string; entities: unknown[] }>('messages.summarize', {
      ...peer, msgId: id, toLang: toLanguageCode, tone,
    });
    return { text, entities: buildProxyEntities(entities, peer.accountId) };
  } catch {
    return undefined;
  }
}

/** Rich messages are not translated through the server yet: the request ends instead of spinning */
export function translateRichMessage(params: MethodArgs<'translateRichMessage'>[0]) {
  emitFailure(params);
  return Promise.resolve(undefined);
}

function emitFailure({ chat, messageIds, requestId, toLanguageCode, tone }: {
  chat: { id: string }; messageIds: number[]; requestId: string; toLanguageCode: string;
  tone?: MethodArgs<'translateRichMessage'>[0]['tone'];
}) {
  emitProxyUpdate({
    '@type': 'failedMessageTranslations', requestId, chatId: chat.id, messageIds, toLanguageCode, tone,
  });
}
