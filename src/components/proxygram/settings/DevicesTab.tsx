import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { Lang, ServerAdmin, SessionRow, TabProps, Translate } from './settingsTypes';

import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { IS_ANDROID, IS_IOS, IS_PWA } from '../../../util/browser/windowEnvironment';
import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { describePxgError, formatDateTime } from '../helpers';
import { Loading, usePxgData } from './settingsShared';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';

import styles from '../admin/AdminPanel.module.scss';

export const DevicesTab = memo(({ lang, t, ask }: TabProps) => {
  const { data, error, reload } = usePxgData<SessionRow[]>('sessions.mine', {}, []);
  if (!data) return <Loading error={error} lang={lang} onRetry={reload} />;

  return (
    <>
      <ServerAdminLine lang={lang} t={t} />
      {IS_TAURI && !IS_ANDROID && <AutostartToggle lang={lang} />}
      <BotNotificationsToggle lang={lang} />
      <table className={buildClassName(styles.table, styles.stacked)}>
        <tbody>
          {data.map((row) => (
            <tr key={row.id}>
              <td>
                <div className={styles.name}>
                  {row.online && <span className={styles.onlineDot} />}
                  {row.isAdminSignIn ? lang('PxgAdminSignInSession') : row.deviceName ?? row.platform ?? '—'}
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
          pxgRpc.call('notifications.setViaBot', { enabled: isChecked }).then(reload).catch((err) => {
            getActions().showNotification({ message: describePxgError(lang, err) });
          });
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
        window.tauri.setAutostart(isChecked)
          .then(() => setIsEnabled(isChecked))
          .catch((err) => getActions().showNotification({ message: describePxgError(lang, err) }));
      }}
    />
  );
}
