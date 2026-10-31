import { memo, useEffect, useState } from '../../lib/teact/teact';
import { getGlobal } from '../../global';

import type { PresetKey, UserLookup } from '../../proxygram/server/types';

import { selectChat } from '../../global/selectors';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { describePxgError, displayName } from './helpers';

import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';

import styles from './ConnectServerModal.module.scss';

type OutgoingShare = {
  id: string;
  accountId: string;
  peerId: number | null;
  preset: PresetKey;
  status: 'active' | 'paused';
  grantee: { id: string; username: string | null; firstName: string | null };
};

const PRESETS: PresetKey[] = ['readOnly', 'assistant', 'full'];

/** «Поделиться чатом» из меню чата (PLAN.md, 7.5): кому, какие права, какая история */
const ShareChatModal = ({ chatId }: { chatId: string }) => {
  const lang = useLang();
  const accounts = usePxgState((state) => state.accounts);
  const connection = usePxgState((state) => state.connection);
  const [shares, setShares] = useState<OutgoingShare[]>();
  const [username, setUsername] = useState('');
  const [guest, setGuest] = useState<UserLookup>();
  const [preset, setPreset] = useState<PresetKey>('assistant');
  const [isNewOnly, setIsNewOnly] = useState(false);
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  const currentUserId = getGlobal().currentUserId;
  const chatTitle = selectChat(getGlobal(), chatId)?.title;
  const account = accounts?.find((item) => String(item.tgUserId) === currentUserId && item.status !== 'revoked');
  const peerId = Number(chatId);

  const loadShares = () => {
    if (!account) return;
    void pxgRpc.call<OutgoingShare[]>('shares.outgoing')
      .then((list) => setShares(list.filter((share) => share.accountId === account.id && share.peerId === peerId)))
      .catch((err) => setError(describePxgError(lang, err)));
  };

  // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
  useEffect(loadShares, [account?.id, peerId, connection]);

  const close = () => setPxgState({ shareChatId: undefined });

  const find = async () => {
    setError(undefined);
    try {
      setGuest(await pxgRpc.call<UserLookup>('users.lookup', { username: username.trim() }));
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const grant = async () => {
    if (!account || !guest?.user) return;
    setIsSaving(true);
    setError(undefined);
    try {
      await pxgRpc.call('shares.create', {
        accountId: account.id,
        granteeUserId: guest.user.id,
        scope: 'chat',
        peerId,
        preset,
        historyMode: isNewOnly ? 'new_only' : 'all',
      });
      setUsername('');
      setGuest(undefined);
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsSaving(false);
    }
  };

  const revoke = async (shareId: string) => {
    try {
      await pxgRpc.call('shares.revoke', { shareId });
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const presetLabel = (key: PresetKey) => (
    (lang as unknown as (k: string) => string)(`PxgPreset${key[0].toUpperCase()}${key.slice(1)}`)
  );

  return (
    <Modal isOpen title={lang('PxgShareTitle')} hasCloseButton onClose={close} className={styles.root}>
      {chatTitle && <p className={styles.secondary}>{chatTitle}</p>}

      {!account ? (
        <>
          <p>{lang('PxgShareNeedServer')}</p>
          <div className={styles.buttons}>
            <Button onClick={() => setPxgState({ shareChatId: undefined, isConnectOpen: true })}>
              {lang('PxgConnectTitle')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.find}>
            <InputText
              label={lang('PxgShareUsername')}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setGuest(undefined);
              }}
            />
            <Button
              fluid={false}
              size="smaller"
              disabled={!/^@?\w{5,32}$/.test(username.trim())}
              onClick={() => void find()}
            >
              {lang('PxgShareFind')}
            </Button>
          </div>

          {guest && !guest.user && (
            <p className={styles.secondary}>
              {lang('PxgShareNotRegistered', { username: username.trim().replace(/^@/, '') })}
            </p>
          )}

          {guest?.user && (
            <>
              <p className={styles.ok}>{lang('PxgShareFound', { name: displayName(guest.user) })}</p>
              <div className={styles.sectionTitle}>{lang('PxgSharePreset')}</div>
              <div className={styles.options}>
                {PRESETS.map((key) => (
                  <Button
                    key={key}
                    size="smaller"
                    pill
                    fluid={false}
                    color={preset === key ? 'primary' : 'translucent'}
                    onClick={() => setPreset(key)}
                  >
                    {presetLabel(key)}
                  </Button>
                ))}
              </div>
              <div className={styles.sectionTitle}>{lang('PxgShareHistory')}</div>
              <div className={styles.options}>
                <Button
                  size="smaller"
                  pill
                  fluid={false}
                  color={isNewOnly ? 'translucent' : 'primary'}
                  onClick={() => setIsNewOnly(false)}
                >
                  {lang('PxgHistoryAll')}
                </Button>
                <Button
                  size="smaller"
                  pill
                  fluid={false}
                  color={isNewOnly ? 'primary' : 'translucent'}
                  onClick={() => setIsNewOnly(true)}
                >
                  {lang('PxgHistoryNew')}
                </Button>
              </div>
              <Button isLoading={isSaving} onClick={() => void grant()}>{lang('PxgShareGrant')}</Button>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {Boolean(shares?.length) && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>{lang('PxgShareList')}</div>
              {shares.map((share) => (
                <div key={share.id} className={styles.row}>
                  <span>
                    {displayName(share.grantee)}
                    <span className={styles.secondary}>{` · ${presetLabel(share.preset)}`}</span>
                  </span>
                  <Button size="tiny" color="danger" isText fluid={false} onClick={() => void revoke(share.id)}>
                    {lang('PxgShareRevoke')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

export default memo(ShareChatModal);
