import type { ChangeEvent, FormEvent } from 'react';
import { memo, useEffect, useRef, useState } from '../../../lib/teact/teact';

import type { LoginStart } from '../../../proxygram/server/types';
import { PxgError } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { logoutSession, pollLogin, startLogin, verifyLoginCode } from '../../../proxygram/server/http';
import { setPxgSession } from '../../../proxygram/server/session';
import { setPxgState } from '../../../proxygram/server/store';
import { describePxgError } from '../helpers';

import useLang from '../../../hooks/useLang';
import { useStateRef } from '../../../hooks/useStateRef';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';
import UnofficialNotice from '../UnofficialNotice';
import BotLinkQr from './BotLinkQr';

import styles from './AuthChoice.module.scss';

const POLL_INTERVAL_MS = 2000;
const CODE_LENGTH = 6;
// Telegram usernames start with a letter, so digits are always a phone number
const PHONE_INPUT = /^\+?[\d\s().-]{7,24}$/;
const USERNAME_INPUT = /^@?[a-zA-Z]\w{4,31}$/;
// The server gives a new code no sooner than a minute later
const RESEND_SECONDS = 60;

type RequestedLogin = { kind: 'username' | 'phone'; value: string };

/** Вход гостя (PLAN.md, 7.2): ник → код от бота, или Start в боте по ссылке */
const GuestLogin = () => {
  const lang = useLang();
  const langRef = useStateRef(lang);
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [attempt, setAttempt] = useState<{ request: LoginStart; id: number }>();
  const request = attempt?.request;
  // What the code was asked for: the bot cannot message an unknown person first, so it falls back to the link
  const [requestedLogin, setRequestedLogin] = useState<RequestedLogin>();
  const [error, setError] = useState<string>();
  const [errorField, setErrorField] = useState<'username' | 'code'>();
  const [isLoading, setIsLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const attemptRef = useRef(0);
  const pendingRef = useRef<number>();

  useEffect(() => () => {
    attemptRef.current++;
  }, [attemptRef]);

  // Подтверждение в боте («Это я» или Start по ссылке) приходит само — опрашиваем сервер
  useEffect(() => {
    if (!attempt) return undefined;
    const { request: activeRequest, id } = attempt;
    let isActive = true;
    let isPolling = false;
    const timer = window.setInterval(async () => {
      if (!isActive || isPolling || id !== attemptRef.current || pendingRef.current === id) return;
      isPolling = true;
      try {
        const result = await pollLogin({
          requestId: activeRequest.requestId, deviceSecret: activeRequest.deviceSecret,
        });
        if ('accessToken' in result) {
          if (!isActive || id !== attemptRef.current) {
            void logoutSession(result.refreshToken).catch(() => undefined);
            return;
          }
          attemptRef.current++;
          window.clearInterval(timer);
          setPxgSession(result);
        }
      } catch (err) {
        if (!isActive || id !== attemptRef.current) return;
        // Сеть моргнула — запрос на сервере ещё жив: продолжаем ждать, а не сбрасываем введённый код
        if (err instanceof PxgError && (err.code === 'network' || err.code === 'rate_limited'
          || err.code === 'http_429' || err.code.startsWith('http_5'))) return;
        window.clearInterval(timer);
        attemptRef.current++;
        setError(describePxgError(langRef.current, err));
        setAttempt(undefined);
      } finally {
        isPolling = false;
      }
    }, POLL_INTERVAL_MS);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [langRef, attempt, attemptRef, pendingRef]);

  const isCodeStep = request?.delivery === 'bot';
  useEffect(() => {
    if (!isCodeStep) return undefined;
    setResendIn(RESEND_SECONDS);
    const timer = window.setInterval(() => setResendIn((left) => Math.max(0, left - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [isCodeStep, request?.requestId]);

  async function begin(withLogin: boolean) {
    if (pendingRef.current === attemptRef.current) return;
    const id = ++attemptRef.current;
    pendingRef.current = id;
    setError(undefined);
    setErrorField(undefined);
    setCode('');
    setIsLoading(true);
    try {
      const value = username.trim();
      const login: RequestedLogin | undefined = !withLogin ? undefined : PHONE_INPUT.test(value)
        ? { kind: 'phone', value }
        : { kind: 'username', value: value.replace(/^@/, '') };
      const started = await startLogin({
        username: login?.kind === 'username' ? login.value : undefined,
        phone: login?.kind === 'phone' ? login.value : undefined,
        level: 'guest',
      });
      if (id !== attemptRef.current) return;
      setAttempt({ request: started, id });
      setRequestedLogin(login);
    } catch (err) {
      if (id === attemptRef.current) setError(describePxgError(lang, err));
    } finally {
      if (id === attemptRef.current) setIsLoading(false);
      if (pendingRef.current === id) pendingRef.current = undefined;
    }
  }

  async function submitCode(value: string) {
    if (!attempt || attempt.id !== attemptRef.current || pendingRef.current === attempt.id) return;
    const { id, request: activeRequest } = attempt;
    pendingRef.current = id;
    setIsLoading(true);
    setError(undefined);
    setErrorField(undefined);
    try {
      const result = await verifyLoginCode({
        requestId: activeRequest.requestId, deviceSecret: activeRequest.deviceSecret, code: value,
      });
      if (id !== attemptRef.current) {
        void logoutSession(result.refreshToken).catch(() => undefined);
        return;
      }
      attemptRef.current++;
      setPxgSession(result);
    } catch (err) {
      if (id !== attemptRef.current) return;
      setError(describePxgError(lang, err));
      if (err instanceof PxgError && err.code === 'invalid_code') setErrorField('code');
      setCode('');
    } finally {
      if (id === attemptRef.current) setIsLoading(false);
      if (pendingRef.current === id) pendingRef.current = undefined;
    }
  }

  const handleUsernameSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = username.trim();
    if (USERNAME_INPUT.test(value) || PHONE_INPUT.test(value)) void begin(true);
    else {
      setError(lang('PxgErrorUsername'));
      setErrorField('username');
    }
  };

  const handleCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setError(undefined);
    setErrorField(undefined);
    setCode(value);
    if (value.length === CODE_LENGTH) void submitCode(value);
  };

  const goBack = () => {
    attemptRef.current++;
    setIsLoading(false);
    setCode('');
    setError(undefined);
    setErrorField(undefined);
    if (request) setAttempt(undefined);
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
            error={errorField === 'username' ? lang('PxgGuestUsername') : undefined}
            ariaDescribedBy={error ? 'pxg-guest-error' : undefined}
            disabled={isLoading}
            autoComplete="username"
            onChange={(e) => {
              setUsername(e.target.value);
              setError(undefined);
              setErrorField(undefined);
            }}
          />
          {error && <p id="pxg-guest-error" className={styles.error} role="alert">{error}</p>}
          <Button type="submit" className="auth-button" isLoading={isLoading} disabled={!username.trim()}>
            {lang('PxgGuestGetCode')}
          </Button>
        </form>
        <Button className="auth-button" color="translucent" disabled={isLoading} onClick={() => void begin(false)}>
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
          error={errorField === 'code' ? lang('PxgGuestCode') : undefined}
          ariaDescribedBy={error ? 'pxg-guest-error' : undefined}
          disabled={isLoading}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          autoFocus
          onChange={handleCodeChange}
        />
        {error && <p id="pxg-guest-error" className={styles.error} role="alert">{error}</p>}
        {isLoading && <p className={styles.hint}>{lang('PxgGuestWaiting')}</p>}
        <Button
          className="auth-button"
          isText
          disabled={isLoading || resendIn > 0}
          onClick={() => void begin(Boolean(requestedLogin))}
        >
          {resendIn > 0 ? lang('PxgGuestResendIn', { seconds: resendIn }) : lang('PxgGuestResend')}
        </Button>
        {request?.botLink && (
          <Button
            className="auth-button"
            isText
            href={request.botLink}
          >
            {lang('PxgGuestOpenBot')}
          </Button>
        )}
      </>
    );
  }

  function renderDeeplink(deeplink: string) {
    return (
      <>
        <h1>{lang('PxgGuestDeeplinkTitle')}</h1>
        <p className="note">
          {requestedLogin?.kind === 'username'
            && lang('PxgGuestDeeplinkFirst', { username: `@${requestedLogin.value}` })}
          {requestedLogin?.kind === 'phone' && lang('PxgGuestDeeplinkPhone', { phone: requestedLogin.value })}
          {!requestedLogin && lang('PxgGuestDeeplinkNote')}
        </p>
        <Button className="auth-button" href={deeplink}>
          {lang('PxgGuestOpenBot')}
        </Button>
        <BotLinkQr link={deeplink} />
        <p className={styles.hint}>{lang('PxgGuestDeeplinkScan')}</p>
        <p className={buildClassName(styles.hint, styles.link)}>{deeplink}</p>
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
