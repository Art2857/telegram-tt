import type { LoginStart, SessionLevel, SessionTokensResponse } from './types';
import { PxgError } from './types';

/**
 * Адрес сервера Proxygram. По умолчанию — тот же origin, путь /pxg: в разработке его
 * проксирует Vite (vite.config.ts), в проде — обратный прокси перед сервером.
 */
export const PXG_SERVER_URL = (import.meta.env.TG_PXG_SERVER_URL || '/pxg').replace(/\/$/, '');

export function getWebSocketUrl() {
  const base = new URL(PXG_SERVER_URL, window.location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${base.toString().replace(/\/$/, '')}/ws`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${PXG_SERVER_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PxgError('network');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PxgError((data as { error?: string }).error ?? `http_${response.status}`);
  return data as T;
}

export function getDeviceInfo() {
  const { userAgent } = navigator;
  const platform = /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
      : /iPhone|iPad/.test(userAgent) ? 'iOS'
        : /Mac OS/.test(userAgent) ? 'macOS'
          : /Linux/.test(userAgent) ? 'Linux' : 'Web';
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\//.test(userAgent) ? 'Firefox'
      : /Chrome\//.test(userAgent) ? 'Chrome'
        : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  return { name: `${browser} · ${platform}`, platform };
}

export function startLogin(params: { username?: string; level: SessionLevel }) {
  return post<LoginStart>('/auth/guest/start', { ...params, device: getDeviceInfo() });
}

export function verifyLoginCode(params: { requestId: string; deviceSecret: string; code: string }) {
  return post<SessionTokensResponse>('/auth/guest/verify', params);
}

export function pollLogin(params: { requestId: string; deviceSecret: string }) {
  return post<SessionTokensResponse | { status: 'pending' }>('/auth/guest/poll', params);
}

export function refreshSession(refreshToken: string) {
  return post<{ accessToken: string; accessExpiresIn: number; refreshToken: string }>(
    '/auth/refresh', { refreshToken },
  );
}

export function logoutSession(refreshToken: string) {
  return post<void>('/auth/logout', { refreshToken });
}
