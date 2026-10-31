import { memo, useEffect, useMemo, useState } from '../../../lib/teact/teact';

import type { AccessChat } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { signOutPxg } from '../../../proxygram/server/session';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import DropdownMenu from '../../ui/DropdownMenu';
import MenuItem from '../../ui/MenuItem';
import AdminPanel from '../admin/AdminPanel';
import PxgAvatar from '../PxgAvatar';
import GuestChat from './GuestChat';

import styles from './GuestApp.module.scss';

const chatKey = (chat: { accountId: string; peerId: number }) => `${chat.accountId}:${chat.peerId}`;

/**
 * Режим гостя: только чаты, открытые этому человеку, через сервер (PLAN.md, 7.7–7.8).
 * Сессии Telegram на устройстве нет — всё идёт через WebSocket RPC.
 */
const GuestApp = () => {
  const lang = useLang();
  const session = usePxgState((state) => state.session);
  const connection = usePxgState((state) => state.connection);
  const isAdminOpen = usePxgState((state) => state.isAdminOpen);
  const [chats, setChats] = useState<AccessChat[]>();
  const [activeKey, setActiveKey] = useState<string>();
  const [error, setError] = useState<string>();

  const activeChat = useMemo(() => chats?.find((chat) => chatKey(chat) === activeKey), [chats, activeKey]);

  useEffect(() => {
    if (connection !== 'online') return undefined;
    const load = () => pxgRpc.call<AccessChat[]>('access.chats')
      .then((list) => {
        setChats(list);
        setError(undefined);
      })
      .catch((err) => setError(describePxgError(lang, err)));
    void load();
    // доступ выдали или отозвали — список меняется сразу
    return pxgRpc.on((event) => {
      if (event.e === 'access.changed') void load();
    });
  }, [connection, lang]);

  // «Сейчас читают» в админке: сообщаем открытый чат, а при уходе со вкладки — что ничего не открыто
  useEffect(() => {
    if (connection !== 'online') return undefined;
    const report = () => {
      const isVisible = document.visibilityState === 'visible';
      const params = activeChat && isVisible ? { accountId: activeChat.accountId, peerId: activeChat.peerId } : {};
      void pxgRpc.call('presence.set', params).catch(() => undefined);
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [activeChat, connection]);

  const signInWithTelegram = () => {
    signOutPxg();
    setPxgState({ authChoice: 'telegram' });
  };

  const isAdmin = session?.user.role === 'admin';
  const username = session?.user.username;

  return (
    <div className={styles.root}>
      <aside className={buildClassName(styles.sidebar, activeChat && styles.sidebarHidden)}>
        <header className={styles.sidebarHeader}>
          <DropdownMenu
            trigger={({ onTrigger, isOpen }) => (
              <Button
                round
                size="smaller"
                color="translucent"
                iconName="hamburger"
                onClick={onTrigger}
                className={isOpen ? 'active' : undefined}
                ariaLabel={lang('PxgGuestMenu')}
              />
            )}
          >
            {isAdmin && (
              <MenuItem icon="admin" onClick={() => setPxgState({ isAdminOpen: true })}>
                {lang('PxgAdminTitle')}
              </MenuItem>
            )}
            <MenuItem icon="key" onClick={signInWithTelegram}>{lang('PxgAuthTelegram')}</MenuItem>
            <MenuItem icon="logout" destructive onClick={signOutPxg}>{lang('PxgSignOut')}</MenuItem>
          </DropdownMenu>
          <div className={styles.headerTitle}>
            <h3>{lang('PxgGuestChatsTitle')}</h3>
            <span className={styles.subtitle}>
              {connection === 'online'
                ? lang('PxgGuestSignedInAs', { name: username ? `@${username}` : session?.user.firstName ?? '' })
                : lang('PxgGuestConnecting')}
            </span>
          </div>
        </header>

        <div className={buildClassName(styles.chatList, 'custom-scroll')}>
          {error && <p className={styles.empty}>{error}</p>}
          {chats?.length === 0 && (
            <p className={styles.empty}>{lang('PxgGuestNoChats', { username: username ?? '' })}</p>
          )}
          {chats?.map((chat) => {
            const key = chatKey(chat);
            return (
              <button
                key={key}
                type="button"
                className={buildClassName(styles.chatItem, key === activeKey && styles.chatItemActive)}
                onClick={() => setActiveKey(key)}
              >
                <PxgAvatar seed={key} title={chat.title} size={54} isProxy />
                <span className={styles.chatText}>
                  <span className={styles.chatTitle}>{chat.title ?? lang('PxgGuestUnknownChat')}</span>
                  <span className={styles.chatSubtitle}>
                    {chat.permissions.write ? lang('PxgGuestCanWrite') : lang('PxgGuestReadOnly')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className={styles.main}>
        {activeChat ? (
          <GuestChat key={chatKey(activeChat)} chat={activeChat} onBack={() => setActiveKey(undefined)} />
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.placeholderBadge}>{lang('PxgGuestSelectChat')}</span>
          </div>
        )}
      </main>

      {isAdminOpen && <AdminPanel />}
    </div>
  );
};

export default memo(GuestApp);
