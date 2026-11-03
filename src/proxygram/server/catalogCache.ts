import type { CatalogDocumentDto, StickerCatalogDto } from './types';

import { PXG_CATALOG_IDB_STORE } from '../../util/browser/idb';
import { getPxgState, subscribePxg } from './store';

export interface Stored<T> {
  hash: string;
  data: T;
}

export type StoredSet = Stored<CatalogDocumentDto[]>;

function getSetKey(userId: string, accountId: string, setId: string) {
  return `${userId}:set:${accountId}:${setId}`;
}

// Storage can be unavailable (private window, cleared site data): that only means asking the server again
async function read<T>(key: string) {
  try {
    return await PXG_CATALOG_IDB_STORE.get<T>(key);
  } catch {
    return undefined;
  }
}

async function write(key: string, value: unknown) {
  try {
    await PXG_CATALOG_IDB_STORE.set(key, value);
  } catch {
    // Same as above
  }
}

async function deleteKeys(prefix: string, shouldKeep?: (key: string) => boolean) {
  try {
    const keys = (await PXG_CATALOG_IDB_STORE.keys()).map(String);
    await PXG_CATALOG_IDB_STORE.delMany(keys.filter((key) => key.startsWith(prefix) && !shouldKeep?.(key)));
  } catch {
    // Same as above
  }
}

export function readStored<T>(userId: string, name: string) {
  return read<Stored<T>>(`${userId}:${name}`);
}

export function saveStored<T>(userId: string, name: string, stored: Stored<T>) {
  return write(`${userId}:${name}`, stored);
}

export function readStoredSet(userId: string, accountId: string, setId: string) {
  return read<StoredSet>(getSetKey(userId, accountId, setId));
}

export function saveStoredSet(userId: string, accountId: string, setId: string, stored: StoredSet) {
  return write(getSetKey(userId, accountId, setId), stored);
}

/** Sets the owner has removed are no longer listed: their contents leave with them */
export function pruneStoredSets(userId: string, catalogs: StickerCatalogDto[]) {
  const listed = new Set(catalogs.flatMap(({ accountId, sets, emojiSets }) => (
    [...sets, ...emojiSets].map((set) => getSetKey(userId, accountId, set.id))
  )));
  return deleteKeys(`${userId}:set:`, (key) => listed.has(key));
}

// A session ends in several ways (sign-out, revoked, expired): what it stored leaves with it
let sessionUserId = getPxgState().session?.user.id;
subscribePxg(() => {
  const userId = getPxgState().session?.user.id;
  if (sessionUserId && sessionUserId !== userId) void deleteKeys(`${sessionUserId}:`);
  sessionUserId = userId;
});
