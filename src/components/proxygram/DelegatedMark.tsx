import { memo, useEffect, useState } from '../../lib/teact/teact';

import type { ApiMessage } from '../../api/types';
import type { AttributionDto } from '../../proxygram/server/types';

import { selectChat, selectUser } from '../../global/selectors';
import { formatDateTime, secondsToDate } from '../../util/localization/dateFormat';
import { isProxyPeerId } from '../../api/proxy/ids';
import { getOwnAccountId } from '../../proxygram/server/ownAccount';
import { pxgRpc } from '../../proxygram/server/rpc';

import useSelector from '../../hooks/data/useSelector';
import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from '../common/Avatar';
import Modal from '../ui/Modal';

import styles from './DelegatedMark.module.scss';

type OwnProps = { message: ApiMessage };

const SCOPE_KEYS = {
  chat: 'PxgAttributionChat',
  topic: 'PxgAttributionTopic',
  folder: 'PxgAttributionFolder',
  chat_members: 'PxgShareMembersChip',
  folder_members: 'PxgShareMembersChip',
} as const;

/** Владелец открывает сведения об отправке, гость видит только разрешённую подпись */
const DelegatedMark = ({ message }: OwnProps) => {
  const lang = useLang();
  const [isOpen, open, close] = useFlag();
  const proxy = useSelector((global) => selectChat(global, message.chatId)?.pxgProxy);
  const peer = useSelector((global) => message.pxgSentByTgUserId
    ? selectUser(global, message.pxgSentByTgUserId) : undefined);
  const handleClick = useLastCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    open();
  });
  const name = message.pxgIsOwn ? lang('PxgSentByYou') : message.pxgSentByName ?? '';

  if (isProxyPeerId(message.chatId) && !proxy?.isOwn) {
    return <span className={styles.mark} title={lang('PxgGuestSentByGuest')}>{`✍ ${name}`}</span>;
  }

  return (
    <>
      <button type="button" className={styles.mark} onClick={handleClick} title={lang('PxgAttributionTitle')}>
        <Avatar size="micro" peer={peer} text={message.pxgSentByName} />
        {`✍ ${name}`}
      </button>
      {isOpen && (
        <AttributionModal message={message} accountId={proxy?.accountId} peerId={proxy?.peerId} onClose={close} />
      )}
    </>
  );
};

function AttributionModal({ message, accountId, peerId, onClose }: OwnProps & {
  accountId?: string;
  peerId?: number;
  onClose: NoneToVoidFunction;
}) {
  const lang = useLang();
  const [data, setData] = useState<AttributionDto>();
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const targetAccountId = accountId ?? getOwnAccountId();
    if (!targetAccountId) {
      setHasError(true);
      return undefined;
    }
    let isActive = true;
    pxgRpc.call<AttributionDto[]>('archive.attribution', {
      accountId: targetAccountId, peerId: peerId ?? Number(message.chatId), minMsgId: message.id, maxMsgId: message.id,
    }).then((rows) => {
      if (!isActive) return;
      setData(rows[0]);
      setHasError(!rows.length);
    }).catch(() => {
      if (isActive) setHasError(true);
    });
    return () => {
      isActive = false;
    };
  }, [accountId, peerId, message.chatId, message.id]);

  return (
    <Modal isOpen title={lang('PxgAttributionTitle')} hasCloseButton onClose={onClose}>
      <div className={styles.details}>
        <div className={styles.name}>{data?.name ?? message.pxgSentByName}</div>
        {data?.username && <div className={styles.secondary}>{`@${data.username}`}</div>}
        <div className={styles.label}>{lang('PxgAttributionSentAt')}</div>
        <div>
          {formatDateTime(lang, data?.date ? new Date(data.date) : secondsToDate(message.date), {
            date: 'long', time: 'long',
          })}
        </div>
        <div className={styles.label}>{lang('PxgAttributionAccess')}</div>
        {data?.share ? (
          <>
            <div>{data.share.label || lang(SCOPE_KEYS[data.share.scope])}</div>
            <code className={styles.secondary}>{data.share.id}</code>
          </>
        ) : !hasError && <div>{lang(data ? 'PxgAttributionUnknownAccess' : 'Loading')}</div>}
        {hasError && <div className={styles.error}>{lang('PxgErrorGeneric')}</div>}
      </div>
    </Modal>
  );
}

export default memo(DelegatedMark);
