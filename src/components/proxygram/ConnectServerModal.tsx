import { memo, useEffect, useRef, useState } from '../../lib/teact/teact';

import type { AccountDto, ConnectStepDto, SrpChallengeDto } from '../../proxygram/server/types';
import { PxgError } from '../../proxygram/server/types';

import { callApi } from '../../api/gramjs';
import { isProxyGuest } from '../../api/proxy';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState, setPxgState } from '../../proxygram/server/store';
import { describePxgError } from './helpers';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import PasswordForm from '../common/PasswordForm';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Modal from '../ui/Modal';
import BotLinkQr from './auth/BotLinkQr';
import { connectDismissKey } from './ProxygramBridge';

import styles from './ConnectServerModal.module.scss';

type Phase =
  | { kind: 'loading' }
  | { kind: 'info'; account: AccountDto }
  | { kind: 'consent' }
  | { kind: 'working' }
  | { kind: 'waiting' }
  | { kind: 'qr'; token: string }
  | { kind: 'password'; challenge: SrpChallengeDto; invalid: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const SHARING_STATUSES = new Set(['active', 'paused', 'flood']);
const CONNECT_RETRY_MS = 5000;

/**
 * «Делиться чатами с этого аккаунта» (PLAN.md, 7.4): экран согласия и подключение сервера к аккаунту.
 * Сервер создаёт свою авторизацию и выдаёт токен входа. С сессией Telegram на устройстве токен подтверждается
 * сам, без QR и кода. У гостя без Telegram на устройстве (docs/RELEASE.md, «Всё через сервер») токен
 * показывается QR-кодом: его сканирует Telegram на телефоне, а свои чаты потом идут через сервер (тонкий режим).
 * 2FA в обоих случаях считается здесь: на сервер уходит только доказательство SRP.
 */
const ConnectServerModal = () => {
  const lang = useLang();
  // Своей сессии Telegram на устройстве нет — подтвердить вход сервера может только телефон
  const [isQr] = useState(isProxyGuest);
  const [recoveryAccountId] = useState(() => getPxgState().connectRecoveryAccountId);
  const hasAutoStartedRef = useRef(false);
  const [disconnectId, setDisconnectId] = useState<string>();
  const [phase, setPhase] = useState<Phase>(() => {
    const { accounts } = getPxgState();
    return accounts ? initialPhase(accounts) : { kind: 'loading' };
  });
  const [attemptId, setAttemptId] = useState<string>();
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  // Шаги сервера спрашиваются, пока окно открыто
  const isOpenRef = useRef(true);
  const attemptRef = useRef<string>();
  const isStartingRef = useRef(false);
  const isCheckingRef = useRef(false);

  useEffect(() => () => {
    isOpenRef.current = false;
    const id = attemptRef.current;
    if (id) void pxgRpc.call('accounts.connect.cancel', { attemptId: id }).catch(() => undefined);
  }, []);

  // У гостя свои аккаунты заранее не загружены: уже подключённый не предлагаем подключать второй раз
  useEffect(() => {
    if (phase.kind !== 'loading') return;
    void pxgRpc.call<AccountDto[]>('accounts.mine').then((accounts) => {
      if (!isOpenRef.current) return;
      setPxgState({ accounts });
      setPhase(initialPhase(accounts));
    }).catch(() => {
      if (isOpenRef.current) setPhase({ kind: 'consent' });
    });
  }, [phase.kind]);

  const close = () => {
    isOpenRef.current = false;
    const id = attemptRef.current;
    attemptRef.current = undefined;
    if (id) {
      void pxgRpc.call('accounts.connect.cancel', { attemptId: id }).catch(() => undefined);
    }
    setPxgState({ isConnectOpen: false });
  };

  const dismiss = () => {
    const tgUserId = getPxgState().session?.user.tgUserId;
    if (tgUserId) localStorage.setItem(connectDismissKey(String(tgUserId)), '1');
    close();
  };

  const showError = (err: unknown) => {
    if (!isOpenRef.current) return;
    // Сервер отказывает, если код отсканирован другим аккаунтом, чем тот, под которым вход сюда
    const isMismatch = isQr && err instanceof PxgError && err.code === 'forbidden';
    setPhase({ kind: 'error', message: isMismatch ? lang('PxgConnectQrMismatch') : describePxgError(lang, err) });
  };

  /** Проходит шаги сервера, пока не понадобится пароль или всё не закончится */
  async function follow(id: string, first: ConnectStepDto) {
    let step = first;
    while (isOpenRef.current) {
      if (step.status === 'connected') {
        if (attemptRef.current === id) attemptRef.current = undefined;
        // Без Telegram на устройстве свои чаты видны только через сервер
        if (isQr) {
          await pxgRpc.call('accounts.setThinMode', { accountId: step.account.id, enabled: true })
            .catch(() => undefined);
        }
        if (!isOpenRef.current) return;
        setPhase({ kind: 'done' });
        const accounts = await pxgRpc.call<AccountDto[]>('accounts.mine').catch(() => undefined);
        if (accounts && isOpenRef.current) setPxgState({ accounts });
        return;
      }
      if (step.status === 'password') {
        setPhase({ kind: 'password', challenge: step.password, invalid: step.invalid });
        return;
      }
      if (step.status === 'token') {
        // Новый токен сервер присылает сам, когда старый истекает: код на экране обновляется
        if (isQr) setPhase({ kind: 'qr', token: step.token });
        else await callApi('pxgAcceptLoginToken', step.token);
      }
      if (!isOpenRef.current) return;
      step = await pxgRpc.call<ConnectStepDto>('accounts.connect.next', { attemptId: id });
    }
  }

  const start = useLastCallback(async () => {
    if (isStartingRef.current || !isOpenRef.current) return;
    isStartingRef.current = true;
    setPhase({ kind: 'working' });
    try {
      const previous = attemptRef.current;
      attemptRef.current = undefined;
      if (previous) await pxgRpc.call('accounts.connect.cancel', { attemptId: previous }).catch(() => undefined);
      if (!isOpenRef.current) return;
      const { attemptId: id, step } = await pxgRpc.call<{ attemptId: string; step: ConnectStepDto }>(
        'accounts.connect.start',
        { recover: recoveryAccountId ? true : undefined },
      );
      if (!isOpenRef.current) {
        // Закрытие может прийти раньше ответа start: созданную позже попытку тоже нужно завершить
        void pxgRpc.call('accounts.connect.cancel', { attemptId: id }).catch(() => undefined);
        return;
      }
      attemptRef.current = id;
      setAttemptId(id);
      await follow(id, step);
    } catch (err) {
      if (!isOpenRef.current) return;
      if (err instanceof PxgError && err.code === 'busy') {
        // Другое устройство уже восстанавливает ту же запись: ждём, не отменяя его авторизацию
        setPhase({ kind: 'waiting' });
        return;
      }
      if (err instanceof PxgError && err.code === 'already_exists') {
        const accounts = await pxgRpc.call<AccountDto[]>('accounts.mine').catch(() => undefined);
        if (!isOpenRef.current) return;
        if (accounts) {
          setPxgState({ accounts });
          const restored = accounts.find((account) => account.id === recoveryAccountId && account.status === 'active');
          setPhase(restored ? { kind: 'done' } : initialPhase(accounts));
          return;
        }
      }
      showError(err);
    } finally {
      isStartingRef.current = false;
    }
  });

  useEffect(() => {
    if (!recoveryAccountId || hasAutoStartedRef.current) return;
    hasAutoStartedRef.current = true;
    void start();
  }, [recoveryAccountId]);

  useEffect(() => {
    if (phase.kind !== 'waiting') return undefined;
    const timer = window.setInterval(() => void start(), CONNECT_RETRY_MS);
    const unsubscribe = pxgRpc.on((event) => {
      if (event.e === 'accounts.changed' && event.d.status !== 'connecting') void start();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [phase.kind]);

  const disconnect = async (accountId: string) => {
    setPhase({ kind: 'working' });
    try {
      await pxgRpc.call('accounts.disconnect', { accountId });
      const accounts = await pxgRpc.call<AccountDto[]>('accounts.mine');
      if (isOpenRef.current) setPxgState({ accounts, isConnectOpen: false });
    } catch (err) {
      showError(err);
    }
  };

  const submitPassword = async (password: string) => {
    if (phase.kind !== 'password' || !attemptId || !isOpenRef.current || isCheckingRef.current) return;
    isCheckingRef.current = true;
    setIsChecking(true);
    try {
      // пароль остаётся здесь: на сервер уходит только доказательство SRP
      const answer = isQr
        ? await (await import('../../proxygram/srp')).computeSrpAnswer(phase.challenge, password)
        : await callApi('pxgComputeSrp', phase.challenge, password);
      if (!answer) throw new Error('srp');
      if (!isOpenRef.current || attemptRef.current !== attemptId) return;
      const step = await pxgRpc.call<ConnectStepDto>('accounts.connect.password', { attemptId, ...answer });
      await follow(attemptId, step);
    } catch (err) {
      showError(err);
    } finally {
      isCheckingRef.current = false;
      if (isOpenRef.current) setIsChecking(false);
    }
  };

  return (
    <Modal
      isOpen
      title={lang(recoveryAccountId ? 'PxgConnectRestoreTitle' : isQr ? 'PxgConnectQrTitle' : 'PxgConnectTitle')}
      hasCloseButton
      onClose={close}
      className={styles.root}
    >
      {phase.kind === 'loading' && <p className={styles.secondary}>{lang('PxgAdminLoading')}</p>}
      {phase.kind === 'info' && (
        <>
          <p>{lang('PxgConnectActive', { name: phase.account.displayName ?? '' })}</p>
          {phase.account.status === 'flood' && <p>{lang('PxgAccountFlood')}</p>}
          {phase.account.importState?.status === 'running' && (
            <p className={styles.secondary}>
              {lang('PxgImportProgress', {
                done: phase.account.importState.doneCount, total: phase.account.importState.total,
              })}
            </p>
          )}
          <p className={styles.secondary}>{lang('PxgConnectDisconnectNote')}</p>
          <div className={styles.buttons}>
            <Button onClick={close}>{lang('PxgConnectOk')}</Button>
            <Button color="danger" onClick={() => setDisconnectId(phase.account.id)}>
              {lang('PxgConnectDisconnect')}
            </Button>
          </div>
        </>
      )}
      {phase.kind === 'consent' && (
        <>
          <p>{lang(isQr ? 'PxgConnectQrText1' : 'PxgConnectText1')}</p>
          <p>{lang('PxgConnectText2')}</p>
          {isQr && <p>{lang('PxgConnectQrText2')}</p>}
          <p className={styles.secondary}>{lang('PxgConnectText3')}</p>
          <div className={styles.buttons}>
            <Button onClick={() => void start()}>{lang(isQr ? 'PxgConnectQrButton' : 'PxgConnectButton')}</Button>
            <Button color="translucent" onClick={dismiss}>{lang('PxgConnectLater')}</Button>
          </div>
        </>
      )}
      {phase.kind === 'working' && <p className={styles.secondary}>{lang('PxgConnectProgress')}</p>}
      {phase.kind === 'waiting' && <p className={styles.secondary}>{lang('PxgConnectRestoreWaiting')}</p>}
      {phase.kind === 'qr' && (
        <>
          <BotLinkQr link={`tg://login?token=${phase.token}`} />
          <ol className={styles.steps}>
            <li>{lang('PxgLoginQrHelp1')}</li>
            <li>{lang('PxgLoginQrHelp2', undefined, { withNodes: true, withMarkdown: true })}</li>
            <li>{lang('PxgLoginQrHelp3')}</li>
          </ol>
          <p className={styles.secondary}>{lang('PxgConnectQrHint')}</p>
        </>
      )}
      {phase.kind === 'password' && (
        <>
          <p>{lang('PxgConnectPasswordNote')}</p>
          <PasswordForm
            error={phase.invalid ? lang('PxgConnectPasswordInvalid') : undefined}
            hint={phase.challenge.hint ?? undefined}
            isLoading={isChecking}
            isPasswordVisible={isPasswordVisible}
            shouldShowSubmit
            submitLabel={lang('PxgConnectButton')}
            onClearError={() => setPhase({ ...phase, invalid: false })}
            onChangePasswordVisibility={setIsPasswordVisible}
            onSubmit={(password) => void submitPassword(password)}
          />
        </>
      )}
      {phase.kind === 'done' && (
        <>
          <p>{lang(recoveryAccountId ? 'PxgConnectRestored' : isQr ? 'PxgConnectQrDone' : 'PxgConnectDone')}</p>
          <div className={styles.buttons}>
            <Button onClick={close}>{lang('PxgConnectOk')}</Button>
          </div>
        </>
      )}
      {phase.kind === 'error' && (
        <>
          <p className={styles.error}>{lang('PxgConnectFailed', { reason: phase.message })}</p>
          <div className={styles.buttons}>
            <Button onClick={() => void start()}>{lang('PxgConnectRetry')}</Button>
            <Button color="translucent" onClick={close}>{lang('Cancel')}</Button>
          </div>
        </>
      )}
      <ConfirmDialog
        isOpen={Boolean(disconnectId)}
        onClose={() => setDisconnectId(undefined)}
        text={lang('PxgConnectDisconnectNote')}
        confirmLabel={lang('PxgConnectDisconnect')}
        confirmIsDestructive
        confirmHandler={async () => {
          const id = disconnectId;
          setDisconnectId(undefined);
          if (id) await disconnect(id);
        }}
      />
    </Modal>
  );
};

/** Уже раздаёт — состояние и «Отключить»; иначе (в том числе сессия потеряна) — экран согласия */
function initialPhase(accounts: AccountDto[]): Phase {
  const tgUserId = getPxgState().session?.user.tgUserId;
  const account = accounts.find((item) => item.tgUserId === tgUserId);
  return account && SHARING_STATUSES.has(account.status) ? { kind: 'info', account } : { kind: 'consent' };
}

export default memo(ConnectServerModal);
