import { memo, useCallback, useEffect, useRef, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { AccountDto, ImportStateDto, PresetKey, ServerEvent } from '../../../proxygram/server/types';

import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { IS_ANDROID, IS_IOS, IS_PWA } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import { getServerTime } from '../../../util/serverTime';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError, displayName, formatDateTime } from '../helpers';

import useSelector from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import ConfirmDialog from '../../ui/ConfirmDialog';
import InputText from '../../ui/InputText';
import TabList from '../../ui/TabList';
import ArchiveTools from './ArchiveTools';

import styles from '../admin/AdminPanel.module.scss';

type Person = { id: string; username: string | null; firstName: string | null } | null;
type Lang = ReturnType<typeof useLang>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

type AccountRow = AccountDto & { messages: number; mediaBytes: number; activeShares: number };

type ShareRow = {
  id: string;
  accountId: string;
  scope: 'chat' | 'topic' | 'folder';
  peerId: number | null;
  topicId: number | null;
  folderId: number | null;
  folderTitle: string | null;
  hiddenAt?: string | null;
  preset: PresetKey;
  status: 'active' | 'paused' | 'source_lost';
  expiresAt: string | null;
  label: string | null;
  peerTitle: string | null;
  topicTitle: string | null;
  grantee?: Person;
  grantor?: Person;
};

type AuditRow = {
  id: string;
  at: string;
  action: string;
  peerTitle: string | null;
  msgIds: number[] | null;
  /** Messages affected when the entry keeps only some of their IDs (a mass deletion) */
  count: number | null;
  isCrossAccountCopy?: boolean;
  actor: Person;
};

type AuditFilters = {
  actors: NonNullable<Person>[];
  chats: { accountId: string; peerId: number; title: string | null }[];
};

/** Teact drops an empty `value`, and the option would then answer with its visible text */
const AUDIT_FILTER_ALL = 'all';
const AUDIT_CATEGORIES = [
  { value: 'actions', key: 'PxgAuditFilterActions' },
  { value: 'access', key: 'PxgAuditFilterAccess' },
  { value: 'archive', key: 'PxgAuditFilterArchive' },
  { value: 'warnings', key: 'PxgAuditFilterWarnings' },
];

type SessionRow = {
  id: string;
  level: 'guest' | 'client';
  deviceName: string | null;
  platform: string | null;
  ip: string | null;
  lastActiveAt: string;
  online: boolean;
  isCurrent: boolean;
};

type Policy = {
  media: {
    maxBytes: number;
    includeVideo: boolean;
    includeDocuments: boolean;
    onDemand: boolean;
    onDemandKeepDays: number;
    keepDays: number;
  };
  retention: { deletedDays: number };
  import: { enabled: boolean; perChat: number };
  chats: { channels: boolean; maxMembers: number };
  /** Chats the owner archives or not regardless of the policy */
  exceptions: { peerId: number; title: string | null; enabled: boolean }[];
};

type Confirm = { text: string; label: string; action: () => Promise<unknown> };

type TabProps = {
  lang: Lang;
  t: Translate;
  accounts?: AccountRow[];
  reloadAccounts: NoneToVoidFunction;
  ask: (text: string, label: string, action: () => Promise<unknown>) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
};

const TABS = [
  { key: 'server', title: 'PxgSettingsServer', isOwnerOnly: true },
  { key: 'outgoing', title: 'PxgSettingsOutgoing', isOwnerOnly: true },
  { key: 'incoming', title: 'PxgSettingsIncoming', isOwnerOnly: false },
  { key: 'archive', title: 'PxgSettingsArchive', isOwnerOnly: true },
  { key: 'audit', title: 'PxgSettingsAudit', isOwnerOnly: true },
  { key: 'devices', title: 'PxgSettingsDevices', isOwnerOnly: false },
] as const;

const MB = 1024 * 1024;
const AUDIT_PAGE = 50;
const ACCOUNT_STATUS: Record<string, { key: string; tone: 'green' | 'red' | 'gray' | 'blue' }> = {
  active: { key: 'PxgStatusActive', tone: 'green' },
  paused: { key: 'PxgStatusPaused', tone: 'gray' },
  auth_lost: { key: 'PxgStatusAuthLost', tone: 'red' },
  flood: { key: 'PxgStatusFlood', tone: 'red' },
  revoked: { key: 'PxgStatusRevoked', tone: 'gray' },
  connecting: { key: 'PxgStatusConnecting', tone: 'blue' },
};
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
  delegate_forward: 'PxgAuditForward',
  message_copy: 'PxgAuditCopy',
  save_to_favorites: 'PxgAuditSaveToFavorites',
  messages_hidden: 'PxgAuditMessagesHidden',
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
  'archive.policy': 'PxgAuditPolicy',
  'archive.chat': 'PxgAuditArchiveChat',
  'account.disconnect': 'PxgAuditDisconnect',
  'account.thin_mode': 'PxgAuditThinMode',
  'session.revoke': 'PxgAuditSessionRevoke',
  'admin.message_debug': 'PxgAuditMessageDebug',
  'admin.outbox.cancel': 'PxgAuditAdminCancel',
  'admin.outbox.retry': 'PxgAuditAdminRetry',
};
const FAILED_SUFFIX = '_failed';
/** Someone cleared the history or removed many messages at once: the count, not a wall of IDs */
const MASS_DELETE = 'mass_delete';

/** Данные раздела; перечитываются по событиям сервера, которые их меняют */
function usePxgData<T>(method: string, params: unknown, reloadOn: ServerEvent['e'][]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const paramsKey = JSON.stringify(params);
  const reloadKey = reloadOn.join();
  const requestRef = useRef(0);
  const connection = usePxgState((state) => state.connection);

  const reload = useCallback(() => {
    const request = ++requestRef.current;
    pxgRpc.call<T>(method, JSON.parse(paramsKey))
      .then((result) => {
        if (request !== requestRef.current) return;
        setData(result);
        setError(undefined);
      })
      .catch((err) => {
        if (request === requestRef.current) setError(err);
      });
  }, [method, paramsKey, requestRef]);

  useEffect(() => {
    if (connection !== 'online') return undefined;
    reload();
    const events = new Set(reloadKey.split(','));
    const unsubscribe = pxgRpc.on((event) => {
      if (events.has(event.e)) reload();
    });
    return () => {
      // This ref tracks RPC generations; cleanup invalidates responses from the previous subscription
      // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
      requestRef.current++;
      unsubscribe();
    };
  }, [reload, reloadKey, connection, requestRef]);

  return { data, error, reload };
}

/** «Настройки Proxygram» (PLAN.md, 7.12): сервер, доступы в обе стороны, архив, журнал, устройства */
const PxgSettingsPanel = () => {
  const lang = useLang();
  const session = usePxgState((state) => state.session);
  // Managing shares needs only the server session: an owner signed in as a guest keeps these tabs
  const { data: accounts, reload: reloadAccounts } = usePxgData<AccountRow[]>(
    'accounts.mine', {}, ['accounts.changed'],
  );
  const ownAccounts = accounts?.filter((account) => account.status !== 'revoked');
  const isOwner = session?.level === 'client' || Boolean(ownAccounts?.length);
  const tabs = TABS.filter((item) => isOwner || !item.isOwnerOnly);
  const [selectedTabKey, setSelectedTabKey] = useState<typeof TABS[number]['key']>(
    session?.level === 'client' ? 'server' : 'incoming',
  );
  const [confirm, setConfirm] = useState<Confirm>();
  const [actionError, setActionError] = useState<string>();
  const tab = Math.max(0, tabs.findIndex((item) => item.key === selectedTabKey));
  const tabKey = tabs[tab].key;
  const t = lang as unknown as Translate;

  const close = () => setPxgState({ isSettingsOpen: false });
  const ask = (text: string, label: string, action: () => Promise<unknown>) => setConfirm({ text, label, action });
  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
    } catch (err) {
      setActionError(describePxgError(lang, err));
    }
  };
  const props = {
    lang, t, ask, run, accounts: ownAccounts, reloadAccounts,
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Button
          round
          size="smaller"
          color="translucent"
          iconName="close"
          onClick={close}
          ariaLabel={lang('Close')}
        />
        <h2>{lang('PxgSettingsTitle')}</h2>
      </header>
      <TabList
        tabs={tabs.map((item) => ({ title: t(item.title) }))}
        activeTab={tab}
        onSwitchTab={(index) => setSelectedTabKey(tabs[index].key)}
        className={styles.tabs}
      />
      {actionError && <div className={styles.actionError}>{actionError}</div>}
      <div className={buildClassName(styles.content, 'custom-scroll')}>
        {tabKey === 'server' && <ServerTab {...props} />}
        {tabKey === 'outgoing' && <OutgoingTab {...props} />}
        {tabKey === 'incoming' && <IncomingTab {...props} />}
        {tabKey === 'archive' && <HideDeletedOption lang={lang} />}
        {tabKey === 'archive' && <ArchiveTab {...props} />}
        {tabKey === 'audit' && <AuditTab {...props} />}
        {tabKey === 'devices' && <DevicesTab {...props} />}
      </div>
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={lang('PxgAdminConfirm')}
        text={confirm?.text}
        confirmLabel={confirm?.label}
        confirmIsDestructive
        confirmHandler={() => {
          const action = confirm?.action;
          setConfirm(undefined);
          if (action) void run(action);
        }}
        onClose={() => setConfirm(undefined)}
      />
    </div>
  );
};

function Loading({ error, lang }: { error: unknown; lang: Lang }) {
  return <p className={styles.empty}>{error ? describePxgError(lang, error) : lang('PxgAdminLoading')}</p>;
}

function Badge({ tone, text }: { tone: 'green' | 'red' | 'gray' | 'blue'; text: string }) {
  return <span className={buildClassName(styles.badge, styles[tone])}>{text}</span>;
}

const ServerTab = memo(({
  lang, t, ask, run, accounts, reloadAccounts,
}: TabProps) => {
  const isClient = usePxgState((state) => state.session?.level === 'client');
  if (!accounts) return <Loading error={undefined} lang={lang} />;

  return (
    <>
      {accounts.length === 0 && <p className={styles.empty}>{lang('PxgSettingsNoAccounts')}</p>}
      {accounts.length > 0 && (
        <table className={styles.table}>
          <tbody>
            {accounts.map((account) => {
              const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
              return (
                <tr key={account.id}>
                  <td>
                    <div className={styles.name}>{account.displayName ?? '—'}</div>
                    <div className={styles.secondary}>{formatDateTime(account.connectedAt)}</div>
                    {account.lastMessageAt && (
                      <div className={styles.secondary}>
                        {t('PxgSettingsLastEvent', { time: formatDateTime(account.lastMessageAt) })}
                      </div>
                    )}
                  </td>
                  <td>
                    <Badge tone={status.tone} text={t(status.key)} />
                    {account.statusReason && (
                      <div className={styles.secondary}>{describeStatusReason(t, account.statusReason)}</div>
                    )}
                  </td>
                  <td>
                    {t('PxgAdminMessages', { count: account.messages })}
                    <div className={styles.secondary}>
                      {t('PxgSettingsMedia', { size: formatMegabytes(account.mediaBytes) })}
                    </div>
                    {renderImport(t, account.importState)}
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="tiny"
                      color="danger"
                      isText
                      onClick={() => ask(
                        t('PxgAdminDisconnectConfirm', { name: account.displayName ?? '' }),
                        lang('PxgAdminDisconnect'),
                        async () => {
                          await pxgRpc.call('accounts.disconnect', { accountId: account.id });
                          reloadAccounts();
                        },
                      )}
                    >
                      {lang('PxgAdminDisconnect')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {accounts.length > 0 && (
        <div className={styles.form}>
          <h3 className={styles.name}>{lang('PxgThinMode')}</h3>
          <p className={styles.secondary}>{lang('PxgThinModeHint')}</p>
          {accounts.map((account) => (
            <Checkbox
              key={account.id}
              label={account.displayName ?? account.id}
              checked={account.thinMode}
              onCheck={(enabled) => run(async () => {
                await pxgRpc.call('accounts.setThinMode', { accountId: account.id, enabled });
                reloadAccounts();
              })}
            />
          ))}
        </div>
      )}
      {/* With Telegram on this device its session signs the server in; without it, a phone scans a QR code */}
      <Button
        size="smaller"
        fluid={false}
        onClick={() => setPxgState({ isSettingsOpen: false, isConnectOpen: true })}
      >
        {lang(isClient ? 'PxgConnectTitle' : 'PxgConnectQrTitle')}
      </Button>
      {accounts.length > 0 && (
        <div className={styles.form}>
          <h3 className={styles.name}>{lang('PxgWipeTitle')}</h3>
          <p className={styles.secondary}>{lang('PxgWipeHint')}</p>
          <Button
            size="smaller"
            color="danger"
            fluid={false}
            onClick={() => ask(lang('PxgWipeConfirm'), lang('PxgWipeRun'), async () => {
              await pxgRpc.call('accounts.wipe');
              reloadAccounts();
            })}
          >
            {lang('PxgWipeRun')}
          </Button>
        </div>
      )}
    </>
  );
});

/** Reasons the server sets itself are codes; the rest is Telegram's own error text */
const STATUS_REASON_KEYS: Record<string, string> = {
  logout_pending: 'PxgReasonLogoutPending',
  logged_out: 'PxgReasonLoggedOut',
  wipe_pending: 'PxgReasonWipePending',
};

function describeStatusReason(t: Translate, reason: string) {
  const key = STATUS_REASON_KEYS[reason];
  return key ? t(key) : reason;
}

function renderImport(t: Translate, state: ImportStateDto | null) {
  if (state?.status !== 'running') return undefined;
  return (
    <div className={styles.secondary}>{t('PxgImportProgress', { done: state.doneCount, total: state.total })}</div>
  );
}

type OutgoingView = 'guest' | 'chat' | 'expiring';
type OutgoingGroup = { key: string; title?: string; items: ShareRow[] };

const OUTGOING_VIEWS: { view: OutgoingView; key: string }[] = [
  { view: 'guest', key: 'PxgSharesByGuest' },
  { view: 'chat', key: 'PxgSharesByChat' },
  { view: 'expiring', key: 'PxgSharesExpiring' },
];

/** «Я поделился» (PLAN.md 7.12): по гостям или по чатам с отзывом всей группы, отдельно — доступы со сроком */
const OutgoingTab = memo(({ lang, t, ask }: TabProps) => {
  const { data, error, reload } = usePxgData<ShareRow[]>('shares.outgoing', {}, ['shares.changed', 'access.changed']);
  const [view, setView] = useState<OutgoingView>('guest');
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>;

  const revoke = (items: ShareRow[], text: string) => ask(text, lang('PxgShareRevoke'), async () => {
    await pxgRpc.call('shares.revokeMany', { shareIds: items.map((share) => share.id) });
    reload();
  });
  const groups: OutgoingGroup[] = view === 'guest'
    ? groupBy(data, (share) => share.grantee?.id ?? '')
      .map(([key, items]) => ({ key, title: displayName(items[0].grantee), items }))
    : view === 'chat'
      ? groupBy(data, targetKey).map(([key, items]) => ({ key, title: describeTarget(t, items[0]), items }))
      : [{ key: 'expiring', items: data.filter((share) => share.expiresAt).sort(byExpiry) }];
  const rowTitle = (share: ShareRow) => (view === 'guest' ? describeTarget(t, share)
    : view === 'chat' ? displayName(share.grantee)
      : `${displayName(share.grantee)} · ${describeTarget(t, share)}`);

  return (
    <>
      <div className={styles.filters}>
        {OUTGOING_VIEWS.map((item) => (
          <Button
            key={item.view}
            size="smaller"
            pill
            fluid={false}
            color={view === item.view ? 'primary' : 'translucent'}
            onClick={() => setView(item.view)}
          >
            {t(item.key)}
          </Button>
        ))}
      </div>
      {!groups[0]?.items.length ? <p className={styles.empty}>{lang('PxgSharesNoExpiring')}</p> : (
        <table className={styles.table}>
          <tbody>
            {groups.map((group) => group.items.map((share, index) => (
              <tr key={share.id}>
                {group.title !== undefined && (
                  <td>
                    {index === 0 && <div className={styles.name}>{group.title}</div>}
                    {index === 0 && group.items.length > 1 && (
                      <>
                        <div className={styles.secondary}>
                          {t(view === 'guest' ? 'PxgSettingsChats' : 'PxgSettingsGuests', {
                            count: group.items.length,
                          })}
                        </div>
                        <Button
                          size="tiny"
                          color="danger"
                          isText
                          fluid
                          onClick={() => revoke(group.items, t(
                            view === 'guest' ? 'PxgRevokeAllOfGuestConfirm' : 'PxgRevokeAllOfChatConfirm',
                            { title: group.title ?? '', count: group.items.length },
                          ))}
                        >
                          {lang('PxgRevokeAll')}
                        </Button>
                      </>
                    )}
                  </td>
                )}
                <td>
                  {rowTitle(share)}
                  <div className={styles.secondary}>{describeShare(t, share)}</div>
                </td>
                <td className={styles.actions}>
                  <Button
                    size="tiny"
                    color="danger"
                    isText
                    onClick={() => revoke([share], t('PxgSettingsRevokeConfirm', {
                      name: displayName(share.grantee), title: describeTarget(t, share),
                    }))}
                  >
                    {lang('PxgShareRevoke')}
                  </Button>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
    </>
  );
});

/** Одна цель доступа: чат, тема или папка своего аккаунта */
function targetKey(share: ShareRow) {
  return [share.accountId, share.scope, share.peerId, share.topicId, share.folderId].join(':');
}

function byExpiry(a: ShareRow, b: ShareRow) {
  return Date.parse(a.expiresAt ?? '') - Date.parse(b.expiresAt ?? '');
}

const IncomingTab = memo(({
  lang, t, ask, run,
}: TabProps) => {
  const { data, error, reload } = usePxgData<ShareRow[]>('shares.incoming', {}, ['access.changed']);
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgGuestNoChatsNoUsername')}</p>;

  return (
    <table className={styles.table}>
      <tbody>
        {groupBy(data, (share) => share.grantor?.id ?? '').map(([, items]) => items.map((share, index) => (
          <tr key={share.id}>
            <td>
              {index === 0 && (
                <div className={styles.name}>
                  {t('PxgSettingsFrom', { name: displayName(items[0].grantor) })}
                </div>
              )}
            </td>
            <td>
              {describeTarget(t, share)}
              <div className={styles.secondary}>{describeShare(t, share)}</div>
              {share.hiddenAt && <div className={styles.secondary}>{lang('PxgSettingsHiddenHint')}</div>}
            </td>
            <td className={styles.actions}>
              <Button
                size="tiny"
                isText
                onClick={() => run(async () => {
                  await pxgRpc.call('shares.setHidden', { shareId: share.id, hidden: !share.hiddenAt });
                  reload();
                })}
              >
                {lang(share.hiddenAt ? 'PxgSettingsShow' : 'PxgSettingsHide')}
              </Button>
              <Button
                size="tiny"
                color="danger"
                isText
                onClick={() => ask(
                  t('PxgSettingsLeaveConfirm', { title: describeTarget(t, share) }),
                  lang('PxgSettingsLeave'),
                  async () => {
                    await pxgRpc.call('shares.leave', { shareId: share.id });
                    reload();
                  },
                )}
              >
                {lang('PxgSettingsLeave')}
              </Button>
            </td>
          </tr>
        )))}
      </tbody>
    </table>
  );
});

const HideDeletedOption = memo(({ lang }: { lang: Lang }) => {
  const { setSettingOption } = getActions();
  const isHidden = useSelector((global) => global.settings.byKey.pxgHideDeleted);

  return (
    <Checkbox
      label={lang('PxgSettingsHideDeleted')}
      checked={Boolean(isHidden)}
      onCheck={(pxgHideDeleted) => setSettingOption({ pxgHideDeleted, pxgHideDeletedChats: {} })}
    />
  );
});

const ArchiveTab = memo(({
  lang, t, run, ask, accounts, reloadAccounts,
}: TabProps) => {
  const [selectedId, setSelectedId] = useState<string>();
  const account = accounts?.find((item) => item.id === selectedId) ?? accounts?.[0];
  const [policy, setPolicy] = useState<Policy>();
  const [error, setError] = useState<unknown>();
  const [maxMegabytes, setMaxMegabytes] = useState('');
  const [keepDays, setKeepDays] = useState('');
  const [perChat, setPerChat] = useState('');
  const [maxMembers, setMaxMembers] = useState('');
  const [filesDays, setFilesDays] = useState('');
  const [deletedDays, setDeletedDays] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  const accountId = account?.id;
  const load = useCallback(() => {
    if (!accountId) return;
    setPolicy(undefined);
    setIsSaved(false);
    pxgRpc.call<Policy>('archive.policy.get', { accountId })
      .then((result) => {
        setPolicy(result);
        setFilesDays(String(result.media.keepDays));
        setDeletedDays(String(result.retention.deletedDays));
        setMaxMegabytes(String(Math.round(result.media.maxBytes / MB)));
        setKeepDays(String(result.media.onDemandKeepDays));
        setPerChat(String(result.import.perChat));
        setMaxMembers(String(result.chats.maxMembers));
      })
      .catch(setError);
  }, [accountId]);

  useEffect(load, [load]);

  if (!account) return <p className={styles.empty}>{lang('PxgSettingsNoAccounts')}</p>;
  if (!policy) return <Loading error={error} lang={lang} />;

  const toggleMedia = (key: 'includeVideo' | 'includeDocuments' | 'onDemand', value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, media: { ...policy.media, [key]: value } });
  };
  const toggleImport = (value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, import: { ...policy.import, enabled: value } });
  };
  const toggleChannels = (value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, chats: { ...policy.chats, channels: value } });
  };
  const save = () => run(async () => {
    const result = await pxgRpc.call<Policy>('archive.policy.set', {
      accountId: account.id,
      media: {
        maxBytes: Math.max(0, Number(maxMegabytes) || 0) * MB,
        includeVideo: policy.media.includeVideo,
        includeDocuments: policy.media.includeDocuments,
        onDemand: policy.media.onDemand,
        onDemandKeepDays: Math.max(1, Number(keepDays) || 1),
        keepDays: Number(filesDays) || 0,
      },
      retention: { deletedDays: Number(deletedDays) || 0 },
      import: {
        enabled: policy.import.enabled,
        perChat: Math.max(0, Number(perChat) || 0),
      },
      chats: {
        channels: policy.chats.channels,
        maxMembers: Math.max(0, Number(maxMembers) || 0),
      },
    });
    setPolicy(result);
    setIsSaved(true);
  });
  const resetException = (peerId: number) => run(async () => {
    // The server goes back to the policy only on an explicit JSON `null`
    // eslint-disable-next-line no-null/no-null
    await pxgRpc.call('archive.chat.set', { accountId: account.id, peerId, enabled: null });
    load();
  });
  const onDigits = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSaved(false);
    setter(e.target.value.replace(/\D/g, ''));
  };

  return (
    <>
      {accounts && accounts.length > 1 && (
        <div className={styles.filters}>
          {accounts.map((item) => (
            <Button
              key={item.id}
              size="smaller"
              fluid={false}
              color={item.id === account.id ? 'primary' : 'translucent'}
              onClick={() => setSelectedId(item.id)}
            >
              {item.displayName ?? '—'}
            </Button>
          ))}
        </div>
      )}
      <p className={styles.secondary}>
        {t('PxgPolicyUsage', {
          count: account.messages,
          size: formatMegabytes(account.mediaBytes),
        })}
      </p>
      <div className={styles.form}>
        <h3 className={styles.sectionTitle}>{lang('PxgArchiveLimitsTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgArchiveLimitFiles')}</p>
        <p className={styles.secondary}>{lang('PxgArchiveLimitBefore')}</p>
        <p className={styles.secondary}>{lang('PxgArchiveLimitEdits')}</p>
      </div>
      <div className={styles.form}>
        <h3 className={styles.sectionTitle}>{lang('PxgPolicyChatsTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgPolicyChatsNote')}</p>
        <Checkbox
          label={lang('PxgPolicyChannels')}
          checked={policy.chats.channels}
          onCheck={toggleChannels}
        />
        <InputText
          label={lang('PxgPolicyMaxMembers')}
          inputMode="numeric"
          value={maxMembers}
          onChange={onDigits(setMaxMembers)}
        />
        {policy.exceptions.length > 0 && (
          <>
            <p className={styles.secondary}>{lang('PxgPolicyExceptions')}</p>
            <table className={styles.table}>
              <tbody>
                {policy.exceptions.map((exception) => (
                  <tr key={exception.peerId}>
                    <td className={styles.name}>{exception.title ?? exception.peerId}</td>
                    <td className={styles.secondary}>
                      {lang(exception.enabled ? 'PxgPolicyExceptionOn' : 'PxgPolicyExceptionOff')}
                    </td>
                    <td className={styles.actions}>
                      <Button size="smaller" isText fluid={false} onClick={() => void resetException(exception.peerId)}>
                        {lang('PxgPolicyExceptionReset')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h3 className={styles.sectionTitle}>{lang('PxgPolicyFilesTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgPolicyNote')}</p>
        <InputText
          label={lang('PxgPolicyMaxSize')}
          inputMode="numeric"
          value={maxMegabytes}
          onChange={onDigits(setMaxMegabytes)}
        />
        <Checkbox
          label={lang('PxgPolicyVideo')}
          checked={policy.media.includeVideo}
          onCheck={(value) => toggleMedia('includeVideo', value)}
        />
        <Checkbox
          label={lang('PxgPolicyDocuments')}
          checked={policy.media.includeDocuments}
          onCheck={(value) => toggleMedia('includeDocuments', value)}
        />
        <Checkbox
          label={lang('PxgPolicyOnDemand')}
          checked={policy.media.onDemand}
          onCheck={(value) => toggleMedia('onDemand', value)}
        />
        <InputText
          label={lang('PxgPolicyKeepDays')}
          inputMode="numeric"
          value={keepDays}
          onChange={onDigits(setKeepDays)}
        />
        <Checkbox
          label={lang('PxgPolicyImport')}
          checked={policy.import.enabled}
          onCheck={toggleImport}
        />
        <InputText
          label={lang('PxgPolicyPerChat')}
          inputMode="numeric"
          value={perChat}
          onChange={onDigits(setPerChat)}
        />
        <h3 className={styles.sectionTitle}>{lang('PxgPolicyRetentionTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgPolicyRetentionNote')}</p>
        <InputText
          label={lang('PxgPolicyDeletedDays')}
          inputMode="numeric"
          value={deletedDays}
          onChange={onDigits(setDeletedDays)}
        />
        <InputText
          label={lang('PxgPolicyFilesDays')}
          inputMode="numeric"
          value={filesDays}
          onChange={onDigits(setFilesDays)}
        />
        <div className={styles.formButtons}>
          <Button fluid={false} onClick={() => void save()}>{lang('PxgShareSave')}</Button>
          {isSaved && <span className={styles.secondary}>{t('PxgSettingsSaved')}</span>}
        </div>
      </div>
      <ArchiveTools
        key={account.id}
        accountId={account.id}
        accountName={account.displayName ?? ''}
        ask={ask}
        onCleared={reloadAccounts}
      />
    </>
  );
});

const AuditTab = memo(({ lang, t }: TabProps) => {
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
      })
      .catch(setError);
  }, [actorUserId, category, chatKey, requestRef]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    pxgRpc.call<AuditFilters>('audit.filters').then(setFilters).catch(() => undefined);
  }, []);

  if (!rows) return <Loading error={error} lang={lang} />;

  return (
    <>
      <div className={styles.filters}>
        <select
          aria-label={lang('PxgAuditFilterCategory')}
          value={category}
          onChange={(e) => setCategory(e.currentTarget.value)}
        >
          <option value={AUDIT_FILTER_ALL}>{lang('PxgAuditFilterAllActions')}</option>
          {AUDIT_CATEGORIES.map(({ value, key }) => <option value={value}>{t(key)}</option>)}
        </select>
        <select
          aria-label={lang('PxgAuditFilterActor')}
          value={actorUserId}
          onChange={(e) => setActorUserId(e.currentTarget.value)}
        >
          <option value={AUDIT_FILTER_ALL}>{lang('PxgAuditFilterAllPeople')}</option>
          {filters?.actors.map((actor) => <option value={actor.id}>{displayName(actor)}</option>)}
        </select>
        <select
          aria-label={lang('PxgAuditFilterChat')}
          value={chatKey}
          onChange={(e) => setChatKey(e.currentTarget.value)}
        >
          <option value={AUDIT_FILTER_ALL}>{lang('PxgAuditFilterAllChats')}</option>
          {filters?.chats.map((chat) => (
            <option value={`${chat.accountId}:${chat.peerId}`}>{chat.title ?? chat.peerId}</option>
          ))}
        </select>
      </div>
      {rows.length === 0 && <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>}
      <table className={styles.table}>
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
                    {describeAction(t, row.action)}
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

const DevicesTab = memo(({ lang, t, ask }: TabProps) => {
  const { data, error, reload } = usePxgData<SessionRow[]>('sessions.mine', {}, []);
  if (!data) return <Loading error={error} lang={lang} />;

  return (
    <>
      <ServerAdminLine lang={lang} t={t} />
      {IS_TAURI && !IS_ANDROID && <AutostartToggle lang={lang} />}
      <BotNotificationsToggle lang={lang} />
      <table className={styles.table}>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <td>
                <div className={styles.name}>
                  {row.online && <span className={styles.onlineDot} />}
                  {row.deviceName ?? row.platform ?? '—'}
                </div>
                <div className={styles.secondary}>
                  {row.isCurrent ? lang('PxgSettingsThisDevice') : row.ip ?? ''}
                </div>
              </td>
              <td>{row.level === 'client' ? lang('PxgLevelClient') : lang('PxgLevelGuest')}</td>
              <td className={styles.secondary}>{formatDateTime(row.lastActiveAt)}</td>
              <td className={styles.actions}>
                {!row.isCurrent && (
                  <Button
                    size="tiny"
                    color="danger"
                    isText
                    onClick={() => ask(t('PxgSettingsEndConfirm'), lang('PxgSettingsEnd'), async () => {
                      await pxgRpc.call('sessions.revoke', { sessionId: row.id });
                      reload();
                    })}
                  >
                    {lang('PxgSettingsEnd')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
});

type ServerAdmin = { firstName: string | null; lastName: string | null; username: string | null; isYou: boolean };

/** Who runs this server — whom to write when something breaks; the server has exactly one administrator */
function ServerAdminLine({ lang, t }: { lang: Lang; t: Translate }) {
  const { data } = usePxgData<ServerAdmin | null>('server.admin', {}, []);
  if (!data) return undefined;
  if (data.isYou) return <p className={styles.secondary}>{lang('PxgServerAdminYou')}</p>;

  const name = [data.firstName, data.lastName].filter(Boolean).join(' ') || (data.username ? `@${data.username}` : '—');
  return (
    <p className={styles.secondary}>
      {t('PxgServerAdmin', { name })}
      {data.username && (
        <>
          {' · '}
          <a href={`https://t.me/${data.username}`} target="_blank" rel="noopener noreferrer">{`@${data.username}`}</a>
        </>
      )}
    </p>
  );
}

/** The fallback channel: the bot writes about new messages when no device of this person gets Web Push (PLAN.md 7.14) */
function BotNotificationsToggle({ lang }: { lang: Lang }) {
  const { data, reload } = usePxgData<{
    viaBot: boolean;
    pushDevices: number;
    isWebPushEnabled?: boolean;
  }>('notifications.get', {}, []);
  if (!data) return undefined;

  return (
    <>
      {!IS_TAURI && data.isWebPushEnabled === false && (
        <p className={styles.secondary}>{lang('PxgNotifyPushUnavailable')}</p>
      )}
      {!IS_TAURI && data.isWebPushEnabled && IS_IOS && !IS_PWA && (
        <p className={styles.secondary}>{lang('PxgNotifyIosInstall')}</p>
      )}
      <Checkbox
        label={lang('PxgNotifyViaBot')}
        subLabel={lang(data.pushDevices ? 'PxgNotifyViaBotHasPush' : 'PxgNotifyViaBotHint')}
        checked={data.viaBot}
        onCheck={(isChecked) => {
          pxgRpc.call('notifications.setViaBot', { enabled: isChecked }).then(reload).catch(() => undefined);
        }}
      />
    </>
  );
}

/** The desktop app can start with the system and stay in the tray (PLAN.md 16) */
function AutostartToggle({ lang }: { lang: Lang }) {
  const [isEnabled, setIsEnabled] = useState<boolean | undefined>();

  useEffect(() => {
    window.tauri.isAutostartEnabled().then(setIsEnabled).catch(() => undefined);
  }, []);

  if (isEnabled === undefined) return undefined;

  return (
    <Checkbox
      label={lang('PxgAutostart')}
      subLabel={lang('PxgAutostartHint')}
      checked={isEnabled}
      onCheck={(isChecked) => {
        window.tauri.setAutostart(isChecked).then(() => setIsEnabled(isChecked)).catch(() => undefined);
      }}
    />
  );
}

function describeTarget(t: Translate, share: ShareRow) {
  if (share.label) return share.label;
  if (share.scope === 'folder') return share.folderTitle || t('PxgSettingsFolder', { id: share.folderId ?? 0 });
  if (share.scope === 'topic' && share.topicTitle) return `${share.peerTitle ?? '—'} › ${share.topicTitle}`;
  return share.peerTitle ?? '—';
}

function describeShare(t: Translate, share: ShareRow) {
  const parts = [t(`PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)];
  if (share.expiresAt && Date.parse(share.expiresAt) <= getServerTime() * 1000) {
    parts.push(t('PxgShareStatusExpired'));
  }
  if (share.status === 'paused') parts.push(t('PxgShareStatusPaused'));
  if (share.status === 'source_lost') parts.push(t('PxgShareStatusLost'));
  if (share.expiresAt) parts.push(t('PxgShareExpires', { date: formatDateTime(share.expiresAt) }));
  return parts.join(' · ');
}

function describeAction(t: Translate, action: string) {
  const isFailed = action.endsWith(FAILED_SUFFIX);
  const base = isFailed ? action.slice(0, -FAILED_SUFFIX.length) : action;
  const key = AUDIT_KEYS[base];
  const text = key ? t(key) : base;
  return isFailed ? `${text} · ${t('PxgAuditFailed')}` : text;
}

function formatMegabytes(bytes: number) {
  return `${(bytes / MB).toFixed(1)} MB`;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.entries()];
}

export default memo(PxgSettingsPanel);
