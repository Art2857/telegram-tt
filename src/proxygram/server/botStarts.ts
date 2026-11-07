import { ACCOUNT_SLOT } from '../../util/multiaccount';
import { pxgSessionKey } from './store';

/** How often a full login may press Start at the bot for itself when the sign-in never gets confirmed */
const MAX_UNCONFIRMED_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60_000;
/** The second and the third try wait longer: each Start is a message from the person's own account */
const UNCONFIRMED_DELAYS_MS = [10 * 60_000, 60 * 60_000];

const STORAGE_KEY = `${pxgSessionKey(ACCOUNT_SLOT)}:bot-starts`;

/**
 * Starts sent to the bot that never signed the device in, for the last day. A bot of another server does not know
 * the link and answers "the link has expired": without this limit every retry would be one more such message
 */
function readUnconfirmedStarts(): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((at): at is number => typeof at === 'number' && Date.now() - at < DAY_MS) : [];
  } catch {
    return [];
  }
}

export function canSendBotStart() {
  return readUnconfirmedStarts().length < MAX_UNCONFIRMED_PER_DAY;
}

/** The delay before the next try, or `undefined` when no more tries are left today */
export function noteUnconfirmedBotStart(): number | undefined {
  const starts = [...readUnconfirmedStarts(), Date.now()];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(starts));
  } catch {
    // Without storage the limit holds until the page is reloaded
  }
  return starts.length < MAX_UNCONFIRMED_PER_DAY ? UNCONFIRMED_DELAYS_MS[starts.length - 1] : undefined;
}

export function clearBotStarts() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear
  }
}
