import { useEffect, useState } from '../../lib/teact/teact';

import type { AccountDto, StoredSession } from './types';

import { ACCOUNT_SLOT } from '../../util/multiaccount';

export type ConnectionState = 'offline' | 'connecting' | 'online';

export interface PxgState {
  /** Системная сессия Proxygram: гостя или после полного входа в Telegram */
  session?: StoredSession;
  /** Способ входа, выбранный на первом экране; до выбора показывается экран выбора */
  authChoice?: 'telegram' | 'guest';
  connection: ConnectionState;
  /** Свои аккаунты, подключённые к серверу (раздача чатов) */
  accounts?: AccountDto[];
  isAdminOpen: boolean;
  isConnectOpen: boolean;
  /** «Открыто мне» поверх полного клиента */
  isSharedOpen: boolean;
  /** Сколько чатов открыли этому человеку другие */
  sharedCount?: number;
  /** Чат Web A, которым делятся сейчас (окно «Поделиться чатом») */
  shareChatId?: string;
}

const SESSION_KEY_PREFIX = 'pxg-session';

/**
 * У каждого слота аккаунта Web A (`?account=N`) своя сессия Proxygram: в одном браузере могут быть
 * несколько аккаунтов Telegram и гостевые аккаунты рядом с ними.
 */
export function pxgSessionKey(slot?: number) {
  return slot && slot !== 1 ? `${SESSION_KEY_PREFIX}-${slot}` : SESSION_KEY_PREFIX;
}

const SESSION_KEY = pxgSessionKey(ACCOUNT_SLOT);

let state: PxgState = {
  session: readStoredSession(),
  connection: 'offline',
  isAdminOpen: false,
  isConnectOpen: false,
  isSharedOpen: false,
};
const listeners = new Set<NoneToVoidFunction>();

export function getPxgState(): PxgState {
  return state;
}

export function setPxgState(patch: Partial<PxgState>) {
  state = { ...state, ...patch };
  if ('session' in patch) writeStoredSession(patch.session);
  listeners.forEach((listener) => listener());
}

export function subscribePxg(listener: NoneToVoidFunction) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Teact-хук: компонент перерисовывается, когда меняется выбранная часть состояния */
export function usePxgState<T>(selector: (current: PxgState) => T): T {
  const [value, setValue] = useState(() => selector(state));
  useEffect(() => {
    setValue(selector(state));
    return subscribePxg(() => setValue(selector(state)));
    // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
  }, []);
  return value;
}

export function readStoredSession(slot = ACCOUNT_SLOT): StoredSession | undefined {
  try {
    const raw = localStorage.getItem(pxgSessionKey(slot));
    return raw ? JSON.parse(raw) as StoredSession : undefined;
  } catch {
    return undefined;
  }
}

/** Записать сессию в другой слот — например, открыть просмотр глазами гостя в новой вкладке */
export function writeSlotSession(slot: number, session: StoredSession) {
  localStorage.setItem(pxgSessionKey(slot), JSON.stringify(session));
}

/** Все слоты, где есть сессия Proxygram */
export function listPxgSessionSlots(): { slot: number; session: StoredSession }[] {
  const result: { slot: number; session: StoredSession }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(SESSION_KEY_PREFIX)) continue;
    const slot = key === SESSION_KEY_PREFIX ? 1 : Number(key.slice(SESSION_KEY_PREFIX.length + 1));
    const session = Number.isInteger(slot) && slot > 0 ? readStoredSession(slot) : undefined;
    if (session) result.push({ slot, session });
  }
  return result.sort((a, b) => a.slot - b.slot);
}

function writeStoredSession(session?: StoredSession) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // приватный режим: сессия живёт до перезагрузки
  }
}

// Другая вкладка продлила или завершила сессию — подхватываем, иначе refresh-токены разойдутся
window.addEventListener('storage', (event) => {
  if (event.key !== SESSION_KEY) return;
  state = { ...state, session: readStoredSession() };
  listeners.forEach((listener) => listener());
});
