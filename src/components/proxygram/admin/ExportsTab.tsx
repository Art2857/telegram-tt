import { memo, useState } from '../../../lib/teact/teact';

import type { AdminExportJob,
} from '../../../proxygram/server/types';
import type { AccountRow, ExportPeer, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { formatFileSize } from '../../../util/textFormat';
import { getPxgReasonText } from '../../../proxygram/errorReasons';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { call, Loading, t, useAdminData } from './adminShared';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from './AdminPanel.module.scss';

const EXPORT_STATUS: Record<AdminExportJob['status'], string> = {
  queued: 'PxgExportStatusQueued',
  collecting: 'PxgExportStatusCollecting',
  packing: 'PxgExportStatusPacking',
  ready: 'PxgExportStatusReady',
  failed: 'PxgExportStatusFailed',
  cancelled: 'PxgExportStatusCancelled',
  expired: 'PxgExportStatusExpired',
};

/** Скачивание чата администратором: выбрать аккаунт и чат, поставить задание, забрать файл */
export const ExportsTab = memo(({ lang, run }: TabProps) => {
  const { data: accounts, error: accountsError } = useAdminData<AccountRow[]>('admin.accounts', {}, ['accounts']);
  const { data: jobs, error } = useAdminData<AdminExportJob[]>('admin.exports', {}, ['exports'], 5000);
  const [accountId, setAccountId] = useState<string>();
  const [query, setQuery] = useState('');
  const [peers, setPeers] = useState<ExportPeer[]>();
  const account = accounts?.find((item) => item.id === accountId) ?? accounts?.[0];

  if (!accounts) return <Loading error={accountsError} lang={lang} />;
  if (!accounts.length) return <p className={styles.empty}>{lang('PxgAdminNoAccounts')}</p>;

  const search = () => {
    if (!account) return;
    void run(async () => {
      const found = await pxgRpc.call<ExportPeer[]>('admin.peers', {
        accountId: account.id,
        query: query.trim() || undefined,
      });
      setPeers(found);
    });
  };

  const start = (peer: ExportPeer) => {
    if (!account) return;
    void run(call('admin.exports.create', { accountId: account.id, peerId: peer.peerId }));
  };

  const download = (job: AdminExportJob) => {
    void run(async () => {
      const { url } = await pxgRpc.call<{ url: string }>('admin.exports.link', { id: job.id });
      window.location.href = url;
    });
  };

  return (
    <>
      <h3 className={styles.sectionTitle}>{lang('PxgAdminExportsStart')}</h3>
      <div className={styles.filters}>
        {accounts.map((item) => (
          <Button
            key={item.id}
            size="smaller"
            pill
            fluid={false}
            color={account?.id === item.id ? 'primary' : 'translucent'}
            onClick={() => {
              setAccountId(item.id);
              setPeers(undefined);
            }}
          >
            {item.displayName ?? item.id}
          </Button>
        ))}
      </div>
      <div className={styles.filters}>
        <InputText
          label={lang('PxgAdminExportsFindChat')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button size="smaller" fluid={false} onClick={search}>{lang('PxgAdminExportsFind')}</Button>
      </div>
      {peers?.length ? (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {peers.map((peer) => (
              <tr key={peer.peerId}>
                <td>
                  <div className={styles.name}>{peer.title ?? peer.username ?? String(peer.peerId)}</div>
                  <div className={styles.secondary}>{peer.type ?? '—'}</div>
                </td>
                <td>
                  <Button size="tiny" isText fluid={false} onClick={() => start(peer)}>
                    {lang('PxgAdminExportsStartAction')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : peers ? <p className={styles.empty}>{lang('PxgAdminExportsNoChats')}</p> : undefined}

      <h3 className={styles.sectionTitle}>{lang('PxgAdminExportsJobs')}</h3>
      {!jobs ? <Loading error={error} lang={lang} /> : !jobs.length ? (
        <p className={styles.empty}>{lang('PxgAdminExportsEmpty')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>
                  <div className={styles.name}>{job.peerTitle ?? String(job.peerId)}</div>
                  <div className={styles.secondary}>
                    {`${job.accountName ?? job.accountId} · ${t(lang, EXPORT_STATUS[job.status])}`}
                  </div>
                  {job.error && (
                    <div className={styles.errorText}>{getPxgReasonText(lang, job.error) ?? job.error}</div>
                  )}
                </td>
                <td>
                  <div>{t(lang, 'PxgAdminExportsCounts', { messages: job.messageCount, files: job.fileCount })}</div>
                  <div className={styles.secondary}>
                    {job.sizeBytes ? formatFileSize(lang, job.sizeBytes) : '—'}
                  </div>
                </td>
                <td>
                  {job.status === 'ready' && (
                    <Button size="tiny" isText fluid={false} onClick={() => download(job)}>
                      {lang('PxgAdminExportsDownload')}
                    </Button>
                  )}
                  {['queued', 'collecting', 'packing'].includes(job.status) && (
                    <Button
                      size="tiny"
                      color="danger"
                      isText
                      fluid={false}
                      onClick={() => void run(call('admin.exports.cancel', { id: job.id }))}
                    >
                      {lang('PxgAdminExportsCancel')}
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
