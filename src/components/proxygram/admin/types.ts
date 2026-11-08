import type { Permissions, PresetKey } from '../../../proxygram/server/types';
import type { HistoryMode } from '../ShareSettingsFields';

export type AdminShare = {
  id: string;
  scope: 'chat' | 'topic' | 'folder';
  peerId: number | null;
  folderId: number | null;
  topicId: number | null;
  preset: PresetKey;
  permissions: Partial<Permissions>;
  historyMode: HistoryMode;
  historyLimit: number | null;
  visibleFromDate: string | null;
  excludePeerIds: number[];
  limits: { sendPerMinute?: number; deletePerMinute?: number; starsPerDay?: number };
  label: string | null;
  status: 'active' | 'paused' | 'revoked' | 'source_lost';
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  account: { id: string; displayName: string | null };
  peerTitle: string | null;
  topicTitle: string | null;
  folderTitle: string | null;
  grantee: { id: string; username: string | null; firstName: string | null } | null;
  grantor: { id: string; username: string | null; firstName: string | null } | null;
};
