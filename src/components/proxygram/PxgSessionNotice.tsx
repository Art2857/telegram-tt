import { memo, useEffect } from '../../lib/teact/teact';
import { getActions } from '../../global';

import { usePxgState } from '../../proxygram/server/store';

/**
 * Сессию Proxygram завершили (админка или протухший refresh-токен): объясняем это и даём войти снова.
 * Компонент живёт вне Main/NativeGuest: те размонтируются вместе с сессией, и уведомление внутри них
 * никогда бы не показалось.
 */
const PxgSessionNotice = () => {
  const isSessionRevoked = usePxgState((state) => state.isSessionRevoked);

  useEffect(() => {
    if (!isSessionRevoked) return;
    getActions().showNotification({
      message: { key: 'PxgSessionRevoked' },
      actionText: { key: 'PxgSessionSignInAgain' },
      action: { action: 'retryPxgSession', payload: undefined },
      duration: 60_000,
    });
  }, [isSessionRevoked]);

  return undefined;
};

export default memo(PxgSessionNotice);
