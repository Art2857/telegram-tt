import { ACCOUNT_SLOT, getAccountSlotUrl, getFirstLoggedInAccountSlot } from '../../../util/multiaccount';
import { listGuestSlots } from '../../../proxygram/server/slots';

export function navigateBack() {
  const currentUrl = new URL(window.location.href);
  const referrer = document.referrer ? new URL(document.referrer) : undefined;
  if (referrer?.origin === currentUrl.origin && referrer.pathname === currentUrl.pathname
    && referrer.searchParams.get('account') !== currentUrl.searchParams.get('account')) {
    window.location.assign(referrer); // Return to previous account with it's state
    return;
  }

  // PXG: a guest account is a slot too, and it can be the only one besides the slot being added
  const guestSlot = listGuestSlots().find(({ slot }) => slot !== (ACCOUNT_SLOT || 1))?.slot;
  const url = getAccountSlotUrl(getFirstLoggedInAccountSlot() || guestSlot || 1);
  window.location.href = url;
}

/** PXG: whether the auth screen is adding one more account, so it can be cancelled */
export function hasOtherAccount() {
  const slot = ACCOUNT_SLOT || 1;
  return Boolean(getFirstLoggedInAccountSlot()) || listGuestSlots().some((item) => item.slot !== slot);
}
