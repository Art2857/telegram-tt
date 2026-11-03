import { memo, useEffect, useMemo, useState } from '../../lib/teact/teact';

import type { ApiMessage, PxgEditVersion } from '../../api/types';
import type { MessageVersionDto, VersionFileDto } from '../../proxygram/server/types';
import { PxgError } from '../../proxygram/server/types';

import { selectChat } from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { formatDateTime, secondsToDate } from '../../util/localization/dateFormat';
import { pause } from '../../util/schedulers';
import { isProxyPeerId } from '../../api/proxy/ids';
import { diffWords } from '../../proxygram/archive/editHistory';
import { PXG_SERVER_URL } from '../../proxygram/server/http';
import { getOwnAccountId } from '../../proxygram/server/ownAccount';
import { pxgRpc } from '../../proxygram/server/rpc';
import renderText from '../common/helpers/renderText';

import useSelector from '../../hooks/data/useSelector';
import useLang from '../../hooks/useLang';

import Checkbox from '../ui/Checkbox';
import Modal from '../ui/Modal';

import styles from './EditHistoryModal.module.scss';

type OwnProps = {
  isOpen: boolean;
  message: ApiMessage;
  onClose: NoneToVoidFunction;
};

type VersionView = {
  key: string;
  label: string;
  date: number;
  text: string;
  previousText?: string;
  /** The file was replaced in this version: which kind of file the note names */
  replacedKind?: string;
  /** A preview is shown only around a replacement: `version` is empty for the current file */
  file?: { media: VersionFileDto; version?: number };
};

const REPLACED_KEYS: Partial<Record<string, 'PxgEditHistoryPhotoReplaced' | 'PxgEditHistoryVideoReplaced'>> = {
  photo: 'PxgEditHistoryPhotoReplaced',
  video: 'PxgEditHistoryVideoReplaced',
  gif: 'PxgEditHistoryVideoReplaced',
  round: 'PxgEditHistoryVideoReplaced',
};
const PREVIEW_IMAGE_KINDS = new Set(['photo', 'sticker']);
const PREVIEW_VIDEO_KINDS = new Set(['video', 'gif', 'round']);
const PREVIEW_AUDIO_KINDS = new Set(['voice', 'audio']);
/** The current file may be outside the archive: the server fetches it while the preview waits */
const FILE_WAIT_ATTEMPTS = 8;
const FILE_WAIT_INTERVAL_MS = 2000;

const EditHistoryModal = ({ isOpen, message, onClose }: OwnProps) => {
  const lang = useLang();
  const [shouldShowDiff, setShouldShowDiff] = useState(true);
  // Устройство правку не застало (было закрыто) — берём версии из серверного архива своего аккаунта
  const [serverRows, setServerRows] = useState<MessageVersionDto[]>();
  const proxy = useSelector((global) => selectChat(global, message.chatId)?.pxgProxy);
  const localHistory = proxy ? undefined : message.pxgEditHistory;
  const accountId = proxy?.accountId || getOwnAccountId();
  const peerId = proxy?.peerId ?? Number(message.chatId);

  useEffect(() => {
    if (!isOpen || !message.isEdited) return;
    setServerRows(undefined);
    if (isProxyPeerId(message.chatId) && !proxy?.permissions.seeArchive) return;
    if (!accountId) return;
    let isActive = true;
    pxgRpc.call<MessageVersionDto[]>(proxy ? 'messages.versions' : 'archive.versions', {
      accountId, peerId, msgId: message.id,
    })
      .then((rows) => isActive && setServerRows(rows))
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [accountId, isOpen, message.chatId, message.id, message.isEdited, peerId, proxy]);

  const versions = useMemo(() => {
    // The server knows files too; this device keeps its own only if it saw more edits than the server
    const rows = (serverRows?.length ?? 0) >= (localHistory?.length ?? 0) ? serverRows : undefined;
    const history: PxgEditVersion[] = rows?.map((row) => ({
      text: { text: row.text },
      date: row.editDate ? Math.floor(Date.parse(row.editDate) / 1000) : message.date,
      capturedAt: Math.floor(Date.parse(row.capturedAt) / 1000),
    })) ?? localHistory ?? [];
    const texts = [...history.map((version) => version.text?.text ?? ''), message.content.text?.text ?? ''];
    const dates = [...history.map((version) => version.date), message.editDate ?? message.date];

    // Сверху — текущая версия, ниже — более старые
    return texts.map((text, index): VersionView => {
      const isCurrent = index === texts.length - 1;
      const replacement = rows?.[index - 1]?.replacedBy ?? undefined;
      const media = isCurrent ? replacement : rows?.[index]?.media;
      const isAroundReplacement = Boolean(replacement || rows?.[index]?.replacedBy);
      return {
        key: String(index),
        label: isCurrent
          ? lang('PxgEditHistoryCurrent')
          : index === 0 ? lang('PxgEditHistoryOriginal') : lang('PxgEditHistoryVersion', { number: index + 1 }),
        date: dates[index],
        text,
        previousText: index > 0 ? texts[index - 1] : undefined,
        replacedKind: replacement?.kind,
        file: media && isAroundReplacement
          ? { media, version: isCurrent ? undefined : rows?.[index]?.version }
          : undefined,
      };
    }).reverse();
  }, [lang, localHistory, message, serverRows]);

  const hasLostVersions = message.isEdited && !localHistory?.length && !serverRows?.length;

  return (
    <Modal isOpen={isOpen} title={lang('PxgEditHistoryTitle')} hasCloseButton onClose={onClose}>
      {hasLostVersions && <p className={styles.notice}>{lang('PxgEditHistoryNotCaptured')}</p>}
      <ul className={styles.list}>
        {versions.map((version) => (
          <li key={version.key} className={styles.version}>
            <div className={styles.header}>
              <span className={styles.label}>{version.label}</span>
              <span className={styles.date}>
                {formatDateTime(lang, secondsToDate(version.date), { date: 'short', time: 'short' })}
              </span>
            </div>
            {version.replacedKind && (
              <div className={styles.replaced}>
                {lang(REPLACED_KEYS[version.replacedKind] ?? 'PxgEditHistoryFileReplaced')}
              </div>
            )}
            {version.file && accountId && (
              <VersionFile
                method={proxy ? 'media.url' : 'archive.mediaUrl'}
                accountId={accountId}
                peerId={peerId}
                msgId={message.id}
                version={version.file.version}
                media={version.file.media}
              />
            )}
            <div className={styles.text}>
              {shouldShowDiff && version.previousText !== undefined
                ? renderDiff(version.previousText, version.text)
                : renderText(version.text, ['br'])}
            </div>
          </li>
        ))}
      </ul>
      {!hasLostVersions && (
        <Checkbox
          label={lang('PxgEditHistoryShowDiff')}
          checked={shouldShowDiff}
          onCheck={setShouldShowDiff}
        />
      )}
    </Modal>
  );
};

/** The file of one version: an old one exists only if the archive saved it before the replacement */
const VersionFile = ({
  method, accountId, peerId, msgId, version, media,
}: {
  method: 'media.url' | 'archive.mediaUrl';
  accountId: string;
  peerId: number;
  msgId: number;
  version?: number;
  media: VersionFileDto;
}) => {
  const lang = useLang();
  const [url, setUrl] = useState<string>();
  const [isLost, setIsLost] = useState(false);

  useEffect(() => {
    let isActive = true;
    void (async () => {
      for (let attempt = 0; isActive && attempt < FILE_WAIT_ATTEMPTS; attempt++) {
        try {
          const signed = await pxgRpc.call<{ url: string }>(method, { accountId, peerId, msgId, version });
          if (isActive) setUrl(`${PXG_SERVER_URL}${signed.url}`);
          return;
        } catch (err) {
          if (!(err instanceof PxgError) || err.code !== 'media_pending') break;
          await pause(FILE_WAIT_INTERVAL_MS);
        }
      }
      if (isActive) setIsLost(true);
    })();
    return () => {
      isActive = false;
    };
  }, [accountId, method, msgId, peerId, version]);

  if (isLost) return <div className={styles.notice}>{lang('PxgEditHistoryFileNotSaved')}</div>;
  if (!url) return undefined;
  if (PREVIEW_IMAGE_KINDS.has(media.kind)) return <img className={styles.preview} src={url} alt="" />;
  if (PREVIEW_VIDEO_KINDS.has(media.kind)) return <video className={styles.preview} src={url} controls muted />;
  if (PREVIEW_AUDIO_KINDS.has(media.kind)) return <audio className={styles.audio} src={url} controls />;
  return (
    <a className={styles.fileLink} href={url} download={media.fileName}>
      {media.fileName || lang('PxgEditHistoryOpenFile')}
    </a>
  );
};

function renderDiff(before: string, after: string) {
  return diffWords(before, after).map((part, index) => (
    <span
      // Части диффа не переставляются, индекс стабилен
      key={index}
      className={buildClassName(part.type === 'added' && styles.added, part.type === 'removed' && styles.removed)}
    >
      {renderText(part.text, ['br'])}
    </span>
  ));
}

export default memo(EditHistoryModal);
