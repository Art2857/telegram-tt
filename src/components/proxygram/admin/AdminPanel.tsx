import type { TeactNode } from '../../../lib/teact/teact';
import { memo, useCallback, useEffect, useState } from '../../../lib/teact/teact';

import type { AdminTopic, ImportStateDto } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError, displayName, formatDateTime } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import InputText from '../../ui/InputText';
import TabList from '../../ui/TabList';
import AdminShareForm from './AdminShareForm';

import styles from './AdminPanel.module.scss';

type Person = { id: string; tgUserId?: number; username: string | null; firstName: string | null } | null;

type Overview = {
  users: { total: number; admins: number; blocked: number };
  sessions: Partial<Record<'guest' | 'client', number>>;
  online: { users: number; guest: number; client: number; readingNow: number };
  accounts: Partial<Record<string, number>>;
  shares: Partial<Record<string, number>>;
  outbox: Partial<Record<string, number>>;
  archive: { messagesEstimate: number; messagesLastDay: number };
};

type PresenceRow = {
  connectionId: string;
  sessionId: string;
  level: 'guest' | 'client';
  ip: string | null;
  connectedAt: string;
  user: Person;
  chat: { accountId: string; peerId: number; since: string; title: string | null; accountName: string | null } | null;
};

type UserRow = {
  id: string;
  tgUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'user' | 'admin';
  blockedAt: string | null;
  lastSeenAt: string | null;
  sessions: number;
  lastLevel: 'guest' | 'client' | null;
  sharesIn: number;
  sharesOut: number;
  accounts: number;
  online: boolean;
};

type SessionRow = {
  id: string;
  level: 'guest' | 'client';
  deviceName: string | null;
  platform: string | null;
  ip: string | null;
  createdAt: string;
  lastActiveAt: string;
  user: Person;
  online: boolean;
  chat: { accountId: string; peerId: number } | null;
};

type AccountRow = {
  id: string;
  tgUserId: number | null;
  displayName: string | null;
  status: string;
  statusReason: string | null;
  workerId: string | null;
  connectedAt: string | null;
  owner: Person;
  messages: number;
  lastMessageAt: string | null;
  activeShares: number;
  queue: number;
  importState: ImportStateDto | null;
};

type ShareRow = {
  id: string;
  scope: 'chat' | 'topic' | 'folder';
  peerId: number | null;
  preset: string;
  historyMode: string;
  status: 'active' | 'paused' | 'revoked' | 'source_lost';
  createdAt: string;
  expiresAt: string | null;
  account: { id: string; displayName: string | null };
  peerTitle: string | null;
  grantee: Person;
  grantor: Person;
};

type AuditRow = { id: string; at: string; action: string; peerId: number | null; meta: unknown; actor: Person };

type OutboxRow = {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  attempts: number;
  createdAt: string;
  actor: Person;
};

type Confirm = { text: string; label: string; action: () => Promise<unknown> };

const TABS = [
  { key: 'overview', title: 'PxgAdminOverview' },
  { key: 'users', title: 'PxgAdminUsers' },
  { key: 'sessions', title: 'PxgAdminSessions' },
  { key: 'accounts', title: 'PxgAdminAccounts' },
  { key: 'shares', title: 'PxgAdminShares' },
  { key: 'audit', title: 'PxgAdminAudit' },
  { key: 'outbox', title: 'PxgAdminQueue' },
] as const;

/** Какие события перерисовывают какую вкладку */
const TAB_TOPICS: Record<(typeof TABS)[number]['key'], AdminTopic[]> = {
  overview: ['presence', 'sessions', 'users', 'accounts', 'shares', 'outbox'],
  users: ['users', 'sessions', 'presence'],
  sessions: ['sessions', 'presence'],
  accounts: ['accounts'],
  shares: ['shares'],
  audit: ['users', 'sessions', 'accounts', 'shares', 'outbox'],
  outbox: ['outbox'],
};

/** Загрузка раздела админки с живым обновлением по событию admin.changed */
function useAdminData<T>(method: string, params: unknown, topics: AdminTopic[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const paramsKey = JSON.stringify(params);

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
    return pxgRpc.on((event) => {
      if (event.e === 'admin.changed' && event.d.topics.some((topic) => topics.includes(topic))) reload();
    });
    // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
  }, [reload]);

  return { data, error, reload };
}

/** Админка (PLAN.md, 7.15): только метаданные — кто, какой чат, когда; не переписка */
const AdminPanel = () => {
  const lang = useLang();
  const session = usePxgState((state) => state.session);
  const [tab, setTab] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>();
  const [actionError, setActionError] = useState<string>();
  const tabKey = TABS[tab].key;

  const close = () => setPxgState({ isAdminOpen: false });

  const ask = (text: string, label: string, action: () => Promise<unknown>) => setConfirm({ text, label, action });
  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
    } catch (err) {
      setActionError(describePxgError(lang, err));
    }
  };

  const tabs = TABS.map((item) => ({ title: lang(item.title) }));
  const props = { lang, ask, run, selfId: session?.user.id, topics: TAB_TOPICS[tabKey] };

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
        <h2>{lang('PxgAdminTitle')}</h2>
      </header>
      <TabList tabs={tabs} activeTab={tab} onSwitchTab={setTab} className={styles.tabs} />
      {actionError && <div className={styles.actionError}>{actionError}</div>}
      <div className={buildClassName(styles.content, 'custom-scroll')}>
        {tabKey === 'overview' && <OverviewTab {...props} />}
        {tabKey === 'users' && <UsersTab {...props} />}
        {tabKey === 'sessions' && <SessionsTab {...props} />}
        {tabKey === 'accounts' && <AccountsTab {...props} />}
        {tabKey === 'shares' && <SharesTab {...props} />}
        {tabKey === 'audit' && <AuditTab {...props} />}
        {tabKey === 'outbox' && <OutboxTab {...props} />}
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

type TabProps = {
  lang: ReturnType<typeof useLang>;
  ask: (text: string, label: string, action: () => Promise<unknown>) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
  selfId?: string;
  topics: AdminTopic[];
};

const call = (method: string, params?: unknown) => () => pxgRpc.call(method, params);

function Loading({ error, lang }: { error: unknown; lang: TabProps['lang'] }) {
  return <p className={styles.empty}>{error ? describePxgError(lang, error) : lang('PxgAdminLoading')}</p>;
}

function Badge({ children, tone }: { children: TeactNode; tone?: 'green' | 'red' | 'blue' | 'gray' }) {
  return <span className={buildClassName(styles.badge, tone && styles[tone])}>{children}</span>;
}

function LevelBadge({ level, lang }: { level: 'guest' | 'client' | null; lang: TabProps['lang'] }) {
  if (!level) return undefined;
  return (
    <Badge tone={level === 'client' ? 'blue' : 'gray'}>
      {level === 'client' ? lang('PxgLevelClient') : lang('PxgLevelGuest')}
    </Badge>
  );
}

const ACCOUNT_STATUS: Record<string, { key: string; tone: 'green' | 'red' | 'blue' | 'gray' }> = {
  active: { key: 'PxgStatusActive', tone: 'green' },
  paused: { key: 'PxgStatusPaused', tone: 'gray' },
  auth_lost: { key: 'PxgStatusAuthLost', tone: 'red' },
  flood: { key: 'PxgStatusFlood', tone: 'red' },
  revoked: { key: 'PxgStatusRevoked', tone: 'gray' },
  connecting: { key: 'PxgStatusConnecting', tone: 'blue' },
};

const SHARE_STATUS: Record<string, { key: string; tone: 'green' | 'red' | 'blue' | 'gray' }> = {
  active: { key: 'PxgShareStatusActive', tone: 'green' },
  paused: { key: 'PxgShareStatusPaused', tone: 'gray' },
  revoked: { key: 'PxgShareStatusRevoked', tone: 'gray' },
  source_lost: { key: 'PxgShareStatusLost', tone: 'red' },
};

const t = (lang: TabProps['lang'], key: string, vars?: Record<string, string | number>) => (
  (lang as unknown as (k: string, v?: Record<string, string | number>) => string)(key, vars)
);

// ─── Обзор ──────────────────────────────────────────────────────────────────

const OverviewTab = memo(({ lang, topics }: TabProps) => {
  const { data, error } = useAdminData<Overview>('admin.overview', {}, topics);
  const presence = useAdminData<PresenceRow[]>('admin.presence', {}, ['presence']);

  if (!data) return <Loading error={error} lang={lang} />;
  const reading = presence.data?.filter((row) => row.chat) ?? [];
  const accountsTotal = Object.values(data.accounts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const brokenAccounts = (data.accounts.auth_lost ?? 0) + (data.accounts.flood ?? 0);

  const stats: [string, number | string, string?][] = [
    [lang('PxgAdminStatUsers'), data.users.total],
    [lang('PxgAdminStatOnline'), data.online.users],
    [lang('PxgAdminStatFull'), data.online.client],
    [lang('PxgAdminStatGuests'), data.online.guest],
    [lang('PxgAdminStatAccounts'), `${data.accounts.active ?? 0} / ${accountsTotal}`],
    [lang('PxgAdminStatShares'), data.shares.active ?? 0],
    [lang('PxgAdminStatArchive'), data.archive.messagesLastDay],
    [lang('PxgAdminStatQueue'), (data.outbox.pending ?? 0) + (data.outbox.running ?? 0)],
  ];

  return (
    <>
      {(brokenAccounts > 0 || (data.outbox.failed ?? 0) > 0) && (
        <div className={styles.warning}>
          {brokenAccounts > 0 && <div>{t(lang, 'PxgAdminWarnAccounts', { count: brokenAccounts })}</div>}
          {(data.outbox.failed ?? 0) > 0 && (
            <div>{t(lang, 'PxgAdminWarnQueue', { count: data.outbox.failed ?? 0 })}</div>
          )}
        </div>
      )}
      <div className={styles.stats}>
        {stats.map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{label}</span>
          </div>
        ))}
      </div>

      <h3 className={styles.sectionTitle}>{lang('PxgAdminReadingNow')}</h3>
      {reading.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminNobodyReading')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColChat')}</th>
              <th>{lang('PxgAdminColAccount')}</th>
              <th>{lang('PxgAdminColSince')}</th>
            </tr>
          </thead>
          <tbody>
            {reading.map((row) => (
              <tr key={row.connectionId}>
                <td>
                  {displayName(row.user)}
                  {' '}
                  <LevelBadge level={row.level} lang={lang} />
                </td>
                <td>{row.chat?.title ?? row.chat?.peerId}</td>
                <td>{row.chat?.accountName ?? '—'}</td>
                <td>{formatDateTime(row.chat?.since)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
});

// ─── Пользователи ───────────────────────────────────────────────────────────

const UsersTab = memo(({ lang, ask, run, selfId, topics }: TabProps) => {
  const [query, setQuery] = useState('');
  const { data, error } = useAdminData<UserRow[]>('admin.users', { query: query || undefined, limit: 200 }, topics);

  return (
    <>
      <InputText
        className={styles.search}
        label={lang('PxgAdminSearch')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!data ? <Loading error={error} lang={lang} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColUser')}</th>
              <th>{lang('PxgAdminColLogin')}</th>
              <th>{lang('PxgAdminColActivity')}</th>
              <th>{lang('PxgAdminColAccess')}</th>
              <th aria-label={lang('PxgAdminColActions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((user) => (
              <tr key={user.id} className={buildClassName(user.blockedAt && styles.muted)}>
                <td>
                  <div className={styles.name}>
                    {user.online && <span className={styles.onlineDot} />}
                    {[user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user)}
                    {user.role === 'admin' && <Badge tone="blue">{lang('PxgRoleAdmin')}</Badge>}
                    {user.blockedAt && <Badge tone="red">{lang('PxgAdminBlocked')}</Badge>}
                  </div>
                  <div className={styles.secondary}>
                    {user.username ? `@${user.username} · ` : ''}
                    {user.tgUserId}
                  </div>
                </td>
                <td>
                  <LevelBadge level={user.lastLevel} lang={lang} />
                  <div className={styles.secondary}>{t(lang, 'PxgAdminDevices', { count: user.sessions })}</div>
                </td>
                <td>{user.online ? lang('PxgAdminOnline') : formatDateTime(user.lastSeenAt)}</td>
                <td className={styles.secondary}>
                  {t(lang, 'PxgAdminAccessCounts', { in: user.sharesIn, out: user.sharesOut, accounts: user.accounts })}
                </td>
                <td className={styles.actions}>
                  {user.sessions > 0 && (
                    <Button
                      size="tiny"
                      color="translucent"
                      isText
                      onClick={() => ask(t(lang, 'PxgAdminKickConfirm', { name: displayName(user) }),
                        lang('PxgAdminKick'), call('admin.users.revokeSessions', { userId: user.id }))}
                    >
                      {lang('PxgAdminKick')}
                    </Button>
                  )}
                  {user.id !== selfId && (
                    <>
                      <Button
                        size="tiny"
                        color="translucent"
                        isText
                        onClick={() => void run(call('admin.users.setRole', {
                          userId: user.id, role: user.role === 'admin' ? 'user' : 'admin',
                        }))}
                      >
                        {user.role === 'admin' ? lang('PxgAdminRemoveAdmin') : lang('PxgAdminMakeAdmin')}
                      </Button>
                      {user.blockedAt ? (
                        <Button
                          size="tiny"
                          color="translucent"
                          isText
                          onClick={() => void run(call('admin.users.setBlocked', { userId: user.id, blocked: false }))}
                        >
                          {lang('PxgAdminUnblock')}
                        </Button>
                      ) : (
                        <Button
                          size="tiny"
                          color="danger"
                          isText
                          onClick={() => ask(t(lang, 'PxgAdminBlockConfirm', { name: displayName(user) }),
                            lang('PxgAdminBlock'), call('admin.users.setBlocked', { userId: user.id, blocked: true }))}
                        >
                          {lang('PxgAdminBlock')}
                        </Button>
                      )}
                    </>
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

// ─── Сессии ─────────────────────────────────────────────────────────────────

const SessionsTab = memo(({ lang, ask, topics }: TabProps) => {
  const [onlineOnly, setOnlineOnly] = useState(false);
  const { data, error } = useAdminData<SessionRow[]>('admin.sessions', { onlineOnly }, topics);

  return (
    <>
      <div className={styles.filters}>
        <Button
          size="smaller"
          pill
          color={onlineOnly ? 'translucent' : 'primary'}
          fluid={false}
          onClick={() => setOnlineOnly(false)}
        >
          {lang('PxgAdminAll')}
        </Button>
        <Button
          size="smaller"
          pill
          color={onlineOnly ? 'primary' : 'translucent'}
          fluid={false}
          onClick={() => setOnlineOnly(true)}
        >
          {lang('PxgAdminOnlineOnly')}
        </Button>
      </div>
      {!data ? <Loading error={error} lang={lang} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColUser')}</th>
              <th>{lang('PxgAdminColLogin')}</th>
              <th>{lang('PxgAdminColDevice')}</th>
              <th>{lang('PxgAdminColActivity')}</th>
              <th aria-label={lang('PxgAdminColActions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className={styles.name}>
                    {row.online && <span className={styles.onlineDot} />}
                    {displayName(row.user)}
                  </div>
                  {row.user?.username && (
                    <div className={styles.secondary}>
                      @
                      {row.user.username}
                    </div>
                  )}
                </td>
                <td><LevelBadge level={row.level} lang={lang} /></td>
                <td>
                  {row.deviceName ?? row.platform ?? '—'}
                  <div className={styles.secondary}>{row.ip ?? ''}</div>
                </td>
                <td>
                  {row.online ? lang('PxgAdminOnline') : formatDateTime(row.lastActiveAt)}
                  <div className={styles.secondary}>
                    {t(lang, 'PxgAdminSince', { time: formatDateTime(row.createdAt) })}
                  </div>
                </td>
                <td className={styles.actions}>
                  <Button
                    size="tiny"
                    color="danger"
                    isText
                    onClick={() => ask(t(lang, 'PxgAdminEndSessionConfirm', { name: displayName(row.user) }),
                      lang('PxgAdminEndSession'), call('admin.sessions.revoke', { sessionId: row.id }))}
                  >
                    {lang('PxgAdminEndSession')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
});

// ─── Аккаунты ───────────────────────────────────────────────────────────────

const AccountsTab = memo(({ lang, ask, run, topics }: TabProps) => {
  const { data, error } = useAdminData<AccountRow[]>('admin.accounts', {}, topics);
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgAdminNoAccounts')}</p>;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{lang('PxgAdminColAccount')}</th>
          <th>{lang('PxgAdminColStatus')}</th>
          <th>{lang('PxgAdminColArchive')}</th>
          <th>{lang('PxgAdminColAccess')}</th>
          <th aria-label={lang('PxgAdminColActions')} />
        </tr>
      </thead>
      <tbody>
        {data.map((account) => {
          const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
          return (
            <tr key={account.id}>
              <td>
                <div className={styles.name}>{account.displayName ?? '—'}</div>
                <div className={styles.secondary}>
                  {t(lang, 'PxgAdminOwner', { name: displayName(account.owner) })}
                  {account.tgUserId ? ` · ${account.tgUserId}` : ''}
                </div>
              </td>
              <td>
                <Badge tone={status.tone}>{t(lang, status.key)}</Badge>
                {account.statusReason && <div className={styles.secondary}>{account.statusReason}</div>}
              </td>
              <td>
                {t(lang, 'PxgAdminMessages', { count: account.messages })}
                <div className={styles.secondary}>{formatDateTime(account.lastMessageAt)}</div>
                {account.importState?.status === 'running' && (
                  <div className={styles.secondary}>
                    {t(lang, 'PxgImportProgress', {
                      done: account.importState.doneCount, total: account.importState.total,
                    })}
                  </div>
                )}
              </td>
              <td className={styles.secondary}>
                {t(lang, 'PxgAdminAccountCounts', { shares: account.activeShares, queue: account.queue })}
              </td>
              <td className={styles.actions}>
                {account.status === 'active' && (
                  <Button
                    size="tiny"
                    color="translucent"
                    isText
                    onClick={() => void run(call('admin.accounts.setPaused', { accountId: account.id, paused: true }))}
                  >
                    {lang('PxgAdminPause')}
                  </Button>
                )}
                {(account.status === 'paused' || account.status === 'flood') && (
                  <Button
                    size="tiny"
                    color="translucent"
                    isText
                    onClick={() => void run(call('admin.accounts.setPaused', { accountId: account.id, paused: false }))}
                  >
                    {lang('PxgAdminResume')}
                  </Button>
                )}
                {account.status !== 'revoked' && (
                  <Button
                    size="tiny"
                    color="danger"
                    isText
                    onClick={() => ask(t(lang, 'PxgAdminDisconnectConfirm', { name: account.displayName ?? '' }),
                      lang('PxgAdminDisconnect'), call('admin.accounts.disconnect', { accountId: account.id }))}
                  >
                    {lang('PxgAdminDisconnect')}
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

// ─── Доступы ────────────────────────────────────────────────────────────────

const SharesTab = memo(({ lang, ask, run, topics }: TabProps) => {
  const [status, setStatus] = useState<'active' | 'paused' | 'revoked' | undefined>('active');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { data, error } = useAdminData<ShareRow[]>('admin.shares', { status }, topics);

  return (
    <>
      <div className={styles.filters}>
        {(['active', 'paused', 'revoked', undefined] as const).map((value) => (
          <Button
            key={value ?? 'all'}
            size="smaller"
            pill
            fluid={false}
            color={status === value ? 'primary' : 'translucent'}
            onClick={() => setStatus(value)}
          >
            {value ? t(lang, SHARE_STATUS[value].key) : lang('PxgAdminAll')}
          </Button>
        ))}
        <Button
          size="smaller"
          pill
          fluid={false}
          color="green"
          iconName="add"
          className={styles.push}
          onClick={() => setIsFormOpen(true)}
        >
          {lang('PxgAdminGrant')}
        </Button>
      </div>
      {isFormOpen && <AdminShareForm onClose={() => setIsFormOpen(false)} />}
      {!data ? <Loading error={error} lang={lang} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColChat')}</th>
              <th>{lang('PxgAdminColGuest')}</th>
              <th>{lang('PxgAdminColPermissions')}</th>
              <th>{lang('PxgAdminColStatus')}</th>
              <th aria-label={lang('PxgAdminColActions')} />
            </tr>
          </thead>
          <tbody>
            {data.map((share) => {
              const shareStatus = SHARE_STATUS[share.status];
              return (
                <tr key={share.id}>
                  <td>
                    <div className={styles.name}>{share.peerTitle ?? share.peerId ?? share.scope}</div>
                    <div className={styles.secondary}>
                      {t(lang, 'PxgAdminFromAccount', { name: share.account.displayName ?? '—' })}
                    </div>
                  </td>
                  <td>
                    {displayName(share.grantee)}
                    {share.grantee?.username && (
                      <div className={styles.secondary}>
                        @
                        {share.grantee.username}
                      </div>
                    )}
                  </td>
                  <td>
                    {t(lang, `PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)}
                    <div className={styles.secondary}>
                      {share.historyMode === 'new_only' ? lang('PxgHistoryNew') : lang('PxgHistoryAll')}
                    </div>
                  </td>
                  <td>
                    <Badge tone={shareStatus.tone}>{t(lang, shareStatus.key)}</Badge>
                    <div className={styles.secondary}>{formatDateTime(share.createdAt)}</div>
                  </td>
                  <td className={styles.actions}>
                    {(share.status === 'active' || share.status === 'paused') && (
                      <>
                        <Button
                          size="tiny"
                          color="translucent"
                          isText
                          onClick={() => void run(call('admin.shares.update', {
                            shareId: share.id, status: share.status === 'active' ? 'paused' : 'active',
                          }))}
                        >
                          {share.status === 'active' ? lang('PxgAdminPause') : lang('PxgAdminResume')}
                        </Button>
                        <Button
                          size="tiny"
                          color="danger"
                          isText
                          onClick={() => ask(t(lang, 'PxgAdminRevokeConfirm', { name: displayName(share.grantee) }),
                            lang('PxgShareRevoke'), call('admin.shares.revoke', { shareId: share.id }))}
                        >
                          {lang('PxgShareRevoke')}
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
});

// ─── Журнал и очередь ───────────────────────────────────────────────────────

const AuditTab = memo(({ lang, topics }: TabProps) => {
  const [action, setAction] = useState('');
  const { data, error } = useAdminData<AuditRow[]>(
    'admin.audit', { limit: 200, action: action.trim() || undefined }, topics,
  );

  return (
    <>
      <InputText
        className={styles.search}
        label={lang('PxgAdminAuditFilter')}
        value={action}
        onChange={(e) => setAction(e.target.value)}
      />
      {!data ? <Loading error={error} lang={lang} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColTime')}</th>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColAction')}</th>
              <th>{lang('PxgAdminColDetails')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
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
    </>
  );
});

const OutboxTab = memo(({ lang, run, topics }: TabProps) => {
  const { data, error } = useAdminData<OutboxRow[]>('admin.outbox', { limit: 200 }, topics);
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>;

  return (
    <table className={styles.table}>
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
                {row.status}
              </Badge>
              {row.error && <div className={styles.secondary}>{row.error}</div>}
            </td>
            <td className={styles.actions}>
              {row.status === 'failed' && (
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
  );
});

export default memo(AdminPanel);
