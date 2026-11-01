import type { ApiMessageEntity } from '../types';
import { ApiMessageEntityTypes } from '../types';

import { getProxyPeerId, resolveProxyPeer } from './index';

const SIMPLE_ENTITIES = new Set([
  'MessageEntityBold', 'MessageEntityItalic', 'MessageEntityUnderline', 'MessageEntityStrike',
  'MessageEntitySpoiler', 'MessageEntityCode', 'MessageEntityUrl', 'MessageEntityMention',
  'MessageEntityHashtag', 'MessageEntityCashtag', 'MessageEntityEmail', 'MessageEntityPhone',
  'MessageEntityBotCommand',
]);

export function buildProxyEntities(entities: unknown[], accountId: string): ApiMessageEntity[] {
  return entities.flatMap((raw): ApiMessageEntity[] => {
    if (!raw || typeof raw !== 'object') return [];
    const entity = raw as Record<string, unknown>;
    if (typeof entity._ !== 'string' || !Number.isInteger(entity.offset) || !Number.isInteger(entity.length)) return [];
    const type = (entity._[0].toUpperCase() + entity._.slice(1)) as ApiMessageEntityTypes;
    const offset = entity.offset as number;
    const length = entity.length as number;
    if (offset < 0 || length <= 0) return [];
    if (SIMPLE_ENTITIES.has(type)) return [{ type, offset, length } as ApiMessageEntity];
    if (type === ApiMessageEntityTypes.TextUrl && typeof entity.url === 'string') {
      return [{ type, offset, length, url: entity.url }];
    }
    if (type === ApiMessageEntityTypes.Pre) {
      return [{ type, offset, length, language: typeof entity.language === 'string' ? entity.language : '' }];
    }
    if (type === ApiMessageEntityTypes.Blockquote) {
      return [{ type, offset, length, canCollapse: entity.collapsed === true || undefined }];
    }
    if (type === ApiMessageEntityTypes.MentionName && Number.isSafeInteger(Number(entity.userId))) {
      return [{ type, offset, length, userId: getProxyPeerId(accountId, Number(entity.userId)) }];
    }
    return [];
  });
}

export function buildProxyInputEntities(entities: ApiMessageEntity[] | undefined, accountId: string) {
  return entities?.flatMap((entity) => {
    if ('userId' in entity) {
      const peer = resolveProxyPeer(entity.userId);
      if (!peer || peer.accountId !== accountId || peer.peerId <= 0) return [];
      return [{
        _: 'inputMessageEntityMentionName', offset: entity.offset, length: entity.length, userId: peer.peerId,
      }];
    }
    const { type, ...fields } = entity;
    return [{ _: type[0].toLowerCase() + type.slice(1), ...fields }];
  });
}
