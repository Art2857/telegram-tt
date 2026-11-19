import { memo, useEffect, useRef, useState } from '../../../lib/teact/teact';

import {
  checkProxygramServer, getUnreachableServer, parseServerAddress, switchServer,
} from '../../../proxygram/server/serverAddress';

import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from './ServerPicker.module.scss';

type OwnProps = {
  /** Another account of this server is signed in: the server stays until all of them sign out */
  isLocked?: boolean;
};

/** The server is chosen at sign-in (docs/RELEASE.md): a browser opens its client, the app remembers it */
const ServerPicker = ({ isLocked }: OwnProps) => {
  const lang = useLang();
  const [isEditing, startEditing, stopEditing] = useFlag();
  const [isChecking, markChecking, unmarkChecking] = useFlag();
  const [isSwitching, markSwitching, unmarkSwitching] = useFlag();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string>();
  const [unreachableServer] = useState(getUnreachableServer);
  const checkRef = useRef<AbortController>();
  const addressRef = useRef<HTMLInputElement>();

  useEffect(() => () => {
    checkRef.current?.abort();
    checkRef.current = undefined;
  }, []);

  const handleCancel = useLastCallback(() => {
    if (isSwitching) return;
    checkRef.current?.abort();
    checkRef.current = undefined;
    unmarkChecking();
    setError(undefined);
    stopEditing();
  });

  useEffect(() => {
    if (isLocked) handleCancel();
  }, [isLocked, handleCancel]);

  const handleChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAddress(e.currentTarget.value);
    setError(undefined);
  });

  const handleSubmit = useLastCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked || checkRef.current) return;
    const parsed = parseServerAddress(addressRef.current?.value ?? address);
    if ('error' in parsed) {
      setError(lang(parsed.error === 'insecure' ? 'PxgServerInsecure' : 'PxgServerInvalid'));
      return;
    }
    if (parsed.origin === window.location.origin) {
      stopEditing();
      return;
    }
    const check = new AbortController();
    checkRef.current = check;
    setError(undefined);
    markChecking();
    const isProxygram = await checkProxygramServer(parsed.origin, check);
    if (checkRef.current !== check) return;
    if (!isProxygram) {
      checkRef.current = undefined;
      unmarkChecking();
      setError(lang('PxgServerUnreachable'));
      return;
    }
    markSwitching();
    try {
      await switchServer(parsed.origin);
    } catch {
      if (checkRef.current !== check) return;
      checkRef.current = undefined;
      unmarkSwitching();
      unmarkChecking();
      setError(lang('PxgServerSwitchFailed'));
    }
  });

  return (
    <div className={styles.root}>
      {unreachableServer && !isEditing && (
        <p className={styles.warning}>{lang('PxgServerSavedUnreachable', { host: unreachableServer })}</p>
      )}
      {isEditing ? (
        <form className={styles.form} onSubmit={handleSubmit}>
          <InputText
            ref={addressRef}
            value={address}
            label={lang('PxgServerAddress')}
            placeholder="chat.example.org"
            inputMode="url"
            autoComplete="url"
            error={error}
            autoFocus
            disabled={isChecking}
            noMargin
            onChange={handleChange}
          />
          <div className={styles.actions}>
            <Button type="submit" isLoading={isChecking} disabled={!address.trim()}>
              {lang('PxgServerConnect')}
            </Button>
            <button type="button" className={styles.change} onClick={handleCancel} disabled={isSwitching}>
              {lang('Cancel')}
            </button>
          </div>
        </form>
      ) : (
        <p className={styles.current}>
          {lang('PxgServerCurrent', { host: window.location.host })}
          {isLocked ? (
            <span className={styles.hint}>{lang('PxgServerLocked')}</span>
          ) : (
            <button type="button" className={styles.change} onClick={startEditing}>
              {lang('PxgServerChange')}
            </button>
          )}
        </p>
      )}
    </div>
  );
};

export default memo(ServerPicker);
