import type { KeyboardEvent } from 'react';
import { memo, useEffect, useMemo, useRef, useState } from '../../../lib/teact/teact';

import type { AccessChat, MessageDto } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { signOutPxg } from '../../../proxygram/server/session';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError, formatTime } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import DropdownMenu from '../../ui/DropdownMenu';
import MenuItem from '../../ui/MenuItem';
import AdminPanel from '../admin/AdminPanel';
import PxgAvatar from '../PxgAvatar';
import GuestMedia from './GuestMedia';

import styles from './GuestApp.module.scss';

const PAGE_SIZE = 50;

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

type ChatProps = {
  chat: AccessChat;
  onBack: NoneToVoidFunction;
};

const GuestChat = memo(({ chat, onBack }: ChatProps) => {
  const lang = useLang();
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();
  const [isNoticeShown, setIsNoticeShown] = useState(() => !localStorage.getItem('pxg-write-notice-seen'));
  const listRef = useRef<HTMLDivElement>();
  const lastReadRef = useRef(0);
  const { accountId, peerId, permissions } = chat;

  const merge = (incoming: MessageDto[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.msgId, message]));
      incoming.forEach((message) => byId.set(message.msgId, message));
      return [...byId.values()].sort((a, b) => a.msgId - b.msgId);
    });
  };

  const loadLatest = async () => {
    const page = await pxgRpc.call<MessageDto[]>('messages.history', { accountId, peerId, limit: PAGE_SIZE });
    merge(page);
    return page;
  };

  useEffect(() => {
    setIsLoading(true);
    loadLatest()
      .then((page) => {
        setHasMore(page.length === PAGE_SIZE);
        requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
      })
      .catch((err) => setError(describePxgError(lang, err)))
      .finally(() => setIsLoading(false));

    // новое, правка, удаление в этом чате — подтягиваем свежую страницу
    return pxgRpc.on((event) => {
      if (event.e === 'archive.change' && event.d.accountId === accountId && event.d.peerId === peerId) {
        const list = listRef.current;
        const isAtBottom = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 80 : true;
        void loadLatest().then(() => {
          if (isAtBottom) requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }));
        });
      }
      if (event.e === 'outbox.done' && event.d.peerId === peerId && event.d.status === 'failed') {
        setError(event.d.error ?? lang('PxgErrorGeneric'));
      }
    });
    // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
  }, [accountId, peerId]);

  // прочтение отмечается от имени владельца — как и задумано (PLAN.md, 19.8)
  useEffect(() => {
    const maxId = messages.at(-1)?.msgId ?? 0;
    if (!permissions.markRead || maxId <= lastReadRef.current || document.visibilityState !== 'visible') return;
    lastReadRef.current = maxId;
    void pxgRpc.call('messages.read', { accountId, peerId, maxId }).catch(() => undefined);
  }, [accountId, messages, peerId, permissions.markRead]);

  const loadOlder = async () => {
    const oldest = messages[0]?.msgId;
    if (!oldest || isLoading) return;
    setIsLoading(true);
    const list = listRef.current;
    const fromBottom = list ? list.scrollHeight - list.scrollTop : 0;
    try {
      const page = await pxgRpc.call<MessageDto[]>('messages.history', {
        accountId, peerId, beforeMsgId: oldest, limit: PAGE_SIZE,
      });
      merge(page);
      setHasMore(page.length === PAGE_SIZE);
      requestAnimationFrame(() => list?.scrollTo({ top: list.scrollHeight - fromBottom }));
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsLoading(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setError(undefined);
    try {
      await pxgRpc.call('messages.send', { accountId, peerId, text });
    } catch (err) {
      setDraft(text);
      setError(describePxgError(lang, err));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const dismissNotice = () => {
    localStorage.setItem('pxg-write-notice-seen', '1');
    setIsNoticeShown(false);
  };

  return (
    <div className={styles.chat}>
      <header className={styles.chatHeader}>
        <Button
          round
          size="smaller"
          color="translucent"
          iconName="arrow-left"
          className={styles.backButton}
          onClick={onBack}
          ariaLabel={lang('PxgGuestBack')}
        />
        <PxgAvatar seed={`${accountId}:${peerId}`} title={chat.title} size={42} isProxy />
        <div className={styles.headerTitle}>
          <h3>{chat.title ?? lang('PxgGuestUnknownChat')}</h3>
          <span className={styles.subtitle}>{lang('PxgGuestViaProxy')}</span>
        </div>
      </header>

      <div ref={listRef} className={buildClassName(styles.messages, 'custom-scroll')}>
        {hasMore && messages.length > 0 && (
          <div className={styles.loadMore}>
            <Button size="smaller" color="translucent" pill fluid={false} isLoading={isLoading} onClick={loadOlder}>
              {lang('PxgGuestLoadOlder')}
            </Button>
          </div>
        )}
        {!isLoading && messages.length === 0 && <p className={styles.empty}>{lang('PxgGuestNoMessages')}</p>}
        {messages.map((message) => (
          <GuestMessage key={message.msgId} message={message} chat={chat} />
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {permissions.write ? (
        <footer className={styles.composer}>
          {isNoticeShown && (
            <div className={styles.notice}>
              <span className={styles.noticeText}>{lang('PxgGuestWriteNotice')}</span>
              <Button
                size="tiny"
                color="translucent"
                isText
                fluid
                className={styles.noticeButton}
                onClick={dismissNotice}
              >
                {lang('PxgGuestNoticeOk')}
              </Button>
            </div>
          )}
          <div className={styles.inputRow}>
            <textarea
              className={styles.input}
              rows={1}
              value={draft}
              placeholder={lang('PxgGuestMessagePlaceholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <Button
              round
              color="secondary"
              iconName="send"
              disabled={!draft.trim()}
              onClick={() => void send()}
              ariaLabel={lang('PxgGuestSend')}
            />
          </div>
        </footer>
      ) : (
        <footer className={styles.readOnly}>{lang('PxgGuestReadOnly')}</footer>
      )}
    </div>
  );
});

const GuestMessage = memo(({ message, chat }: { message: MessageDto; chat: AccessChat }) => {
  const lang = useLang();

  if (message.isService) {
    return <div className={styles.service}>{message.text || lang('PxgGuestServiceMessage')}</div>;
  }

  return (
    <div className={buildClassName(styles.messageRow, message.isOutgoing && styles.outgoing)}>
      <div className={buildClassName(styles.bubble, message.deleted && styles.deleted)}>
        {message.media && (
          <GuestMedia message={message} canDownload={chat.permissions.download} />
        )}
        {message.text && <div className={styles.text}>{message.text}</div>}
        <div className={styles.meta}>
          {message.deleted && <span className={styles.deletedMark}>{lang('PxgDeleted')}</span>}
          {message.editDate && !message.deleted && <span>{lang('PxgGuestEdited')}</span>}
          {message.sentByUserId && <span>✍</span>}
          <span>{formatTime(message.date)}</span>
        </div>
      </div>
    </div>
  );
});

export default memo(GuestApp);
