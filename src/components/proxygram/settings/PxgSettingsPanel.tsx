import { memo, useCallback, useEffect, useState } from '../../../lib/teact/teact';

import type { AccountDto, ImportStateDto, PresetKey, ServerEvent } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError, displayName, formatDateTime } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import ConfirmDialog from '../../ui/ConfirmDialog';
import InputText from '../../ui/InputText';
import TabList from '../../ui/TabList';

import styles from '../admin/AdminPanel.module.scss';

type Person = { id: string; username: string | null; firstName: string | null } | null;
type Lang = ReturnType<typeof useLang>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

type AccountRow = AccountDto & { messages: number; mediaBytes: number; activeShares: number };

type ShareRow = {
  id: string;
  scope: 'chat' | 'topic' | 'folder';
  folderId: number | null;
  preset: PresetKey;
  status: 'active' | 'paused' | 'source_lost';
  expiresAt: string | null;
  label: string | null;
  peerTitle: string | null;
  grantee?: Person;
  grantor?: Person;
};

type AuditRow = {
  id: string;
  at: string;
  action: string;
  peerTitle: string | null;
  msgIds: number[] | null;
  actor: Person;
};

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
    maxBytes: number; includeVideo: boolean; includeDocuments: boolean; onDemand: boolean; onDemandKeepDays: number;
  };
  import: { enabled: boolean; perChat: number; includeChannels: boolean };
};

type Confirm = { text: string; label: string; action: () => Promise<unknown> };

type TabProps = {
  lang: Lang;
  t: Translate;
  ask: (text: string, label: string, action: () => Promise<unknown>) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
};

const TABS = [
  { key: 'server', title: 'PxgSettingsServer', isClientOnly: true },
  { key: 'outgoing', title: 'PxgSettingsOutgoing', isClientOnly: true },
  { key: 'incoming', title: 'PxgSettingsIncoming', isClientOnly: false },
  { key: 'archive', title: 'PxgSettingsArchive', isClientOnly: true },
  { key: 'audit', title: 'PxgSettingsAudit', isClientOnly: true },
  { key: 'devices', title: 'PxgSettingsDevices', isClientOnly: false },
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
  delegate_send: 'PxgAuditSend',
  delegate_edit: 'PxgAuditEdit',
  delegate_delete: 'PxgAuditDelete',
  delegate_react: 'PxgAuditReact',
  delegate_forward: 'PxgAuditForward',
  delegate_callback: 'PxgAuditCallback',
  delegate_vote: 'PxgAuditVote',
  delegate_read: 'PxgAuditRead',
  delegate_history: 'PxgAuditHistory',
  media_fetch: 'PxgAuditMediaFetch',
  invite_create: 'PxgAuditInviteCreate',
  invite_open: 'PxgAuditInviteOpen',
  invite_accept: 'PxgAuditInviteAccept',
  invite_decline: 'PxgAuditInviteDecline',
  invite_revoke: 'PxgAuditInviteRevoke',
  archive_gap: 'PxgAuditArchiveGap',
  'archive.policy': 'PxgAuditPolicy',
  'account.disconnect': 'PxgAuditDisconnect',
  'session.revoke': 'PxgAuditSessionRevoke',
};
const FAILED_SUFFIX = '_failed';

/** Данные раздела; перечитываются по событиям сервера, которые их меняют */
function usePxgData<T>(method: string, params: unknown, reloadOn: ServerEvent['e'][]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const paramsKey = JSON.stringify(params);
  const reloadKey = reloadOn.join();

  const reload = useCallback(() => {
    pxgRpc.call<T>(method, JSON.parse(paramsKey))
      .then((result) => {
        setData(result);
        setError(undefined);
      })
      .catch(setError);
  }, [method, paramsKey]);

  useEffect(() => {
    reload();
    const events = new Set(reloadKey.split(','));
    return pxgRpc.on((event) => {
      if (events.has(event.e)) reload();
    });
  }, [reload, reloadKey]);

  return { data, error, reload };
}

/** «Настройки Proxygram» (PLAN.md, 7.12): сервер, доступы в обе стороны, архив, журнал, устройства */
const PxgSettingsPanel = () => {
  const lang = useLang();
  const session = usePxgState((state) => state.session);
  const isClient = session?.level === 'client';
  const tabs = TABS.filter((item) => isClient || !item.isClientOnly);
  const [tab, setTab] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>();
  const [actionError, setActionError] = useState<string>();
  const tabKey = (tabs[tab] ?? tabs[0]).key;
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
  const props = { lang, t, ask, run };

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
        onSwitchTab={setTab}
        className={styles.tabs}
      />
      {actionError && <div className={styles.actionError}>{actionError}</div>}
      <div className={buildClassName(styles.content, 'custom-scroll')}>
        {tabKey === 'server' && <ServerTab {...props} />}
        {tabKey === 'outgoing' && <OutgoingTab {...props} />}
        {tabKey === 'incoming' && <IncomingTab {...props} />}
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

const ServerTab = memo(({ lang, t, ask }: TabProps) => {
  const { data, error, reload } = usePxgData<AccountRow[]>('accounts.mine', {}, ['accounts.changed']);
  if (!data) return <Loading error={error} lang={lang} />;
  const accounts = data.filter((account) => account.status !== 'revoked');

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
                  </td>
                  <td>
                    <Badge tone={status.tone} text={t(status.key)} />
                    {account.statusReason && <div className={styles.secondary}>{account.statusReason}</div>}
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
                          reload();
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
      <Button
        size="smaller"
        fluid={false}
        onClick={() => setPxgState({ isSettingsOpen: false, isConnectOpen: true })}
      >
        {lang('PxgConnectTitle')}
      </Button>
    </>
  );
});

function renderImport(t: Translate, state: ImportStateDto | null) {
  if (state?.status !== 'running') return undefined;
  return (
    <div className={styles.secondary}>{t('PxgImportProgress', { done: state.doneCount, total: state.total })}</div>
  );
}

const OutgoingTab = memo(({ lang, t, ask }: TabProps) => {
  const { data, error, reload } = usePxgData<ShareRow[]>('shares.outgoing', {}, ['access.changed']);
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>;

  return (
    <table className={styles.table}>
      <tbody>
        {groupBy(data, (share) => share.grantee?.id ?? '').map(([guestId, items]) => items.map((share, index) => (
          <tr key={share.id}>
            <td>
              {index === 0 && <div className={styles.name}>{displayName(items[0].grantee)}</div>}
              {index === 0 && guestId && items.length > 1 && (
                <div className={styles.secondary}>{t('PxgSettingsChats', { count: items.length })}</div>
              )}
            </td>
            <td>
              {describeTarget(t, share)}
              <div className={styles.secondary}>{describeShare(t, share)}</div>
            </td>
            <td className={styles.actions}>
              <Button
                size="tiny"
                color="danger"
                isText
                onClick={() => ask(
                  t('PxgSettingsRevokeConfirm', {
                    name: displayName(share.grantee), title: describeTarget(t, share),
                  }),
                  lang('PxgShareRevoke'),
                  async () => {
                    await pxgRpc.call('shares.revoke', { shareId: share.id });
                    reload();
                  },
                )}
              >
                {lang('PxgShareRevoke')}
              </Button>
            </td>
          </tr>
        )))}
      </tbody>
    </table>
  );
});

const IncomingTab = memo(({ lang, t, ask }: TabProps) => {
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
            </td>
            <td className={styles.actions}>
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

const ArchiveTab = memo(({ lang, t, run }: TabProps) => {
  const account = usePxgState((state) => state.accounts?.find((item) => item.status !== 'revoked'));
  const [policy, setPolicy] = useState<Policy>();
  const [error, setError] = useState<unknown>();
  const [maxMegabytes, setMaxMegabytes] = useState('');
  const [keepDays, setKeepDays] = useState('');
  const [perChat, setPerChat] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  const accountId = account?.id;
  useEffect(() => {
    if (!accountId) return;
    pxgRpc.call<Policy>('archive.policy.get', { accountId })
      .then((result) => {
        setPolicy(result);
        setMaxMegabytes(String(Math.round(result.media.maxBytes / MB)));
        setKeepDays(String(result.media.onDemandKeepDays));
        setPerChat(String(result.import.perChat));
      })
      .catch(setError);
  }, [accountId]);

  if (!account) return <p className={styles.empty}>{lang('PxgSettingsNoAccounts')}</p>;
  if (!policy) return <Loading error={error} lang={lang} />;

  const toggleMedia = (key: 'includeVideo' | 'includeDocuments' | 'onDemand', value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, media: { ...policy.media, [key]: value } });
  };
  const toggleImport = (key: 'enabled' | 'includeChannels', value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, import: { ...policy.import, [key]: value } });
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
      },
      import: {
        enabled: policy.import.enabled,
        perChat: Math.max(0, Number(perChat) || 0),
        includeChannels: policy.import.includeChannels,
      },
    });
    setPolicy(result);
    setIsSaved(true);
  });
  const onDigits = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSaved(false);
    setter(e.target.value.replace(/\D/g, ''));
  };

  return (
    <div className={styles.form}>
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
        onCheck={(value) => toggleImport('enabled', value)}
      />
      <InputText label={lang('PxgPolicyPerChat')} inputMode="numeric" value={perChat} onChange={onDigits(setPerChat)} />
      <Checkbox
        label={lang('PxgPolicyChannels')}
        checked={policy.import.includeChannels}
        onCheck={(value) => toggleImport('includeChannels', value)}
      />
      <div className={styles.formButtons}>
        <Button fluid={false} onClick={() => void save()}>{lang('PxgShareSave')}</Button>
        {isSaved && <span className={styles.secondary}>{t('PxgSettingsSaved')}</span>}
      </div>
    </div>
  );
});

const AuditTab = memo(({ lang, t }: TabProps) => {
  const [rows, setRows] = useState<AuditRow[]>();
  const [error, setError] = useState<unknown>();
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback((beforeId?: string) => {
    pxgRpc.call<AuditRow[]>('audit.mine', { limit: AUDIT_PAGE, beforeId })
      .then((page) => {
        setRows((current) => (beforeId ? [...(current ?? []), ...page] : page));
        setHasMore(page.length === AUDIT_PAGE);
      })
      .catch(setError);
  }, []);

  useEffect(() => load(), [load]);

  if (!rows) return <Loading error={error} lang={lang} />;
  if (rows.length === 0) return <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>;

  return (
    <>
      <table className={styles.table}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={styles.secondary}>{formatDateTime(row.at)}</td>
              <td>
                <div className={styles.name}>{row.actor ? displayName(row.actor) : '—'}</div>
              </td>
              <td>
                {describeAction(t, row.action)}
                {row.msgIds?.length ? <span className={styles.secondary}>{` · ${row.msgIds.join(', ')}`}</span> : ''}
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
  );
});

function describeTarget(t: Translate, share: ShareRow) {
  if (share.label) return share.label;
  if (share.scope === 'folder') return t('PxgSettingsFolder', { id: share.folderId ?? 0 });
  return share.peerTitle ?? '—';
}

function describeShare(t: Translate, share: ShareRow) {
  const parts = [t(`PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)];
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
