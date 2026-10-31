import { memo } from '../../lib/teact/teact';

import { setPxgState, usePxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';

import MenuItem from '../ui/MenuItem';

/** PXG: пункты главного меню — раздача своих чатов и админка (только администраторам) */
const PxgMenuItems = () => {
  const lang = useLang();
  const session = usePxgState((state) => state.session);
  const isSharing = usePxgState((state) => state.accounts?.some((account) => account.status === 'active'));
  const sharedCount = usePxgState((state) => state.sharedCount);

  if (!session) return undefined;

  return (
    <>
      <MenuItem icon="folder" onClick={() => setPxgState({ isSharedOpen: true })}>
        <span className="menu-item-name">{lang('PxgSharedWithMe')}</span>
        {Boolean(sharedCount) && <div className="right-badge">{sharedCount}</div>}
      </MenuItem>
      <MenuItem icon="share-filled" onClick={() => setPxgState({ isConnectOpen: true })}>
        <span className="menu-item-name">{lang('PxgMenuSharing')}</span>
        {isSharing && <span className="menu-item-badge">{lang('PxgMenuSharingOn')}</span>}
      </MenuItem>
      {session.user.role === 'admin' && (
        <MenuItem icon="admin" onClick={() => setPxgState({ isAdminOpen: true })}>
          {lang('PxgAdminTitle')}
        </MenuItem>
      )}
    </>
  );
};

export default memo(PxgMenuItems);
