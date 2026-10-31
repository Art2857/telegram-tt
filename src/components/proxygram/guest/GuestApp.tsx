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
import MenuSeparator from '../../ui/MenuSeparator';
import AdminPanel from '../admin/AdminPanel';
import GuestAccountItems from '../GuestAccountItems';
import PxgAvatar from '../PxgAvatar';
import GuestChat from './GuestChat';

import styles from './GuestApp.module.scss';

const chatKey = (chat: { accountId: string; peerId: number }) => `${chat.accountId}:${chat.peerId}`;

type OwnProps = {
  /**
   * Открыт поверх полного клиента («Открыто мне»): вместо меню выхода — кнопка «Закрыть»,
   * админку и выход держит сам полный клиент.
   */
  onClose?: NoneToVoidFunction;
};

/**
 * Режим гостя: только чаты, открытые этому человеку, через сервер (PLAN.md, 7.7–7.8).
 * Сессии Telegram на устройстве нет — всё идёт через WebSocket RPC. Тот же экран открывается
 * и поверх полного клиента — для чатов, которые открыли этому человеку другие.
 */
const GuestApp = ({ onClose }: OwnProps) => {
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

  const isAdmin = session?.user.role === 'admin';
  const username = session?.user.username;

  return (
    <div className={buildClassName(styles.root, onClose && styles.overlay)}>
      <aside className={buildClassName(styles.sidebar, activeChat && styles.sidebarHidden)}>
        <header className={styles.sidebarHeader}>
          {onClose ? (
            <Button
              round
              size="smaller"
              color="translucent"
              iconName="close"
              onClick={onClose}
              ariaLabel={lang('Close')}
            />
          ) : (
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
              {/* как в Telegram: другие аккаунты (и гостевые, и полные) и «Добавить аккаунт» */}
              <GuestAccountItems isStandalone />
              <MenuSeparator />
              {isAdmin && (
                <MenuItem icon="admin" onClick={() => setPxgState({ isAdminOpen: true })}>
                  {lang('PxgAdminTitle')}
                </MenuItem>
              )}
              <MenuItem icon="logout" destructive onClick={signOutPxg}>{lang('PxgSignOut')}</MenuItem>
            </DropdownMenu>
          )}
          <div className={styles.headerTitle}>
            <h3>{lang('PxgGuestChatsTitle')}</h3>
            <span className={styles.subtitle}>
              {connection !== 'online'
                ? lang('PxgGuestConnecting')
                : onClose
                  ? lang('PxgSharedWithMeHint')
                  : lang('PxgGuestSignedInAs', { name: username ? `@${username}` : session?.user.firstName ?? '' })}
            </span>
          </div>
        </header>

        <div className={buildClassName(styles.chatList, 'custom-scroll')}>
          {error && <p className={styles.empty}>{error}</p>}
          {chats?.length === 0 && (
            <p className={styles.empty}>
              {username ? lang('PxgGuestNoChats', { username }) : lang('PxgGuestNoChatsNoUsername')}
            </p>
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

      {isAdminOpen && !onClose && <AdminPanel />}
    </div>
  );
};

export default memo(GuestApp);
