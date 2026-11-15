import { memo } from '../../../lib/teact/teact';

import type { SystemInfo, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { formatTimeDuration } from '../../../util/dates/duration';
import { formatFileSize } from '../../../util/textFormat';
import { formatDateTime } from '../helpers';
import { Badge, Loading, SYSTEM_REFRESH_MS, t, useAdminData } from './adminShared';

import styles from './AdminPanel.module.scss';

export const SystemTab = memo(({ lang, topics }: TabProps) => {
  const { data, error } = useAdminData<SystemInfo>('admin.system', {}, topics, SYSTEM_REFRESH_MS);
  if (!data) return <Loading error={error} lang={lang} />;
  const { vpn } = data;

  return (
    <>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.version?.slice(0, 7) ?? 'dev'}</span>
          <span className={styles.statLabel}>{lang('PxgAdminVersion')}</span>
        </div>
        <div className={styles.stat}>
          <span className={buildClassName(styles.statValue, styles.statText)}>
            {formatTimeDuration(lang, data.uptimeSeconds) ?? '—'}
          </span>
          <span className={styles.statLabel}>{lang('PxgAdminUptime')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.node}</span>
          <span className={styles.statLabel}>Node.js</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.migrations ?? '—'}</span>
          <span className={styles.statLabel}>{lang('PxgAdminMigrations')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatFileSize(lang, data.memory.rssBytes)}</span>
          <span className={styles.statLabel}>{lang('PxgAdminMemory')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {formatFileSize(lang, data.memory.perAccountBytes)}
            <span className={styles.secondary}>{` / ${data.memory.accounts}`}</span>
          </span>
          <span className={styles.statLabel}>{lang('PxgAdminMemoryAccount')}</span>
        </div>
        {data.storage.disk && (
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {formatFileSize(lang, data.storage.disk.freeBytes)}
              {' / '}
              {formatFileSize(lang, data.storage.disk.totalBytes)}
            </span>
            <span className={styles.statLabel}>{lang('PxgAdminDiskFree')}</span>
          </div>
        )}
      </div>

      <h3 className={styles.sectionTitle}>{lang('PxgAdminWorkers')}</h3>
      {data.workers.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminWorker')}</th>
              <th>{lang('PxgAdminAccounts')}</th>
              <th>{lang('PxgAdminLease')}</th>
            </tr>
          </thead>
          <tbody>
            {data.workers.map((worker) => (
              <tr key={worker.workerId ?? 'none'}>
                <td><code>{worker.workerId ?? '—'}</code></td>
                <td>{worker.accounts}</td>
                <td>
                  {formatDateTime(worker.leaseUntil ?? undefined)}
                  {' '}
                  {worker.stale > 0 && <Badge tone="red">{lang('PxgAdminLeaseStale')}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {vpn && (
        <>
          <h3 className={styles.sectionTitle}>{lang('PxgAdminVpn')}</h3>
          {!vpn.isReachable ? <p className={styles.empty}>{lang('PxgAdminVpnUnreachable')}</p> : (
            <>
              <p>
                <Badge tone={vpn.isHealthy ? 'green' : 'red'}>
                  {lang(vpn.isHealthy ? 'PxgAdminVpnHealthy' : 'PxgAdminVpnDown')}
                </Badge>
                {' '}
                {vpn.active ?? '—'}
                {vpn.activeRttMs ? ` · ${t(lang, 'PxgAdminVpnMs', { value: vpn.activeRttMs })}` : ''}
                {` · ${t(lang, 'PxgAdminVpnNodes', { answering: vpn.answering ?? 0, total: vpn.total ?? 0 })}`}
              </p>
              {Boolean(vpn.switches?.length) && (
                <table className={buildClassName(styles.table, styles.stacked)}>
                  <thead>
                    <tr>
                      <th>{lang('PxgAdminColTime')}</th>
                      <th>{lang('PxgAdminVpnSwitch')}</th>
                      <th>{lang('PxgAdminColDetails')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vpn.switches.map((item) => (
                      <tr key={item.at}>
                        <td className={styles.nowrap}>{formatDateTime(item.at)}</td>
                        <td>{[item.from, item.to].filter(Boolean).join(' → ')}</td>
                        <td className={styles.details}>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </>
  );
});
