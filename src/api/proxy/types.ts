import type { AccessRestriction, Permissions } from '../../proxygram/server/types';

export type ProxyChatInfo = {
  accountId: string;
  peerId: number;
  permissions: Permissions;
  shareIds: string[];
  restricted?: AccessRestriction;
  /** The viewer's own account in thin mode: nobody's name to write on behalf of */
  isOwn?: boolean;
  /** The owner's account the guest writes on behalf of */
  providerName?: string;
  /** Who shared the chat: a full login goes to this person in their own Telegram */
  providerUserId?: number;
  providerUsername?: string;
  /** Premium of the owner's account: several reactions and custom emoji */
  isProviderPremium?: boolean;
  maxUploadBytes?: number;
};

/** Reactions per message: one, or as many as Telegram gives a Premium owner */
export const PROXY_MAX_REACTIONS = 1;
export const PROXY_MAX_REACTIONS_PREMIUM = 3;

export const PROXY_FOLDER_ID = -2;
export const MAX_PROXY_FOLDERS = 30;
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
