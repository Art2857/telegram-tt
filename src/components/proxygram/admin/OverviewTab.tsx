import { memo } from '../../../lib/teact/teact';

import type { Overview, PresenceRow, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { formatFileSize } from '../../../util/textFormat';
import { describePxgError, displayName, formatDateTime } from '../helpers';
import {
  ACCOUNT_STATUS, Badge, DISK_WARNING_PERCENT, LevelBadge, Loading, SYSTEM_REFRESH_MS, t, useAdminData,
} from './adminShared';

import Button from '../../ui/Button';

import styles from './AdminPanel.module.scss';

// ─── Обзор ──────────────────────────────────────────────────────────────────

export const OverviewTab = memo(({ lang, topics, openTab }: TabProps) => {
  const { data, error } = useAdminData<Overview>('admin.overview', {}, topics, SYSTEM_REFRESH_MS);
  const presence = useAdminData<PresenceRow[]>('admin.presence', {}, ['presence']);

  if (!data) return <Loading error={error} lang={lang} />;
  const reading = presence.data?.filter((row) => row.chat) ?? [];
  const accountsTotal = Object.values(data.accounts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const brokenAccounts = (data.accounts.auth_lost ?? 0) + (data.accounts.flood ?? 0);
  const { disk } = data.storage;
  const diskPercent = disk?.totalBytes ? Math.round((1 - disk.freeBytes / disk.totalBytes) * 100) : undefined;
  const isDiskFull = diskPercent !== undefined && diskPercent >= DISK_WARNING_PERCENT;
  const writeError = data.storage.writeError;
  const attention = data.attentionAccounts;

  const stats: [string, number | string, string?][] = [
    [lang('PxgAdminStatUsers'), data.users.total],
    [lang('PxgAdminStatOnline'), data.online.users],
    [lang('PxgAdminStatFull'), data.online.client],
    [lang('PxgAdminStatGuests'), data.online.guest],
    [lang('PxgAdminStatAccounts'), `${data.accounts.active ?? 0} / ${accountsTotal}`],
    [lang('PxgAdminStatShares'), data.shares.active ?? 0],
    [lang('PxgAdminStatArchive'), data.archive.messagesLastDay],
    [lang('PxgAdminStatQueue'), (data.outbox.pending ?? 0) + (data.outbox.running ?? 0)],
    [lang('PxgAdminStatMedia'), formatFileSize(lang, data.storage.mediaBytes)],
    [lang('PxgAdminStatDisk'), diskPercent !== undefined ? `${diskPercent}%` : '—'],
  ];

  return (
    <>
      {(brokenAccounts > 0 || (data.outbox.failed ?? 0) > 0 || isDiskFull || data.staleLeases > 0
        || writeError) && (
        <div className={styles.warning}>
          {writeError && (
            <div>
              {lang('PxgAdminWarnStorage')}
              <div className={styles.secondary}>{writeError}</div>
            </div>
          )}
          {data.staleLeases > 0 && <div>{t(lang, 'PxgAdminWarnLease', { count: data.staleLeases })}</div>}
          {isDiskFull && <div>{t(lang, 'PxgAdminWarnDisk', { percent: diskPercent })}</div>}
          {brokenAccounts > 0 && !attention?.length && (
            <div>{t(lang, 'PxgAdminWarnAccounts', { count: brokenAccounts })}</div>
          )}
          {attention?.map((account) => (
            <div key={account.id}>
              {t(lang, account.status === 'flood' ? 'PxgAdminWarnAccountFlood' : 'PxgAdminWarnAccountLost', {
                name: account.displayName ?? String(account.tgUserId ?? '—'),
                owner: account.owner ?? '—',
                date: account.statusChangedAt ? formatDateTime(account.statusChangedAt) : '—',
              })}
              <div className={styles.secondary}>
                {lang(account.status === 'flood' ? 'PxgAdminWarnAccountFloodHint' : 'PxgAdminWarnAccountLostHint')}
              </div>
            </div>
          ))}
          {Boolean(attention?.length) && (
            <Button size="tiny" color="translucent" isText onClick={() => openTab?.('accounts')}>
              {lang('PxgAdminOpenAccounts')}
            </Button>
          )}
          {(data.outbox.failed ?? 0) > 0 && (
            <div>
              {t(lang, 'PxgAdminWarnQueue', { count: data.outbox.failed ?? 0 })}
              {' '}
              <Button size="tiny" color="translucent" isText onClick={() => openTab?.('outbox')}>
                {lang('PxgAdminOpenQueue')}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{label}</span>
          </div>
        ))}
      </div>
      <div className={styles.accountStatuses}>
        {Object.entries(ACCOUNT_STATUS).map(([status, { key, tone }]) => {
          const count = data.accounts[status] ?? 0;
          return (
            <Badge key={status} tone={count ? tone : 'gray'}>{`${t(lang, key)}: ${count}`}</Badge>
          );
        })}
      </div>

      <h3 className={styles.sectionTitle}>{lang('PxgAdminReadingNow')}</h3>
      {presence.error ? (
        <p className={styles.empty}>{describePxgError(lang, presence.error)}</p>
      ) : !presence.data ? (
        <Loading error={undefined} lang={lang} />
      ) : reading.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminNobodyReading')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColChat')}</th>
              <th>{lang('PxgAdminColAccount')}</th>
              <th>{lang('PxgAdminColDevice')}</th>
              <th>{lang('PxgAdminColSince')}</th>
            </tr>
          </thead>
          <tbody>
            {reading.map((row) => (
              <tr key={row.connectionId}>
                <td>
                  {displayName(row.user)}
                  {' '}
                  <LevelBadge level={row.level} lang={lang} />
                </td>
                <td>{row.chat?.title ?? row.chat?.peerId}</td>
                <td>{row.chat?.accountName ?? '—'}</td>
                <td>{[row.device, row.platform].filter(Boolean).join(' · ') || '—'}</td>
                <td>{formatDateTime(row.chat?.since)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
});
