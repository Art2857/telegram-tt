import { memo, useCallback, useEffect, useRef, useState } from '../../../lib/teact/teact';

import type { AuditRow, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { describePxgError, displayName, formatDateTime } from '../helpers';
import { AUDIT_PAGE, Loading } from './adminShared';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from './AdminPanel.module.scss';

export const AuditTab = memo(({ lang, topics, actorUserId }: TabProps & { actorUserId?: string }) => {
  const [action, setAction] = useState('');
  const [peer, setPeer] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<AuditRow[]>();
  const [error, setError] = useState<unknown>();
  const [hasMore, setHasMore] = useState(false);
  const requestRef = useRef(0);
  const peerNumber = Number(peer.trim());
  const peerId = /^-?\d+$/.test(peer.trim()) && Number.isSafeInteger(peerNumber) ? peerNumber : undefined;
  const filterKey = JSON.stringify({ actorUserId, action: action.trim() || undefined, peerId,
    from: parseAuditDate(from), to: parseAuditDate(to, true) });

  const load = useCallback((beforeId?: string) => {
    const request = ++requestRef.current;
    const filters = JSON.parse(filterKey) as Record<string, unknown>;
    void pxgRpc.call<AuditRow[]>('admin.audit', {
      ...filters,
      limit: AUDIT_PAGE,
      beforeId,
    }).then((page) => {
      if (request !== requestRef.current) return;
      setRows((current) => (beforeId ? [...(current ?? []), ...page] : page));
      setHasMore(page.length === AUDIT_PAGE);
      setError(undefined);
    }).catch((err) => {
      if (request === requestRef.current) setError(err);
    });
  }, [filterKey]);

  useEffect(() => {
    setRows(undefined);
    load();
    const requestRefForCleanup = requestRef;
    return () => {
      // ответ прежнего фильтра не должен попасть в новый список
      requestRefForCleanup.current++;
    };
  }, [load]);

  useEffect(() => pxgRpc.on((event) => {
    if (event.e === 'admin.changed' && event.d.topics.some((topic) => topics.includes(topic))) load();
  }), [load, topics]);

  return (
    <>
      <InputText
        className={styles.search}
        label={lang('PxgAdminAuditFilter')}
        value={action}
        onChange={(e) => setAction(e.target.value)}
      />
      <div className={styles.auditFilters}>
        <InputText label={lang('PxgAdminAuditChat')} value={peer} onChange={(e) => setPeer(e.target.value)} />
        <label className={styles.dateFilter}>
          {lang('PxgAdminAuditFrom')}
          <input className={styles.dateInput} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={styles.dateFilter}>
          {lang('PxgAdminAuditTo')}
          <input className={styles.dateInput} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {!rows ? <Loading error={error} lang={lang} /> : rows.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColTime')}</th>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColAction')}</th>
              <th>{lang('PxgAdminColDetails')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={styles.nowrap}>{formatDateTime(row.at)}</td>
                <td>{displayName(row.actor)}</td>
                <td><code>{row.action}</code></td>
                <td className={styles.details}>{row.meta ? JSON.stringify(row.meta) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && rows?.length ? (
        <Button
          size="smaller"
          isText
          fluid={false}
          onClick={() => load(rows[rows.length - 1].id)}
        >
          {lang('PxgSettingsMore')}
        </Button>
      ) : undefined}
      {error && rows ? <p className={styles.errorText}>{describePxgError(lang, error)}</p> : undefined}
    </>
  );
});

// ─── Система ────────────────────────────────────────────────────────────────

function parseAuditDate(value: string, isEndOfDay?: boolean) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return undefined;
  if (isEndOfDay) date.setDate(date.getDate() + 1);
  return new Date(date.getTime() - (isEndOfDay ? 1 : 0)).toISOString();
}
