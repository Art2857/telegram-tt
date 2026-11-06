import { PXG_SERVER_URL } from './server/http';

/**
 * PXG: полный клиент ходит в Telegram через сервер Proxygram (ретранслятор MTProto /pxg/tg) или напрямую в
 * web.telegram.org. По умолчанию — через сервер: так он работает и там, где Telegram закрыт. Выбор хранится
 * на устройстве и действует до входа (на странице входа) и после.
 */
const DIRECT_KEY = 'pxg-telegram-direct';

export function isTelegramDirect(): boolean {
  try {
    return localStorage.getItem(DIRECT_KEY) === '1';
  } catch {
    return false;
  }
}

/** GramJS подключается при запуске: новый путь вступает в силу после перезагрузки, и в остальных вкладках тоже */
export function setTelegramDirect(isDirect: boolean) {
  if (isDirect) localStorage.setItem(DIRECT_KEY, '1');
  else localStorage.removeItem(DIRECT_KEY);
  window.location.reload();
}

/** wss://<сервер>/pxg/tg — адрес ретранслятора; undefined — напрямую */
export function getTelegramRelayUrl(): string | undefined {
  if (isTelegramDirect()) return undefined;
  const url = new URL(`${PXG_SERVER_URL}/tg`, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString().replace(/\/$/, '');
}

// Соединение с Telegram держит главная вкладка: переключили в другой — перезапускаются все
window.addEventListener('storage', (event) => {
  if (event.key === DIRECT_KEY) window.location.reload();
});
