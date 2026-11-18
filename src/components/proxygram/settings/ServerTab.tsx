import { memo } from '../../../lib/teact/teact';

import type { TabProps } from './settingsTypes';

import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { formatDateTime } from '../helpers';
import { ACCOUNT_STATUS, Badge, describeStatusReason, formatMegabytes, Loading, renderImport } from './settingsShared';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';

import styles from './ServerTab.module.scss';

export const ServerTab = memo(({
  lang, t, ask, run, accounts, accountsError, reloadAccounts,
}: TabProps) => {
  const session = usePxgState((state) => state.session);
  if (!accounts) return <Loading error={accountsError} lang={lang} onRetry={reloadAccounts} />;

  const isClient = session?.level === 'client';
  const currentAccount = isClient ? accounts.find((account) => account.tgUserId === session.user.tgUserId) : undefined;
  const recoveryAccountId = currentAccount?.status === 'auth_lost' ? currentAccount.id : undefined;
  const connectLabel = recoveryAccountId ? 'PxgConnectRestoreTitle' : 'PxgSettingsLinkTelegram';

  function openConnect() {
    setPxgState({ isSettingsOpen: false, isConnectOpen: true, connectRecoveryAccountId: recoveryAccountId });
  }

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.heading}>{lang('PxgAdminAccounts')}</h3>
          {(!currentAccount || recoveryAccountId) && accounts.length > 0 && (
            <Button noFastClick size="smaller" onClick={openConnect} className={styles.connectButton}>
              {lang(connectLabel)}
            </Button>
          )}
        </div>
        {accounts.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.description}>{lang('PxgSettingsNoAccounts')}</p>
            <Button noFastClick size="smaller" onClick={openConnect} className={styles.connectButton}>
              {lang(connectLabel)}
            </Button>
          </div>
        ) : (
          <ul className={styles.accountList}>
            {accounts.map((account) => {
              const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
              const name = account.displayName || String(account.tgUserId || account.id);
              return (
                <li className={styles.card} key={account.id}>
                  <div className={styles.accountHeader}>
                    <h4 className={styles.accountName}>{name}</h4>
                    <Badge tone={status.tone} text={t(status.key)} />
                  </div>
                  {account.statusReason && (
                    <p className={styles.description}>{describeStatusReason(t, account.statusReason)}</p>
                  )}
                  <div className={styles.accountDetails}>
                    <div>
                      {t('PxgAdminMessages', { count: account.messages })}
                      <p className={styles.description}>
                        {t('PxgSettingsMedia', { size: formatMegabytes(account.mediaBytes) })}
                      </p>
                      {renderImport(t, account.importState)}
                    </div>
                    <div>
                      {account.connectedAt && (
                        <p className={styles.description}>
                          {t('PxgSettingsConnectedAt', { time: formatDateTime(account.connectedAt) })}
                        </p>
                      )}
                      {account.lastMessageAt && (
                        <p className={styles.description}>
                          {t('PxgSettingsLastEvent', { time: formatDateTime(account.lastMessageAt) })}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className={styles.accountActions}>
                    <Button
                      noFastClick
                      size="smaller"
                      color="danger"
                      isText
                      onClick={() => ask(
                        t('PxgAdminDisconnectConfirm', { name }), lang('PxgAdminDisconnect'),
                        async () => {
                          await pxgRpc.call('accounts.disconnect', { accountId: account.id });
                          reloadAccounts();
                        },
                      )}
                    >
                      {lang('PxgAdminDisconnect')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {accounts.length > 0 && (
        <>
          <section className={styles.section}>
            <h3 className={styles.heading}>{lang('PxgThinMode')}</h3>
            <div className={styles.card}>
              <p className={styles.description}>{lang('PxgThinModeHint')}</p>
              <div className={styles.thinAccounts}>
                {accounts.map((account) => (
                  <Checkbox
                    key={account.id}
                    label={account.displayName || String(account.tgUserId || account.id)}
                    checked={account.thinMode}
                    onCheck={(enabled) => void run(async () => {
                      await pxgRpc.call('accounts.setThinMode', { accountId: account.id, enabled });
                      reloadAccounts();
                    })}
                  />
                ))}
              </div>
            </div>
          </section>
          <section className={styles.section}>
            <h3 className={styles.heading}>{lang('PxgWipeTitle')}</h3>
            <div className={styles.dangerCard}>
              <p className={styles.description}>{lang('PxgWipeHint')}</p>
              <Button
                noFastClick
                size="smaller"
                color="danger"
                isText
                onClick={() => ask(lang('PxgWipeConfirm'), lang('PxgWipeRun'), async () => {
                  await pxgRpc.call('accounts.wipe');
                  reloadAccounts();
                })}
              >
                {lang('PxgWipeRun')}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
});
