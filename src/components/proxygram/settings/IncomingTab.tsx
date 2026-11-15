import { memo } from '../../../lib/teact/teact';

import type { ShareRow, TabProps } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { displayName } from '../helpers';
import { describeShare, describeTarget, groupBy, Loading, usePxgData } from './settingsShared';

import Button from '../../ui/Button';

import styles from '../admin/AdminPanel.module.scss';

export const IncomingTab = memo(({
  lang, t, ask, run,
}: TabProps) => {
  const { data, error, reload } = usePxgData<ShareRow[]>('shares.incoming', {}, ['access.changed']);
  if (!data) return <Loading error={error} lang={lang} onRetry={reload} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgGuestNoChatsNoUsername')}</p>;

  return (
    <table className={buildClassName(styles.table, styles.stacked)}>
      <tbody>
        {groupBy(data, (share) => share.grantor?.id ?? '').map(([, items]) => items.map((share, index) => (
          <tr key={share.id}>
            <td>
              {index === 0 && (
                <div className={styles.name}>
                  {t('PxgSettingsFrom', { name: displayName(items[0].grantor) })}
                </div>
              )}
            </td>
            <td>
              {describeTarget(t, share)}
              <div className={styles.secondary}>{describeShare(t, share)}</div>
              {share.hiddenAt && <div className={styles.secondary}>{lang('PxgSettingsHiddenHint')}</div>}
            </td>
            <td className={styles.actions}>
              <Button
                size="tiny"
                isText
                onClick={() => run(async () => {
                  await pxgRpc.call('shares.setHidden', { shareId: share.id, hidden: !share.hiddenAt });
                  reload();
                })}
              >
                {lang(share.hiddenAt ? 'PxgSettingsShow' : 'PxgSettingsHide')}
              </Button>
              <Button
                size="tiny"
                color="danger"
                isText
                onClick={() => ask(
                  t('PxgSettingsLeaveConfirm', { title: describeTarget(t, share) }),
                  lang('PxgSettingsLeave'),
                  async () => {
                    await pxgRpc.call('shares.leave', { shareId: share.id });
                    reload();
                  },
                )}
              >
                {lang('PxgSettingsLeave')}
              </Button>
            </td>
          </tr>
        )))}
      </tbody>
    </table>
  );
});
