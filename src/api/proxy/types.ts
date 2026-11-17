import type { AccessRestriction, Permissions, ProviderAccountState } from '../../proxygram/server/types';

export type ProxyChatInfo = {
  accountId: string;
  peerId: number;
  /** Имя Telegram до личного переименования собеседника */
  originalTitle?: string;
  personalName?: { firstName: string; lastName: string };
  originalPhotoId?: string;
  personalPhoto?: { id: string; width: number; height: number };
  permissions: Permissions;
  shareIds: string[];
  restricted?: AccessRestriction;
  /** The owner's label for the guest: "Clients / Acme" */
  label?: string;
  /** Личка из охвата участников: название чата-источника */
  coverageSourceTitle?: string;
  /** The viewer's own account in thin mode: nobody's name to write on behalf of */
  isOwn?: boolean;
  /** Личка, начатая гостем из охвата: серверного доступа ещё нет, чат живёт на устройстве */
  isLocal?: true;
  /** The provider's Telegram Saved Messages */
  isSavedMessages?: boolean;
  /** The owner's account the guest writes on behalf of */
  providerName?: string;
  /** The owner's account is off the server since then: no updates arrive until the owner connects it again */
  providerState?: { status: ProviderAccountState; since?: number };
  /** Папки владельца, через которые открыт чат: отдельные вкладки «папка от …» */
  sharedFolders?: { id: number; title: string | null }[];
  /** Who shared the chat: a full login goes to this person in their own Telegram */
  providerUserId?: number;
  providerUsername?: string;
  /** Premium of the owner's account: several reactions and custom emoji */
  isProviderPremium?: boolean;
  maxUploadBytes?: number;
  /** The owner's Stars a day the guest may spend here: paid messages need the guest's confirmation every time */
  starsPerDay?: number;
};

/** Reactions per message: one, or as many as Telegram gives a Premium owner */
export const PROXY_MAX_REACTIONS = 1;
export const PROXY_MAX_REACTIONS_PREMIUM = 3;

export const PROXY_FOLDER_ID = -2;

/** Local tabs go down from here: the accesses tab, then one per owner. Telegram never sees them */
export function isLocalFolderId(id: number) {
  return id <= PROXY_FOLDER_ID;
}
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
