import { memo, useEffect } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { AccountDto } from '../../proxygram/server/types';

import { callApi } from '../../api/gramjs';
import { pollLogin, startLogin } from '../../proxygram/server/http';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgSession, signOutPxg } from '../../proxygram/server/session';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store';

import AdminPanel from './admin/AdminPanel';
import ConnectServerModal from './ConnectServerModal';
import ShareChatModal from './ShareChatModal';
import TombstonesLoader from './TombstonesLoader';

type StateProps = {
  currentUserId?: string;
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
/** Сервер недоступен — пробуем снова, не мешая пользоваться Telegram */
const RETRY_DELAY_MS = 60_000;

export const connectDismissKey = (tgUserId: string | number) => `pxg-connect-dismissed-${tgUserId}`;

/**
 * Связка полного входа с сервером Proxygram (PLAN.md, 7.3–7.4). После входа в Telegram:
 * 1) сама получает системную сессию — нажимает Start у бота своей сессией, человек ничего не вводит;
 * 2) один раз предлагает разрешить раздачу чатов (подключить сервер);
 * 3) держит окна «Поделиться чатом», подключения и админку.
 */
const ProxygramBridge = ({ currentUserId }: StateProps) => {
  const session = usePxgState((state) => state.session);
  const connection = usePxgState((state) => state.connection);
  const isConnectOpen = usePxgState((state) => state.isConnectOpen);
  const isAdminOpen = usePxgState((state) => state.isAdminOpen);
  const shareChatId = usePxgState((state) => state.shareChatId);
  // архив этого аккаунта на сервере есть, даже если раздача сейчас на паузе или отключена
  const ownAccountId = usePxgState((state) => state.accounts?.find(
    (account) => String(account.tgUserId) === currentUserId,
  )?.id);

  const hasOwnSession = Boolean(
    session && session.level === 'client' && currentUserId && String(session.user.tgUserId) === currentUserId,
  );

  useEffect(() => {
    if (!currentUserId || hasOwnSession) return undefined;
    // сессия гостя или чужого аккаунта (сменили аккаунт Telegram) здесь не подходит
    if (getPxgState().session) signOutPxg();

    let isActive = true;
    let retryTimer: number | undefined;
    const attempt = async () => {
      try {
        await obtainSession(() => isActive);
      } catch {
        if (isActive) retryTimer = window.setTimeout(() => void attempt(), RETRY_DELAY_MS);
      }
    };
    void attempt();
    return () => {
      isActive = false;
      window.clearTimeout(retryTimer);
    };
  }, [currentUserId, hasOwnSession]);

  // Свои аккаунты на сервере; если раздача не включена — один раз предлагаем
  useEffect(() => {
    if (!hasOwnSession || connection !== 'online' || !currentUserId) return;
    void pxgRpc.call<AccountDto[]>('accounts.mine').then((accounts) => {
      setPxgState({ accounts });
      const isSharing = accounts.some((account) => account.status === 'active' || account.status === 'paused');
      if (!isSharing && !localStorage.getItem(connectDismissKey(currentUserId))) {
        setPxgState({ isConnectOpen: true });
      }
    }).catch(() => undefined);
  }, [connection, currentUserId, hasOwnSession]);

  return (
    <>
      {hasOwnSession && ownAccountId && connection === 'online' && <TombstonesLoader accountId={ownAccountId} />}
      {isConnectOpen && <ConnectServerModal />}
      {shareChatId && <ShareChatModal chatId={shareChatId} />}
      {isAdminOpen && <AdminPanel />}
    </>
  );
};

async function obtainSession(isActive: () => boolean) {
  const started = await startLogin({ level: 'client' });
  if (started.delivery !== 'deeplink') throw new Error('unexpected delivery');
  const link = new URL(started.deeplink);
  const botUsername = link.pathname.replace(/^\//, '');
  const startParam = link.searchParams.get('start');
  if (!botUsername || !startParam) throw new Error('bad deeplink');

  await callApi('pxgStartBot', botUsername, startParam);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (isActive() && Date.now() < deadline) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, POLL_INTERVAL_MS);
    });
    const result = await pollLogin(started);
    if ('accessToken' in result) {
      if (isActive()) setPxgSession(result);
      return;
    }
  }
  throw new Error('timeout');
}

export default memo(withGlobal(
  (global): Complete<StateProps> => ({ currentUserId: global.currentUserId }),
)(ProxygramBridge));
