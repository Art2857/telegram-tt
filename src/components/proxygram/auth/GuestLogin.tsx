import type { ChangeEvent, FormEvent } from 'react';
import { memo, useEffect, useState } from '../../../lib/teact/teact';

import type { LoginStart } from '../../../proxygram/server/types';

import { pollLogin, startLogin, verifyLoginCode } from '../../../proxygram/server/http';
import { setPxgSession } from '../../../proxygram/server/session';
import { setPxgState } from '../../../proxygram/server/store';
import { describePxgError } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';
import UnofficialNotice from '../UnofficialNotice';

import styles from './AuthChoice.module.scss';

const POLL_INTERVAL_MS = 2000;
const CODE_LENGTH = 6;

/** Вход гостя (PLAN.md, 7.2): ник → код от бота, или Start в боте по ссылке */
const GuestLogin = () => {
  const lang = useLang();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [request, setRequest] = useState<LoginStart>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  // Подтверждение в боте («Это я» или Start по ссылке) приходит само — опрашиваем сервер
  useEffect(() => {
    if (!request) return undefined;
    let isActive = true;
    const timer = window.setInterval(async () => {
      try {
        const result = await pollLogin(request);
        if (isActive && 'accessToken' in result) setPxgSession(result);
      } catch (err) {
        if (!isActive) return;
        window.clearInterval(timer);
        setError(describePxgError(lang, err));
        setRequest(undefined);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [lang, request]);

  async function begin(withUsername: boolean) {
    setError(undefined);
    setIsLoading(true);
    try {
      const started = await startLogin({ username: withUsername ? username.trim() : undefined, level: 'guest' });
      setRequest(started);
      if (started.delivery === 'deeplink') window.open(started.deeplink, '_blank', 'noopener');
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsLoading(false);
    }
  }

  async function submitCode(value: string) {
    if (!request) return;
    setIsLoading(true);
    setError(undefined);
    try {
      setPxgSession(await verifyLoginCode({ ...request, code: value }));
    } catch (err) {
      setError(describePxgError(lang, err));
      setCode('');
    } finally {
      setIsLoading(false);
    }
  }

  const handleUsernameSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (/^@?\w{5,32}$/.test(username.trim())) void begin(true);
    else setError(lang('PxgErrorUsername'));
  };

  const handleCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(value);
    if (value.length === CODE_LENGTH) void submitCode(value);
  };

  const goBack = () => {
    setError(undefined);
    if (request) setRequest(undefined);
    else setPxgState({ authChoice: undefined });
  };

  function renderStart() {
    return (
      <>
        <h1>{lang('PxgGuestTitle')}</h1>
        <p className="note">{lang('PxgGuestNote')}</p>
        <form onSubmit={handleUsernameSubmit}>
          <InputText
            id="pxg-guest-username"
            label={lang('PxgGuestUsername')}
            value={username}
            error={error}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button type="submit" className="auth-button" isLoading={isLoading} disabled={!username.trim()}>
            {lang('PxgGuestGetCode')}
          </Button>
        </form>
        <Button className="auth-button" color="translucent" onClick={() => void begin(false)}>
          {lang('PxgGuestViaBot')}
        </Button>
      </>
    );
  }

  function renderCode() {
    return (
      <>
        <h1>{lang('PxgGuestCodeTitle')}</h1>
        <p className="note">{lang('PxgGuestCodeNote')}</p>
        <InputText
          id="pxg-guest-code"
          label={lang('PxgGuestCode')}
          value={code}
          error={error}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          autoFocus
          onChange={handleCodeChange}
        />
        {isLoading && <p className={styles.hint}>{lang('PxgGuestWaiting')}</p>}
      </>
    );
  }

  function renderDeeplink(deeplink: string) {
    return (
      <>
        <h1>{lang('PxgGuestDeeplinkTitle')}</h1>
        <p className="note">{lang('PxgGuestDeeplinkNote')}</p>
        <Button className="auth-button" href={deeplink} onClick={() => window.open(deeplink, '_blank', 'noopener')}>
          {lang('PxgGuestOpenBot')}
        </Button>
        <p className="note">{error ?? lang('PxgGuestWaiting')}</p>
      </>
    );
  }

  return (
    <div className={styles.root}>
      <Button
        size="smaller"
        round
        color="translucent"
        className={styles.back}
        iconName="arrow-left"
        ariaLabel={lang('PxgGuestBack')}
        onClick={goBack}
      />
      <div className="auth-form">
        <div id="logo" />
        {!request ? renderStart() : request.delivery === 'bot' ? renderCode() : renderDeeplink(request.deeplink)}
        <UnofficialNotice />
      </div>
    </div>
  );
};

export default memo(GuestLogin);
