import { memo, useEffect, useState } from '../../../lib/teact/teact';

import type { MessageDto } from '../../../proxygram/server/types';

import { PXG_SERVER_URL } from '../../../proxygram/server/http';
import { pxgRpc } from '../../../proxygram/server/rpc';

import useLang from '../../../hooks/useLang';

import styles from './GuestApp.module.scss';

type OwnProps = {
  message: MessageDto;
  canDownload: boolean;
};

const IMAGE_TYPES = new Set(['photo', 'sticker']);

/** Вложение из архива сервера: фото показываем, остальное — ссылкой. Ссылка подписана и живёт 10 минут */
const GuestMedia = ({ message, canDownload }: OwnProps) => {
  const lang = useLang();
  const [url, setUrl] = useState<string>();
  const [isMissing, setIsMissing] = useState(false);
  const type = message.media?.type ?? 'file';
  const isImage = IMAGE_TYPES.has(type);

  useEffect(() => {
    if (!canDownload || !message.media?.key) return;
    pxgRpc.call<{ url: string }>('media.url', {
      accountId: message.accountId, peerId: message.peerId, msgId: message.msgId,
    })
      .then((result) => setUrl(`${PXG_SERVER_URL}${result.url}`))
      .catch(() => setIsMissing(true));
  }, [canDownload, message.accountId, message.media?.key, message.msgId, message.peerId]);

  if (isImage && url) {
    return <img className={styles.photo} src={url} alt="" loading="lazy" />;
  }

  return (
    <div className={styles.attachment}>
      <span className={styles.attachmentType}>{message.media?.fileName ?? lang('PxgGuestMedia', { type })}</span>
      {url && <a href={url} target="_blank" rel="noopener noreferrer">{lang('PxgGuestDownload')}</a>}
      {(isMissing || !canDownload) && (
        <span className={styles.attachmentNote}>
          {canDownload ? lang('PxgGuestMediaNotArchived') : lang('PxgGuestNoDownload')}
        </span>
      )}
    </div>
  );
};

export default memo(GuestMedia);
