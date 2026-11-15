import type useLang from '../../../hooks/useLang';
import type {
  AccountDto, PresetKey,
} from '../../../proxygram/server/types';

export type Person = { id: string; username: string | null; firstName: string | null } | null;

export type Lang = ReturnType<typeof useLang>;

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type AccountRow = AccountDto & { messages: number; mediaBytes: number; activeShares: number };

export type ShareRow = {
  id: string;
  accountId: string;
  scope: 'chat' | 'topic' | 'folder' | 'chat_members' | 'folder_members';
  peerId: number | null;
  topicId: number | null;
  folderId: number | null;
  folderTitle: string | null;
  hiddenAt?: string | null;
  preset: PresetKey;
  status: 'active' | 'paused' | 'source_lost';
  expiresAt: string | null;
  label: string | null;
  peerTitle: string | null;
  topicTitle: string | null;
  grantee?: Person;
  grantor?: Person;
};

export type AuditRow = {
  id: string;
  at: string;
  action: string;
  peerTitle: string | null;
  msgIds: number[] | null;
  /** Messages affected when the entry keeps only some of their IDs (a mass deletion) */
  count: number | null;
  /** The owner's Stars the guest spent: paid messages and paid reactions */
  stars?: number | null;
  isCrossAccountCopy?: boolean;
  actor: Person;
};

export type AuditFilters = {
  actors: NonNullable<Person>[];
  chats: { accountId: string; peerId: number; title: string | null }[];
};

export type SessionRow = {
  id: string;
  level: 'guest' | 'client';
  /** The server's administrator signed in as this person */
  isAdminSignIn: boolean;
  deviceName: string | null;
  platform: string | null;
  ip: string | null;
  lastActiveAt: string;
  online: boolean;
  isCurrent: boolean;
};

export type Policy = {
  media: {
    maxBytes: number;
    includeVideo: boolean;
    includeDocuments: boolean;
    sharedVideoMaxBytes?: number;
    onDemand: boolean;
    onDemandKeepDays: number;
    keepDays: number;
  };
  retention: { deletedDays: number };
  import: { enabled: boolean; perChat: number };
  chats: { channels: boolean; maxMembers: number };
  /** Chats the owner archives or not regardless of the policy */
  exceptions: { peerId: number; title: string | null; enabled: boolean }[];
};

export type Confirm = { text: string; label: string; action: () => Promise<unknown> };

export type TabProps = {
  lang: Lang;
  t: Translate;
  accounts?: AccountRow[];
  accountsError?: unknown;
  reloadAccounts: NoneToVoidFunction;
  ask: (text: string, label: string, action: () => Promise<unknown>) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
};

export type OutgoingView = 'guest' | 'chat' | 'requests' | 'expiring';

/** An access request from the guest's side or the owner's (docs/RELEASE.md) */
export type AccessRequestRow = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  requester: { id: string; tgUserId: number; name: string; username: string | null };
  ownerName: string;
  accountId: string | null;
  peerId: number | null;
  peerTitle: string | null;
  query: string | null;
  originTitle: string | null;
  reason: string | null;
  createdAt: string;
  context: { commonGroups: number; hasChat: boolean } | null;
};

/** A chat of the owner as the guests see it, with the accesses that open it */
export type OutgoingChatRow = {
  accountId: string;
  peerId: number;
  title: string | null;
  viewers: { userId: string; name: string; shareIds: string[] }[];
};

/** What one guest sees in the owner's chats: the effective rights and where they come from */
export type EffectiveChatRow = {
  accountId: string;
  peerId: number;
  title: string | null;
  permissions: Record<string, boolean>;
  sources: { shareId: string }[];
};

export type OutgoingGroup = { key: string; title?: string; items: ShareRow[] };

export type ServerAdmin = {
  firstName: string | null; lastName: string | null; username: string | null; isYou: boolean;
};
