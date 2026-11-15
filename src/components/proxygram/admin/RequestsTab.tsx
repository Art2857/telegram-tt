import { memo, useState } from '../../../lib/teact/teact';

import type {
  AdminAccessRequestDto,
} from '../../../proxygram/server/types';
import type { TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { formatDateTime } from '../helpers';
import { AdminAvatar, Loading, REQUESTS_PAGE_SIZE, t, useAdminData } from './adminShared';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from './AdminPanel.module.scss';

/** Выдача доступа из запроса: права и история по умолчанию — как у владельца в форме «Поделиться» */
const REQUEST_PRESETS = [
  { key: 'readOnly', title: 'PxgPresetReadOnly' },
  { key: 'assistant', title: 'PxgPresetAssistant' },
  { key: 'full', title: 'PxgPresetFull' },
] as const;

const REQUEST_HISTORIES = [
  { key: 'all', title: 'PxgHistoryAll' },
  { key: 'new_only', title: 'PxgHistoryNew' },
] as const;

const REQUEST_STATUS_KEYS: Record<AdminAccessRequestDto['status'], string> = {
  pending: 'PxgRequestPending',
  approved: 'PxgRequestApproved',
  rejected: 'PxgRequestRejected',
  cancelled: 'PxgRequestCancelled',
  expired: 'PxgRequestExpired',
};

// ─── Журнал и очередь ───────────────────────────────────────────────────────

export const RequestsTab = memo(({ lang, ask, run, topics }: TabProps) => {
  const [status, setStatus] = useState<
    'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'all'
  >('pending');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error } = useAdminData<AdminAccessRequestDto[]>(
    'admin.requests',
    {
      status: status === 'all' ? undefined : status,
      query: query.trim() || undefined,
      limit: REQUESTS_PAGE_SIZE,
      offset,
    },
    topics,
  );
  const [approvingId, setApprovingId] = useState<string>();
  const [preset, setPreset] = useState<(typeof REQUEST_PRESETS)[number]['key']>('readOnly');
  const [historyMode, setHistoryMode] = useState<(typeof REQUEST_HISTORIES)[number]['key']>('all');

  if (!data) return <Loading error={error} lang={lang} />;

  return (
    <>
      <p className={styles.secondary}>{lang('PxgAdminRequestsHint')}</p>
      <div className={styles.filters}>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.currentTarget.value as typeof status);
            setOffset(0);
          }}
        >
          <option value="pending">{lang('PxgRequestPending')}</option>
          <option value="approved">{lang('PxgRequestApproved')}</option>
          <option value="rejected">{lang('PxgRequestRejected')}</option>
          <option value="cancelled">{lang('PxgRequestCancelled')}</option>
          <option value="expired">{lang('PxgRequestExpired')}</option>
          <option value="all">{lang('PxgAdminAll')}</option>
        </select>
        <InputText
          label={lang('Search')}
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setOffset(0);
          }}
        />
      </div>
      {data.length === 0 ? <p className={styles.empty}>{lang('PxgAdminRequestsEmpty')}</p> : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminRequestOwner')}</th>
              <th>{lang('PxgAdminRequestTarget')}</th>
              <th>{lang('PxgAdminColTime')}</th>
              <th aria-label={lang('PxgAdminColActions')} />
            </tr>
          </thead>
          {data.map((row) => (
            <tbody key={row.id}>
              <tr>
                <td>
                  <div className={styles.name}>
                    <AdminAvatar name={row.requester.name} id={row.requester.id} />
                    {row.requester.name}
                  </div>
                  {row.requester.username && (
                    <div className={styles.secondary}>{`@${row.requester.username}`}</div>
                  )}
                </td>
                <td>
                  {row.ownerName}
                  {row.accountName && <div className={styles.secondary}>{row.accountName}</div>}
                </td>
                <td>
                  {row.peerTitle ?? row.query}
                  {row.originTitle && <div className={styles.secondary}>{row.originTitle}</div>}
                  {row.context && (
                    <div className={styles.secondary}>
                      {lang('PxgRequestsCommonGroups', { count: row.context.commonGroups })}
                    </div>
                  )}
                </td>
                <td className={styles.nowrap}>
                  {formatDateTime(row.createdAt)}
                  <div className={styles.secondary}>{t(lang, REQUEST_STATUS_KEYS[row.status])}</div>
                </td>
                <td className={styles.actions}>
                  {row.status === 'pending' ? (
                    <>
                      {row.accountId && typeof row.peerId === 'number' ? (
                        <Button
                          size="tiny"
                          color="primary"
                          isText
                          onClick={() => setApprovingId(approvingId === row.id ? undefined : row.id)}
                        >
                          {lang('PxgAdminGrant')}
                        </Button>
                      ) : (
                        <span className={styles.secondary}>{lang('PxgAdminRequestNoChat')}</span>
                      )}
                      <Button
                        size="tiny"
                        color="danger"
                        isText
                        onClick={() => ask(
                          lang('PxgAdminRequestRejectText'),
                          lang('PxgAdminRequestReject'),
                          () => pxgRpc.call('admin.requests.reject', { id: row.id }),
                        )}
                      >
                        {lang('PxgAdminRequestReject')}
                      </Button>
                    </>
                  ) : (
                    <span className={styles.secondary}>{lang('PxgAdminRequestAnswered')}</span>
                  )}
                </td>
              </tr>
              {approvingId === row.id && (
                <tr>
                  <td colSpan={5}>
                    <div className={styles.form}>
                      <h3 className={styles.sectionTitle}>{lang('PxgAdminRequestApproveTitle')}</h3>
                      <div className={styles.row}>
                        <label className={styles.field}>
                          {lang('PxgAdminRequestPreset')}
                          <select
                            value={preset}
                            onChange={(e) => setPreset(e.currentTarget.value as typeof preset)}
                          >
                            {REQUEST_PRESETS.map((item) => (
                              <option key={item.key} value={item.key}>{lang(item.title)}</option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.field}>
                          {lang('PxgAdminRequestHistory')}
                          <select
                            value={historyMode}
                            onChange={(e) => setHistoryMode(e.currentTarget.value as typeof historyMode)}
                          >
                            {REQUEST_HISTORIES.map((item) => (
                              <option key={item.key} value={item.key}>{lang(item.title)}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className={styles.formButtons}>
                        <Button
                          size="smaller"
                          fluid={false}
                          onClick={() => void run(async () => {
                            if (!row.accountId || typeof row.peerId !== 'number') return;
                            await pxgRpc.call('admin.shares.create', {
                              accountId: row.accountId,
                              requestId: row.id,
                              granteeUserId: row.requester.id,
                              scope: 'chat',
                              peerId: row.peerId,
                              preset,
                              historyMode,
                            });
                            setApprovingId(undefined);
                          })}
                        >
                          {lang('PxgAdminGrant')}
                        </Button>
                        <Button
                          size="smaller"
                          fluid={false}
                          color="translucent"
                          onClick={() => setApprovingId(undefined)}
                        >
                          {lang('Cancel')}
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      )}
      {(offset > 0 || data.length === REQUESTS_PAGE_SIZE) && (
        <div className={styles.pagination}>
          <Button
            size="smaller"
            fluid={false}
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - REQUESTS_PAGE_SIZE))}
          >
            {lang('AccDescrPrevious')}
          </Button>
          <span>{lang.number(offset / REQUESTS_PAGE_SIZE + 1)}</span>
          <Button
            size="smaller"
            fluid={false}
            disabled={data.length < REQUESTS_PAGE_SIZE}
            onClick={() => setOffset(offset + REQUESTS_PAGE_SIZE)}
          >
            {lang('Next')}
          </Button>
        </div>
      )}
    </>
  );
});
