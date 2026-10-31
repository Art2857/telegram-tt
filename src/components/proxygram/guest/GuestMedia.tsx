import { memo, useEffect, useState } from '../../../lib/teact/teact';

import type { MessageDto } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { PXG_SERVER_URL } from '../../../proxygram/server/http';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { mediaLabel } from '../helpers';

import useLang from '../../../hooks/useLang';

import AnimatedSticker from '../../common/AnimatedSticker';

import styles from './GuestApp.module.scss';

type OwnProps = {
  message: MessageDto;
  canDownload: boolean;
};

const STICKER_SIZE = 160;

/**
 * Вложение из архива сервера, как в Telegram: фото, стикеры (в том числе анимированные .tgs и видео .webm),
 * видео, GIF, кружки, голосовые и аудио; остальное — файлом. Ссылка подписана и живёт 10 минут.
 */
const GuestMedia = ({ message, canDownload }: OwnProps) => {
  const lang = useLang();
  const [url, setUrl] = useState<string>();
  const [isMissing, setIsMissing] = useState(false);
  const media = message.media;
  const kind = media?.kind ?? 'document';
  const mime = media?.mimeType ?? '';

  useEffect(() => {
    if (!canDownload || !media?.key) return;
    pxgRpc.call<{ url: string }>('media.url', {
      accountId: message.accountId, peerId: message.peerId, msgId: message.msgId,
    })
      .then((result) => setUrl(`${PXG_SERVER_URL}${result.url}`))
      .catch(() => setIsMissing(true));
  }, [canDownload, media?.key, message.accountId, message.msgId, message.peerId]);

  if (url) {
    if (kind === 'photo') return <img className={styles.photo} src={url} alt="" loading="lazy" />;

    if (kind === 'sticker') {
      if (mime === 'application/x-tgsticker') {
        return <AnimatedSticker className={styles.sticker} tgsUrl={url} size={STICKER_SIZE} play />;
      }
      if (mime.startsWith('video/')) {
        return <video className={styles.sticker} src={url} autoPlay loop muted playsInline />;
      }
      return <img className={styles.sticker} src={url} alt="" loading="lazy" />;
    }

    if (kind === 'gif') return <video className={styles.photo} src={url} autoPlay loop muted playsInline />;
    if (kind === 'video') return <video className={styles.photo} src={url} controls preload="metadata" />;
    if (kind === 'round') {
      return <video className={styles.round} src={url} controls preload="metadata" playsInline />;
    }
    if (kind === 'voice' || kind === 'audio') {
      return (
        <div className={styles.attachment}>
          {media?.fileName && <span className={styles.attachmentType}>{media.fileName}</span>}
          <audio className={styles.audio} src={url} controls preload="metadata" />
        </div>
      );
    }
  }

  return (
    <div className={buildClassName(styles.attachment, kind === 'sticker' && styles.stickerPlaceholder)}>
      <span className={styles.attachmentType}>{media?.fileName ?? mediaLabel(lang, message)}</span>
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
