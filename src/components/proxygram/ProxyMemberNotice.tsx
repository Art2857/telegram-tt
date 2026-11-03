import { memo, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import { selectChat } from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { getPxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';
import Button from '../ui/Button';

import styles from './ProxyWriteNotice.module.scss';

type OwnProps = {
  chatId: string;
};

type StateProps = {
  ownChatId?: string;
};

const STORAGE_KEY_PREFIX = 'pxg-member-notice-';

/**
 * PLAN.md 13: a guest with their own Telegram in this slot who is a member of the shared group or channel
 * has two chats, their own and the proxy one. Groups and channels keep their IDs across accounts, so the own
 * chat is the one under the owner's peer ID; a private chat with the same person is another conversation.
 */
const ProxyMemberNotice = ({ chatId, ownChatId }: OwnProps & StateProps) => {
  const { openChat } = getActions();
  const lang = useLang();
  const [isDismissed, setIsDismissed] = useState(false);
  const storageKey = `${STORAGE_KEY_PREFIX}${getPxgState().session?.user.id}`;

  const handleOpen = useLastCallback(() => {
    if (ownChatId) openChat({ id: ownChatId });
  });

  const handleDismiss = useLastCallback(() => {
    setIsDismissed(true);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...readDismissed(storageKey), chatId]));
    } catch {
      // Without storage the notice returns after a reload
    }
  });

  if (!ownChatId || isDismissed || readDismissed(storageKey).includes(chatId)) return undefined;

  return (
    <div className={buildClassName(styles.root, styles.wide)}>
      <Icon name="info-filled" className={styles.icon} />
      <span className={styles.text}>{lang('PxgAlsoMember')}</span>
      <Button size="tiny" isText fluid onClick={handleOpen}>{lang('PxgOpenOwnChat')}</Button>
      <Button
        round
        faded
        color="translucent"
        size="smaller"
        ariaLabel={lang('OK')}
        iconName="close"
        onClick={handleDismiss}
      />
    </div>
  );
};

function readDismissed(storageKey: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export default memo(withGlobal<OwnProps>((global, { chatId }): Complete<StateProps> => {
  const peerId = selectChat(global, chatId)?.pxgProxy?.peerId;
  const own = peerId !== undefined && peerId < 0 ? selectChat(global, String(peerId)) : undefined;
  const isMember = own && !own.pxgProxy && !own.isNotJoined && !own.isForbidden;
  return { ownChatId: isMember ? own.id : undefined };
})(ProxyMemberNotice));
