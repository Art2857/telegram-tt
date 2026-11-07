import { useEffect, useRef } from '../../lib/teact/teact';

import type { AccountDto, StoredSession } from './types';

import { ACCOUNT_SLOT } from '../../util/multiaccount';

import useForceUpdate from '../../hooks/useForceUpdate';

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
  /** «Настройки Proxygram»: сервер, доступы, архив, журнал, устройства */
  isSettingsOpen: boolean;
  isAppUpdateOpen?: boolean;
  isConnectOpen: boolean;
  /** Сколько чатов открыли этому человеку другие */
  sharedCount?: number;
  /** Свои чаты, открытые другим: ID чата Web A → имена тех, кому открыт */
  sharedChats?: Record<string, string[]>;
  /** Чат Web A, которым делятся сейчас (окно «Поделиться чатом») */
  shareChatId?: string;
  /** Папка Telegram, которой делятся сейчас (окно «Поделиться папкой») */
  shareFolder?: { id: number; title: string };
  /** Тема форума shareChatId, которой делятся отдельно от остального форума */
  shareTopic?: { id: number; title: string };
  /** Окно «Поделиться» открывается сразу в правке этого доступа (из профиля чата) */
  shareEditId?: string;
  /** Панель разработчика: сообщение, о котором администратор смотрит данные архива */
  debugMessage?: { accountId: string; peerId: number; msgId: number };
  /** Журнал реакций сообщения: прокси-чата или своего */
  reactionLogMessage?: { accountId: string; peerId: number; msgId: number; isProxy: boolean };
  /** Окно «Скрыть от гостей»: сообщения своего чата (альбом — целиком) */
  hideMessages?: { accountId: string; peerId: number; chatId: string; msgIds: number[] };
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
  isSettingsOpen: false,
  isConnectOpen: false,
};
const listeners = new Set<NoneToVoidFunction>();

export function getPxgState(): PxgState {
  return state;
}

export function setPxgState(patch: Partial<PxgState>) {
  const isNewIdentity = 'session' in patch && (
    state.session?.user.id !== patch.session?.user.id || state.session?.level !== patch.session?.level
  );
  if (isNewIdentity) {
    state = { ...state,
      accounts: undefined, sharedCount: undefined, sharedChats: undefined,
      shareChatId: undefined, shareFolder: undefined, shareTopic: undefined, shareEditId: undefined,
      debugMessage: undefined, reactionLogMessage: undefined, hideMessages: undefined,
      isAdminOpen: false, isSettingsOpen: false, isConnectOpen: false,
    };
  }
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
  const forceUpdate = useForceUpdate();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const value = selector(state);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const update = () => {
      const next = selectorRef.current(state);
      if (Object.is(next, valueRef.current)) return;
      valueRef.current = next;
      forceUpdate();
    };
    update();
    return subscribePxg(update);
  }, [selectorRef, valueRef, forceUpdate]);
  return value;
}

export function readStoredSession(slot = ACCOUNT_SLOT): StoredSession | undefined {
  try {
    const raw = localStorage.getItem(pxgSessionKey(slot));
    if (!raw) return undefined;
    const session = JSON.parse(raw) as Partial<StoredSession> | undefined;
    if (!session || (session.level !== 'guest' && session.level !== 'client')
      || typeof session.accessToken !== 'string' || !session.accessToken
      || typeof session.refreshToken !== 'string'
      || session.refreshToken.length < 16 || session.refreshToken.length > 128
      || !Number.isFinite(session.accessExpiresAt)
      || !session.user || typeof session.user.id !== 'string' || !session.user.id
      || !Number.isSafeInteger(session.user.tgUserId)) return undefined;
    return session as StoredSession;
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
  setPxgState({ session: readStoredSession() });
});
