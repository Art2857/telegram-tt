import { memo, useEffect, useState } from '../../lib/teact/teact';
import { getActions, getPromiseActions } from '../../global';

import { Bundles } from '../../util/moduleLoader';
import { getPxgState, subscribePxg, usePxgState } from '../../proxygram/server/store';

import useModuleLoader from '../../hooks/useModuleLoader';

type OwnProps = { isMobile?: boolean };

const NativeGuest = ({ isMobile }: OwnProps) => {
  const { resetProxyGuest } = getActions();
  const Main = useModuleLoader(Bundles.Main, 'Main');
  const userId = usePxgState((state) => state.session?.user.id);
  const [initializedUserId, setInitializedUserId] = useState<string>();

  useEffect(() => {
    if (!Main || !userId) return undefined;
    let isActive = true;
    void getPromiseActions().initProxyGuest().then(() => {
      if (isActive && getPxgState().session?.user.id === userId) setInitializedUserId(userId);
    });
    const unsubscribe = subscribePxg(() => {
      if (!getPxgState().session) resetProxyGuest();
    });
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [Main, userId, resetProxyGuest]);

  return Main && userId === initializedUserId ? <Main isMobile={isMobile} /> : undefined;
};

export default memo(NativeGuest);
