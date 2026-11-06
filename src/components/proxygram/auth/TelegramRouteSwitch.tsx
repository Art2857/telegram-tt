import { memo, useState } from '../../../lib/teact/teact';

import { isTelegramDirect, setTelegramDirect } from '../../../proxygram/telegramRoute';

import useLang from '../../../hooks/useLang';

import Switcher from '../../ui/Switcher';

import styles from './TelegramRouteSwitch.module.scss';

const SWITCH_ID = 'pxg-telegram-route-auth';

/** PXG: на странице входа — связь с Telegram через сервер Proxygram (по умолчанию) или напрямую */
const TelegramRouteSwitch = () => {
  const lang = useLang();
  const [isDirect] = useState(isTelegramDirect);

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <label htmlFor={SWITCH_ID}>{lang('PxgTelegramViaServer')}</label>
        <Switcher
          id={SWITCH_ID}
          label={lang('PxgTelegramViaServer')}
          checked={!isDirect}
          noAnimation
          onCheck={(isChecked) => setTelegramDirect(!isChecked)}
        />
      </div>
      <p className={styles.hint}>{lang(isDirect ? 'PxgTelegramDirectHint' : 'PxgTelegramViaServerHint')}</p>
    </div>
  );
};

export default memo(TelegramRouteSwitch);
