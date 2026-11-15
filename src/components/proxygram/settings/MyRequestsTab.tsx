import { memo, useState } from '../../../lib/teact/teact';

import type { AccessRequestRow, TabProps } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { formatDateTime } from '../helpers';
import { Loading, REQUEST_STATUS_KEYS, usePxgData } from './settingsShared';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from '../admin/AdminPanel.module.scss';

/**
 * «Мои запросы» (docs/RELEASE.md): что я просил и что ответили; попросить у того, кто уже со мной делится, чат по
 * нику, номеру или Telegram ID. Запрос участника группы — из его меню в списке участников
 */
export const MyRequestsTab = memo(({ lang, t, run }: TabProps) => {
  const { data, error, reload } = usePxgData<AccessRequestRow[]>('requests.mine', {}, ['requests.changed']);
  const { data: owners } = usePxgData<{ id: string; name: string }[]>('requests.owners', {}, ['access.changed']);
  const [ownerId, setOwnerId] = useState<string>();
  const [query, setQuery] = useState('');
  const owner = ownerId ?? owners?.[0]?.id;

  const send = () => run(async () => {
    await pxgRpc.call('requests.create', { ownerUserId: owner, query: query.trim() });
    setQuery('');
    reload();
  });
  const cancel = (request: AccessRequestRow) => run(async () => {
    await pxgRpc.call('requests.cancel', { id: request.id });
    reload();
  });

  return (
    <>
      {owners && owners.length > 0 && (
        <div className={styles.requestForm}>
          {owners.length > 1 ? (
            <select value={owner} onChange={(e) => setOwnerId(e.currentTarget.value)}>
              {owners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          ) : (
            <p className={styles.secondary}>
              {t('PxgRequestAskWhom', { name: owners[0].name })}
            </p>
          )}
          <div className={styles.requestRow}>
            <InputText
              label={lang('PxgRequestAskLabel')}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <Button size="smaller" fluid={false} disabled={!query.trim()} onClick={() => void send()}>
              {lang('PxgRequestSend')}
            </Button>
          </div>
        </div>
      )}
      {!data ? <Loading error={error} lang={lang} onRetry={reload} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgRequestsMineEmpty')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {data.map((request) => (
              <tr key={request.id}>
                <td>
                  <div className={styles.name}>{request.peerTitle ?? request.query ?? '—'}</div>
                  <div className={styles.secondary}>
                    {[
                      request.ownerName,
                      request.originTitle ? t('PxgRequestsFromGroup', { title: request.originTitle }) : undefined,
                      formatDateTime(request.createdAt),
                    ].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>
                  {t(REQUEST_STATUS_KEYS[request.status])}
                  {request.reason && <div className={styles.secondary}>{request.reason}</div>}
                </td>
                <td className={styles.actions}>
                  {request.status === 'pending' && (
                    <Button size="tiny" color="danger" isText onClick={() => void cancel(request)}>
                      {lang('PxgRequestCancel')}
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
