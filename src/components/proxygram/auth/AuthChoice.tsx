import { memo, useEffect, useState } from '../../../lib/teact/teact';

import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { IS_ANDROID } from '../../../util/browser/windowEnvironment';
import { getAndroidAppUpdate } from '../../../proxygram/appDownloads';
import { setPxgState } from '../../../proxygram/server/store';
import { hasOtherAccount, navigateBack } from '../../auth/helpers/backNavigation';

import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';
import AppUpdateModal from '../AppUpdateModal';
import UnofficialNotice from '../UnofficialNotice';
import AppDownloadOffer from './AppDownloadOffer';
import AuthLanguagePicker from './AuthLanguagePicker';
import ServerPicker from './ServerPicker';
import TelegramRouteSwitch from './TelegramRouteSwitch';

import styles from './AuthChoice.module.scss';

const HAS_ANDROID_UPDATER = IS_TAURI && IS_ANDROID;

/** Первый экран: два способа входа в одном клиенте (PLAN.md, 7.1 и 7.3) */
const AuthChoice = () => {
  const lang = useLang();
  // Adding one more account can be cancelled: back to the account this slot was opened from
  const [canCancel] = useState(hasOtherAccount);
  const [updateVersion, setUpdateVersion] = useState<string>();

  useEffect(() => {
    if (!HAS_ANDROID_UPDATER) return undefined;
    let isActive = true;
    void getAndroidAppUpdate(window.tauri?.version).then((update) => {
      if (isActive) setUpdateVersion(update?.version);
    });
    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div className={styles.root}>
      <AuthLanguagePicker />
      {canCancel && (
        <Button
          size="smaller"
          round
          color="translucent"
          className={styles.close}
          iconName="close"
          ariaLabel={lang('Cancel')}
          onClick={navigateBack}
        />
      )}
      <div className="auth-form">
        <div id="logo" className={styles.logo} />
        <h1>{lang('PxgAuthChoiceTitle')}</h1>
        <p className="note">{lang('PxgAuthChoiceNote')}</p>
        <AppDownloadOffer />
        {HAS_ANDROID_UPDATER && updateVersion && (
          <Button color="translucent" onClick={() => setPxgState({ isAppUpdateOpen: true })}>
            {lang('PxgAppUpdateAvailable', { version: updateVersion })}
          </Button>
        )}

        <button type="button" className={styles.option} onClick={() => setPxgState({ authChoice: 'telegram' })}>
          <Icon name="key" className={styles.icon} />
          <span className={styles.text}>
            <span className={styles.title}>{lang('PxgAuthTelegram')}</span>
            <span className={styles.hint}>{lang('PxgAuthTelegramHint')}</span>
          </span>
        </button>

        <button type="button" className={styles.option} onClick={() => setPxgState({ authChoice: 'guest' })}>
          <Icon name="user" className={styles.icon} />
          <span className={styles.text}>
            <span className={styles.title}>{lang('PxgAuthGuest')}</span>
            <span className={styles.hint}>{lang('PxgAuthGuestHint')}</span>
          </span>
        </button>

        {HAS_ANDROID_UPDATER && !updateVersion && (
          <Button color="translucent" onClick={() => setPxgState({ isAppUpdateOpen: true })}>
            {lang('PxgAppUpdates')}
          </Button>
        )}
        {HAS_ANDROID_UPDATER && <AppUpdateModal />}
        <ServerPicker isLocked={canCancel} />
        <TelegramRouteSwitch />
        <UnofficialNotice />
      </div>
    </div>
  );
};

export default memo(AuthChoice);
