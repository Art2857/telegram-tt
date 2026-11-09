import type { StoredSession } from './types';

import { ACCOUNT_SLOT, getAccountsInfo, loadSlotSession } from '../../util/multiaccount';
import { listPxgSessionSlots } from './store';

/**
 * Гостевой аккаунт — слот Web A (`?account=N`), где есть гостевая сессия Proxygram,
 * а сессии Telegram нет. В переключателе аккаунтов он стоит рядом с обычными.
 */
export function listGuestSlots(): { slot: number; session: StoredSession }[] {
  return listPxgSessionSlots().filter(({ slot, session }) => session.level === 'guest' && !loadSlotSession(slot));
}

export function isGuestSlot(slot: number) {
  return listGuestSlots().some((item) => item.slot === slot);
}

/** Первый слот, не занятый ни аккаунтом Telegram, ни гостевым, ни текущей вкладкой */
export function findFreeSlot() {
  const telegram = getAccountsInfo();
  const guests = new Set(listGuestSlots().map((item) => item.slot));
  const currentSlot = ACCOUNT_SLOT || 1;
  let slot = 1;
  while (slot === currentSlot || telegram[slot] || guests.has(slot)) slot += 1;
  return slot;
}

export function guestSlotTitle(session: StoredSession) {
  const { username, firstName, tgUserId } = session.user;
  return username ? `@${username}` : firstName || `id${tgUserId}`;
}
