import type { AccessRestriction, Permissions } from '../../proxygram/server/types';

export type ProxyChatInfo = {
  accountId: string;
  peerId: number;
  permissions: Permissions;
  restricted?: AccessRestriction;
};

export const PROXY_FOLDER_ID = -2;
export const PROXY_REACTION_EMOJIS = ['👍', '❤', '🔥', '👏', '😁', '🤔', '👎'];
export const PROXY_CONFIG = {
  expiresAt: Number.MAX_SAFE_INTEGER,
  maxGroupSize: 0,
  maxMessageLength: 4096,
  editTimeLimit: 172800,
  maxForwardedCount: 0,
  ratingEDecay: 0,
  defaultReaction: { type: 'emoji' as const, emoticon: '👍' },
};
