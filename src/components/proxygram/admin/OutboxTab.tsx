import { memo, useState } from '../../../lib/teact/teact';

import type { OutboxRow, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { getPxgReasonText } from '../../../proxygram/errorReasons';
import { displayName, formatDateTime } from '../helpers';
import { Badge, call, Loading, useAdminData } from './adminShared';

import Button from '../../ui/Button';

import styles from './AdminPanel.module.scss';

/** Состояния очереди по-человечески, а не значениями из базы */
const OUTBOX_STATUS_KEYS = {
  pending: 'PxgAdminOutboxPending',
  running: 'PxgAdminOutboxRunning',
  done: 'PxgAdminOutboxDone',
  failed: 'PxgAdminOutboxFailed',
} as const;

export const OutboxTab = memo(({ lang, run, topics }: TabProps) => {
  const [status, setStatus] = useState<'pending' | 'running' | 'done' | 'failed' | undefined>();
  const { data, error } = useAdminData<OutboxRow[]>('admin.outbox', { limit: 500, status }, topics);
  if (!data) return <Loading error={error} lang={lang} />;

  return (
    <>
      <div className={styles.filters}>
        <select
          aria-label={lang('PxgAdminColStatus')}
          value={status ?? ''}
          onChange={(e) => setStatus((e.currentTarget.value || undefined) as typeof status)}
        >
          <option value="">{lang('PxgAdminAll')}</option>
          <option value="pending">{lang('PxgAdminOutboxPending')}</option>
          <option value="running">{lang('PxgAdminOutboxRunning')}</option>
          <option value="done">{lang('PxgAdminOutboxDone')}</option>
          <option value="failed">{lang('PxgAdminOutboxFailed')}</option>
        </select>
      </div>
      {data.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColTime')}</th>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColAction')}</th>
              <th>{lang('PxgAdminColStatus')}</th>
              <th aria-label={lang('PxgAdminColActions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td className={styles.nowrap}>{formatDateTime(row.createdAt)}</td>
                <td>{displayName(row.actor)}</td>
                <td><code>{row.kind}</code></td>
                <td>
                  <Badge tone={row.status === 'failed' ? 'red' : row.status === 'done' ? 'green' : 'blue'}>
                    {lang(OUTBOX_STATUS_KEYS[row.status as keyof typeof OUTBOX_STATUS_KEYS] ?? 'PxgAdminOutboxPending')}
                  </Badge>
                  {row.error && (
                    <div className={styles.secondary}>{getPxgReasonText(lang, row.error) ?? row.error}</div>
                  )}
                </td>
                <td className={styles.actions}>
                  {row.status === 'failed' && row.error !== 'cancelled_by_admin' && (
                    <Button
                      size="tiny"
                      color="translucent"
                      isText
                      onClick={() => void run(call('admin.outbox.retry', { id: row.id }))}
                    >
                      {lang('PxgAdminRetry')}
                    </Button>
                  )}
                  {row.status === 'pending' && (
                    <Button
                      size="tiny"
                      color="danger"
                      isText
                      onClick={() => void run(call('admin.outbox.cancel', { id: row.id }))}
                    >
                      {lang('PxgAdminCancel')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
});
