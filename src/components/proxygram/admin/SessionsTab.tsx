import { memo, useState } from '../../../lib/teact/teact';

import type { SessionRow, TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { displayName, formatDateTime } from '../helpers';
import { AdminAvatar, call, LevelBadge, Loading, t, useAdminData } from './adminShared';

import Button from '../../ui/Button';

import styles from './AdminPanel.module.scss';

// ─── Сессии ─────────────────────────────────────────────────────────────────

export const SessionsTab = memo(({ lang, ask, topics }: TabProps) => {
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
            {groupSessions(data).map(({ rows, isFirstOfUser, userSessions }) => {
              const [row] = rows;
              const others = rows.slice(1);
              return (
                <tr key={row.id}>
                  <td>
                    {isFirstOfUser && (
                      <>
                        <div className={styles.name}>
                          <AdminAvatar name={displayName(row.user)} id={row.user?.id ?? row.id} />
                          {rows.some((session) => session.online) && <span className={styles.onlineDot} />}
                          {displayName(row.user)}
                        </div>
                        <div className={styles.secondary}>
                          {row.user?.username ? `@${row.user.username} · ` : ''}
                          {t(lang, 'PxgAdminSessionsCount', { count: userSessions })}
                        </div>
                      </>
                    )}
                  </td>
                  <td><LevelBadge level={row.level} lang={lang} /></td>
                  <td>
                    {row.isAdminSignIn ? lang('PxgAdminSignInSession') : row.deviceName ?? row.platform ?? '—'}
                    <div className={styles.secondary}>
                      {row.ip ?? ''}
                      {others.length > 0 && ` · ${t(lang, 'PxgAdminSameDevice', { count: others.length })}`}
                    </div>
                  </td>
                  <td>
                    {rows.some((session) => session.online) ? lang('PxgAdminOnline') : formatDateTime(row.lastActiveAt)}
                    <div className={styles.secondary}>
                      {t(lang, 'PxgAdminSince', { time: formatDateTime(rows[rows.length - 1].createdAt) })}
                    </div>
                  </td>
                  <td className={styles.actions}>
                    <Button
                      size="tiny"
                      color="danger"
                      isText
                      onClick={() => ask(
                        others.length
                          ? t(lang, 'PxgAdminEndSessionsConfirm', { name: displayName(row.user), count: rows.length })
                          : t(lang, 'PxgAdminEndSessionConfirm', { name: displayName(row.user) }),
                        lang(others.length ? 'PxgAdminEndSessions' : 'PxgAdminEndSession'),
                        () => Promise.all(rows.map((session) => (
                          call('admin.sessions.revoke', { sessionId: session.id })()
                        ))),
                      )}
                    >
                      {lang(others.length ? 'PxgAdminEndSessions' : 'PxgAdminEndSession')}
                    </Button>
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

/**
 * Сессии по людям и устройствам (spec/13 §6): человек — один раз, повторные входы одного устройства — одной строкой
 * «и ещё N», с кнопкой завершить все. Свежая активность — первой
 */
export function groupSessions(rows: SessionRow[]) {
  const byUser = new Map<string, Map<string, SessionRow[]>>();
  rows.forEach((row) => {
    const userKey = row.user?.id ?? row.id;
    const deviceKey = [row.level, row.isAdminSignIn, row.deviceName, row.platform].join('|');
    const devices = byUser.get(userKey) ?? new Map<string, SessionRow[]>();
    devices.set(deviceKey, [...devices.get(deviceKey) ?? [], row]);
    byUser.set(userKey, devices);
  });
  const latest = (sessions: SessionRow[]) => Math.max(...sessions.map((session) => (
    session.online ? Infinity : Date.parse(session.lastActiveAt)
  )));
  const users = [...byUser.values()].map((devices) => [...devices.values()]
    .map((sessions) => sessions.toSorted((a, b) => latest([b]) - latest([a])))
    .sort((a, b) => latest(b) - latest(a)));
  return users
    .sort((a, b) => latest(b.flat()) - latest(a.flat()))
    .flatMap((devices) => {
      const userSessions = devices.reduce((sum, sessions) => sum + sessions.length, 0);
      return devices.map((sessions, index) => ({ rows: sessions, isFirstOfUser: index === 0, userSessions }));
    });
}
