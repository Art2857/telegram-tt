import { memo, useEffect, useRef, useState } from '../../lib/teact/teact';
import { getActions, getGlobal } from '../../global';

import type {
  GuestCandidate, PermissionKey, Permissions, PresetKey, UserLookup,
} from '../../proxygram/server/types';

import { selectChat, selectChatFullInfo } from '../../global/selectors';
import { copyTextToClipboard } from '../../util/clipboard';
import { getServerTime } from '../../util/serverTime';
import { callApi } from '../../api/gramjs';
import { diffPermissions, PERMISSION_KEYS, resolvePermissions } from '../../proxygram/permissions';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { describePxgError, displayName, formatDateTime } from './helpers';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';

import styles from './ConnectServerModal.module.scss';

type HistoryMode = 'all' | 'new_only' | 'last_n' | 'since_date';
type Expiry = 'keep' | 'never' | 'day' | 'week' | 'month';

type OutgoingShare = {
  id: string;
  accountId: string;
  scope: 'chat' | 'topic' | 'folder';
  peerId: number | null;
  topicId: number | null;
  folderId: number | null;
  preset: PresetKey;
  permissions: Partial<Permissions>;
  historyMode: HistoryMode;
  label: string | null;
  limits: ShareLimits;
  expiresAt: string | null;
  status: 'active' | 'paused' | 'source_lost';
  grantee: { id: string; username: string | null; firstName: string | null };
};

type ShareLimits = { sendPerMinute?: number; deletePerMinute?: number };

type ShareTargetFields = { scope: string; peerId: number | null; topicId: number | null; folderId: number | null };

type Invite = {
  id: string;
  status: 'pending' | 'awaiting';
  scope: 'chat' | 'topic' | 'folder';
  peerId: number | null;
  topicId: number | null;
  folderId: number | null;
  preset: PresetKey;
  label: string | null;
  candidate: { id: string; username: string | null; firstName: string | null } | null;
  expiresAt: string;
};

type OwnProps = {
  chatId?: string;
  folder?: { id: number; title: string };
  /** A forum topic of `chatId`: the guest gets only this topic */
  topic?: { id: number; title: string };
};

const PRESETS: PresetKey[] = ['readOnly', 'assistant', 'full'];
const HISTORY_MODES: HistoryMode[] = ['all', 'new_only', 'last_n', 'since_date'];
const EXPIRIES: Expiry[] = ['never', 'day', 'week', 'month'];
const EDIT_EXPIRIES: Expiry[] = ['keep', ...EXPIRIES];
const EXPIRY_DAYS: Record<Expiry, number> = { keep: 0, never: 0, day: 1, week: 7, month: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 100_000;
const LABEL_MAX_LENGTH = 64;
const MAX_RATE_LIMIT = 60;
const USERNAME = /^@?\w{5,32}$/;
// A guest without a username is found by the phone number they shared with the bot
const PHONE = /^\+?[\d\s().-]{7,24}$/;
const HISTORY_KEYS: Record<HistoryMode, string> = {
  all: 'PxgHistoryAll', new_only: 'PxgHistoryNew', last_n: 'PxgHistoryLastN', since_date: 'PxgHistorySince',
};
const EXPIRY_KEYS: Record<Expiry, string> = {
  keep: 'PxgExpiryKeep',
  never: 'PxgExpiryNever', day: 'PxgExpiryDay', week: 'PxgExpiryWeek', month: 'PxgExpiryMonth',
};

/** «Поделиться чатом» и «Поделиться папкой» (PLAN.md, 7.5–7.6): кому, какие права, какая история, на какой срок */
const ShareChatModal = ({ chatId, folder, topic }: OwnProps) => {
  const { showNotification } = getActions();
  const lang = useLang();
  const accounts = usePxgState((state) => state.accounts);
  const connection = usePxgState((state) => state.connection);
  const shareEditId = usePxgState((state) => state.shareEditId);
  const [shares, setShares] = useState<OutgoingShare[]>();
  const [username, setUsername] = useState('');
  const [guest, setGuest] = useState<UserLookup>();
  const [editing, setEditing] = useState<OutgoingShare>();
  const [preset, setPreset] = useState<PresetKey>('assistant');
  const [permissions, setPermissions] = useState<Permissions>(() => resolvePermissions('assistant'));
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [historyMode, setHistoryMode] = useState<HistoryMode>('all');
  const [historyLimit, setHistoryLimit] = useState(String(DEFAULT_HISTORY_LIMIT));
  const [historySince, setHistorySince] = useState('');
  const [expiry, setExpiry] = useState<Expiry>('never');
  const [label, setLabel] = useState('');
  const [sendLimit, setSendLimit] = useState('');
  const [deleteLimit, setDeleteLimit] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string>();
  const [invites, setInvites] = useState<Invite[]>();
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [isFinding, setIsFinding] = useState(false);
  const lookupRequestRef = useRef(0);
  const loadRequestRef = useRef(0);

  const currentUserId = getGlobal().currentUserId;
  const peerTitle = chatId ? selectChat(getGlobal(), chatId)?.title : folder?.title;
  const chatTitle = topic ? `${peerTitle} › ${topic.title}` : peerTitle;
  const account = accounts?.find((item) => String(item.tgUserId) === currentUserId && item.status !== 'revoked');
  const peerId = chatId ? Number(chatId) : undefined;
  const t = lang as unknown as (key: string, params?: Record<string, string | number>) => string;

  const isSameTarget = (item: ShareTargetFields) => {
    if (folder) return item.scope === 'folder' && item.folderId === folder.id;
    if (topic) return item.scope === 'topic' && item.peerId === peerId && item.topicId === topic.id;
    return item.scope === 'chat' && item.peerId === peerId;
  };

  const loadShares = useLastCallback(() => {
    if (!account || connection !== 'online') return;
    const request = ++loadRequestRef.current;
    void pxgRpc.call<OutgoingShare[]>('shares.outgoing')
      .then((list) => {
        if (request === loadRequestRef.current) {
          setShares(list.filter((share) => share.accountId === account.id && isSameTarget(share)));
        }
      })
      .catch((err) => setError(describePxgError(lang, err)));
    void pxgRpc.call<Invite[]>('invites.list', { accountId: account.id })
      .then((list) => {
        if (request === loadRequestRef.current) setInvites(list.filter(isSameTarget));
      })
      .catch(() => setInvites(undefined));
  });

  // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
  useEffect(loadShares, [account?.id, peerId, folder?.id, topic?.id, connection]);

  useEffect(() => pxgRpc.on((event) => {
    if (event.e === 'shares.changed' || event.e === 'access.changed') loadShares();
  }), [loadShares]);

  const close = () => setPxgState({
    shareChatId: undefined, shareFolder: undefined, shareTopic: undefined, shareEditId: undefined,
  });

  const resetForm = () => {
    lookupRequestRef.current++;
    setIsFinding(false);
    setEditing(undefined);
    setGuest(undefined);
    setUsername('');
    setPreset('assistant');
    setPermissions(resolvePermissions('assistant'));
    setIsCustomizing(false);
    setHistoryMode('all');
    setHistoryLimit(String(DEFAULT_HISTORY_LIMIT));
    setHistorySince('');
    setExpiry('never');
    setLabel('');
    setSendLimit('');
    setDeleteLimit('');
    setIsInviting(false);
  };

  const startInvite = () => {
    resetForm();
    setInviteLink(undefined);
    setIsInviting(true);
  };

  const find = async () => {
    const request = ++lookupRequestRef.current;
    setGuest(undefined);
    setError(undefined);
    setIsFinding(true);
    try {
      const value = username.trim();
      const isPhone = PHONE.test(value);
      const found = await pxgRpc.call<UserLookup>('users.lookup', isPhone ? { phone: value } : { username: value });
      if (request !== lookupRequestRef.current) return;
      // Someone who has never signed in is still found through the owner's own Telegram (PLAN.md 7.5)
      const candidate = found.registered || found.candidate ? found.candidate : await resolveCandidate(value, isPhone);
      if (request !== lookupRequestRef.current) return;
      setGuest({ ...found, candidate });
    } catch (err) {
      if (request === lookupRequestRef.current) setError(describePxgError(lang, err));
    } finally {
      if (request === lookupRequestRef.current) setIsFinding(false);
    }
  };

  async function resolveCandidate(value: string, isPhone: boolean): Promise<GuestCandidate | undefined> {
    const result = isPhone
      ? await callApi('getChatByPhoneNumber', value.replace(/[^\d+]/g, ''))
      : await callApi('getChatByUsername', value.replace(/^@/, ''));
    const user = result?.user;
    if (!user || user.type !== 'userTypeRegular') return undefined;
    return {
      tgUserId: Number(user.id),
      username: user.usernames?.find((item) => item.isActive)?.username,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  const selectPreset = (key: PresetKey) => {
    setPreset(key);
    setPermissions(resolvePermissions(key));
  };

  const togglePermission = (key: PermissionKey, isChecked: boolean) => {
    setPermissions({ ...permissions, [key]: isChecked });
  };

  const startEdit = (share: OutgoingShare) => {
    lookupRequestRef.current++;
    setIsFinding(false);
    setEditing(share);
    setGuest(undefined);
    setPreset(share.preset);
    setPermissions(resolvePermissions(share.preset, share.permissions));
    setIsCustomizing(Object.keys(share.permissions).length > 0);
    setExpiry('keep');
    setLabel(share.label || '');
    setSendLimit(share.limits.sendPerMinute ? String(share.limits.sendPerMinute) : '');
    setDeleteLimit(share.limits.deletePerMinute ? String(share.limits.deletePerMinute) : '');
    setIsInviting(false);
  };

  // Opened from the chat profile to change one particular access
  useEffect(() => {
    const share = shareEditId ? shares?.find((item) => item.id === shareEditId) : undefined;
    if (!share) return;
    startEdit(share);
    setPxgState({ shareEditId: undefined });
  }, [shares, shareEditId]);

  const buildLimits = (): ShareLimits => ({
    sendPerMinute: parseLimit(sendLimit),
    deletePerMinute: parseLimit(deleteLimit),
  });

  const expiresAt = () => {
    if (expiry === 'keep') return editing?.expiresAt || undefined;
    const days = EXPIRY_DAYS[expiry];
    return days ? new Date(getServerTime() * 1000 + days * DAY_MS).toISOString() : undefined;
  };

  const save = async () => {
    if (!account || (!editing && !guest?.user && !guest?.candidate && !isInviting)) return;
    setIsSaving(true);
    setError(undefined);
    const common = {
      preset,
      permissions: diffPermissions(preset, permissions),
      label: label.trim() || undefined,
      limits: buildLimits(),
    };
    const target = {
      scope: folder ? 'folder' : topic ? 'topic' : 'chat',
      peerId,
      topicId: topic?.id,
      folderId: folder?.id,
      historyMode,
      historyLimit: historyMode === 'last_n' ? Math.min(Number(historyLimit) || 1, MAX_HISTORY_LIMIT) : undefined,
      historySince: historyMode === 'since_date' && historySince ? new Date(historySince).toISOString() : undefined,
      expiresAt: expiresAt(),
    };
    try {
      if (isInviting) {
        const result = await pxgRpc.call<{ link: string }>('invites.create', {
          ...common, ...target, accountId: account.id,
        });
        resetForm();
        setInviteLink(result.link);
        loadShares();
        return;
      }
      if (editing) {
        await pxgRpc.call('shares.update', {
          // The server clears the expiry only on an explicit JSON `null`
          // eslint-disable-next-line no-null/no-null
          shareId: editing.id, ...common, label: label.trim(), expiresAt: expiresAt() ?? null,
        });
      } else {
        await pxgRpc.call('shares.create', {
          ...common,
          ...target,
          accountId: account.id,
          // Someone who has never signed in gets the account in advance and finds the chat at the first sign-in
          ...(guest!.user ? { granteeUserId: guest!.user.id } : { grantee: guest!.candidate! }),
        });
      }
      resetForm();
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsSaving(false);
    }
  };

  const setStatus = async (share: OutgoingShare, status: 'active' | 'paused') => {
    try {
      await pxgRpc.call('shares.update', { shareId: share.id, status });
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const revoke = async (shareId: string) => {
    try {
      await pxgRpc.call('shares.revoke', { shareId });
      if (editing?.id === shareId) resetForm();
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const decideInvite = async (inviteId: string, isApproved: boolean) => {
    try {
      await pxgRpc.call('invites.decide', { inviteId, approve: isApproved });
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      await pxgRpc.call('invites.revoke', { inviteId });
      loadShares();
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  };

  const copyInviteLink = () => {
    if (inviteLink && copyTextToClipboard(inviteLink)) showNotification({ message: { key: 'LinkCopied' } });
  };

  const presetLabel = (key: PresetKey) => t(`PxgPreset${key[0].toUpperCase()}${key.slice(1)}`);
  const isFormVisible = Boolean(editing || guest?.user || guest?.candidate || isInviting);
  const guestTgUserId = guest?.user?.tgUserId ?? guest?.candidate?.tgUserId;
  // PLAN.md 13: a member of the group sees it in their own Telegram as well, as long as the owner's client knows
  const isGuestMember = Boolean(chatId && guestTgUserId !== undefined && selectChatFullInfo(getGlobal(), chatId)
    ?.members?.some((member) => member.userId === String(guestTgUserId)));
  const isHistoryValid = historyMode !== 'since_date' || Boolean(historySince);

  function renderOptions<T extends string>(
    items: T[], selected: T, labelOf: (item: T) => string, onSelect: (item: T) => void,
  ) {
    return (
      <div className={styles.options}>
        {items.map((item) => (
          <Button
            key={item}
            size="smaller"
            pill
            fluid={false}
            color={selected === item ? 'primary' : 'translucent'}
            onClick={() => onSelect(item)}
          >
            {labelOf(item)}
          </Button>
        ))}
      </div>
    );
  }

  function renderForm() {
    return (
      <>
        <div className={styles.sectionTitle}>{lang('PxgSharePreset')}</div>
        {renderOptions(PRESETS, preset, presetLabel, selectPreset)}
        <Button size="smaller" isText fluid={false} onClick={() => setIsCustomizing(!isCustomizing)}>
          {lang('PxgShareCustomize')}
        </Button>
        {isCustomizing && (
          <div className={styles.permissions}>
            {PERMISSION_KEYS.filter((key) => key !== 'read').map((key) => (
              <Checkbox
                key={key}
                label={t(`PxgPerm${key[0].toUpperCase()}${key.slice(1)}`)}
                checked={permissions[key]}
                onCheck={(isChecked) => togglePermission(key, isChecked)}
              />
            ))}
          </div>
        )}
        {permissions.markRead && <p className={styles.secondary}>{lang('PxgShareReadWarning')}</p>}

        <div className={styles.sectionTitle}>{lang('PxgShareHistory')}</div>
        {editing ? (
          <p className={styles.secondary}>
            {`${t(HISTORY_KEYS[editing.historyMode])}. ${lang('PxgShareHistoryFixed')}`}
          </p>
        ) : (
          <>
            {renderOptions(HISTORY_MODES.filter((mode) => !folder || mode !== 'last_n'), historyMode,
              (mode) => t(HISTORY_KEYS[mode]), setHistoryMode)}
            {historyMode === 'last_n' && (
              <InputText
                label={lang('PxgHistoryCount')}
                inputMode="numeric"
                value={historyLimit}
                onChange={(e) => setHistoryLimit(e.target.value.replace(/\D/g, ''))}
              />
            )}
            {historyMode === 'since_date' && (
              <label className={styles.dateField}>
                <span className={styles.secondary}>{lang('PxgHistoryDate')}</span>
                <input
                  type="date"
                  className="form-control"
                  value={historySince}
                  onChange={(e) => setHistorySince(e.currentTarget.value)}
                />
              </label>
            )}
          </>
        )}

        <div className={styles.sectionTitle}>{lang('PxgShareExpiry')}</div>
        {editing?.expiresAt && (
          <p className={styles.secondary}>{lang('PxgShareExpires', { date: formatDateTime(editing.expiresAt) })}</p>
        )}
        {renderOptions(editing ? EDIT_EXPIRIES : EXPIRIES, expiry, (item) => t(EXPIRY_KEYS[item]), setExpiry)}

        <InputText
          label={lang('PxgShareLabel')}
          value={label}
          maxLength={LABEL_MAX_LENGTH}
          onChange={(e) => setLabel(e.target.value)}
        />

        <div className={styles.sectionTitle}>{lang('PxgShareLimits')}</div>
        <p className={styles.secondary}>{lang('PxgShareLimitsHint')}</p>
        <div className={styles.find}>
          <InputText
            label={lang('PxgShareLimitSend')}
            inputMode="numeric"
            value={sendLimit}
            onChange={(e) => setSendLimit(e.target.value.replace(/\D/g, ''))}
          />
          <InputText
            label={lang('PxgShareLimitDelete')}
            inputMode="numeric"
            value={deleteLimit}
            onChange={(e) => setDeleteLimit(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className={styles.buttons}>
          <Button isLoading={isSaving} disabled={!isHistoryValid} onClick={() => void save()}>
            {lang(editing ? 'PxgShareSave' : isInviting ? 'PxgInviteMake' : 'PxgShareGrant')}
          </Button>
          {(editing || isInviting) && (
            <Button color="translucent" onClick={resetForm}>{lang('PxgShareCancelEdit')}</Button>
          )}
        </div>
      </>
    );
  }

  return (
    <Modal
      isOpen
      title={lang(folder ? 'PxgShareFolderTitle' : topic ? 'PxgShareTopic' : 'PxgShareTitle')}
      hasCloseButton
      onClose={close}
      className={styles.root}
    >
      {chatTitle && <p className={styles.secondary}>{chatTitle}</p>}
      {folder && <p className={styles.secondary}>{lang('PxgShareFolderHint')}</p>}
      {topic && <p className={styles.secondary}>{lang('PxgShareTopicHint')}</p>}

      {!account ? (
        <>
          <p>{lang('PxgShareNeedServer')}</p>
          <div className={styles.buttons}>
            <Button
              onClick={() => setPxgState({
                shareChatId: undefined, shareFolder: undefined, shareTopic: undefined, isConnectOpen: true,
              })}
            >
              {lang('PxgConnectTitle')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {editing ? (
            <p className={styles.ok}>{lang('PxgShareEditing', { name: displayName(editing.grantee) })}</p>
          ) : (
            <div className={styles.find}>
              <InputText
                label={lang('PxgShareUsername')}
                value={username}
                onChange={(e) => {
                  lookupRequestRef.current++;
                  setIsFinding(false);
                  setUsername(e.target.value);
                  setGuest(undefined);
                }}
              />
              <Button
                fluid={false}
                size="smaller"
                isLoading={isFinding}
                disabled={!USERNAME.test(username.trim()) && !PHONE.test(username.trim())}
                onClick={() => void find()}
              >
                {lang('PxgShareFind')}
              </Button>
            </div>
          )}

          {!editing && guest && !guest.user && !guest.candidate && (
            <p className={styles.secondary}>
              {PHONE.test(username.trim())
                ? lang('PxgShareNotRegisteredPhone')
                : lang('PxgShareNotRegistered', { username: username.trim().replace(/^@/, '') })}
            </p>
          )}
          {!editing && guest?.user && (
            <p className={styles.ok}>{lang('PxgShareFound', { name: displayName(guest.user) })}</p>
          )}
          {!editing && (guest?.candidate || guest?.user?.isPending) && (
            <p className={styles.secondary}>
              {lang('PxgSharePending', { name: displayName(guest.user ?? guest.candidate) })}
            </p>
          )}
          {/* PLAN.md 13: sharing a private chat with its own counterpart */}
          {!editing && guestTgUserId !== undefined && !topic && peerId === guestTgUserId && (
            <p className={styles.secondary}>{lang('PxgShareSelfChat')}</p>
          )}
          {!editing && isGuestMember && (
            <p className={styles.secondary}>
              {lang('PxgShareGuestIsMember', { name: displayName(guest?.user ?? guest?.candidate) })}
            </p>
          )}
          {!editing && !isInviting && (
            <Button size="smaller" isText fluid={false} onClick={startInvite}>{lang('PxgInviteCreate')}</Button>
          )}
          {isInviting && <p className={styles.secondary}>{lang('PxgInviteHint')}</p>}
          {inviteLink && (
            <div className={styles.section}>
              <p className={styles.ok}>{lang('PxgInviteReady')}</p>
              <div className={styles.row}>
                <span className={styles.link}>{inviteLink}</span>
                <Button size="tiny" isText fluid={false} onClick={copyInviteLink}>{lang('Copy')}</Button>
              </div>
            </div>
          )}

          {isFormVisible && renderForm()}

          {error && <p className={styles.error}>{error}</p>}

          {Boolean(invites?.length) && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>{lang('PxgInviteList')}</div>
              {invites.map((invite) => (
                <div key={invite.id} className={styles.row}>
                  <span>
                    {invite.candidate
                      ? lang('PxgInviteAwaiting', { name: displayName(invite.candidate) })
                      : lang('PxgInvitePending', { date: formatDateTime(invite.expiresAt) })}
                    <span className={styles.secondary}>
                      {` · ${presetLabel(invite.preset)}`}
                      {invite.label ? ` · ${invite.label}` : ''}
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    {invite.status === 'awaiting' && (
                      <>
                        <Button size="tiny" isText fluid={false} onClick={() => void decideInvite(invite.id, true)}>
                          {lang('PxgInviteApprove')}
                        </Button>
                        <Button
                          size="tiny"
                          color="danger"
                          isText
                          fluid={false}
                          onClick={() => void decideInvite(invite.id, false)}
                        >
                          {lang('PxgInviteDecline')}
                        </Button>
                      </>
                    )}
                    {invite.status === 'pending' && (
                      <Button
                        size="tiny"
                        color="danger"
                        isText
                        fluid={false}
                        onClick={() => void revokeInvite(invite.id)}
                      >
                        {lang('PxgShareRevoke')}
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {Boolean(shares?.length) && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>{lang('PxgShareList')}</div>
              {shares.map((share) => (
                <div key={share.id} className={styles.row}>
                  <span>
                    {displayName(share.grantee)}
                    <span className={styles.secondary}>
                      {` · ${presetLabel(share.preset)}`}
                      {Object.keys(share.permissions).length ? '*' : ''}
                      {share.status === 'paused' ? ` · ${lang('PxgShareStatusPaused')}` : ''}
                      {share.status === 'source_lost' ? ` · ${lang('PxgShareStatusLost')}` : ''}
                      {share.expiresAt && Date.parse(share.expiresAt) <= getServerTime() * 1000
                        ? ` · ${lang('PxgShareStatusExpired')}` : ''}
                      {share.expiresAt
                        ? ` · ${lang('PxgShareExpires', { date: formatDateTime(share.expiresAt) })}` : ''}
                      {share.label ? ` · ${share.label}` : ''}
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    <Button size="tiny" isText fluid={false} onClick={() => startEdit(share)}>
                      {lang('PxgShareEdit')}
                    </Button>
                    <Button
                      size="tiny"
                      isText
                      fluid={false}
                      disabled={share.status === 'source_lost'}
                      onClick={() => void setStatus(share, share.status === 'paused' ? 'active' : 'paused')}
                    >
                      {lang(share.status === 'paused' ? 'PxgShareResume' : 'PxgSharePause')}
                    </Button>
                    <Button size="tiny" color="danger" isText fluid={false} onClick={() => void revoke(share.id)}>
                      {lang('PxgShareRevoke')}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

function parseLimit(value: string) {
  const limit = Number(value);
  return limit > 0 ? Math.min(limit, MAX_RATE_LIMIT) : undefined;
}

export default memo(ShareChatModal);
