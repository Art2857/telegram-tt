import { memo, useMemo } from '../../lib/teact/teact';

import { ACCOUNT_SLOT, getAccountsInfo, getAccountSlotUrl } from '../../util/multiaccount';
import { findFreeSlot, guestSlotTitle, listGuestSlots } from '../../proxygram/server/slots';

import useLang from '../../hooks/useLang';

import MenuItem from '../ui/MenuItem';

type OwnProps = {
  /** Как у аккаунтов Telegram: переход через onSwitchAccount Web A, чтобы кэш успел сохраниться */
  onSwitchAccount?: (url: string) => void;
  /**
   * Меню гостевого экрана: там нет переключателя Web A, поэтому показываем и аккаунты Telegram,
   * и «Добавить аккаунт» — при входе в новый слот снова выбирается способ входа
   */
  isStandalone?: boolean;
};

/**
 * PXG: единый переключатель аккаунтов. Гостевые аккаунты (слот с гостевой сессией Proxygram)
 * стоят рядом с аккаунтами Telegram, переход — как между обычными аккаунтами Web A.
 */
const GuestAccountItems = ({ onSwitchAccount, isStandalone }: OwnProps) => {
  const lang = useLang();
  const currentSlot = ACCOUNT_SLOT || 1;
  const guests = useMemo(() => listGuestSlots().filter(({ slot }) => slot !== currentSlot), [currentSlot]);
  const telegramAccounts = useMemo(() => (
    isStandalone ? Object.entries(getAccountsInfo()).filter(([slot]) => Number(slot) !== currentSlot) : []
  ), [currentSlot, isStandalone]);

  const navigate = (url: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    if (!onSwitchAccount) return;
    e.preventDefault();
    onSwitchAccount(url);
  };

  return (
    <>
      {telegramAccounts.map(([slot, account]) => {
        const url = getAccountSlotUrl(Number(slot));
        return (
          <MenuItem key={`tg-${slot}`} icon="user" href={url} onClick={navigate(url)}>
            <span className="menu-item-name">
              {[account.firstName, account.lastName].filter(Boolean).join(' ') || account.phone}
            </span>
          </MenuItem>
        );
      })}
      {guests.map(({ slot, session }) => {
        const url = getAccountSlotUrl(slot);
        return (
          <MenuItem key={`guest-${slot}`} icon="user" href={url} onClick={navigate(url)}>
            <span className="menu-item-name">{guestSlotTitle(session)}</span>
            <span className="menu-item-badge">{lang('PxgLevelGuest')}</span>
          </MenuItem>
        );
      })}
      {isStandalone && (
        <MenuItem icon="add" href={getAccountSlotUrl(findFreeSlot(), true)}>
          {lang('MenuAddAccount')}
        </MenuItem>
      )}
    </>
  );
};

export default memo(GuestAccountItems);
