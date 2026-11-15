import type useLang from '../../../hooks/useLang';
import type { AdminTopic, ImportStateDto,
} from '../../../proxygram/server/types';
import type { AdminShare as ShareRow } from './types';

export type AdminTabKey = 'overview' | 'users' | 'sessions' | 'accounts' | 'shares' | 'requests'
  | 'audit' | 'outbox' | 'exports' | 'vpn' | 'system';

export type Person = { id: string; tgUserId?: number; username: string | null; firstName: string | null } | null;

export type Overview = {
  users: { total: number; admins: number; blocked: number };
  sessions: Partial<Record<'guest' | 'client', number>>;
  online: { users: number; guest: number; client: number; readingNow: number };
  accounts: Partial<Record<string, number>>;
  shares: Partial<Record<string, number>>;
  outbox: Partial<Record<string, number>>;
  archive: { messagesEstimate: number; messagesLastDay: number };
  storage: {
    mediaBytes: number;
    disk: { totalBytes: number; freeBytes: number } | null;
    /** The server cannot write files: the archive, guests' photo cache and guests' uploads stop */
    writeError?: string | null;
  };
  attentionAccounts?: {
    id: string;
    displayName: string | null;
    tgUserId: number | null;
    status: string;
    statusReason: string | null;
    statusChangedAt: string | null;
    owner: string | null;
  }[];
  staleLeases: number;
};

export type SystemInfo = {
  version: string | null;
  node: string;
  startedAt: string;
  uptimeSeconds: number;
  migrations: number | null;
  memory: { rssBytes: number; heapUsedBytes: number; accounts: number; perAccountBytes: number };
  storage: { disk: { totalBytes: number; freeBytes: number } | null };
  workers: { workerId: string | null; accounts: number; leaseUntil: string | null; stale: number }[];
  connections?: {
    total: number;
    connected: number;
    accounts: {
      id: string;
      displayName: string | null;
      state: 'offline' | 'connecting' | 'updating' | 'connected' | null;
      checkedAt: string | null;
      lastUpdateAt: string | null;
      isConnected: boolean;
    }[];
  };
  vpn: {
    isReachable: boolean;
    isHealthy?: boolean;
    active?: string | null;
    lastSweepAt?: string | null;
    total?: number;
    answering?: number;
    activeRttMs?: number | null;
    switches?: { at: string; from?: string; to: string; reason: string }[];
  } | null;
};

export type PresenceRow = {
  connectionId: string;
  sessionId: string;
  level: 'guest' | 'client';
  ip: string | null;
  connectedAt: string;
  device: string | null;
  platform: string | null;
  user: Person;
  chat: { accountId: string; peerId: number; since: string; title: string | null; accountName: string | null } | null;
};

export type UserRow = {
  id: string;
  tgUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  blockedAt: string | null;
  lastSeenAt: string | null;
  sessions: number;
  lastLevel: 'guest' | 'client' | null;
  sharesIn: number;
  sharesOut: number;
  accounts: number;
  online: boolean;
};

export type UserDetails = {
  user: Pick<UserRow,
    'id' | 'tgUserId' | 'username' | 'firstName' | 'lastName' | 'role' | 'blockedAt' | 'lastSeenAt'
  > & {
    createdAt: string;
  };
  sessions: SessionRow[];
  accounts: AccountRow[];
  shares: ShareRow[];
};

export type SessionRow = {
  id: string;
  level: 'guest' | 'client';
  isAdminSignIn: boolean;
  deviceName: string | null;
  platform: string | null;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
  user: Person;
  online: boolean;
  chat: { accountId: string; peerId: number } | null;
};

export type AccountRow = {
  id: string;
  tgUserId: number | null;
  displayName: string | null;
  status: string;
  statusReason: string | null;
  workerId: string | null;
  leaseUntil: string | null;
  restartRequested: boolean;
  connectedAt: string | null;
  owner: Person;
  messages: number;
  mediaBytes: number;
  lastMessageAt: string | null;
  activeShares: number;
  queue: number;
  importState: ImportStateDto | null;
};

export type AuditRow = { id: string; at: string; action: string; peerId: number | null; meta: unknown; actor: Person };

export type OutboxRow = {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  attempts: number;
  createdAt: string;
  actor: Person;
};

export type Confirm = { text: string; label: string; action: () => Promise<unknown> };

export type TabProps = {
  lang: ReturnType<typeof useLang>;
  ask: (text: string, label: string, action: () => Promise<unknown>) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
  selfId?: string;
  topics: AdminTopic[];
  openTab?: (key: AdminTabKey) => void;
};

export type ShareFilters = {
  status: ShareRow['status'] | undefined;
  accountId: string;
  granteeQuery: string;
  peer: string;
  offset: number;
};

export type ExportPeer = { peerId: number; title: string | null; username: string | null; type: string | null };
