import { memo, useCallback, useEffect, useRef, useState } from '../../../lib/teact/teact';

import type { AuditFilters, AuditRow, TabProps, Translate } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { usePxgState } from '../../../proxygram/server/store';
import { displayName, formatDateTime } from '../helpers';
import { Loading } from './settingsShared';

import Button from '../../ui/Button';

import styles from '../admin/AdminPanel.module.scss';

/** Teact drops an empty `value`, and the option would then answer with its visible text */
const AUDIT_FILTER_ALL = 'all';

const AUDIT_CATEGORIES = [
  { value: 'actions', key: 'PxgAuditFilterActions' },
  { value: 'access', key: 'PxgAuditFilterAccess' },
  { value: 'archive', key: 'PxgAuditFilterArchive' },
  { value: 'warnings', key: 'PxgAuditFilterWarnings' },
];

const AUDIT_PAGE = 50;

const AUDIT_KEYS: Record<string, string> = {
  share_create: 'PxgAuditShareCreate',
  share_update: 'PxgAuditShareUpdate',
  share_revoke: 'PxgAuditShareRevoke',
  share_leave: 'PxgAuditShareLeave',
  share_source_lost: 'PxgAuditSourceLost',
  share_source_restored: 'PxgAuditSourceRestored',
  share_migrated: 'PxgAuditShareMigrated',
  delegate_send: 'PxgAuditSend',
  delegate_edit: 'PxgAuditEdit',
  delegate_delete: 'PxgAuditDelete',
  delegate_react: 'PxgAuditReact',
  delegate_paidReaction: 'PxgAuditPaidReaction',
  delegate_forward: 'PxgAuditForward',
  message_copy: 'PxgAuditCopy',
  save_to_favorites: 'PxgAuditSaveToFavorites',
  messages_hidden: 'PxgAuditMessagesHidden',
  'admin.sign_in_as': 'PxgAuditAdminSignIn',
  messages_shown: 'PxgAuditMessagesShown',
  delegate_callback: 'PxgAuditCallback',
  delegate_vote: 'PxgAuditVote',
  delegate_read: 'PxgAuditRead',
  delegate_history: 'PxgAuditHistory',
  delegate_pin: 'PxgAuditPin',
  delegate_admin: 'PxgAuditAdmin',
  delegate_scheduled: 'PxgAuditScheduled',
  delegate_transcribe: 'PxgAuditTranscribe',
  delegate_translate: 'PxgAuditTranslate',
  delegate_summarize: 'PxgAuditSummarize',
  delegate_seenBy: 'PxgAuditSeenBy',
  delegate_reactors: 'PxgAuditReactors',
  delegate_sendAs: 'PxgAuditSendAs',
  delegate_inlineBot: 'PxgAuditInlineBot',
  delegate_sponsored: 'PxgAuditSponsored',
  guest_burst: 'PxgAuditGuestBurst',
  guest_rate_limited: 'PxgAuditGuestRateLimited',
  guest_account_limit: 'PxgAuditGuestAccountLimit',
  media_fetch: 'PxgAuditMediaFetch',
  invite_create: 'PxgAuditInviteCreate',
  invite_open: 'PxgAuditInviteOpen',
  invite_accept: 'PxgAuditInviteAccept',
  invite_decline: 'PxgAuditInviteDecline',
  invite_revoke: 'PxgAuditInviteRevoke',
  archive_gap: 'PxgAuditArchiveGap',
  archive_purge: 'PxgAuditPurge',
  archive_export: 'PxgAuditArchiveExport',
  archive_clear: 'PxgAuditArchiveClear',
  archive_retention: 'PxgAuditArchiveRetention',
  archive_dialog_cleared: 'PxgAuditDialogCleared',
  'archive.policy': 'PxgAuditPolicy',
  'archive.chat': 'PxgAuditArchiveChat',
  'account.disconnect': 'PxgAuditDisconnect',
  'account.thin_mode': 'PxgAuditThinMode',
  'session.revoke': 'PxgAuditSessionRevoke',
  'admin.message_debug': 'PxgAuditMessageDebug',
  'admin.outbox.cancel': 'PxgAuditAdminCancel',
  'admin.outbox.retry': 'PxgAuditAdminRetry',
  request_approved: 'PxgAuditRequestApproved',
  request_rejected: 'PxgAuditRequestRejected',
  'admin.request.reject': 'PxgAuditRequestRejected',
  'admin.share.create': 'PxgAuditAdminShareCreate',
  'admin.share.update': 'PxgAuditAdminShareUpdate',
  'admin.share.revoke': 'PxgAuditAdminShareRevoke',
  'admin.account.pause': 'PxgAuditAdminAccountPause',
  'admin.account.resume': 'PxgAuditAdminAccountResume',
  'admin.account.restart': 'PxgAuditAdminAccountRestart',
  'admin.export.start': 'PxgAuditAdminExportStart',
  'admin.export.ready': 'PxgAuditAdminExportReady',
  'admin.export.download': 'PxgAuditAdminExportDownload',
  'admin.export.cancel': 'PxgAuditAdminExportCancel',
};

const FAILED_SUFFIX = '_failed';

/** Someone cleared the history or removed many messages at once: the count, not a wall of IDs */
const MASS_DELETE = 'mass_delete';

export const AuditTab = memo(({ lang, t }: TabProps) => {
  const connection = usePxgState((state) => state.connection);
  const [rows, setRows] = useState<AuditRow[]>();
  const [error, setError] = useState<unknown>();
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState<AuditFilters>();
  const [actorUserId, setActorUserId] = useState(AUDIT_FILTER_ALL);
  const [chatKey, setChatKey] = useState(AUDIT_FILTER_ALL);
  const [category, setCategory] = useState(AUDIT_FILTER_ALL);
  const requestRef = useRef(0);

  const load = useCallback((beforeId?: string) => {
    const request = ++requestRef.current;
    const [accountId, peerId] = chatKey !== AUDIT_FILTER_ALL ? chatKey.split(':') : [];
    pxgRpc.call<AuditRow[]>('audit.mine', {
      limit: AUDIT_PAGE,
      beforeId,
      accountId,
      peerId: peerId ? Number(peerId) : undefined,
      actorUserId: actorUserId !== AUDIT_FILTER_ALL ? actorUserId : undefined,
      category: category !== AUDIT_FILTER_ALL ? category : undefined,
    })
      .then((page) => {
        // The answer to a filter the viewer has already changed
        if (request !== requestRef.current) return;
        setRows((current) => (beforeId ? [...(current ?? []), ...page] : page));
        setHasMore(page.length === AUDIT_PAGE);
        setError(undefined);
      })
      .catch((err) => {
        if (request === requestRef.current) setError(err);
      });
  }, [actorUserId, category, chatKey, requestRef]);

  useEffect(() => {
    if (connection !== 'online') return undefined;
    setRows(undefined);
    setError(undefined);
    load();
    return () => {
      // После смены фильтра или ухода из раздела прежний ответ не применяется
      // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
      requestRef.current++;
    };
  }, [load, connection, requestRef]);

  useEffect(() => {
    if (connection !== 'online') return undefined;
    let isActive = true;
    pxgRpc.call<AuditFilters>('audit.filters').then((result) => {
      if (isActive) setFilters(result);
    }).catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [connection]);

  if (!rows) return <Loading error={error} lang={lang} onRetry={load} />;

  return (
    <>
      <div className={styles.filters}>
        <select
          aria-label={lang('PxgAuditFilterCategory')}
          value={category}
          onChange={(e) => setCategory(e.currentTarget.value)}
        >
          <option value={AUDIT_FILTER_ALL}>{lang('PxgAuditFilterAllActions')}</option>
          {AUDIT_CATEGORIES.map(({ value, key }) => <option key={value} value={value}>{t(key)}</option>)}
        </select>
        <select
          aria-label={lang('PxgAuditFilterActor')}
          value={actorUserId}
          onChange={(e) => setActorUserId(e.currentTarget.value)}
        >
          <option value={AUDIT_FILTER_ALL}>{lang('PxgAuditFilterAllPeople')}</option>
          {filters?.actors.map((actor) => <option key={actor.id} value={actor.id}>{displayName(actor)}</option>)}
        </select>
        <select
          aria-label={lang('PxgAuditFilterChat')}
          value={chatKey}
          onChange={(e) => setChatKey(e.currentTarget.value)}
        >
          <option value={AUDIT_FILTER_ALL}>{lang('PxgAuditFilterAllChats')}</option>
          {filters?.chats.map((chat) => (
            <option key={`${chat.accountId}:${chat.peerId}`} value={`${chat.accountId}:${chat.peerId}`}>
              {chat.title ?? chat.peerId}
            </option>
          ))}
        </select>
      </div>
      {rows.length === 0 && <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>}
      <table className={buildClassName(styles.table, styles.stacked)}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={styles.secondary}>{formatDateTime(row.at)}</td>
              <td>
                <div className={styles.name}>{row.actor ? displayName(row.actor) : '—'}</div>
              </td>
              <td>
                {row.action === MASS_DELETE ? t('PxgAuditMassDelete', { count: row.count ?? 0 }) : (
                  <>
                    {describeAction(t, row)}
                    {row.msgIds?.length
                      ? <span className={styles.secondary}>{` · ${row.msgIds.join(', ')}`}</span> : ''}
                  </>
                )}
                {row.isCrossAccountCopy && (
                  <div className={styles.secondary}>{lang('PxgAuditCrossAccountCopy')}</div>
                )}
              </td>
              <td className={styles.secondary}>{row.peerTitle ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <Button size="smaller" isText fluid={false} onClick={() => load(rows.at(-1)?.id)}>
          {lang('PxgSettingsMore')}
        </Button>
      )}
    </>
  );
});

function describeAction(t: Translate, row: AuditRow) {
  const isFailed = row.action.endsWith(FAILED_SUFFIX);
  const base = isFailed ? row.action.slice(0, -FAILED_SUFFIX.length) : row.action;
  // A paid action and its spend are two entries: the amount is the only thing this one adds
  if (base === 'stars_spent' && row.stars) return t('PxgAuditStarsSpent', { stars: row.stars });
  const key = AUDIT_KEYS[base];
  const text = key ? t(key) : t('PxgAuditUnknown');
  return isFailed ? `${text} · ${t('PxgAuditFailed')}` : text;
}
