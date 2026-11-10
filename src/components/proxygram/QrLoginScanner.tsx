import { memo, useEffect, useRef, useState } from '../../lib/teact/teact';
import { getActions } from '../../global';

import { callApi } from '../../api/gramjs';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';

import styles from './QrLoginScanner.module.scss';

type OwnProps = {
  isOpen: boolean;
  onClose: NoneToVoidFunction;
};

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const TOKEN_PATTERN = /[?&]token=([A-Za-z0-9_-]+)/;
const TOKEN_ONLY_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

/** Token from the Telegram login QR (`tg://login?token=…`) */
export function extractQrLoginToken(value: string) {
  const trimmed = value.trim();
  return TOKEN_PATTERN.exec(trimmed)?.[1] ?? (TOKEN_ONLY_PATTERN.test(trimmed) ? trimmed : undefined);
}

const QrLoginScanner = ({ isOpen, onClose }: OwnProps) => {
  const { showNotification } = getActions();
  const lang = useLang();
  const videoRef = useRef<HTMLVideoElement>();
  const [manualValue, setManualValue] = useState('');
  const [errorKey, setErrorKey] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const isHandledRef = useRef(false);

  const confirmToken = useLastCallback(async (value: string) => {
    if (isHandledRef.current) return;
    const token = extractQrLoginToken(value);
    if (!token) {
      setErrorKey('PxgQrScanInvalid');
      return;
    }

    isHandledRef.current = true;
    setIsBusy(true);
    setErrorKey(undefined);
    try {
      await callApi('pxgAcceptLoginToken', token);
      showNotification({ message: { key: 'PxgQrScanSuccess' } });
      onClose();
    } catch {
      isHandledRef.current = false;
      setErrorKey('PxgQrScanInvalid');
    } finally {
      setIsBusy(false);
    }
  });

  const handleManualSubmit = useLastCallback(() => {
    void confirmToken(manualValue);
  });

  useEffect(() => {
    if (!isOpen) return undefined;

    isHandledRef.current = false;
    setManualValue('');
    setErrorKey(undefined);

    let isActive = true;
    let stream: MediaStream | undefined;
    let frame: number | undefined;
    let isDetecting = false;
    const video = videoRef.current;

    const start = async () => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        setErrorKey('PxgQrScanNoCamera');
        return;
      }

      try {
        stream = await mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!isActive || !video) return;
        video.srcObject = stream;
        await video.play();
      } catch {
        if (isActive) setErrorKey('PxgQrScanNoCamera');
        return;
      }

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Detector) {
        setErrorKey('PxgQrScanUnsupported');
        return;
      }

      const detector = new Detector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!isActive || !video) return;
        if (!isDetecting) {
          isDetecting = true;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value && !isHandledRef.current) {
              void confirmToken(value);
              return;
            }
          } catch {
            // A frame without a readable code is normal
          } finally {
            isDetecting = false;
          }
        }
        frame = requestAnimationFrame(() => void scan());
      };
      void scan();
    };

    void start();

    return () => {
      isActive = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [confirmToken, isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      title={lang('PxgQrScanTitle')}
      hasCloseButton
      onClose={onClose}
    >
      <div className={styles.content}>
        <video ref={videoRef} className={styles.video} muted playsInline />
        <p className={styles.hint}>{lang('PxgQrScanHint')}</p>
        {errorKey && <p className={styles.error} role="alert">{lang(errorKey as 'PxgQrScanInvalid')}</p>}
        <InputText
          label={lang('PxgQrScanManual')}
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
        />
        <Button disabled={!manualValue.trim() || isBusy} onClick={handleManualSubmit}>
          {lang('PxgQrScanSubmit')}
        </Button>
      </div>
    </Modal>
  );
};

export default memo(QrLoginScanner);
