import { memo, useEffect, useMemo, useRef, useState } from '../../../lib/teact/teact';

import type { UserLookup } from '../../../proxygram/server/types';
import type { ShareSettings } from '../ShareSettingsFields';
import type { AdminShare } from './types';

import { getServerTime } from '../../../util/serverTime';
import { diffPermissions, resolvePermissions } from '../../../proxygram/permissions';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { describePxgError, displayName } from '../helpers';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';
import ShareSettingsFields, { parseStarsLimit } from '../ShareSettingsFields';

import styles from './AdminPanel.module.scss';

type AccountOption = { id: string; displayName: string | null; status: string };
type PeerOption = { peerId: number; title: string | null; username: string | null; type: string | null };
type Targets = {
  folders: { id: number; title: string }[];
  topics: { id: number; title: string }[];
  folderChats: { peerId: number; title: string | null }[];
};
type OwnProps = { share?: AdminShare; onClose: NoneToVoidFunction };

const SEARCH_DELAY_MS = 250;
const PHONE = /^\+?[\d\s().-]{7,24}$/;
const MAX_HISTORY_LIMIT = 100_000;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_RATE_LIMIT = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_DAYS = { keep: 0, never: 0, day: 1, week: 7, month: 30 };

/** Параметры общие с формой владельца; цель и граница истории при правке неизменны */
const AdminShareForm = ({ share, onClose }: OwnProps) => {
  const lang = useLang();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState(share?.account.id ?? '');
  const [scope, setScope] = useState<AdminShare['scope']>(share?.scope ?? 'chat');
  const [chatQuery, setChatQuery] = useState('');
  const [peers, setPeers] = useState<PeerOption[]>([]);
  const [peerId, setPeerId] = useState(share?.peerId ?? undefined);
  const [topicId, setTopicId] = useState(share?.topicId ?? undefined);
  const [folderId, setFolderId] = useState(share?.folderId ?? undefined);
  const [username, setUsername] = useState('');
  const [guest, setGuest] = useState<UserLookup>();
  const [settings, setSettings] = useState<ShareSettings>(() => ({
    preset: share?.preset ?? 'assistant',
    permissions: resolvePermissions(share?.preset ?? 'assistant', share?.permissions),
    isCustomizing: Boolean(share && Object.keys(share.permissions).length),
    historyMode: share?.historyMode ?? 'all',
    historyLimit: String(share?.historyLimit ?? DEFAULT_HISTORY_LIMIT),
    historySince: share?.visibleFromDate?.slice(0, 10) ?? '',
    expiry: share ? 'keep' : 'never',
    label: share?.label ?? '',
    sendLimit: share?.limits.sendPerMinute ? String(share.limits.sendPerMinute) : '',
    deleteLimit: share?.limits.deletePerMinute ? String(share.limits.deletePerMinute) : '',
    starsLimit: share?.limits.starsPerDay ? String(share.limits.starsPerDay) : '',
    excludePeerIds: share?.excludePeerIds ?? [],
  }));
  const [targetResult, setTargetResult] = useState<{ key: string; data: Targets }>();
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const lookupRequestRef = useRef(0);
  const targetsKey = JSON.stringify({
    accountId,
    peerId: scope === 'topic' ? peerId : undefined,
    folderId: scope === 'folder' ? folderId : undefined,
  });
  const targets = targetResult?.key === targetsKey ? targetResult.data : undefined;
  const folderChats = useMemo(() => targets?.folderChats.map((chat) => ({
    peerId: chat.peerId, title: chat.title ?? String(chat.peerId),
  })), [targets]);

  useEffect(() => {
    if (share) return;
    let isActive = true;
    void pxgRpc.call<AccountOption[]>('admin.accounts').then((list) => {
      if (!isActive) return;
      const active = list.filter((account) => account.status !== 'revoked');
      setAccounts(active);
      if (active[0]) setAccountId(active[0].id);
    }).catch((err) => {
      if (isActive) setError(describePxgError(lang, err));
    });
    return () => {
      isActive = false;
    };
  }, [lang, share]);

  useEffect(() => {
    if (!accountId) return;
    let isActive = true;
    void pxgRpc.call<Targets>('admin.shareTargets', JSON.parse(targetsKey)).then((result) => {
      if (isActive) setTargetResult({ key: targetsKey, data: result });
    }).catch((err) => {
      if (isActive) setError(describePxgError(lang, err));
    });
    return () => {
      isActive = false;
    };
  }, [accountId, targetsKey, lang]);

  useEffect(() => {
    if (!accountId || share || scope === 'folder') return;
    let isActive = true;
    const timer = window.setTimeout(() => {
      void pxgRpc.call<PeerOption[]>('admin.peers', { accountId, query: chatQuery.trim() || undefined })
        .then((result) => {
          if (isActive) setPeers(result);
        }).catch((err) => {
          if (isActive) setError(describePxgError(lang, err));
        });
    }, SEARCH_DELAY_MS);
    return () => {
      isActive = false;
      window.clearTimeout(timer);
    };
  }, [accountId, chatQuery, lang, share, scope]);

  const changeSettings = useLastCallback((patch: Partial<ShareSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  });

  const findGuest = async () => {
    const request = ++lookupRequestRef.current;
    setGuest(undefined);
    setError(undefined);
    try {
      const value = username.trim();
      const found = await pxgRpc.call<UserLookup>('users.lookup',
        PHONE.test(value) ? { phone: value } : { username: value });
      if (request === lookupRequestRef.current) setGuest(found);
    } catch (err) {
      if (request === lookupRequestRef.current) setError(describePxgError(lang, err));
    }
  };

  const hasTarget = Boolean(share || (scope === 'folder'
    ? targets?.folders.some((folder) => folder.id === folderId)
    : peers.some((peer) => peer.peerId === peerId)
      && (scope !== 'topic' || targets?.topics.some((topic) => topic.id === topicId))));
  const isHistoryValid = Boolean(share) || settings.historyMode !== 'since_date'
    || Boolean(settings.historySince && Number.isFinite(Date.parse(settings.historySince)));
  const canSave = Boolean(accountId && hasTarget && isHistoryValid && (share || guest?.user || guest?.candidate)
    && (scope !== 'folder' || targets));

  const save = async () => {
    if (!canSave || isSaving) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const days = EXPIRY_DAYS[settings.expiry];
      const expiresAt = days ? new Date(getServerTime() * 1000 + days * DAY_MS).toISOString() : undefined;
      const common = {
        preset: settings.preset,
        permissions: diffPermissions(settings.preset, settings.permissions),
        label: settings.label.trim(),
        limits: {
          sendPerMinute: parseLimit(settings.sendLimit),
          deletePerMinute: parseLimit(settings.deleteLimit),
          starsPerDay: parseStarsLimit(settings.starsLimit, settings.permissions),
        },
        excludePeerIds: scope === 'folder' ? settings.excludePeerIds : undefined,
      };
      if (share) {
        await pxgRpc.call('admin.shares.update', {
          shareId: share.id,
          ...common,
          // Срок снимается только явным JSON `null`; «оставить» не меняет поле
          // eslint-disable-next-line no-null/no-null
          expiresAt: settings.expiry === 'keep' ? undefined : expiresAt ?? null,
        });
      } else {
        await pxgRpc.call('admin.shares.create', {
          ...common,
          accountId,
          granteeUserId: guest?.user?.id,
          grantee: guest?.user ? undefined : guest?.candidate,
          scope,
          peerId: scope !== 'folder' ? peerId : undefined,
          topicId: scope === 'topic' ? topicId : undefined,
          folderId: scope === 'folder' ? folderId : undefined,
          historyMode: settings.historyMode,
          historyLimit: settings.historyMode === 'last_n'
            ? Math.max(1, Math.min(Number(settings.historyLimit) || 1, MAX_HISTORY_LIMIT)) : undefined,
          historySince: settings.historyMode === 'since_date'
            ? new Date(settings.historySince).toISOString() : undefined,
          expiresAt,
        });
      }
      onClose();
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.form}>
      <h3 className={styles.sectionTitle}>{lang(share ? 'PxgShareEdit' : 'PxgAdminGrant')}</h3>
      {share ? (
        <>
          <p>{share.account.displayName ?? share.account.id}</p>
          <p>{share.folderTitle ?? share.peerTitle ?? share.peerId ?? share.folderId}</p>
          {share.scope === 'topic' && <p>{share.topicTitle ?? share.topicId}</p>}
          <p>{lang('PxgShareEditing', { name: displayName(share.grantee) })}</p>
        </>
      ) : (
        <>
          <label className={styles.field}>
            <span>{lang('PxgAdminColAccount')}</span>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.currentTarget.value);
                setPeerId(undefined);
                setTopicId(undefined);
                setFolderId(undefined);
                setPeers([]);
                changeSettings({ excludePeerIds: [] });
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.displayName ?? account.id}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{lang('PxgAdminShareTarget')}</span>
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.currentTarget.value as AdminShare['scope']);
                setTopicId(undefined);
                changeSettings({ excludePeerIds: [], historyMode: 'all' });
              }}
            >
              <option value="chat">{lang('PxgAdminColChat')}</option>
              <option value="topic">{lang('PxgShareTopic')}</option>
              <option value="folder">{lang('PxgShareFolderTitle')}</option>
            </select>
          </label>
          {scope === 'folder' ? (
            <label className={styles.field}>
              <span>{lang('PxgShareFolderTitle')}</span>
              <select
                value={folderId === undefined ? '' : String(folderId)}
                onChange={(e) => {
                  setFolderId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined);
                  changeSettings({ excludePeerIds: [] });
                }}
              >
                <option value="">{lang('PxgAdminChooseTarget')}</option>
                {targets?.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.title}</option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <InputText
                label={lang('PxgAdminChatSearch')}
                value={chatQuery}
                onChange={(e) => {
                  setChatQuery(e.target.value);
                  setPeerId(undefined);
                  setTopicId(undefined);
                  setPeers([]);
                }}
              />
              <div className={styles.peerList}>
                {peers.map((peer) => (
                  <button
                    key={peer.peerId}
                    type="button"
                    className={peer.peerId === peerId ? styles.peerActive : styles.peer}
                    onClick={() => {
                      setPeerId(peer.peerId);
                      setTopicId(undefined);
                    }}
                  >
                    {peer.title ?? peer.username ?? peer.peerId}
                  </button>
                ))}
              </div>
              {scope === 'topic' && (
                <label className={styles.field}>
                  <span>{lang('PxgShareTopic')}</span>
                  <select
                    value={topicId === undefined ? '' : String(topicId)}
                    onChange={(e) => {
                      setTopicId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined);
                    }}
                  >
                    <option value="">{lang('PxgAdminChooseTarget')}</option>
                    {targets?.topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>{topic.title}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <div className={styles.row}>
            <InputText
              label={lang('PxgShareUsername')}
              value={username}
              onChange={(e) => {
                lookupRequestRef.current++;
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
              {guest.user || guest.candidate
                ? lang('PxgShareFound', { name: displayName(guest.user || guest.candidate) })
                : lang('PxgShareNotRegistered', { username: username.replace(/^@/, '') })}
            </p>
          )}
        </>
      )}
      <ShareSettingsFields
        value={settings}
        isFolder={scope === 'folder'}
        editingHistory={share?.historyMode}
        expiresAt={share?.expiresAt ?? undefined}
        folderChats={scope === 'folder' ? folderChats : undefined}
        onChange={changeSettings}
      />
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.row}>
        <Button fluid={false} isLoading={isSaving} disabled={!canSave} onClick={() => void save()}>
          {lang(share ? 'PxgShareSave' : 'PxgShareGrant')}
        </Button>
        <Button fluid={false} color="translucent" onClick={onClose}>{lang('Cancel')}</Button>
      </div>
    </div>
  );
};

function parseLimit(value: string) {
  const limit = Number(value);
  return limit > 0 ? Math.min(limit, MAX_RATE_LIMIT) : undefined;
}

export default memo(AdminShareForm);
