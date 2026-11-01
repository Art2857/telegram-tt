import { memo, useState } from '../../lib/teact/teact';
import { getGlobal } from '../../global';

import type { AccountDto, ConnectStepDto, SrpChallengeDto } from '../../proxygram/server/types';

import { callApi } from '../../api/gramjs';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState, setPxgState } from '../../proxygram/server/store';
import { describePxgError } from './helpers';

import useLang from '../../hooks/useLang';

import PasswordForm from '../common/PasswordForm';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { connectDismissKey } from './ProxygramBridge';

import styles from './ConnectServerModal.module.scss';

type Phase =
  | { kind: 'info'; account: AccountDto }
  | { kind: 'consent' }
  | { kind: 'working' }
  | { kind: 'password'; challenge: SrpChallengeDto; invalid: boolean }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * «Делиться чатами с этого аккаунта» (PLAN.md, 7.4): экран согласия и подключение сервера
 * без QR и без кода — токен входа подтверждает сессия этого устройства, 2FA считается здесь же.
 */
const ConnectServerModal = () => {
  const lang = useLang();
  const [phase, setPhase] = useState<Phase>(() => {
    const userId = getGlobal().currentUserId;
    const account = getPxgState().accounts?.find((item) => String(item.tgUserId) === userId);
    // уже раздаёт — показываем состояние и «Отключить»; иначе (в том числе сессия потеряна) — экран согласия
    return account && (account.status === 'active' || account.status === 'paused' || account.status === 'flood')
      ? { kind: 'info', account }
      : { kind: 'consent' };
  });
  const [attemptId, setAttemptId] = useState<string>();
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const close = () => {
    if (attemptId && phase.kind !== 'done') {
      void pxgRpc.call('accounts.connect.cancel', { attemptId }).catch(() => undefined);
    }
    setPxgState({ isConnectOpen: false });
  };

  const dismiss = () => {
    const userId = getGlobal().currentUserId;
    if (userId) localStorage.setItem(connectDismissKey(userId), '1');
    close();
  };

  /** Проходит шаги сервера, пока не понадобится пароль или всё не закончится */
  async function follow(id: string, first: ConnectStepDto) {
    let step = first;
    for (;;) {
      if (step.status === 'connected') {
        setPhase({ kind: 'done' });
        const accounts = await pxgRpc.call<AccountDto[]>('accounts.mine').catch(() => undefined);
        if (accounts) setPxgState({ accounts });
        return;
      }
      if (step.status === 'password') {
        setPhase({ kind: 'password', challenge: step.password, invalid: step.invalid });
        return;
      }
      if (step.status === 'token') await callApi('pxgAcceptLoginToken', step.token);
      step = await pxgRpc.call<ConnectStepDto>('accounts.connect.next', { attemptId: id });
    }
  }

  const start = async () => {
    setPhase({ kind: 'working' });
    try {
      const { attemptId: id, step } = await pxgRpc.call<{ attemptId: string; step: ConnectStepDto }>(
        'accounts.connect.start',
      );
      setAttemptId(id);
      await follow(id, step);
    } catch (err) {
      setPhase({ kind: 'error', message: describePxgError(lang, err) });
    }
  };

  const disconnect = async (accountId: string) => {
    setPhase({ kind: 'working' });
    try {
      await pxgRpc.call('accounts.disconnect', { accountId });
      const accounts = await pxgRpc.call<AccountDto[]>('accounts.mine');
      setPxgState({ accounts, isConnectOpen: false });
    } catch (err) {
      setPhase({ kind: 'error', message: describePxgError(lang, err) });
    }
  };

  const submitPassword = async (password: string) => {
    if (phase.kind !== 'password' || !attemptId) return;
    setIsChecking(true);
    try {
      // пароль остаётся здесь: на сервер уходит только доказательство SRP
      const answer = await callApi('pxgComputeSrp', phase.challenge, password);
      if (!answer) throw new Error('srp');
      const step = await pxgRpc.call<ConnectStepDto>('accounts.connect.password', { attemptId, ...answer });
      await follow(attemptId, step);
    } catch (err) {
      setPhase({ kind: 'error', message: describePxgError(lang, err) });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <Modal isOpen title={lang('PxgConnectTitle')} hasCloseButton onClose={close} className={styles.root}>
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
            <Button color="danger" onClick={() => void disconnect(phase.account.id)}>
              {lang('PxgConnectDisconnect')}
            </Button>
          </div>
        </>
      )}
      {phase.kind === 'consent' && (
        <>
          <p>{lang('PxgConnectText1')}</p>
          <p>{lang('PxgConnectText2')}</p>
          <p className={styles.secondary}>{lang('PxgConnectText3')}</p>
          <div className={styles.buttons}>
            <Button onClick={() => void start()}>{lang('PxgConnectButton')}</Button>
            <Button color="translucent" onClick={dismiss}>{lang('PxgConnectLater')}</Button>
          </div>
        </>
      )}
      {phase.kind === 'working' && <p className={styles.secondary}>{lang('PxgConnectProgress')}</p>}
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
          <p>{lang('PxgConnectDone')}</p>
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
    </Modal>
  );
};

export default memo(ConnectServerModal);
