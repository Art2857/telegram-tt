import type { SessionTokensResponse, StoredSession } from './types';

import { logoutSession, refreshSession } from './http';
import { getPxgState, readStoredSession, setPxgState } from './store';

/** Токен продлеваем заранее, чтобы запрос не упал на границе срока */
const REFRESH_MARGIN_MS = 60_000;

export function sessionFromTokens(tokens: SessionTokensResponse): StoredSession {
  return {
    level: tokens.level,
    accessToken: tokens.accessToken,
    accessExpiresAt: Date.now() + tokens.accessExpiresIn * 1000,
    refreshToken: tokens.refreshToken,
    user: tokens.user,
  };
}

export function setPxgSession(tokens: SessionTokensResponse) {
  setPxgState({ session: sessionFromTokens(tokens) });
}

let refreshing: Promise<string | undefined> | undefined;

/** Действующий токен доступа; при необходимости продлевает сессию одноразовым refresh-токеном */
export function getAccessToken(force = false): Promise<string | undefined> {
  const { session } = getPxgState();
  if (!session) return Promise.resolve(undefined);
  if (!force && session.accessExpiresAt - REFRESH_MARGIN_MS > Date.now()) return Promise.resolve(session.accessToken);

  refreshing ??= refreshSession(session.refreshToken)
    .then((tokens) => {
      setPxgState({
        session: {
          ...session,
          accessToken: tokens.accessToken,
          accessExpiresAt: Date.now() + tokens.accessExpiresIn * 1000,
          refreshToken: tokens.refreshToken,
        },
      });
      return tokens.accessToken;
    })
    .catch((error: { code?: string }) => {
      if (error.code !== 'invalid_session') return undefined;
      // другая вкладка могла уже продлить сессию и сменить refresh-токен
      const stored = readStoredSession();
      if (stored && stored.refreshToken !== session.refreshToken) {
        setPxgState({ session: stored });
        return stored.accessToken;
      }
      setPxgState({ session: undefined, accounts: undefined });
      return undefined;
    })
    .finally(() => {
      refreshing = undefined;
    });
  return refreshing;
}

/** Выход из системы Proxygram на этом устройстве (сессия Telegram не затрагивается) */
export function signOutPxg() {
  const { session } = getPxgState();
  setPxgState({ session: undefined, accounts: undefined, isAdminOpen: false });
  if (session) void logoutSession(session.refreshToken).catch(() => undefined);
}
