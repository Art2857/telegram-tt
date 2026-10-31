import { memo, useEffect, useState } from '../../../lib/teact/teact';

import type { PresetKey, UserLookup } from '../../../proxygram/server/types';

import { pxgRpc } from '../../../proxygram/server/rpc';
import { describePxgError, displayName } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from './AdminPanel.module.scss';

type AccountOption = { id: string; displayName: string | null; status: string };
type PeerOption = { peerId: number; title: string | null; username: string | null; type: string | null };

const PRESETS: PresetKey[] = ['readOnly', 'assistant', 'full'];

/** «Выдать доступ» из админки: от имени владельца выбранного аккаунта */
const AdminShareForm = ({ onClose }: { onClose: NoneToVoidFunction }) => {
  const lang = useLang();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  const [peers, setPeers] = useState<PeerOption[]>([]);
  const [peerId, setPeerId] = useState<number>();
  const [username, setUsername] = useState('');
  const [guest, setGuest] = useState<UserLookup>();
  const [preset, setPreset] = useState<PresetKey>('assistant');
  const [isNewOnly, setIsNewOnly] = useState(false);
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void pxgRpc.call<AccountOption[]>('admin.accounts').then((list) => {
      const active = list.filter((account) => account.status !== 'revoked');
      setAccounts(active);
      if (active[0]) setAccountId(active[0].id);
    });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const timer = window.setTimeout(() => {
      void pxgRpc.call<PeerOption[]>('admin.peers', { accountId, query: chatQuery.trim() || undefined })
        .then(setPeers);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountId, chatQuery]);

  const findGuest = async () => {
    setError(undefined);
    try {
      setGuest(await pxgRpc.call<UserLookup>('users.lookup', { username: username.trim() }));
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const save = async () => {
    if (!accountId || peerId === undefined || !guest?.user) return;
    setIsSaving(true);
    setError(undefined);
    try {
      await pxgRpc.call('admin.shares.create', {
        accountId,
        granteeUserId: guest.user.id,
        scope: 'chat',
        peerId,
        preset,
        historyMode: isNewOnly ? 'new_only' : 'all',
      });
      onClose();
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>{lang('PxgAdminColAccount')}</span>
        <select value={accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.displayName ?? account.id}</option>
          ))}
        </select>
      </label>

      <InputText label={lang('PxgAdminChatSearch')} value={chatQuery} onChange={(e) => setChatQuery(e.target.value)} />
      <div className={styles.peerList}>
        {peers.map((peer) => (
          <button
            key={peer.peerId}
            type="button"
            className={peer.peerId === peerId ? styles.peerActive : styles.peer}
            onClick={() => setPeerId(peer.peerId)}
          >
            {peer.title ?? peer.username ?? peer.peerId}
          </button>
        ))}
      </div>

      <div className={styles.row}>
        <InputText
          label={lang('PxgShareUsername')}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setGuest(undefined);
          }}
        />
        <Button size="smaller" fluid={false} onClick={() => void findGuest()} disabled={!username.trim()}>
          {lang('PxgShareFind')}
        </Button>
      </div>
      {guest && (
        <p className={guest.user ? styles.ok : styles.secondary}>
          {guest.user
            ? lang('PxgShareFound', { name: displayName(guest.user) })
            : lang('PxgShareNotRegistered', { username: username.replace(/^@/, '') })}
        </p>
      )}

      <div className={styles.filters}>
        {PRESETS.map((key) => (
          <Button
            key={key}
            size="smaller"
            pill
            fluid={false}
            color={preset === key ? 'primary' : 'translucent'}
            onClick={() => setPreset(key)}
          >
            {(lang as unknown as (k: string) => string)(`PxgPreset${key[0].toUpperCase()}${key.slice(1)}`)}
          </Button>
        ))}
      </div>
      <div className={styles.filters}>
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

      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.row}>
        <Button
          fluid={false}
          isLoading={isSaving}
          disabled={!guest?.user || peerId === undefined}
          onClick={() => void save()}
        >
          {lang('PxgShareGrant')}
        </Button>
        <Button fluid={false} color="translucent" onClick={onClose}>{lang('Cancel')}</Button>
      </div>
    </div>
  );
};

export default memo(AdminShareForm);
