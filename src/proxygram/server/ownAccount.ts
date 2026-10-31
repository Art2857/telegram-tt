import { getGlobal } from '../../global';

import { getPxgState } from './store';

/**
 * Запись на сервере для аккаунта Telegram, в который вошли на этом устройстве. Архив читается и
 * после паузы или отключения раздачи — поэтому статус не важен.
 */
export function getOwnAccountId(): string | undefined {
  const userId = getGlobal().currentUserId;
  if (!userId) return undefined;
  return getPxgState().accounts?.find((account) => String(account.tgUserId) === userId)?.id;
}
