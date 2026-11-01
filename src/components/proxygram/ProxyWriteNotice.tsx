import { memo, useState } from '../../lib/teact/teact';

import { getPxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';
import Button from '../ui/Button';

import styles from './ProxyWriteNotice.module.scss';

type OwnProps = {
  accountId: string;
  providerName?: string;
};

const STORAGE_KEY_PREFIX = 'pxg-write-notice-';

/** PLAN.md 7.8: once per provider account the guest learns that the other side sees the owner, not them */
const ProxyWriteNotice = ({ accountId, providerName }: OwnProps) => {
  const lang = useLang();
  const [dismissedAccountId, setDismissedAccountId] = useState<string | undefined>();
  const storageKey = `${STORAGE_KEY_PREFIX}${getPxgState().session?.user.id}`;

  const handleDismiss = useLastCallback(() => {
    setDismissedAccountId(accountId);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...readDismissed(storageKey), accountId]));
    } catch {
      // Without storage the notice returns after a reload
    }
  });

  if (dismissedAccountId === accountId || readDismissed(storageKey).includes(accountId)) return undefined;

  return (
    <div className={styles.root}>
      <Icon name="info-filled" className={styles.icon} />
      <span className={styles.text}>
        {providerName ? lang('PxgWriteAsOwner', { name: providerName }) : lang('PxgGuestWriteNotice')}
      </span>
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

export default memo(ProxyWriteNotice);
