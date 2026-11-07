import { memo } from '../../lib/teact/teact';
import { getGlobal } from '../../global';

import type { ApiMessage } from '../../api/types';

import { selectMessageIdsByGroupId } from '../../global/selectors';
import { getOwnAccountId } from '../../proxygram/server/ownAccount';
import { setPxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';

import styles from './DelegatedMark.module.scss';

type OwnProps = { message: ApiMessage };

/** The owner sees from whom a message of the chat is hidden; a click opens the same choice again */
const HiddenMark = ({ message }: OwnProps) => {
  const lang = useLang();
  const { isAll, names } = message.pxgHiddenFrom!;

  const handleClick = useLastCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const accountId = getOwnAccountId();
    if (!accountId) return;
    openHideFromGuests(accountId, message);
  });

  const text = isAll ? lang('PxgHiddenFromAll') : lang('PxgHiddenFrom', { names: names.join(', ') });
  return (
    <button type="button" className={styles.mark} onClick={handleClick} title={text}>
      <Icon name="eye-crossed-outline" />
      {text}
    </button>
  );
};

/** An album is hidden as a whole, as it is forwarded and quoted */
export function openHideFromGuests(accountId: string, message: ApiMessage) {
  const msgIds = message.groupedId
    ? selectMessageIdsByGroupId(getGlobal(), message.chatId, message.groupedId) || [message.id]
    : [message.id];
  setPxgState({
    hideMessages: { accountId, peerId: Number(message.chatId), chatId: message.chatId, msgIds },
  });
}

export default memo(HiddenMark);
