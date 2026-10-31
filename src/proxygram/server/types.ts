// Зеркало типов из packages/protocol: клиент живёт вне pnpm workspace и не тянет zod.
// Меняя протокол на сервере — поменяйте и здесь.

export type SessionLevel = 'guest' | 'client';

export interface SessionUser {
  id: string;
  tgUserId: number;
  username: string | null;
  firstName?: string | null;
  role: 'user' | 'admin';
}

export interface StoredSession {
  level: SessionLevel;
  accessToken: string;
  /** Unix-время в мс */
  accessExpiresAt: number;
  refreshToken: string;
  user: SessionUser;
}

export type LoginStart = {
  requestId: string;
  deviceSecret: string;
  expiresAt: string;
} & ({ delivery: 'bot' } | { delivery: 'deeplink'; deeplink: string });

export interface SessionTokensResponse {
  accessToken: string;
  accessExpiresIn: number;
  refreshToken: string;
  level: SessionLevel;
  user: SessionUser;
}

export type PermissionKey =
  | 'read' | 'write' | 'sendMedia' | 'useOwnerStickers' | 'react' | 'editOwn' | 'deleteOwn'
  | 'manageOwnerOutgoing' | 'interact' | 'download' | 'forwardOut' | 'seeArchive' | 'seeAttribution'
  | 'markRead' | 'typing' | 'seePhones' | 'admin';

export type Permissions = Record<PermissionKey, boolean>;

export type PresetKey = 'readOnly' | 'assistant' | 'full';

export interface AccessChat {
  accountId: string;
  peerId: number;
  title: string | null;
  username: string | null;
  type: 'user' | 'bot' | 'chat' | 'channel' | 'megagroup' | 'forum' | null;
  permissions: Permissions;
  shareIds: string[];
}

export interface MessageDto {
  accountId: string;
  peerId: number;
  msgId: number;
  topicId: number | null;
  senderId: number | null;
  date: string;
  editDate: string | null;
  text: string;
  entities: unknown[];
  media: { type?: string; key?: string; fileName?: string; mimeType?: string } | null;
  replyTo: { msgId?: number } | null;
  fwdFrom: unknown;
  reactions: unknown;
  groupedId: string | null;
  isOutgoing: boolean;
  isPost: boolean;
  isService: boolean;
  ttlExpiresAt: string | null;
  version: number;
  changeSeq: string;
  deleted: { at: string; reason: 'delegate' | 'external' } | null;
  sentByUserId: string | null;
}

export interface MessageVersionDto {
  version: number;
  text: string;
  editDate: string | null;
  capturedAt: string;
}

export interface AccountDto {
  id: string;
  tgUserId: number | null;
  displayName: string | null;
  status: 'connecting' | 'active' | 'paused' | 'auth_lost' | 'flood' | 'revoked';
  statusReason: string | null;
  connectedAt: string | null;
}

export interface SrpChallengeDto {
  srpId: string;
  srpB: string;
  salt1: string;
  salt2: string;
  g: number;
  p: string;
  hint: string | null;
}

export type ConnectStepDto =
  | { status: 'token'; token: string; expiresAt: string }
  | { status: 'password'; password: SrpChallengeDto; invalid: boolean }
  | { status: 'waiting' }
  | { status: 'connected'; account: { id: string; tgUserId: number; displayName: string } };

export interface UserLookup {
  registered: boolean;
  knownToBot: boolean;
  user: { id: string; tgUserId: number; username: string | null; firstName: string | null } | null;
}

export type AdminTopic = 'presence' | 'sessions' | 'users' | 'accounts' | 'shares' | 'outbox';

export type ServerEvent =
  | { e: 'archive.change'; d: { accountId: string; peerId: number; msgId: number; kind: string } }
  | { e: 'access.changed'; d: Record<string, never> }
  | { e: 'outbox.done'; d: { id: string; status: 'done' | 'failed'; error: string | null; peerId: number } }
  | { e: 'admin.changed'; d: { topics: AdminTopic[] } }
  | { e: 'session.revoked'; d: Record<string, never> };

export class PxgError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}
