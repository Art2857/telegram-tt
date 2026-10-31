import type { KeyboardEvent } from 'react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../../lib/teact/teact';

import type { AccessChat, MessageDto } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { describePxgError } from '../helpers';
import useGuestHistory from './useGuestHistory';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import Spinner from '../../ui/Spinner';
import PxgAvatar from '../PxgAvatar';
import GuestMessage from './GuestMessage';

import styles from './GuestApp.module.scss';

/** Ближе к верху, чем столько пикселей, — подгружаем раньше, как при прокрутке в Telegram */
const LOAD_OLDER_THRESHOLD_PX = 400;
const STICK_TO_BOTTOM_PX = 120;

type OwnProps = {
  chat: AccessChat;
  onBack: NoneToVoidFunction;
};

const GuestChat = ({ chat, onBack }: OwnProps) => {
  const lang = useLang();
  const { accountId, peerId, permissions } = chat;
  const [error, setError] = useState<string>();
  const onError = (err: unknown) => setError(describePxgError(lang, err));
  const history = useGuestHistory(accountId, peerId, onError);
  const { messages } = history;
  const [draft, setDraft] = useState('');
  const [isNoticeShown, setIsNoticeShown] = useState(() => !localStorage.getItem('pxg-write-notice-seen'));
  const listRef = useRef<HTMLDivElement>();
  const lastReadRef = useRef(0);
  // расстояние от низа списка: при подгрузке сверху лента не должна прыгать
  const fromBottomRef = useRef(0);
  const edgesRef = useRef<{ first?: number; last?: number }>({});

  const byId = useMemo(() => new Map(messages.map((message) => [message.msgId, message])), [messages]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || messages.length === 0) return;
    const first = messages[0].msgId;
    const last = messages[messages.length - 1].msgId;
    const prev = edgesRef.current;
    edgesRef.current = { first, last };

    if (prev.last === undefined) {
      list.scrollTop = list.scrollHeight;
    } else if (first !== prev.first && last === prev.last) {
      // подгрузили старые — держим видимое место
      list.scrollTop = list.scrollHeight - fromBottomRef.current;
    } else if (last !== prev.last && fromBottomRef.current - list.clientHeight < STICK_TO_BOTTOM_PX) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    fromBottomRef.current = list.scrollHeight - list.scrollTop;
    if (list.scrollTop < LOAD_OLDER_THRESHOLD_PX && history.canLoadOlder && !history.isLoading
      && !history.isImporting) {
      void history.loadOlder();
    }
  };

  // прочтение отмечается от имени владельца — как и задумано (PLAN.md, 19.8)
  useEffect(() => {
    const maxId = messages.at(-1)?.msgId ?? 0;
    if (!permissions.markRead || maxId <= lastReadRef.current || document.visibilityState !== 'visible') return;
    lastReadRef.current = maxId;
    void pxgRpc.call('messages.read', { accountId, peerId, maxId }).catch(() => undefined);
  }, [accountId, messages, peerId, permissions.markRead]);

  // отказ Telegram по действию гостя (отправка, реакция) — показываем
  useEffect(() => pxgRpc.on((event) => {
    if (event.e === 'outbox.done' && event.d.peerId === peerId && event.d.status === 'failed') {
      setError(event.d.error ?? lang('PxgErrorGeneric'));
    }
  }), [lang, peerId]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setError(undefined);
    fromBottomRef.current = 0;
    try {
      await pxgRpc.call('messages.send', { accountId, peerId, text });
    } catch (err) {
      setDraft(text);
      onError(err);
    }
  };

  const react = (message: MessageDto, emoji?: string) => {
    pxgRpc.call('messages.react', {
      accountId,
      peerId,
      msgId: message.msgId,
      // в протоколе снятая реакция — null
      // eslint-disable-next-line no-null/no-null
      emoji: emoji ?? null,
    }).catch(onError);
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

  function renderTop() {
    if (history.isImporting || (history.isLoading && messages.length > 0)) {
      return (
        <div className={styles.historyState}>
          <Spinner className={styles.historySpinner} />
          <span>{history.isImporting ? lang('PxgGuestLoadingHistory') : lang('Loading')}</span>
        </div>
      );
    }
    if (!history.canLoadOlder && messages.length > 0) {
      return <div className={styles.historyState}>{lang('PxgGuestHistoryStart')}</div>;
    }
    return undefined;
  }

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

      <div ref={listRef} className={buildClassName(styles.messages, 'custom-scroll')} onScroll={handleScroll}>
        {renderTop()}
        {!history.isLoading && !history.isImporting && messages.length === 0 && (
          <p className={styles.empty}>{lang('PxgGuestNoMessages')}</p>
        )}
        {messages.flatMap((message, index) => {
          const day = dayKey(message.date);
          const replyId = message.replyTo?.replyToMsgId;
          const items = [];
          if (index === 0 || dayKey(messages[index - 1].date) !== day) {
            items.push(<div key={`day-${day}`} className={styles.service}>{formatDay(lang, message.date)}</div>);
          }
          items.push(
            <GuestMessage
              key={message.msgId}
              message={message}
              chat={chat}
              replyTarget={replyId ? byId.get(replyId) : undefined}
              onReact={react}
            />,
          );
          return items;
        })}
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
};

function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

/** «Сегодня», «Вчера» или дата — как разделители дней в Telegram */
function formatDay(lang: ReturnType<typeof useLang>, iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 3600_000);
  if (date.toDateString() === today.toDateString()) return lang('PxgGuestToday');
  if (date.toDateString() === yesterday.toDateString()) return lang('PxgGuestYesterday');
  return date.toLocaleDateString(lang.code, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export default memo(GuestChat);
