import { memo, useState } from '../../../lib/teact/teact';

import type { AccountRow, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { formatFileSize } from '../../../util/textFormat';
import { displayName, formatDateTime } from '../helpers';
import { ACCOUNT_STATUS, Badge, call, Loading, SYSTEM_REFRESH_MS, t, useAdminData } from './adminShared';

import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';

import styles from './AdminPanel.module.scss';

// ─── Аккаунты ───────────────────────────────────────────────────────────────

export const AccountsTab = memo(({ lang, run, topics }: TabProps) => {
  const [selectedId, setSelectedId] = useState<string>();
  const [disconnect, setDisconnect] = useState<AccountRow>();
  const { data, error } = useAdminData<AccountRow[]>('admin.accounts', {}, topics, SYSTEM_REFRESH_MS);
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgAdminNoAccounts')}</p>;
  const selected = data.find((account) => account.id === selectedId);
  const finishDisconnect = (deleteArchive: boolean) => {
    const accountId = disconnect?.id;
    setDisconnect(undefined);
    if (accountId) void run(call('admin.accounts.disconnect', { accountId, deleteArchive }));
  };

  return (
    <>
      {selected ? (
        <AccountCard
          account={selected}
          lang={lang}
          run={run}
          onClose={() => setSelectedId(undefined)}
          onDisconnect={setDisconnect}
        />
      ) : (
        <table className={buildClassName(styles.table, styles.stacked, styles.userTable)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColAccount')}</th>
              <th>{lang('PxgAdminColStatus')}</th>
              <th>{lang('PxgAdminColArchive')}</th>
              <th>{lang('PxgAdminColAccess')}</th>
              <th aria-label={lang('PxgAdminColActions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((account) => {
              const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
              return (
                <tr key={account.id} className={styles.userRow}>
                  <td>
                    <button type="button" className={styles.userNameButton} onClick={() => setSelectedId(account.id)}>
                      {account.displayName ?? '—'}
                    </button>
                    <div className={styles.secondary}>
                      {t(lang, 'PxgAdminOwner', { name: displayName(account.owner) })}
                      {account.tgUserId ? ` · ${account.tgUserId}` : ''}
                    </div>
                  </td>
                  <td>
                    <Badge tone={status.tone}>{t(lang, status.key)}</Badge>
                    {account.statusReason && <div className={styles.secondary}>{account.statusReason}</div>}
                  </td>
                  <td>
                    {t(lang, 'PxgAdminMessages', { count: account.messages })}
                    <div className={styles.secondary}>{formatDateTime(account.lastMessageAt)}</div>
                    {account.importState?.status === 'running' && (
                      <div className={styles.secondary}>
                        {t(lang, 'PxgImportProgress', {
                          done: account.importState.doneCount, total: account.importState.total,
                        })}
                      </div>
                    )}
                  </td>
                  <td className={styles.secondary}>
                    {t(lang, 'PxgAdminAccountCounts', { shares: account.activeShares, queue: account.queue })}
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="smaller"
                      round
                      color="translucent"
                      iconName="arrow-right"
                      ariaLabel={lang('PxgAdminColAccount')}
                      onClick={() => setSelectedId(account.id)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        isOpen={Boolean(disconnect)}
        title={lang('PxgAdminDisconnect')}
        text={t(lang, 'PxgAdminArchiveChoice', { name: disconnect?.displayName ?? '' })}
        confirmLabel={lang('PxgAdminKeepArchive')}
        confirmHandler={() => finishDisconnect(false)}
        extraButtons={(
          <Button color="danger" isText onClick={() => finishDisconnect(true)}>
            {lang('PxgAdminDeleteArchive')}
          </Button>
        )}
        onClose={() => setDisconnect(undefined)}
      />
    </>
  );
});

function AccountActions({ account, lang, run, onDisconnect }: {
  account: AccountRow;
  onDisconnect: (account: AccountRow) => void;
} & Pick<TabProps, 'lang' | 'run'>) {
  return (
    <>
      {account.status === 'active' && (
        <Button
          size="tiny"
          color="translucent"
          isText
          onClick={() => void run(call('admin.accounts.setPaused', { accountId: account.id, paused: true }))}
        >
          {lang('PxgAdminPause')}
        </Button>
      )}
      {(account.status === 'paused' || account.status === 'flood') && (
        <Button
          size="tiny"
          color="translucent"
          isText
          onClick={() => void run(call('admin.accounts.setPaused', { accountId: account.id, paused: false }))}
        >
          {lang('PxgAdminResume')}
        </Button>
      )}
      {(account.status === 'active' || account.status === 'flood') && (
        <Button
          size="tiny"
          color="translucent"
          isText
          disabled={account.restartRequested}
          onClick={() => void run(call('admin.accounts.restart', { accountId: account.id }))}
        >
          {account.restartRequested ? lang('PxgAdminRestartPending') : lang('PxgAdminRestart')}
        </Button>
      )}
      {account.status !== 'revoked' && (
        <Button size="tiny" color="danger" isText onClick={() => onDisconnect(account)}>
          {lang('PxgAdminDisconnect')}
        </Button>
      )}
    </>
  );
}

function AccountCard({ account, lang, run, onClose, onDisconnect }: {
  account: AccountRow;
  onClose: () => void;
  onDisconnect: (account: AccountRow) => void;
} & Pick<TabProps, 'lang' | 'run'>) {
  const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
  const facts = [
    [lang('PxgAdminWorker'), account.workerId ?? '—'],
    [lang('PxgAdminLease'), formatDateTime(account.leaseUntil)],
    [lang('PxgAdminConnected'), formatDateTime(account.connectedAt)],
    [lang('PxgAdminLastEvent'), formatDateTime(account.lastMessageAt)],
    [lang('PxgAdminColArchive'), t(lang, 'PxgAdminMessages', { count: account.messages })],
    [lang('PxgAdminStatMedia'), formatFileSize(lang, account.mediaBytes ?? 0)],
    [lang('PxgAdminColAccess'), t(lang, 'PxgAdminAccountCounts', {
      shares: account.activeShares, queue: account.queue,
    })],
  ];
  return (
    <>
      <div className={styles.filters}>
        <Button size="smaller" color="translucent" iconName="arrow-left" fluid={false} onClick={onClose}>
          {lang('Back')}
        </Button>
      </div>
      <h2>{account.displayName ?? account.tgUserId ?? account.id}</h2>
      <p>{t(lang, 'PxgAdminOwner', { name: displayName(account.owner) })}</p>
      <div className={styles.filters}>
        <Badge tone={status.tone}>{t(lang, status.key)}</Badge>
        <code>{account.tgUserId}</code>
      </div>
      <p className={styles.details}>{account.id}</p>
      {account.statusReason && <p className={styles.secondary}>{account.statusReason}</p>}
      <div className={styles.userActions}>
        <AccountActions account={account} lang={lang} run={run} onDisconnect={onDisconnect} />
      </div>
      <div className={buildClassName(styles.stats, styles.userCards)}>
        {facts.map(([label, value]) => (
          <div className={styles.stat} key={label}>
            <span className={styles.statLabel}>{label}</span>
            <span className={styles.details}>{value}</span>
          </div>
        ))}
      </div>
      {account.importState?.status === 'running' && (
        <p>{t(lang, 'PxgImportProgress', { done: account.importState.doneCount, total: account.importState.total })}</p>
      )}
    </>
  );
}
