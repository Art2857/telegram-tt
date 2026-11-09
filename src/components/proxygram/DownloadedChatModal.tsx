import { memo, useMemo, useState } from '../../lib/teact/teact';

import type { DownloadedChat } from '../../proxygram/downloadedChat';

import buildClassName from '../../util/buildClassName';
import { setPxgState } from '../../proxygram/server/store';
import { formatDateTime } from './helpers';

import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';

import styles from './DownloadedChatModal.module.scss';

const VISIBLE_MESSAGES = 500;

type OwnProps = {
  chat: DownloadedChat;
};

/** Локальный .pxgchat: читаем только то, что в файле, без сервера и Telegram */
const DownloadedChatModal = ({ chat }: OwnProps) => {
  const lang = useLang();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const messages = needle
      ? chat.messages.filter((message) => (
        message.text.toLowerCase().includes(needle)
        || message.senderName?.toLowerCase().includes(needle)
      ))
      : chat.messages;
    return messages.slice(-VISIBLE_MESSAGES);
  }, [chat.messages, query]);

  const close = () => setPxgState({ downloadedChat: undefined });

  return (
    <Modal isOpen title={chat.title} hasCloseButton onClose={close} className={styles.root}>
      <p className={styles.meta}>
        {lang('PxgDownloadedMeta', {
          count: chat.messageCount,
          date: formatDateTime(chat.exportedAt),
        })}
      </p>
      <p className={styles.meta}>{lang('PxgDownloadedReadOnly')}</p>
      <InputText
        className={styles.search}
        label={lang('PxgDownloadedSearch')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={buildClassName(styles.list, 'custom-scroll')}>
        {!visible.length ? <p className={styles.meta}>{lang('PxgDownloadedEmpty')}</p> : visible.map((message) => (
          <div
            key={message.id}
            className={buildClassName(styles.message, message.isDeleted && styles.deleted)}
          >
            <div className={styles.senderLine}>
              <span className={styles.sender}>{message.senderName ?? lang('PxgDownloadedUnknownSender')}</span>
              <span className={styles.date}>{formatDateTime(message.date)}</span>
              {message.isEdited && <span className={styles.date}>{lang('PxgDownloadedEdited')}</span>}
              {message.isDeleted && <span className={styles.date}>{lang('PxgDownloadedDeleted')}</span>}
            </div>
            <div className={styles.text}>
              {message.text || (message.mediaKind ? lang('PxgDownloadedMedia', { kind: message.mediaKind }) : '')}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.buttons}>
        <Button color="translucent" onClick={close}>{lang('PxgDownloadedClose')}</Button>
      </div>
    </Modal>
  );
};

export default memo(DownloadedChatModal);
