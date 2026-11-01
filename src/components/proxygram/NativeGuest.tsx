import { memo, useEffect } from '../../lib/teact/teact';
import { getActions } from '../../global';

import { Bundles } from '../../util/moduleLoader';
import { getPxgState, subscribePxg, usePxgState } from '../../proxygram/server/store';

import useModuleLoader from '../../hooks/useModuleLoader';

type OwnProps = { isMobile?: boolean };

const NativeGuest = ({ isMobile }: OwnProps) => {
  const { initProxyGuest, resetProxyGuest } = getActions();
  const Main = useModuleLoader(Bundles.Main, 'Main');
  const userId = usePxgState((state) => state.session?.user.id);

  useEffect(() => {
    if (!Main || !userId) return undefined;
    initProxyGuest();
    return subscribePxg(() => {
      if (!getPxgState().session) resetProxyGuest();
    });
  }, [Main, userId, initProxyGuest, resetProxyGuest]);

  return Main ? <Main isMobile={isMobile} /> : undefined;
};

export default memo(NativeGuest);
