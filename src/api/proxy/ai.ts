import type { AiComposedDto, AiTonesDto } from '../../proxygram/server/types';
import type { MethodArgs } from '../gramjs/methods/types';
import type {
  ApiAiComposeToneDefault, ApiComposedMessageWithAI, ApiFormattedText, ApiInputAiComposeTone,
} from '../types';

import { pxgRpc } from '../../proxygram/server/rpc';
import { buildProxyEntities } from './entities';
import { resolveProxyPeer } from './index';

/** A tone the guest may use: a built-in Telegram style or their own one-off prompt */
function buildTone(tone?: ApiInputAiComposeTone): { type: 'default'; tone: string } | {
  type: 'singleUse'; customPrompt: string;
} | undefined {
  if (!tone) return undefined;
  if (tone.type === 'default') return { type: 'default', tone: tone.tone };
  // Telegram styles of the owner and other people's public styles are not the guest's to use
  if (tone.type === 'singleUse') return { type: 'singleUse', customPrompt: tone.customPrompt };
  return undefined;
}

function buildFormattedText(
  { text, entities }: { text: string; entities: unknown[] },
  accountId: string,
): ApiFormattedText {
  return { text, entities: buildProxyEntities(entities, accountId) };
}

/**
 * The AI editor composes through the owner's Telegram Premium: the text never leaves the server, only the result
 * comes back. An unsupported style is refused by the server, so it is filtered out here
 */
export async function composeMessageWithAI({
  chat, text, shouldProofread, isEmojify, translateToLang, tone,
}: MethodArgs<'composeMessageWithAI'>[0]): Promise<
  { result?: ApiComposedMessageWithAI; error?: 'floodPremium' | 'aiError' | 'generic' }
> {
  const peer = chat && resolveProxyPeer(chat.id);
  if (!chat || !peer) return { error: 'generic' };
  try {
    const result = await pxgRpc.call<AiComposedDto>('ai.compose', {
      ...peer,
      text: text.text,
      entities: text.entities?.length ? text.entities : undefined,
      proofread: shouldProofread || undefined,
      emojify: isEmojify || undefined,
      translateToLang,
      tone: buildTone(tone),
    });
    return {
      result: {
        resultText: buildFormattedText(result, peer.accountId),
        diffText: result.diffText ? buildFormattedText(result.diffText, peer.accountId) : undefined,
      },
    };
  } catch {
    return { error: 'generic' };
  }
}

/** Built-in Telegram styles for the AI editor; the owner's own styles stay private */
export async function fetchAiComposeTones({
  hash, chat,
}: MethodArgs<'fetchAiComposeTones'>[0]): Promise<{ tones: ApiAiComposeToneDefault[]; hash: string } | undefined> {
  const peer = chat && resolveProxyPeer(chat.id);
  if (!chat || !peer) return undefined;
  const result = await pxgRpc.call<AiTonesDto>('ai.tones', { ...peer, hash }).catch(() => undefined);
  if (!result) return undefined;
  return {
    hash: result.hash ?? '0',
    tones: result.tones.map((tone) => ({
      tone: tone.tone,
      title: tone.title,
      emojiId: tone.emojiId ?? '',
    })),
  };
}
