import { getGlobal } from '../../global';

import { getPxgState } from './store';

const CONNECTED_STATUSES = new Set(['active', 'paused', 'flood']);

/**
 * Запись на сервере для аккаунта Telegram, в который вошли на этом устройстве. Архив читается и
 * после паузы или отключения раздачи — поэтому статус не важен.
 */
export function getOwnAccountId(): string | undefined {
  const userId = getGlobal().currentUserId;
  if (!userId) return undefined;
  return getPxgState().accounts?.find((account) => String(account.tgUserId) === userId)?.id;
}

/** Та же запись, если сервер сейчас держит сессию этого аккаунта: её можно отключить */
export function getConnectedOwnAccountId(): string | undefined {
  const userId = getGlobal().currentUserId;
  if (!userId) return undefined;
  return getPxgState().accounts?.find((account) => (
    String(account.tgUserId) === userId && CONNECTED_STATUSES.has(account.status)
  ))?.id;
}
