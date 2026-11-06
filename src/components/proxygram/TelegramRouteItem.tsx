import { memo, useState } from '../../lib/teact/teact';

import { isTelegramDirect, setTelegramDirect } from '../../proxygram/telegramRoute';

import useLang from '../../hooks/useLang';

import MenuItem from '../ui/MenuItem';
import Switcher from '../ui/Switcher';

/** PXG: в главном меню — связь с Telegram через сервер Proxygram или напрямую; меняется с перезагрузкой */
const TelegramRouteItem = () => {
  const lang = useLang();
  const [isDirect] = useState(isTelegramDirect);

  return (
    <MenuItem icon="web" onClick={() => setTelegramDirect(!isDirect)}>
      <span className="menu-item-name">{lang('PxgTelegramViaServer')}</span>
      <Switcher id="pxg-telegram-route" label={lang('PxgTelegramViaServer')} checked={!isDirect} noAnimation />
    </MenuItem>
  );
};

export default memo(TelegramRouteItem);
