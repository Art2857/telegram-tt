import { ACCOUNT_SLOT } from '../util/multiaccount';

/**
 * The newest archive change the guest's chats on this device have (`change_seq`). It is kept with the slot, so a reload
 * shows the saved chats at once and asks `sync.changes` only for what came after it (docs/spec/11 C5)
 */
export type SyncCursor = { userId: string; seq?: string };

const STORAGE_KEY = `pxg-sync-cursor-${ACCOUNT_SLOT || 1}`;

export function loadSyncCursor(): SyncCursor | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as SyncCursor | null;
    return value && typeof value.userId === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveSyncCursor(cursor: SyncCursor | undefined) {
  try {
    if (cursor) localStorage.setItem(STORAGE_KEY, JSON.stringify(cursor));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the guest starts from scratch on reload, as before
  }
}
