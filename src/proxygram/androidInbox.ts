import { ACCOUNT_SLOT } from '../util/multiaccount';
import { PXG_SERVER_URL } from './server/http';
import { getAccessToken } from './server/session';
import { getPxgState } from './server/store';
import { getAndroidNotifications } from './androidNotifications';

const REGISTRATION_TIMEOUT_MS = 12_000;

export async function syncAndroidInbox(isCurrent: () => boolean, hidePreviews: boolean) {
  const bridge = getAndroidNotifications();
  const userId = getPxgState().session?.user.id;
  if (!bridge || !userId || !isCurrent() || document.visibilityState === 'hidden') return;
  const token = await getAccessToken();
  if (!token || !isCurrent() || getPxgState().session?.user.id !== userId) return;
  const sessionId = accessSessionId(token);
  if (!sessionId) return;
  const slot = ACCOUNT_SLOT || 1;
  const endpoint = new URL(`${PXG_SERVER_URL}/push/android`, window.location.href).href;
  if (bridge.ensureRunning(slot, userId, sessionId, endpoint, hidePreviews)) return;
  const response = await fetch(`${endpoint}/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS),
  });
  if (!response.ok || !isCurrent() || getPxgState().session?.user.id !== userId) return;
  const result = await response.json() as { token: string; sessionId: string; cursor: string; expiresIn: number };
  if (result.sessionId !== sessionId || !isCurrent()) return;
  bridge.configure(slot, JSON.stringify({
    token: result.token, sessionId, cursor: result.cursor, userId, endpoint, hidePreviews,
    expiresAt: Date.now() + result.expiresIn * 1000,
  }));
}

function accessSessionId(token: string) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { sid } = JSON.parse(atob(encoded)) as { sid?: string };
    return sid;
  } catch {
    return undefined;
  }
}
