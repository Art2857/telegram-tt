import type { AccessRestriction, Permissions } from '../../proxygram/server/types';

export type ProxyChatInfo = {
  accountId: string;
  peerId: number;
  permissions: Permissions;
  restricted?: AccessRestriction;
  /** The owner's account the guest writes on behalf of */
  providerName?: string;
  /** Premium of the owner's account: several reactions and custom emoji */
  isProviderPremium?: boolean;
};

/** Reactions per message: one, or as many as Telegram gives a Premium owner */
export const PROXY_MAX_REACTIONS = 1;
export const PROXY_MAX_REACTIONS_PREMIUM = 3;

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
