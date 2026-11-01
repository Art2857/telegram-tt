import { memo, useLayoutEffect, useRef } from '../../../lib/teact/teact';

import { STRICTERDOM_ENABLED } from '../../../config';
import { disableStrict, enableStrict } from '../../../lib/fasterdom/stricterdom';
import { createStyledQrCode } from '../../../util/qrCode/buildStyledQrCode';

import useAsync from '../../../hooks/useAsync';

import styles from './AuthChoice.module.scss';

type OwnProps = {
  link: string;
};

const QR_SIZE = 200;
const QR_MARGIN = 8;

/** The bot link as a QR code: the guest's Telegram is often on a phone, not on this device */
const BotLinkQr = ({ link }: OwnProps) => {
  const qrRef = useRef<HTMLDivElement>();
  const drawTokenRef = useRef(0);

  const { result: qrCode } = useAsync(() => createStyledQrCode({ size: QR_SIZE, margin: QR_MARGIN, imageSize: 0 }), []);

  useLayoutEffect(() => {
    if (!qrCode) return;

    const token = ++drawTokenRef.current;

    // The library draws into the mounted SVG asynchronously, outside the mutation phase
    if (STRICTERDOM_ENABLED) {
      disableStrict();
    }

    qrCode.update({ data: link });
    qrCode.append(qrRef.current);

    if (STRICTERDOM_ENABLED) {
      void qrCode.getRawData('svg').finally(() => {
        if (drawTokenRef.current === token) {
          enableStrict();
        }
      });
    }
  }, [qrCode, link]);

  return <div ref={qrRef} className={styles.qr} />;
};

export default memo(BotLinkQr);
