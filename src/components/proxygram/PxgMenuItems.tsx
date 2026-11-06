import { memo } from '../../lib/teact/teact';
import { getActions, getGlobal } from '../../global';

import { PROXY_FOLDER_ID } from '../../api/proxy/types';

import { signOutPxg } from '../../proxygram/server/session';
import { setPxgState, usePxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';

import MenuItem from '../ui/MenuItem';

/** PXG: пункты главного меню — раздача своих чатов и админка (только администраторам) */
const PxgMenuItems = () => {
  const { setActiveChatFolder, showNotification } = getActions();
  const lang = useLang();
  const session = usePxgState((state) => state.session);
  const isSharing = usePxgState((state) => state.accounts?.some((account) => account.status === 'active'));
  const isLost = usePxgState((state) => state.accounts?.some((account) => account.status === 'auth_lost'));
  const isFlood = usePxgState((state) => state.accounts?.some((account) => account.status === 'flood'));
  const sharedCount = usePxgState((state) => state.sharedCount);

  if (!session) return undefined;

  return (
    <>
      {session.level === 'client' && (
        <MenuItem
          icon="folder"
          onClick={() => {
            const index = getGlobal().chatFolders.orderedIds?.indexOf(PROXY_FOLDER_ID) ?? -1;
            if (index >= 0) setActiveChatFolder({ activeChatFolder: index });
            else showNotification({ message: { key: 'PxgGuestNoChatsNoUsername' } });
          }}
        >
          <span className="menu-item-name">{lang('PxgSharedWithMe')}</span>
          {Boolean(sharedCount) && <div className="right-badge">{sharedCount}</div>}
        </MenuItem>
      )}
      {/* Гость без Telegram на устройстве подключает свой аккаунт по QR и работает с ним через сервер */}
      <MenuItem icon="share-filled" onClick={() => setPxgState({ isConnectOpen: true })}>
        <span className="menu-item-name">
          {lang(session.level === 'client' ? 'PxgMenuSharing' : 'PxgConnectQrTitle')}
        </span>
        {isLost ? <span className="menu-item-badge">{lang('PxgMenuSharingLost')}</span>
          : isFlood ? <span className="menu-item-badge">{lang('PxgMenuSharingFlood')}</span>
            : isSharing && <span className="menu-item-badge">{lang('PxgMenuSharingOn')}</span>}
      </MenuItem>
      <MenuItem icon="settings" onClick={() => setPxgState({ isSettingsOpen: true })}>
        {lang('PxgSettingsTitle')}
      </MenuItem>
      {session.user.role === 'admin' && (
        <MenuItem icon="admin" onClick={() => setPxgState({ isAdminOpen: true })}>
          {lang('PxgAdminTitle')}
        </MenuItem>
      )}
      {session.level === 'guest' && (
        <MenuItem icon="logout" destructive onClick={signOutPxg}>{lang('PxgSignOut')}</MenuItem>
      )}
    </>
  );
};

export default memo(PxgMenuItems);
