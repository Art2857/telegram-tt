import { memo, useEffect } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiChat } from '../../api/types';
import type { AccountDto, OutboxDoneDto, OutgoingChatDto } from '../../proxygram/server/types';

import { selectCurrentMessageList } from '../../global/selectors';
import { callApi } from '../../api/gramjs';
import { getProxyPeerId, setProxyUpdateHandler } from '../../api/proxy';
import { buildProxyUserStatus } from '../../api/proxy/builders';
import { isProxyPeerId } from '../../api/proxy/ids';
import { startGuestSettingsSync } from '../../proxygram/guestSettings';
import { pollLogin, startLogin } from '../../proxygram/server/http';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgSession, signOutPxg } from '../../proxygram/server/session';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store';

import AdminPanel from './admin/AdminPanel';
import ConnectServerModal from './ConnectServerModal';
import LocalArchiveLoader from './LocalArchiveLoader';
import PxgSettingsPanel from './settings/PxgSettingsPanel';
import ShareChatModal from './ShareChatModal';
import TombstonesLoader from './TombstonesLoader';

type StateProps = {
  currentUserId?: string;
  proxyPeer?: ApiChat['pxgProxy'];
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;
/** Сервер недоступен — пробуем снова, не мешая пользоваться Telegram */
const RETRY_DELAY_MS = 60_000;
/** Фоновые действия: о задержке Telegram гостю не сообщаем */
const SILENT_JOB_KINDS = new Set<OutboxDoneDto['kind']>(['read', 'typing', 'history']);

export const connectDismissKey = (tgUserId: string | number) => `pxg-connect-dismissed-${tgUserId}`;

/**
 * Связка полного входа с сервером Proxygram (PLAN.md, 7.3–7.4). После входа в Telegram:
 * 1) сама получает системную сессию — нажимает Start у бота своей сессией, человек ничего не вводит;
 * 2) один раз предлагает разрешить раздачу чатов (подключить сервер);
 * 3) держит окна «Поделиться чатом», подключения и админку.
 */
const ProxygramBridge = ({ currentUserId, proxyPeer }: StateProps) => {
  const {
    loadProxyChats, refreshProxyMessage, refreshProxyHistory, refreshProxyTopics, refreshProxyUnread,
    applyProxyChatState, applyProxyTyping, apiUpdate, showNotification,
    loadChatFolders, setSharedSettingOption,
  } = getActions();
  const session = usePxgState((state) => state.session);
  const connection = usePxgState((state) => state.connection);
  const isConnectOpen = usePxgState((state) => state.isConnectOpen);
  const isAdminOpen = usePxgState((state) => state.isAdminOpen);
  const isSettingsOpen = usePxgState((state) => state.isSettingsOpen);
  const shareChatId = usePxgState((state) => state.shareChatId);
  const shareFolder = usePxgState((state) => state.shareFolder);
  const shareTopic = usePxgState((state) => state.shareTopic);
  // архив этого аккаунта на сервере есть, даже если раздача сейчас на паузе или отключена
  const ownAccountId = usePxgState((state) => state.accounts?.find(
    (account) => String(account.tgUserId) === currentUserId,
  )?.id);

  const hasOwnSession = Boolean(
    session && session.level === 'client' && currentUserId && String(session.user.tgUserId) === currentUserId,
  );
  const isGuest = Boolean(session?.level === 'guest' && currentUserId && isProxyPeerId(currentUserId));

  useEffect(() => {
    if (!isGuest) return undefined;
    return startGuestSettingsSync(setSharedSettingOption);
  }, [isGuest, session?.user.id, setSharedSettingOption]);

  useEffect(() => {
    if (!isGuest) return;
    apiUpdate({
      '@type': 'updateConnectionState',
      connectionState: connection === 'online' ? 'connectionStateReady' : 'connectionStateConnecting',
    });
  }, [isGuest, connection, apiUpdate]);

  useEffect(() => {
    if (!currentUserId || hasOwnSession || isGuest) return undefined;
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
  }, [currentUserId, hasOwnSession, isGuest]);

  // Свои аккаунты на сервере; если раздача не включена — один раз предлагаем
  useEffect(() => {
    if (!hasOwnSession || connection !== 'online' || !currentUserId) return undefined;
    void pxgRpc.call<AccountDto[]>('accounts.mine').then((accounts) => {
      setPxgState({ accounts });
      const isSharing = accounts.some((account) => (
        account.status === 'active' || account.status === 'paused' || account.status === 'flood'
      ));
      const isLost = accounts.some((account) => account.status === 'auth_lost');
      if (!isSharing && !isLost && !localStorage.getItem(connectDismissKey(currentUserId))) {
        setPxgState({ isConnectOpen: true });
      }
      if (isLost) showNotification({ message: { key: 'PxgAccountAuthLost' } });
    }).catch(() => undefined);
    // Статус аккаунта поменялся на сервере (потеря сессии, флуд) — перечитать и сказать владельцу
    return pxgRpc.on((event) => {
      if (event.e !== 'accounts.changed') return;
      void pxgRpc.call<AccountDto[]>('accounts.mine').then((accounts) => setPxgState({ accounts }))
        .catch(() => undefined);
      if (event.d.status === 'auth_lost') showNotification({ message: { key: 'PxgAccountAuthLost' } });
      if (event.d.status === 'flood') showNotification({ message: { key: 'PxgAccountFlood' } });
    });
  }, [connection, currentUserId, hasOwnSession, showNotification]);

  // Кому открыты свои чаты — для подписи в списке чатов
  useEffect(() => {
    if (!hasOwnSession || !ownAccountId || connection !== 'online') return undefined;
    const load = () => {
      void pxgRpc.call<OutgoingChatDto[]>('shares.outgoingChats').then((chats) => {
        setPxgState({
          sharedChats: Object.fromEntries(chats
            .filter((chat) => chat.accountId === ownAccountId)
            .map((chat) => [String(chat.peerId), chat.grantees])),
        });
      }).catch(() => undefined);
    };
    load();
    return pxgRpc.on((event) => {
      if (event.e === 'shares.changed') load();
    });
  }, [connection, hasOwnSession, ownAccountId]);

  // Сколько чатов открыли этому человеку — для пункта меню «Открыто мне»; доступ выдали или отозвали — пересчёт
  useEffect(() => {
    if ((!hasOwnSession && !isGuest) || connection !== 'online') return undefined;
    setProxyUpdateHandler(apiUpdate);
    loadProxyChats();
    if (isGuest) loadChatFolders();
    return pxgRpc.on((event) => {
      // Sent for a profile change too: only a chat whose access is gone closes
      if (event.e === 'access.changed') loadProxyChats({ shouldKeepUnchanged: true });
      if (event.e === 'archive.change') refreshProxyMessage(event.d);
      if (event.e === 'outbox.done' && event.d.status === 'delayed' && !SILENT_JOB_KINDS.has(event.d.kind)) {
        showNotification({ message: { key: 'PxgFloodDelay', variables: { seconds: event.d.retryInSeconds } } });
      }
      if (event.e === 'outbox.done' && event.d.status !== 'delayed' && event.d.kind === 'history') {
        refreshProxyHistory(event.d);
      }
      if (event.e === 'topics.changed') refreshProxyTopics(event.d);
      if (event.e === 'read.changed') refreshProxyUnread(event.d);
      if (event.e === 'chats.state') applyProxyChatState(event.d);
      if (event.e === 'folders.changed' && isGuest) loadChatFolders();
      if (event.e === 'chat.typing') applyProxyTyping(event.d);
      if (event.e === 'user.status') {
        apiUpdate({
          '@type': 'updateUserStatus',
          userId: getProxyPeerId(event.d.accountId, event.d.userId),
          status: buildProxyUserStatus(event.d.status),
        });
      }
    });
  }, [connection, hasOwnSession, isGuest, loadProxyChats, refreshProxyMessage, refreshProxyHistory,
    refreshProxyTopics, refreshProxyUnread, applyProxyChatState, applyProxyTyping, apiUpdate, showNotification,
    loadChatFolders]);

  useEffect(() => {
    if ((!hasOwnSession && !isGuest) || connection !== 'online') return undefined;
    const report = () => {
      const params = document.visibilityState === 'visible' && proxyPeer
        ? { accountId: proxyPeer.accountId, peerId: proxyPeer.peerId } : {};
      void pxgRpc.call('presence.set', params).catch(() => undefined);
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [connection, hasOwnSession, isGuest, proxyPeer]);

  return (
    <>
      {hasOwnSession && ownAccountId && connection === 'online' && <TombstonesLoader accountId={ownAccountId} />}
      {currentUserId && !isProxyPeerId(currentUserId) && <LocalArchiveLoader ownerId={currentUserId} />}
      {isConnectOpen && <ConnectServerModal />}
      {(shareChatId || shareFolder) && (
        <ShareChatModal
          key={`${shareChatId}:${shareFolder?.id}:${shareTopic?.id}`}
          chatId={shareChatId}
          folder={shareFolder}
          topic={shareTopic}
        />
      )}
      {isAdminOpen && <AdminPanel />}
      {isSettingsOpen && <PxgSettingsPanel />}
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
  (global): Complete<StateProps> => {
    const chatId = selectCurrentMessageList(global)?.chatId;
    return { currentUserId: global.currentUserId, proxyPeer: chatId ? global.chats.byId[chatId]?.pxgProxy : undefined };
  },
)(ProxygramBridge));
