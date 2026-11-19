import { memo, useState } from '../../../lib/teact/teact';

import type { AdminTopic, SessionTokensResponse,
} from '../../../proxygram/server/types';
import type { TabProps, UserDetails, UserRow } from './adminTypes';
import type { AdminShare as ShareRow } from './types';

import { IS_MULTIACCOUNT_SUPPORTED, IS_TAURI } from '../../../util/browser/globalEnvironment';
import buildClassName from '../../../util/buildClassName';
import { getAccountSlotUrl } from '../../../util/multiaccount';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { sessionFromTokens } from '../../../proxygram/server/session';
import { findFreeSlot } from '../../../proxygram/server/slots';
import { writeSlotSession } from '../../../proxygram/server/store';
import { displayName, formatDateTime } from '../helpers';
import {
  ACCOUNT_STATUS, AdminAvatar, Badge, call, LevelBadge, Loading, SHARE_STATUS, SYSTEM_REFRESH_MS,
  t, useAdminData, USERS_PAGE_SIZE,
} from './adminShared';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';
import { AuditTab } from './AuditTab';

import styles from './AdminPanel.module.scss';

// ─── Пользователи ───────────────────────────────────────────────────────────

export const UsersTab = memo(({ lang, ask, run, selfId, topics }: TabProps) => {
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
        <table className={buildClassName(styles.table, styles.stacked, styles.userTable)}>
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
              <tr key={user.id} className={buildClassName(styles.userRow, user.blockedAt && styles.muted)}>
                <td>
                  <div className={styles.name}>
                    <AdminAvatar
                      name={[user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user)}
                      id={user.id}
                    />
                    {user.online && <span className={styles.onlineDot} />}
                    <button type="button" className={styles.userNameButton} onClick={() => setSelectedUserId(user.id)}>
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user)}
                    </button>
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
                  <Button
                    size="smaller"
                    round
                    color="translucent"
                    iconName="arrow-right"
                    ariaLabel={lang('PxgAdminUserCard')}
                    onClick={() => setSelectedUserId(user.id)}
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
      {user.id !== selfId && user.role !== 'admin' && (
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
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const topics: AdminTopic[] = ['users', 'sessions', 'presence', 'accounts', 'shares'];
  const { data, error } = useAdminData<UserDetails>('admin.user', { userId }, topics, SYSTEM_REFRESH_MS);
  return (
    <>
      <div className={styles.filters}>
        <Button size="smaller" color="translucent" iconName="arrow-left" fluid={false} onClick={onClose}>
          {lang('PxgAdminUsers')}
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
          <div className={styles.userActions}>
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
          <Button
            size="smaller"
            color="translucent"
            fluid={false}
            iconName={isAuditOpen ? 'up' : 'down'}
            onClick={() => setIsAuditOpen(!isAuditOpen)}
          >
            {lang('PxgAdminAudit')}
          </Button>
          {isAuditOpen && (
            <AuditTab
              lang={lang}
              ask={ask}
              run={run}
              selfId={selfId}
              topics={[...topics, 'outbox']}
              actorUserId={userId}
            />
          )}
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
