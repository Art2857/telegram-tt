import type { AdminTopic } from '../../../proxygram/server/types';

export const TABS = [
  { key: 'overview', title: 'PxgAdminOverview' },
  { key: 'users', title: 'PxgAdminUsers' },
  { key: 'sessions', title: 'PxgAdminSessions' },
  { key: 'accounts', title: 'PxgAdminAccounts' },
  { key: 'shares', title: 'PxgAdminShares' },
  { key: 'requests', title: 'PxgAdminRequests' },
  { key: 'audit', title: 'PxgAdminAudit' },
  { key: 'outbox', title: 'PxgAdminQueue' },
  { key: 'exports', title: 'PxgAdminExports' },
  { key: 'vpn', title: 'PxgAdminVpnTab' },
  { key: 'system', title: 'PxgAdminSystem' },
] as const;

export const TAB_TOPICS: Record<(typeof TABS)[number]['key'], AdminTopic[]> = {
  overview: ['presence', 'sessions', 'users', 'accounts', 'shares', 'outbox'],
  users: ['users', 'sessions', 'presence'],
  sessions: ['sessions', 'presence'],
  accounts: ['accounts'],
  shares: ['shares'],
  requests: ['requests'],
  audit: ['users', 'sessions', 'accounts', 'shares', 'outbox'],
  outbox: ['outbox'],
  exports: ['exports', 'accounts'],
  vpn: [],
  system: ['accounts'],
};
