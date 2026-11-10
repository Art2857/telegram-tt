import type { TeactNode } from '../../../lib/teact/teact';
import { memo, useCallback, useEffect, useRef, useState } from '../../../lib/teact/teact';

import type {
  AdminAccessRequestDto, AdminExportJob, AdminTopic, ImportStateDto, SessionTokensResponse,
} from '../../../proxygram/server/types';
import type { AdminShare as ShareRow } from './types';

import { IS_MULTIACCOUNT_SUPPORTED, IS_TAURI } from '../../../util/browser/globalEnvironment';
import buildClassName from '../../../util/buildClassName';
import { formatTimeDuration } from '../../../util/dates/duration';
import { getAccountSlotUrl } from '../../../util/multiaccount';
import { getServerTime } from '../../../util/serverTime';
import { formatFileSize } from '../../../util/textFormat';
import { getPxgReasonText } from '../../../proxygram/errorReasons';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { sessionFromTokens } from '../../../proxygram/server/session';
import { findFreeSlot } from '../../../proxygram/server/slots';
import { setPxgState, usePxgState, writeSlotSession } from '../../../proxygram/server/store';
import { describePxgError, displayName, formatDateTime } from '../helpers';

import useAppLayout from '../../../hooks/useAppLayout';
import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import ConfirmDialog from '../../ui/ConfirmDialog';
import InputText from '../../ui/InputText';
import { HISTORY_KEYS } from '../ShareSettingsFields';
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
  storage: { mediaBytes: number; disk: { totalBytes: number; freeBytes: number } | null };
  staleLeases: number;
};

type SystemInfo = {
  version: string | null;
  node: string;
  startedAt: string;
  uptimeSeconds: number;
  migrations: number | null;
  memory: { rssBytes: number; heapUsedBytes: number; accounts: number; perAccountBytes: number };
  storage: { disk: { totalBytes: number; freeBytes: number } | null };
  workers: { workerId: string | null; accounts: number; leaseUntil: string | null; stale: number }[];
  vpn: {
    isReachable: boolean;
    isHealthy?: boolean;
    active?: string | null;
    lastSweepAt?: string | null;
    total?: number;
    answering?: number;
    activeRttMs?: number | null;
    switches?: { at: string; from?: string; to: string; reason: string }[];
  } | null;
};

type PresenceRow = {
  connectionId: string;
  sessionId: string;
  level: 'guest' | 'client';
  ip: string | null;
  connectedAt: string;
  device: string | null;
  platform: string | null;
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

type UserDetails = {
  user: Pick<UserRow,
    'id' | 'tgUserId' | 'username' | 'firstName' | 'lastName' | 'role' | 'blockedAt' | 'lastSeenAt'
  > & {
    createdAt: string;
  };
  sessions: SessionRow[];
  accounts: AccountRow[];
  shares: ShareRow[];
};

type SessionRow = {
  id: string;
  level: 'guest' | 'client';
  isAdminSignIn: boolean;
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
  leaseUntil: string | null;
  restartRequested: boolean;
  connectedAt: string | null;
  owner: Person;
  messages: number;
  mediaBytes: number;
  lastMessageAt: string | null;
  activeShares: number;
  queue: number;
  importState: ImportStateDto | null;
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

/** PLAN.md 13: the admin is warned before the storage disk runs out */
const DISK_WARNING_PERCENT = 80;
const SYSTEM_REFRESH_MS = 15000;
const AUDIT_PAGE = 200;

const TABS = [
  { key: 'overview', title: 'PxgAdminOverview' },
  { key: 'users', title: 'PxgAdminUsers' },
  { key: 'sessions', title: 'PxgAdminSessions' },
  { key: 'accounts', title: 'PxgAdminAccounts' },
  { key: 'shares', title: 'PxgAdminShares' },
  { key: 'requests', title: 'PxgAdminRequests' },
  { key: 'audit', title: 'PxgAdminAudit' },
  { key: 'outbox', title: 'PxgAdminQueue' },
  { key: 'exports', title: 'PxgAdminExports' },
  { key: 'system', title: 'PxgAdminSystem' },
] as const;

/** Какие события перерисовывают какую вкладку */
const TAB_TOPICS: Record<(typeof TABS)[number]['key'], AdminTopic[]> = {
  overview: ['presence', 'sessions', 'users', 'accounts', 'shares', 'outbox'],
  users: ['users', 'sessions', 'presence'],
  sessions: ['sessions', 'presence'],
  accounts: ['accounts'],
  shares: ['shares'],
  requests: ['requests'],
  audit: ['users', 'sessions', 'accounts', 'shares', 'outbox'],
  outbox: ['outbox'],
  exports: ['exports', 'accounts'],
  system: ['accounts'],
};

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

/** Состояния очереди по-человечески, а не значениями из базы */
const OUTBOX_STATUS_KEYS = {
  pending: 'PxgAdminOutboxPending',
  running: 'PxgAdminOutboxRunning',
  done: 'PxgAdminOutboxDone',
  failed: 'PxgAdminOutboxFailed',
} as const;

const REQUEST_STATUS_KEYS: Record<AdminAccessRequestDto['status'], string> = {
  pending: 'PxgRequestPending',
  approved: 'PxgRequestApproved',
  rejected: 'PxgRequestRejected',
  cancelled: 'PxgRequestCancelled',
  expired: 'PxgRequestExpired',
};

/** Загрузка раздела админки с живым обновлением по событию admin.changed */
function useAdminData<T>(method: string, params: unknown, topics: AdminTopic[], refreshMs?: number) {
  const [loaded, setLoaded] = useState<{ key: string; value: T }>();
  const [error, setError] = useState<unknown>();
  const paramsKey = JSON.stringify(params);
  const topicsKey = JSON.stringify(topics);

  useEffect(() => {
    let isActive = true;
    let requestId = 0;

    function reload() {
      const currentId = ++requestId;
      pxgRpc.call<T>(method, JSON.parse(paramsKey))
        .then((result) => {
          if (!isActive || currentId !== requestId) return;
          setLoaded({ key: paramsKey, value: result });
          setError(undefined);
        })
        .catch((err) => {
          if (isActive && currentId === requestId) setError(err);
        });
    }

    reload();
    const subscribedTopics = JSON.parse(topicsKey) as AdminTopic[];
    const unsubscribe = pxgRpc.on((event) => {
      if (event.e === 'admin.changed' && event.d.topics.some((topic) => subscribedTopics.includes(topic))) reload();
    });
    const timer = refreshMs ? window.setInterval(reload, refreshMs) : undefined;
    return () => {
      isActive = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [method, paramsKey, topicsKey, refreshMs]);

  return { data: loaded?.key === paramsKey ? loaded.value : undefined, error };
}

/** Админка (PLAN.md, 7.15): только метаданные — кто, какой чат, когда; не переписка */
const AdminPanel = () => {
  const lang = useLang();
  const { isMobile } = useAppLayout();
  const session = usePxgState((state) => state.session);
  const [tab, setTab] = useState(0);
  const [isSectionOpen, setIsSectionOpen] = useState(false);
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

  const props = { lang, ask, run, selfId: session?.user.id, topics: TAB_TOPICS[tabKey] };

  return (
    <div className={styles.root}>
      {(!isMobile || !isSectionOpen) && (
        <aside className={styles.sidebar}>
          <header className={styles.sidebarHeader}>
            <Button
              round
              size="smaller"
              color="translucent"
              iconName="close"
              onClick={close}
              ariaLabel={lang('Close')}
            />
            <h2 className={styles.title}>{lang('PxgAdminTitle')}</h2>
          </header>
          <nav className={styles.nav}>
            {TABS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={buildClassName(styles.navItem, index === tab && styles.navItemActive)}
                onClick={() => {
                  setTab(index);
                  setIsSectionOpen(true);
                }}
              >
                <span>{lang(item.title)}</span>
                <Icon name="arrow-right" className={styles.navChevron} />
              </button>
            ))}
          </nav>
        </aside>
      )}
      {(!isMobile || isSectionOpen) && (
        <main className={styles.content}>
          <header className={styles.contentHeader}>
            {isMobile && (
              <Button
                round
                size="smaller"
                color="translucent"
                iconName="arrow-left"
                onClick={() => setIsSectionOpen(false)}
                ariaLabel={lang('Back')}
              />
            )}
            <h2 className={styles.title}>{lang(TABS[tab].title)}</h2>
          </header>
          {actionError && <div className={styles.actionError}>{actionError}</div>}
          <div className={buildClassName(styles.contentBody, 'custom-scroll')}>
            {tabKey === 'overview' && <OverviewTab {...props} />}
            {tabKey === 'users' && <UsersTab {...props} />}
            {tabKey === 'sessions' && <SessionsTab {...props} />}
            {tabKey === 'accounts' && <AccountsTab {...props} />}
            {tabKey === 'shares' && <SharesTab {...props} />}
            {tabKey === 'requests' && <RequestsTab {...props} />}
            {tabKey === 'audit' && <AuditTab {...props} />}
            {tabKey === 'outbox' && <OutboxTab {...props} />}
            {tabKey === 'exports' && <ExportsTab {...props} />}
            {tabKey === 'system' && <SystemTab {...props} />}
          </div>
        </main>
      )}
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

/** Кружок с инициалами: у людей админки нет фотографий Telegram, цвет стабилен для одного и того же id */
function AdminAvatar({ name, id }: { name: string; id: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % 360;
  return (
    <span className={styles.avatar} style={`background: hsl(${hash} 45% 45%)`}>
      {initials || '?'}
    </span>
  );
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
  const { data, error } = useAdminData<Overview>('admin.overview', {}, topics, SYSTEM_REFRESH_MS);
  const presence = useAdminData<PresenceRow[]>('admin.presence', {}, ['presence']);

  if (!data) return <Loading error={error} lang={lang} />;
  const reading = presence.data?.filter((row) => row.chat) ?? [];
  const accountsTotal = Object.values(data.accounts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const brokenAccounts = (data.accounts.auth_lost ?? 0) + (data.accounts.flood ?? 0);
  const { disk } = data.storage;
  const diskPercent = disk?.totalBytes ? Math.round((1 - disk.freeBytes / disk.totalBytes) * 100) : undefined;
  const isDiskFull = diskPercent !== undefined && diskPercent >= DISK_WARNING_PERCENT;

  const stats: [string, number | string, string?][] = [
    [lang('PxgAdminStatUsers'), data.users.total],
    [lang('PxgAdminStatOnline'), data.online.users],
    [lang('PxgAdminStatFull'), data.online.client],
    [lang('PxgAdminStatGuests'), data.online.guest],
    [lang('PxgAdminStatAccounts'), `${data.accounts.active ?? 0} / ${accountsTotal}`],
    [lang('PxgAdminStatShares'), data.shares.active ?? 0],
    [lang('PxgAdminStatArchive'), data.archive.messagesLastDay],
    [lang('PxgAdminStatQueue'), (data.outbox.pending ?? 0) + (data.outbox.running ?? 0)],
    [lang('PxgAdminStatMedia'), formatFileSize(lang, data.storage.mediaBytes)],
    [lang('PxgAdminStatDisk'), diskPercent !== undefined ? `${diskPercent}%` : '—'],
  ];

  return (
    <>
      {(brokenAccounts > 0 || (data.outbox.failed ?? 0) > 0 || isDiskFull || data.staleLeases > 0) && (
        <div className={styles.warning}>
          {data.staleLeases > 0 && <div>{t(lang, 'PxgAdminWarnLease', { count: data.staleLeases })}</div>}
          {isDiskFull && <div>{t(lang, 'PxgAdminWarnDisk', { percent: diskPercent })}</div>}
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
      <div className={styles.accountStatuses}>
        {Object.entries(ACCOUNT_STATUS).map(([status, { key, tone }]) => {
          const count = data.accounts[status] ?? 0;
          return (
            <Badge key={status} tone={count ? tone : 'gray'}>{`${t(lang, key)}: ${count}`}</Badge>
          );
        })}
      </div>

      <h3 className={styles.sectionTitle}>{lang('PxgAdminReadingNow')}</h3>
      {presence.error ? (
        <p className={styles.empty}>{describePxgError(lang, presence.error)}</p>
      ) : !presence.data ? (
        <Loading error={undefined} lang={lang} />
      ) : reading.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminNobodyReading')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColChat')}</th>
              <th>{lang('PxgAdminColAccount')}</th>
              <th>{lang('PxgAdminColDevice')}</th>
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
                <td>{[row.device, row.platform].filter(Boolean).join(' · ') || '—'}</td>
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
  const [offset, setOffset] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const { data, error } = useAdminData<UserRow[]>(
    'admin.users',
    { query: query || undefined, limit: USERS_PAGE_SIZE, offset },
    topics,
  );

  if (selectedUserId) {
    return (
      <UserCard
        key={selectedUserId}
        userId={selectedUserId}
        lang={lang}
        ask={ask}
        run={run}
        selfId={selfId}
        topics={topics}
        onClose={() => setSelectedUserId(undefined)}
      />
    );
  }

  return (
    <>
      <InputText
        className={styles.search}
        label={lang('PxgAdminSearch')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOffset(0);
        }}
      />
      {!data ? <Loading error={error} lang={lang} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgAdminEmpty')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
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
                    <AdminAvatar
                      name={[user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user)}
                      id={user.id}
                    />
                    {user.online && <span className={styles.onlineDot} />}
                    <Button size="tiny" color="translucent" isText onClick={() => setSelectedUserId(user.id)}>
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user)}
                    </Button>
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
                  <UserActions
                    user={user}
                    hasSessions={user.sessions > 0}
                    lang={lang}
                    ask={ask}
                    run={run}
                    selfId={selfId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(offset > 0 || (data?.length ?? 0) === USERS_PAGE_SIZE) && (
        <div className={styles.pagination}>
          <Button
            size="smaller"
            fluid={false}
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - USERS_PAGE_SIZE))}
          >
            {lang('AccDescrPrevious')}
          </Button>
          <span>{lang.number(offset / USERS_PAGE_SIZE + 1)}</span>
          <Button
            size="smaller"
            fluid={false}
            disabled={(data?.length ?? 0) < USERS_PAGE_SIZE}
            onClick={() => setOffset(offset + USERS_PAGE_SIZE)}
          >
            {lang('Next')}
          </Button>
        </div>
      )}
    </>
  );
});

function UserActions({ user, hasSessions, lang, ask, run, selfId }: {
  user: Omit<UserDetails['user'], 'createdAt'>;
  hasSessions: boolean;
} & Pick<TabProps, 'lang' | 'ask' | 'run' | 'selfId'>) {
  return (
    <>
      {hasSessions && (
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
          {/* docs/spec/08-admin.md §2: a plain session of this person in a new slot, seen in the person's devices */}
          {IS_MULTIACCOUNT_SUPPORTED && !user.blockedAt && (
            <Button
              size="tiny"
              color="translucent"
              isText
              onClick={() => ask(t(lang, 'PxgAdminSignInAsConfirm', { name: displayName(user) }),
                lang('PxgAdminSignInAs'), signInAs(user.id))}
            >
              {lang('PxgAdminSignInAs')}
            </Button>
          )}
          {/* The server has exactly one administrator: rights move to another user, never get added */}
          {user.role !== 'admin' && !user.blockedAt && (
            <Button
              size="tiny"
              color="translucent"
              isText
              onClick={() => ask(t(lang, 'PxgAdminTransferConfirm', { name: displayName(user) }),
                lang('PxgAdminTransfer'), call('admin.users.transferAdmin', { userId: user.id }))}
            >
              {lang('PxgAdminTransfer')}
            </Button>
          )}
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
    </>
  );
}

/** Opens the person's own session in a free account slot of this browser: from there it is just this person */
function signInAs(userId: string) {
  return async () => {
    // без слотов второй вход на устройстве некуда открыть: кнопка скрыта, а запрос не создаём
    if (!IS_MULTIACCOUNT_SUPPORTED) return;
    // A browser only allows a popup that is opened synchronously from the click, before the RPC
    const popup = IS_TAURI ? undefined : window.open('', '_blank');
    try {
      const tokens = await pxgRpc.call<SessionTokensResponse>('admin.users.signInAs', { userId });
      const slot = findFreeSlot();
      writeSlotSession(slot, sessionFromTokens(tokens));
      const url = getAccountSlotUrl(slot);
      if (popup && !popup.closed) {
        popup.location.replace(url);
        popup.focus();
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      popup?.close();
      throw err;
    }
  };
}

/** Карточка не читает переписку: только устройства, аккаунты, доступы и журнал действий */
const UserCard = memo(({ userId, onClose, lang, ask, run, selfId }: TabProps & {
  userId: string;
  onClose: () => void;
}) => {
  const topics: AdminTopic[] = ['users', 'sessions', 'presence', 'accounts', 'shares', 'outbox'];
  const { data, error } = useAdminData<UserDetails>('admin.user', { userId }, topics, SYSTEM_REFRESH_MS);
  return (
    <>
      <div className={styles.filters}>
        <Button size="smaller" color="translucent" iconName="arrow-left" fluid={false} onClick={onClose}>
          {lang('Back')}
        </Button>
        <h3 className={styles.sectionTitle}>{lang('PxgAdminUserCard')}</h3>
      </div>
      {(!data || error) ? <Loading error={error} lang={lang} /> : (
        <>
          <h2>{[data.user.firstName, data.user.lastName].filter(Boolean).join(' ') || displayName(data.user)}</h2>
          <div className={styles.filters}>
            {data.user.role === 'admin' && <Badge tone="blue">{lang('PxgRoleAdmin')}</Badge>}
            {data.user.blockedAt && <Badge tone="red">{lang('PxgAdminBlocked')}</Badge>}
            {data.sessions.some((session) => session.online) && <Badge tone="green">{lang('PxgAdminOnline')}</Badge>}
            {data.user.username && <span>{`@${data.user.username}`}</span>}
            <code>{data.user.tgUserId}</code>
          </div>
          <div className={buildClassName(styles.secondary, styles.details)}>{data.user.id}</div>
          <p className={styles.secondary}>
            {t(lang, 'PxgAdminRegistered', { time: formatDateTime(data.user.createdAt) })}
            {' · '}
            {t(lang, 'PxgAdminLastSeen', { time: formatDateTime(data.user.lastSeenAt) })}
          </p>
          <div className={styles.filters}>
            <UserActions
              user={data.user}
              hasSessions={data.sessions.length > 0}
              lang={lang}
              ask={ask}
              run={run}
              selfId={selfId}
            />
          </div>

          <h3 className={styles.sectionTitle}>{lang('PxgAdminSessions')}</h3>
          {data.sessions.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
            <div className={buildClassName(styles.stats, styles.userCards)}>
              {data.sessions.map((session) => (
                <div className={styles.stat} key={session.id}>
                  <div className={styles.name}>
                    {session.online && <span className={styles.onlineDot} />}
                    {session.deviceName || session.platform || '—'}
                  </div>
                  <LevelBadge level={session.level} lang={lang} />
                  <div className={styles.secondary}>
                    {session.platform}
                    {' '}
                    ·
                    {' '}
                    {session.ip ?? '—'}
                  </div>
                  <div className={styles.secondary}>
                    {t(lang, 'PxgAdminSince', { time: formatDateTime(session.createdAt) })}
                  </div>
                  <div className={styles.secondary}>{formatDateTime(session.lastActiveAt)}</div>
                  {session.chat && (
                    <div className={styles.secondary}>
                      {lang('PxgAdminColChat')}
                      :
                      {' '}
                      {session.chat.peerId}
                    </div>
                  )}
                  <Button
                    size="tiny"
                    color="danger"
                    isText
                    onClick={() => ask(t(lang, 'PxgAdminEndSessionConfirm', { name: displayName(data.user) }),
                      lang('PxgAdminEndSession'), call('admin.sessions.revoke', { sessionId: session.id }))}
                  >
                    {lang('PxgAdminEndSession')}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <h3 className={styles.sectionTitle}>{lang('PxgAdminAccounts')}</h3>
          {data.accounts.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
            <div className={buildClassName(styles.stats, styles.userCards)}>
              {data.accounts.map((account) => (
                <div className={styles.stat} key={account.id}>
                  <span className={styles.name}>{account.displayName ?? account.tgUserId}</span>
                  <Badge tone={ACCOUNT_STATUS[account.status]?.tone}>
                    {t(lang, ACCOUNT_STATUS[account.status]?.key ?? account.status)}
                  </Badge>
                  <div className={buildClassName(styles.secondary, styles.details)}>{account.id}</div>
                  <div className={styles.secondary}>{t(lang, 'PxgAdminMessages', { count: account.messages })}</div>
                  <div className={styles.secondary}>{formatDateTime(account.connectedAt)}</div>
                </div>
              ))}
            </div>
          )}

          <UserShares
            title={lang('PxgAdminReceived')}
            shares={data.shares.filter((share) => share.grantee?.id === userId)}
            lang={lang}
          />
          <UserShares
            title={lang('PxgAdminGranted')}
            shares={data.shares.filter((share) => share.grantor?.id === userId)}
            lang={lang}
          />
          <h3 className={styles.sectionTitle}>{lang('PxgAdminAudit')}</h3>
          <AuditTab lang={lang} ask={ask} run={run} selfId={selfId} topics={topics} actorUserId={userId} />
        </>
      )}
    </>
  );
});

function UserShares({ title, shares, lang }: { title: string; shares: ShareRow[]; lang: TabProps['lang'] }) {
  return (
    <>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {shares.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminColChat')}</th>
              <th>{lang('PxgAdminColWho')}</th>
              <th>{lang('PxgAdminColPermissions')}</th>
              <th>{lang('PxgAdminColStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((share) => (
              <tr key={share.id}>
                <td>
                  {share.peerTitle ?? share.peerId ?? t(lang, 'PxgSettingsFolder', { id: share.folderId ?? '—' })}
                  <div className={styles.secondary}>{share.account.displayName}</div>
                  {Boolean(share.topicId) && (
                    <div className={styles.secondary}>
                      {lang('PxgAttributionTopic')}
                      :
                      {' '}
                      {share.topicId}
                    </div>
                  )}
                </td>
                <td>
                  {displayName(share.grantor)}
                  {' '}
                  →
                  {' '}
                  {displayName(share.grantee)}
                </td>
                <td>{t(lang, `PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)}</td>
                <td>
                  <Badge tone={SHARE_STATUS[share.status].tone}>{t(lang, SHARE_STATUS[share.status].key)}</Badge>
                  {share.expiresAt && <div className={styles.secondary}>{formatDateTime(share.expiresAt)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

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
        <table className={buildClassName(styles.table, styles.stacked)}>
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
                    <AdminAvatar name={displayName(row.user)} id={row.user?.id ?? row.id} />
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
                  {row.isAdminSignIn ? lang('PxgAdminSignInSession') : row.deviceName ?? row.platform ?? '—'}
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

const AccountsTab = memo(({ lang, run, topics }: TabProps) => {
  const [selectedId, setSelectedId] = useState<string>();
  const [disconnect, setDisconnect] = useState<AccountRow>();
  const { data, error } = useAdminData<AccountRow[]>('admin.accounts', {}, topics, SYSTEM_REFRESH_MS);
  if (!data) return <Loading error={error} lang={lang} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgAdminNoAccounts')}</p>;
  const selected = data.find((account) => account.id === selectedId);
  const finishDisconnect = (deleteArchive: boolean) => {
    const accountId = disconnect?.id;
    setDisconnect(undefined);
    if (accountId) void run(call('admin.accounts.disconnect', { accountId, deleteArchive }));
  };

  return (
    <>
      {selected ? (
        <AccountCard
          account={selected}
          lang={lang}
          run={run}
          onClose={() => setSelectedId(undefined)}
          onDisconnect={setDisconnect}
        />
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
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
                    <Button size="tiny" color="translucent" isText onClick={() => setSelectedId(account.id)}>
                      {account.displayName ?? '—'}
                    </Button>
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
                    <AccountActions account={account} lang={lang} run={run} onDisconnect={setDisconnect} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ConfirmDialog
        isOpen={Boolean(disconnect)}
        title={lang('PxgAdminDisconnect')}
        text={t(lang, 'PxgAdminArchiveChoice', { name: disconnect?.displayName ?? '' })}
        confirmLabel={lang('PxgAdminKeepArchive')}
        confirmHandler={() => finishDisconnect(false)}
        extraButtons={(
          <Button color="danger" isText onClick={() => finishDisconnect(true)}>
            {lang('PxgAdminDeleteArchive')}
          </Button>
        )}
        onClose={() => setDisconnect(undefined)}
      />
    </>
  );
});

function AccountActions({ account, lang, run, onDisconnect }: {
  account: AccountRow;
  onDisconnect: (account: AccountRow) => void;
} & Pick<TabProps, 'lang' | 'run'>) {
  return (
    <>
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
      {(account.status === 'active' || account.status === 'flood') && (
        <Button
          size="tiny"
          color="translucent"
          isText
          disabled={account.restartRequested}
          onClick={() => void run(call('admin.accounts.restart', { accountId: account.id }))}
        >
          {account.restartRequested ? lang('PxgAdminRestartPending') : lang('PxgAdminRestart')}
        </Button>
      )}
      {account.status !== 'revoked' && (
        <Button size="tiny" color="danger" isText onClick={() => onDisconnect(account)}>
          {lang('PxgAdminDisconnect')}
        </Button>
      )}
    </>
  );
}

function AccountCard({ account, lang, run, onClose, onDisconnect }: {
  account: AccountRow;
  onClose: () => void;
  onDisconnect: (account: AccountRow) => void;
} & Pick<TabProps, 'lang' | 'run'>) {
  const status = ACCOUNT_STATUS[account.status] ?? { key: account.status, tone: 'gray' as const };
  const facts = [
    [lang('PxgAdminWorker'), account.workerId ?? '—'],
    [lang('PxgAdminLease'), formatDateTime(account.leaseUntil)],
    [lang('PxgAdminConnected'), formatDateTime(account.connectedAt)],
    [lang('PxgAdminLastEvent'), formatDateTime(account.lastMessageAt)],
    [lang('PxgAdminColArchive'), t(lang, 'PxgAdminMessages', { count: account.messages })],
    [lang('PxgAdminStatMedia'), formatFileSize(lang, account.mediaBytes ?? 0)],
    [lang('PxgAdminColAccess'), t(lang, 'PxgAdminAccountCounts', {
      shares: account.activeShares, queue: account.queue,
    })],
  ];
  return (
    <>
      <div className={styles.filters}>
        <Button size="smaller" color="translucent" iconName="arrow-left" fluid={false} onClick={onClose}>
          {lang('Back')}
        </Button>
      </div>
      <h2>{account.displayName ?? account.tgUserId ?? account.id}</h2>
      <p>{t(lang, 'PxgAdminOwner', { name: displayName(account.owner) })}</p>
      <div className={styles.filters}>
        <Badge tone={status.tone}>{t(lang, status.key)}</Badge>
        <code>{account.tgUserId}</code>
      </div>
      <p className={styles.details}>{account.id}</p>
      {account.statusReason && <p className={styles.secondary}>{account.statusReason}</p>}
      <div className={styles.filters}>
        <AccountActions account={account} lang={lang} run={run} onDisconnect={onDisconnect} />
      </div>
      <div className={buildClassName(styles.stats, styles.userCards)}>
        {facts.map(([label, value]) => (
          <div className={styles.stat} key={label}>
            <span className={styles.statLabel}>{label}</span>
            <span className={styles.details}>{value}</span>
          </div>
        ))}
      </div>
      {account.importState?.status === 'running' && (
        <p>{t(lang, 'PxgImportProgress', { done: account.importState.doneCount, total: account.importState.total })}</p>
      )}
    </>
  );
}

// ─── Доступы ────────────────────────────────────────────────────────────────

const SHARES_PAGE_SIZE = 200;
const REQUESTS_PAGE_SIZE = 50;
const USERS_PAGE_SIZE = 100;
type ShareFilters = {
  status: ShareRow['status'] | undefined;
  accountId: string;
  granteeQuery: string;
  peer: string;
  offset: number;
};

const SharesTab = memo(({ lang, ask, run, topics }: TabProps) => {
  const [filters, setFilters] = useState<ShareFilters>({
    status: 'active', accountId: '', granteeQuery: '', peer: '', offset: 0,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShareRow>();
  const { data: accounts } = useAdminData<AccountRow[]>('admin.accounts', {}, TAB_TOPICS.accounts);
  const peerNumber = Number(filters.peer.trim());
  const peerId = /^-?\d+$/.test(filters.peer.trim()) && Number.isSafeInteger(peerNumber) ? peerNumber : undefined;
  const { data, error } = useAdminData<ShareRow[]>('admin.shares', {
    status: filters.status,
    accountId: filters.accountId || undefined,
    granteeQuery: filters.granteeQuery.trim() || undefined,
    peerId,
    limit: SHARES_PAGE_SIZE,
    offset: filters.offset,
  }, topics, SYSTEM_REFRESH_MS);
  const selectableIds = data?.filter((share) => share.status !== 'revoked').map((share) => share.id) ?? [];
  const selected = selectedIds.filter((id) => selectableIds.includes(id));

  function changeFilters(patch: Partial<ShareFilters>) {
    setFilters((current) => ({ ...current, offset: 0, ...patch }));
    setSelectedIds([]);
  }

  function toggleSelected(id: string, isChecked: boolean) {
    setSelectedIds(isChecked ? [...selected, id] : selected.filter((item) => item !== id));
  }

  function openForm(share?: ShareRow) {
    setEditing(share);
    setIsFormOpen(true);
  }

  return (
    <>
      <div className={styles.filters}>
        {(['active', 'paused', 'source_lost', 'revoked', undefined] as const).map((value) => (
          <Button
            key={value ?? 'all'}
            size="smaller"
            pill
            fluid={false}
            color={filters.status === value ? 'primary' : 'translucent'}
            onClick={() => changeFilters({ status: value })}
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
          onClick={() => openForm()}
        >
          {lang('PxgAdminGrant')}
        </Button>
      </div>
      <div className={styles.shareFilters}>
        <label className={styles.field}>
          <span>{lang('PxgAdminColAccount')}</span>
          <select value={filters.accountId} onChange={(e) => changeFilters({ accountId: e.currentTarget.value })}>
            <option value="">{lang('PxgAdminAll')}</option>
            {accounts?.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName ?? account.id}</option>
            ))}
          </select>
        </label>
        <InputText
          label={lang('PxgAdminGuestFilter')}
          className={styles.shareGuestFilter}
          value={filters.granteeQuery}
          maxLength={64}
          onChange={(e) => changeFilters({ granteeQuery: e.target.value })}
        />
        <InputText
          label={lang('PxgAdminAuditChat')}
          value={filters.peer}
          inputMode="text"
          onChange={(e) => changeFilters({ peer: e.target.value })}
        />
      </div>
      {isFormOpen && <AdminShareForm key={editing?.id ?? 'new'} share={editing} onClose={() => setIsFormOpen(false)} />}
      {!data ? <Loading error={error} lang={lang} /> : (
        <>
          <div className={styles.filters}>
            <Checkbox
              label={lang('ContextMenuItemSelectAll')}
              checked={Boolean(selectableIds.length && selected.length === selectableIds.length)}
              disabled={!selectableIds.length}
              onCheck={(isChecked) => setSelectedIds(isChecked ? selectableIds : [])}
            />
            <Button
              size="smaller"
              color="danger"
              fluid={false}
              disabled={!selected.length}
              onClick={() => ask(lang('PxgAdminBulkRevokeConfirm', { count: selected.length }),
                lang('PxgShareRevoke'), async () => {
                  await pxgRpc.call('admin.shares.revokeMany', { shareIds: selected });
                  setSelectedIds([]);
                })}
            >
              {lang('PxgAdminRevokeSelected', { count: selected.length })}
            </Button>
          </div>
          {data.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
            <table className={buildClassName(styles.table, styles.stacked)}>
              <thead>
                <tr>
                  <th aria-label={lang('ContextMenuItemSelectAll')} />
                  <th>{lang('PxgAdminColChat')}</th>
                  <th>{lang('PxgAdminColGuest')}</th>
                  <th>{lang('PxgAdminColPermissions')}</th>
                  <th>{lang('PxgShareExpiry')}</th>
                  <th>{lang('PxgAdminLastUsed')}</th>
                  <th>{lang('PxgAdminColStatus')}</th>
                  <th aria-label={lang('PxgAdminColActions')} />
                </tr>
              </thead>
              <tbody>
                {data.map((share) => {
                  const isExpired = share.status === 'active' && Boolean(share.expiresAt)
                    && Date.parse(share.expiresAt) <= getServerTime() * 1000;
                  const shareStatus = isExpired
                    ? { key: 'PxgShareStatusExpired', tone: 'gray' as const }
                    : SHARE_STATUS[share.status];
                  return (
                    <tr key={share.id}>
                      <td>
                        <Checkbox
                          label={<span className="visually-hidden">{share.label || displayName(share.grantee)}</span>}
                          className={styles.shareSelect}
                          onlyInput
                          checked={selected.includes(share.id)}
                          disabled={share.status === 'revoked'}
                          onCheck={(isChecked) => toggleSelected(share.id, isChecked)}
                        />
                      </td>
                      <td>
                        <div className={styles.name}>
                          {share.scope === 'folder' || share.scope === 'folder_members'
                            ? share.folderTitle ?? share.folderId
                            : share.peerTitle ?? share.peerId}
                          {share.scope.endsWith('_members') && (
                            <span className={styles.secondary}>{` · ${lang('PxgShareMembersChip')}`}</span>
                          )}
                        </div>
                        {share.scope === 'topic' && <div>{share.topicTitle ?? share.topicId}</div>}
                        {share.label && <div>{share.label}</div>}
                        <div className={styles.secondary}>
                          {t(lang, 'PxgAdminFromAccount', { name: share.account.displayName ?? '—' })}
                        </div>
                      </td>
                      <td>
                        {displayName(share.grantee)}
                        {share.grantee?.username && (
                          <div className={styles.secondary}>{'@' + share.grantee.username}</div>
                        )}
                      </td>
                      <td>
                        {t(lang, `PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)}
                        {Object.entries(share.permissions).map(([key, value]) => (
                          <div key={key} className={styles.secondary}>
                            {`${value ? '✓' : '✗'} ${t(lang, `PxgPerm${key[0].toUpperCase()}${key.slice(1)}`)}`}
                          </div>
                        ))}
                        <div className={styles.secondary}>{lang(HISTORY_KEYS[share.historyMode])}</div>
                        {share.historyMode === 'last_n' && (
                          <div className={styles.secondary}>{share.historyLimit}</div>
                        )}
                        {share.historyMode === 'since_date' && (
                          <div className={styles.secondary}>{formatDateTime(share.visibleFromDate)}</div>
                        )}
                      </td>
                      <td>{share.expiresAt ? formatDateTime(share.expiresAt) : lang('PxgExpiryNever')}</td>
                      <td>{formatDateTime(share.lastUsedAt)}</td>
                      <td>
                        <Badge tone={shareStatus.tone}>{t(lang, shareStatus.key)}</Badge>
                        <div className={styles.secondary}>{formatDateTime(share.createdAt)}</div>
                      </td>
                      <td className={styles.actions}>
                        {share.status !== 'revoked' && (
                          <>
                            <Button size="tiny" isText onClick={() => openForm(share)}>{lang('PxgShareEdit')}</Button>
                            <Button
                              size="tiny"
                              color="translucent"
                              isText
                              disabled={share.status === 'source_lost'}
                              onClick={() => void run(call('admin.shares.update', {
                                shareId: share.id, status: share.status === 'paused' ? 'active' : 'paused',
                              }))}
                            >
                              {lang(share.status === 'paused' ? 'PxgAdminResume' : 'PxgAdminPause')}
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
          <div className={styles.filters}>
            <Button
              size="smaller"
              fluid={false}
              disabled={!filters.offset}
              onClick={() => changeFilters({ offset: Math.max(0, filters.offset - SHARES_PAGE_SIZE) })}
            >
              {lang('AccDescrPrevious')}
            </Button>
            <span>{lang.number(filters.offset / SHARES_PAGE_SIZE + 1)}</span>
            <Button
              size="smaller"
              fluid={false}
              disabled={data.length < SHARES_PAGE_SIZE}
              onClick={() => changeFilters({ offset: filters.offset + SHARES_PAGE_SIZE })}
            >
              {lang('Next')}
            </Button>
          </div>
        </>
      )}
    </>
  );
});

// ─── Журнал и очередь ───────────────────────────────────────────────────────

const RequestsTab = memo(({ lang, ask, run, topics }: TabProps) => {
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

const AuditTab = memo(({ lang, topics, actorUserId }: TabProps & { actorUserId?: string }) => {
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

const SystemTab = memo(({ lang, topics }: TabProps) => {
  const { data, error } = useAdminData<SystemInfo>('admin.system', {}, topics, SYSTEM_REFRESH_MS);
  if (!data) return <Loading error={error} lang={lang} />;
  const { vpn } = data;

  return (
    <>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.version?.slice(0, 7) ?? 'dev'}</span>
          <span className={styles.statLabel}>{lang('PxgAdminVersion')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {formatTimeDuration(lang, data.uptimeSeconds) ?? '—'}
          </span>
          <span className={styles.statLabel}>{lang('PxgAdminUptime')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.node}</span>
          <span className={styles.statLabel}>Node.js</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{data.migrations ?? '—'}</span>
          <span className={styles.statLabel}>{lang('PxgAdminMigrations')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatFileSize(lang, data.memory.rssBytes)}</span>
          <span className={styles.statLabel}>{lang('PxgAdminMemory')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {formatFileSize(lang, data.memory.perAccountBytes)}
            <span className={styles.secondary}>{` / ${data.memory.accounts}`}</span>
          </span>
          <span className={styles.statLabel}>{lang('PxgAdminMemoryAccount')}</span>
        </div>
        {data.storage.disk && (
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {formatFileSize(lang, data.storage.disk.freeBytes)}
              {' / '}
              {formatFileSize(lang, data.storage.disk.totalBytes)}
            </span>
            <span className={styles.statLabel}>{lang('PxgAdminDiskFree')}</span>
          </div>
        )}
      </div>

      <h3 className={styles.sectionTitle}>{lang('PxgAdminWorkers')}</h3>
      {data.workers.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminWorker')}</th>
              <th>{lang('PxgAdminAccounts')}</th>
              <th>{lang('PxgAdminLease')}</th>
            </tr>
          </thead>
          <tbody>
            {data.workers.map((worker) => (
              <tr key={worker.workerId ?? 'none'}>
                <td><code>{worker.workerId ?? '—'}</code></td>
                <td>{worker.accounts}</td>
                <td>
                  {formatDateTime(worker.leaseUntil ?? undefined)}
                  {' '}
                  {worker.stale > 0 && <Badge tone="red">{lang('PxgAdminLeaseStale')}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {vpn && (
        <>
          <h3 className={styles.sectionTitle}>{lang('PxgAdminVpn')}</h3>
          {!vpn.isReachable ? <p className={styles.empty}>{lang('PxgAdminVpnUnreachable')}</p> : (
            <>
              <p>
                <Badge tone={vpn.isHealthy ? 'green' : 'red'}>
                  {lang(vpn.isHealthy ? 'PxgAdminVpnHealthy' : 'PxgAdminVpnDown')}
                </Badge>
                {' '}
                {vpn.active ?? '—'}
                {vpn.activeRttMs ? ` · ${vpn.activeRttMs} ms` : ''}
                {` · ${t(lang, 'PxgAdminVpnNodes', { answering: vpn.answering ?? 0, total: vpn.total ?? 0 })}`}
              </p>
              {Boolean(vpn.switches?.length) && (
                <table className={buildClassName(styles.table, styles.stacked)}>
                  <thead>
                    <tr>
                      <th>{lang('PxgAdminColTime')}</th>
                      <th>{lang('PxgAdminVpnSwitch')}</th>
                      <th>{lang('PxgAdminColDetails')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vpn.switches.map((item) => (
                      <tr key={item.at}>
                        <td className={styles.nowrap}>{formatDateTime(item.at)}</td>
                        <td>{[item.from, item.to].filter(Boolean).join(' → ')}</td>
                        <td className={styles.details}>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}
    </>
  );
});

const OutboxTab = memo(({ lang, run, topics }: TabProps) => {
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

const EXPORT_STATUS: Record<AdminExportJob['status'], string> = {
  queued: 'PxgExportStatusQueued',
  collecting: 'PxgExportStatusCollecting',
  packing: 'PxgExportStatusPacking',
  ready: 'PxgExportStatusReady',
  failed: 'PxgExportStatusFailed',
  cancelled: 'PxgExportStatusCancelled',
  expired: 'PxgExportStatusExpired',
};

type ExportPeer = { peerId: number; title: string | null; username: string | null; type: string | null };

/** Скачивание чата администратором: выбрать аккаунт и чат, поставить задание, забрать файл */
const ExportsTab = memo(({ lang, run }: TabProps) => {
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

export default memo(AdminPanel);
