import { useEffect, useState } from '../../lib/teact/teact';

import type { AccountDto, StoredSession } from './types';

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

const SESSION_KEY = 'pxg-session';

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

export function readStoredSession(): StoredSession | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as StoredSession : undefined;
  } catch {
    return undefined;
  }
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
