import type { GlobalState } from '../global/types';
import type { LangFn } from '../util/localization';

import { isProxyGuest } from '../api/proxy';
import { usePxgState } from '../proxygram/server/store';
import useBrowserOnline from './window/useBrowserOnline';

export enum ConnectionStatus {
  waitingForNetwork,
  syncing,
  online,
}

type ConnectionStatusPosition =
  'overlay'
  | 'minimized'
  | 'middleHeader'
  | 'none';

export default function useConnectionStatus(
  lang: LangFn,
  connectionState: GlobalState['connectionState'],
  isSyncing: boolean | undefined,
  hasMiddleHeader: boolean,
  isMinimized?: boolean,
  isDisabled?: boolean,
) {
  let status: ConnectionStatus;
  const isBrowserOnline = useBrowserOnline();
  const guestConnection = usePxgState((state) => isProxyGuest() ? state.connection : undefined);
  const isGuestWaiting = guestConnection === 'connecting' || guestConnection === 'offline';
  if (!isBrowserOnline || isGuestWaiting || (guestConnection === undefined
    && connectionState === 'connectionStateConnecting')) {
    status = ConnectionStatus.waitingForNetwork;
  } else if (isSyncing) {
    status = ConnectionStatus.syncing;
  } else {
    status = ConnectionStatus.online;
  }

  let position: ConnectionStatusPosition;
  if (status === ConnectionStatus.online || isDisabled) {
    position = 'none';
  } else if (hasMiddleHeader) {
    position = 'middleHeader';
  } else if (isMinimized) {
    position = 'minimized';
  } else {
    position = 'overlay';
  }

  let text: string | undefined;
  if (status === ConnectionStatus.waitingForNetwork) {
    text = isBrowserOnline && isGuestWaiting
      ? lang(guestConnection === 'connecting' ? 'PxgConnectionServerWait' : 'PxgConnectionServerOffline')
      : lang('WaitingForNetwork');
  } else if (status === ConnectionStatus.syncing) {
    text = lang('Updating');
  }

  if (position === 'middleHeader') {
    text = text!.toLowerCase().replace(/\.+$/, '');
  }

  return {
    connectionStatus: status,
    connectionStatusPosition: position,
    connectionStatusText: text,
  };
}
