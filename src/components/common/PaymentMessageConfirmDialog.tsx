import type { FC, StateHookSetter } from '../../lib/teact/teact';
import { memo } from '../../lib/teact/teact';

import { formatStarsAsText } from '../../util/localization/format';

import useLang from '../../hooks/useLang';

import Checkbox from '../ui/Checkbox';
import ConfirmDialog from '../ui/ConfirmDialog';

import styles from './PaymentMessageConfirmDialog.module.scss';

type OwnProps = {
  isOpen: boolean;
  onClose: NoneToVoidFunction;
  userName?: string;
  messagePriceInStars: number;
  messagesCount: number;
  shouldAutoApprove: boolean;
  setAutoApprove: StateHookSetter<boolean>;
  confirmHandler: NoneToVoidFunction;
  // PXG: The guest spends the owner's Stars: asked every time, within the daily limit of the access
  isProxyChat?: boolean;
  starsPerDay?: number;
};

const PaymentMessageConfirmDialog: FC<OwnProps> = ({
  isOpen,
  onClose,
  userName,
  messagePriceInStars,
  messagesCount,
  shouldAutoApprove: shouldPaidMessageAutoApprove,
  setAutoApprove: setShouldPaidMessageAutoApprove,
  confirmHandler,
  isProxyChat,
  starsPerDay,
}) => {
  const lang = useLang();

  const confirmPaymentMessage = lang('ConfirmationModalPaymentForMessage', {
    user: userName,
    amount: formatStarsAsText(lang, messagePriceInStars),
    totalAmount: formatStarsAsText(lang, messagePriceInStars * messagesCount),
    count: messagesCount,
  }, {
    withMarkdown: true,
    withNodes: true,
    pluralValue: messagesCount,
  });

  const confirmLabel = lang('PayForMessage', { count: messagesCount }, {
    withNodes: true,
    pluralValue: messagesCount,
  });

  return (
    <ConfirmDialog
      title={lang('TitleConfirmPayment')}
      confirmLabel={confirmLabel}
      isOpen={isOpen}
      onClose={onClose}
      confirmHandler={confirmHandler}
    >
      {confirmPaymentMessage}
      {isProxyChat ? (
        Boolean(starsPerDay) && <p className={styles.limit}>{lang('PxgPaidStarsLimit', { stars: starsPerDay })}</p>
      ) : (
        <Checkbox
          className={styles.checkBox}
          label={lang('DoNotAskAgain')}
          checked={shouldPaidMessageAutoApprove}
          onCheck={setShouldPaidMessageAutoApprove}
        />
      )}
    </ConfirmDialog>
  );
};

export default memo(PaymentMessageConfirmDialog);
