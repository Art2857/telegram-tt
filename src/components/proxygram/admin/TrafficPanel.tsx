import { memo } from '../../../lib/teact/teact';

import type { SystemInfo, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { formatTimeDuration } from '../../../util/dates/duration';
import { formatFileSize } from '../../../util/textFormat';
import { t } from './adminShared';

import styles from './AdminPanel.module.scss';

type Props = {
  lang: TabProps['lang'];
  traffic: NonNullable<SystemInfo['traffic']>;
  mediaBytes?: number;
};

export const TrafficPanel = memo(({ lang, traffic, mediaBytes }: Props) => {
  const total = Object.values(traffic.requests).reduce((sum, value) => sum + value, 0);
  const hits = total ? `${Math.round((traffic.requests.hit / total) * 100)}%` : '—';
  const calls = [...traffic.calls].sort((a, b) => b.count - a.count).slice(0, 20);
  const values = [
    ['PxgAdminTrafficHits', hits],
    ['PxgAdminTrafficIn', formatFileSize(lang, traffic.telegramBytes)],
    ['PxgAdminTrafficOut', formatFileSize(lang, traffic.servedBytes)],
    ['PxgAdminTrafficStored', mediaBytes === undefined ? '—' : formatFileSize(lang, mediaBytes)],
    ['PxgAdminTrafficEvicted', formatFileSize(lang, traffic.evictedBytes)],
    ['PxgAdminTrafficFlood', traffic.floodSeconds ? formatTimeDuration(lang, traffic.floodSeconds) : '0'],
  ] as const;

  return (
    <>
      <h3 className={styles.sectionTitle}>{lang('PxgAdminTraffic')}</h3>
      <p className={styles.secondary}>{lang('PxgAdminTrafficHint')}</p>
      <div className={styles.stats}>
        {values.map(([key, value]) => (
          <div key={key} className={styles.stat}>
            <span className={buildClassName(styles.statValue, styles.statText)}>{value}</span>
            <span className={styles.statLabel}>{lang(key)}</span>
          </div>
        ))}
      </div>
      <p className={styles.secondary}>
        {t(lang, 'PxgAdminTrafficRequests', traffic.requests)}
      </p>
      <p className={styles.secondary}>
        {t(lang, 'PxgAdminTrafficQueue', traffic.queue)}
      </p>
      <p className={styles.secondary}>
        {t(lang, 'PxgAdminTrafficLocations', traffic.locations)}
      </p>
      <details className={styles.trafficDetails}>
        <summary className={styles.trafficSummary}>{lang('PxgAdminTrafficMethods')}</summary>
        {calls.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
          <table className={buildClassName(styles.table, styles.stacked)}>
            <thead>
              <tr>
                <th>{lang('PxgAdminTrafficMethod')}</th>
                <th>{lang('PxgAdminTrafficSource')}</th>
                <th>{lang('PxgAdminColStatus')}</th>
                <th>{lang('PxgAdminTrafficCount')}</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={`${call.method}:${call.source}:${call.result}`}>
                  <td className={styles.details}>{call.method}</td>
                  <td className={styles.details}>{call.source}</td>
                  <td>{call.result}</td>
                  <td>{lang.number(call.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </>
  );
});
