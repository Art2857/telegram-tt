import { memo } from '../../../lib/teact/teact';

import type { TabProps } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { formatDateTime } from '../helpers';
import { ACCOUNT_STATUS, Badge, describeStatusReason, formatMegabytes, Loading, renderImport } from './settingsShared';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';

import styles from '../admin/AdminPanel.module.scss';

export const ServerTab = memo(({
  lang, t, ask, run, accounts, accountsError, reloadAccounts,
}: TabProps) => {
  const isClient = usePxgState((state) => state.session?.level === 'client');
  if (!accounts) return <Loading error={accountsError} lang={lang} onRetry={reloadAccounts} />;

  return (
    <>
      {accounts.length === 0 && <p className={styles.empty}>{lang('PxgSettingsNoAccounts')}</p>}
      {accounts.length > 0 && (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {accounts.map((account) => {
              const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
              return (
                <tr key={account.id}>
                  <td>
                    <div className={styles.name}>{account.displayName ?? '—'}</div>
                    <div className={styles.secondary}>{formatDateTime(account.connectedAt)}</div>
                    {account.lastMessageAt && (
                      <div className={styles.secondary}>
                        {t('PxgSettingsLastEvent', { time: formatDateTime(account.lastMessageAt) })}
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge tone={status.tone} text={t(status.key)} />
                    {account.statusReason && (
                      <div className={styles.secondary}>{describeStatusReason(t, account.statusReason)}</div>
                    )}
                  </td>
                  <td>
                    {t('PxgAdminMessages', { count: account.messages })}
                    <div className={styles.secondary}>
                      {t('PxgSettingsMedia', { size: formatMegabytes(account.mediaBytes) })}
                    </div>
                    {renderImport(t, account.importState)}
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="tiny"
                      color="danger"
                      isText
                      onClick={() => ask(
                        t('PxgAdminDisconnectConfirm', { name: account.displayName ?? '' }),
                        lang('PxgAdminDisconnect'),
                        async () => {
                          await pxgRpc.call('accounts.disconnect', { accountId: account.id });
                          reloadAccounts();
                        },
                      )}
                    >
                      {lang('PxgAdminDisconnect')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {accounts.length > 0 && (
        <div className={styles.form}>
          <h3 className={styles.name}>{lang('PxgThinMode')}</h3>
          <p className={styles.secondary}>{lang('PxgThinModeHint')}</p>
          {accounts.map((account) => (
            <Checkbox
              key={account.id}
              label={account.displayName ?? account.id}
              checked={account.thinMode}
              onCheck={(enabled) => run(async () => {
                await pxgRpc.call('accounts.setThinMode', { accountId: account.id, enabled });
                reloadAccounts();
              })}
            />
          ))}
        </div>
      )}
      {/* With Telegram on this device its session signs the server in; without it, a phone scans a QR code */}
      <Button
        size="smaller"
        fluid={false}
        onClick={() => setPxgState({ isSettingsOpen: false, isConnectOpen: true })}
      >
        {lang(isClient ? 'PxgConnectTitle' : 'PxgConnectQrTitle')}
      </Button>
      {accounts.length > 0 && (
        <div className={styles.form}>
          <h3 className={styles.name}>{lang('PxgWipeTitle')}</h3>
          <p className={styles.secondary}>{lang('PxgWipeHint')}</p>
          <Button
            size="smaller"
            color="danger"
            fluid={false}
            onClick={() => ask(lang('PxgWipeConfirm'), lang('PxgWipeRun'), async () => {
              await pxgRpc.call('accounts.wipe');
              reloadAccounts();
            })}
          >
            {lang('PxgWipeRun')}
          </Button>
        </div>
      )}
    </>
  );
});
