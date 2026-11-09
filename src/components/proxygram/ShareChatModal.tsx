import { memo, useEffect, useMemo, useRef, useState } from '../../lib/teact/teact';
import { getActions, getGlobal } from '../../global';

import type { ApiUser } from '../../api/types';
import type {
  GuestCandidate, Permissions, PresetKey, ReachablePage, UserLookup,
} from '../../proxygram/server/types';
import type { Expiry, HistoryMode, ShareSettings } from './ShareSettingsFields';

import { SERVICE_NOTIFICATIONS_USER_ID } from '../../config';
import { getMainUsername, getUserFullName, isChatChannel } from '../../global/helpers';
import { selectChat, selectChatFullInfo, selectUser } from '../../global/selectors';
import { copyTextToClipboard } from '../../util/clipboard';
import { getOrderedIds } from '../../util/folderManager';
import { getServerTime } from '../../util/serverTime';
import { callApi } from '../../api/gramjs';
import { isProxyPeerId } from '../../api/proxy/ids';
import { diffPermissions, resolvePermissions } from '../../proxygram/permissions';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { describePxgError, displayName, formatDateTime } from './helpers';

import useSelector from '../../hooks/data/useSelector';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from '../common/Avatar';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';
import ListItem from '../ui/ListItem';
import Modal from '../ui/Modal';
import ShareSettingsFields, { parseStarsLimit } from './ShareSettingsFields';

import styles from './ConnectServerModal.module.scss';

type OutgoingShare = {
  id: string;
  accountId: string;
  scope: 'chat' | 'topic' | 'folder' | 'chat_members' | 'folder_members';
  peerId: number | null;
  topicId: number | null;
  folderId: number | null;
  excludePeerIds: number[];
  memberMode?: 'all' | 'selected' | 'none';
  memberIds?: number[];
  includeBots?: boolean;
  preset: PresetKey;
  permissions: Partial<Permissions>;
  historyMode: HistoryMode;
  label: string | null;
  limits: ShareLimits;
  expiresAt: string | null;
  status: 'active' | 'paused' | 'source_lost';
  grantee: { id: string; username: string | null; firstName: string | null; tgUserId: number };
};

type ShareLimits = { sendPerMinute?: number; deletePerMinute?: number; starsPerDay?: number };

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

/** Someone the owner can open access to in one click: a contact or a person who already has access to something */
type GuestSuggestion = {
  tgUserId: number;
  name: string;
  username?: string;
  peer?: ApiUser;
  lookup: UserLookup;
};

type OwnProps = {
  chatId?: string;
  folder?: { id: number; title: string };
  /** A forum topic of `chatId`: the guest gets only this topic */
  topic?: { id: number; title: string };
};

const EXPIRY_DAYS: Record<Expiry, number> = { keep: 0, never: 0, day: 1, week: 7, month: 30 };
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 100_000;
const MAX_RATE_LIMIT = 60;
const MAX_GUEST_SUGGESTIONS = 6;
/** The server answers about this many people at a time */
const MAX_KNOWN_PEOPLE = 1000;
const USERNAME = /^@?\w{5,32}$/;
// A guest without a username is found by the phone number they shared with the bot
const PHONE = /^\+?[\d\s().-]{7,24}$/;
/** «Поделиться чатом» и «Поделиться папкой» (PLAN.md, 7.5–7.6): кому, какие права, какая история, на какой срок */
const ShareChatModal = ({ chatId, folder, topic }: OwnProps) => {
  const { showNotification } = getActions();
  const lang = useLang();
  const accounts = usePxgState((state) => state.accounts);
  const connection = usePxgState((state) => state.connection);
  const shareEditId = usePxgState((state) => state.shareEditId);
  const shareRequest = usePxgState((state) => state.shareRequest);
  const contactIds = useSelector((global) => global.contactList?.userIds);
  const [shares, setShares] = useState<OutgoingShare[]>();
  const [grantees, setGrantees] = useState<OutgoingShare['grantee'][]>();
  const [knownPeople, setKnownPeople] = useState<Map<number, UserLookup>>();
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
  const [starsLimit, setStarsLimit] = useState('');
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [isInviting, setIsInviting] = useState(false);
  const [coverMembers, setCoverMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberPage, setMemberPage] = useState<ReachablePage>();
  const [inviteLink, setInviteLink] = useState<string>();
  const [invites, setInvites] = useState<Invite[]>();
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [isFinding, setIsFinding] = useState(false);
  const lookupRequestRef = useRef(0);
  const loadRequestRef = useRef(0);

  const currentUserId = getGlobal().currentUserId;
  const peerTitle = chatId && chatId === currentUserId ? lang('SavedMessages')
    : chatId ? selectChat(getGlobal(), chatId)?.title : folder?.title;
  const chat = chatId ? selectChat(getGlobal(), chatId) : undefined;
  const isMemberScope = Boolean(editing?.scope.endsWith('_members'));
  // Охват участников: групповой чат или все чаты папки, но не канал и не тема
  const canCoverMembers = (!editing || isMemberScope) && !isInviting && !topic
    && Boolean(folder || (chat && !isChatChannel(chat)
      && (chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup')));
  const chatTitle = topic ? `${peerTitle} › ${topic.title}` : peerTitle;
  const account = accounts?.find((item) => String(item.tgUserId) === currentUserId && item.status !== 'revoked');
  const peerId = chatId ? Number(chatId) : undefined;
  const t = lang as unknown as (key: string, params?: Record<string, string | number>) => string;

  const isSameTarget = (item: ShareTargetFields) => {
    if (folder) return (item.scope === 'folder' || item.scope === 'folder_members') && item.folderId === folder.id;
    if (topic) return item.scope === 'topic' && item.peerId === peerId && item.topicId === topic.id;
    return (item.scope === 'chat' || item.scope === 'chat_members') && item.peerId === peerId;
  };

  const loadShares = useLastCallback(() => {
    if (!account || connection !== 'online') return;
    const request = ++loadRequestRef.current;
    void pxgRpc.call<OutgoingShare[]>('shares.outgoing')
      .then((list) => {
        if (request === loadRequestRef.current) {
          setShares(list.filter((share) => share.accountId === account.id && isSameTarget(share)));
          setGrantees(list.map((share) => share.grantee));
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

  // Кого можно включить в охват: состав своего чата или всех чатов папки
  useEffect(() => {
    if (!coverMembers || !canCoverMembers || !account) return undefined;
    let isActive = true;
    const timer = setTimeout(() => {
      void pxgRpc.call<ReachablePage>('members.source', {
        accountId: account.id,
        ...(folder ? { folderId: folder.id } : { peerId }),
        query: memberQuery.trim() || undefined,
      })
        .then((page) => {
          if (isActive) setMemberPage(page);
        })
        .catch(() => {
          if (isActive) setMemberPage(undefined);
        });
    }, 250);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [coverMembers, canCoverMembers, account, folder, peerId, memberQuery]);

  useEffect(() => pxgRpc.on((event) => {
    if (event.e === 'shares.changed' || event.e === 'access.changed') loadShares();
  }), [loadShares]);

  // Who of the owner's contacts and earlier guests the server knows: the rest get access by their Telegram ID
  const hasAccount = Boolean(account);
  useEffect(() => {
    if (!hasAccount || connection !== 'online' || !grantees) return;
    const tgUserIds = [...new Set([
      ...grantees.map((person) => person.tgUserId),
      ...(contactIds ?? []).map(Number),
    ])].slice(0, MAX_KNOWN_PEOPLE);
    void pxgRpc.call<(UserLookup & { tgUserId: number })[]>('users.inSystem', { tgUserIds })
      .then((people) => setKnownPeople(new Map(people.map((person) => [person.tgUserId, person]))))
      .catch(() => setKnownPeople(new Map()));
  }, [hasAccount, connection, grantees, contactIds]);

  const close = () => setPxgState({
    shareChatId: undefined, shareFolder: undefined, shareTopic: undefined, shareEditId: undefined,
    shareRequest: undefined,
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
    setStarsLimit('');
    setExcludedIds([]);
    setIsInviting(false);
    setCoverMembers(false);
    setSelectedMembers([]);
    setMemberQuery('');
    setMemberPage(undefined);
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

  // Opened from an access request: the person who asked is already chosen
  useEffect(() => {
    if (!shareRequest) return;
    const { grantee } = shareRequest;
    setUsername(grantee.username ? `@${grantee.username}` : grantee.name);
    setGuest({
      registered: true,
      knownToBot: true,
      user: {
        id: grantee.id, tgUserId: grantee.tgUserId, username: grantee.username, firstName: grantee.name,
        isPending: false,
      },
    });
  }, [shareRequest]);

  const pickSuggestion = ({ lookup, username: nick, name }: GuestSuggestion) => {
    lookupRequestRef.current++;
    setIsFinding(false);
    setError(undefined);
    setUsername(nick ? `@${nick}` : name);
    setGuest(lookup);
  };

  /** PLAN.md 7.5: while the owner types — matching people; before that — contacts who are already in the system */
  function buildSuggestions(): GuestSuggestion[] {
    if (editing || isInviting || guest || !knownPeople) return [];
    const global = getGlobal();
    const taken = new Set(shares?.map((share) => share.grantee.id));
    const people = new Map<number, GuestSuggestion>();
    grantees?.forEach((person) => {
      const lookup = knownPeople.get(person.tgUserId);
      if (!lookup?.user || taken.has(person.id)) return;
      people.set(person.tgUserId, {
        tgUserId: person.tgUserId,
        name: displayName(person),
        username: person.username ?? undefined,
        lookup,
      });
    });
    contactIds?.forEach((id) => {
      const user = selectUser(global, id);
      const tgUserId = Number(id);
      if (!user || user.type !== 'userTypeRegular' || id === currentUserId || people.has(tgUserId)) return;
      const nick = getMainUsername(user);
      const known = knownPeople.get(tgUserId);
      // Blocked on this server: the answer has neither a person nor a candidate
      if (known && !known.user && !known.candidate) return;
      if (known?.user && taken.has(known.user.id)) return;
      people.set(tgUserId, {
        tgUserId,
        name: getUserFullName(lang, user) ?? nick ?? id,
        username: nick,
        peer: user,
        lookup: known ?? {
          registered: false,
          knownToBot: false,
          user: null, // eslint-disable-line no-null/no-null
          candidate: {
            tgUserId, username: nick, firstName: user.firstName, lastName: user.lastName,
          },
        },
      });
    });
    const query = username.trim().replace(/^@/, '').toLowerCase();
    const isSignedIn = (item: GuestSuggestion) => Boolean(item.lookup.user && !item.lookup.user.isPending);
    return [...people.values()]
      .filter((item) => (query
        ? item.name.toLowerCase().includes(query) || item.username?.toLowerCase().includes(query)
        : isSignedIn(item)))
      .sort((a, b) => Number(isSignedIn(b)) - Number(isSignedIn(a)))
      .slice(0, MAX_GUEST_SUGGESTIONS);
  }

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
    setStarsLimit(share.limits.starsPerDay ? String(share.limits.starsPerDay) : '');
    setExcludedIds(share.excludePeerIds);
    setIsInviting(false);
    if (share.scope.endsWith('_members')) {
      setCoverMembers(true);
      setSelectedMembers(share.memberIds ?? []);
    }
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
    starsPerDay: parseStarsLimit(starsLimit, permissions),
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
      excludePeerIds: folder ? excludedIds : undefined,
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
    const memberMode = !coverMembers ? 'none' as const : selectedMembers.length ? 'selected' as const : 'all' as const;
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
          ...(isMemberScope ? { memberMode, memberIds: selectedMembers } : {}),
        });
      } else {
        await pxgRpc.call('shares.create', {
          ...common,
          ...target,
          accountId: account.id,
          // The access answers the guest's request: it becomes "approved" with a link to this access
          requestId: shareRequest && guest?.user?.id === shareRequest.grantee.id ? shareRequest.id : undefined,
          // Someone who has never signed in gets the account in advance and finds the chat at the first sign-in
          ...(guest!.user ? { granteeUserId: guest!.user.id } : { grantee: guest!.candidate! }),
        });
        // Охват участников — отдельный доступ: сам групповой чат он не открывает
        if (coverMembers && canCoverMembers) {
          await pxgRpc.call('shares.create', {
            ...common,
            ...(folder
              ? { scope: 'folder_members' as const, folderId: folder.id }
              : { scope: 'chat_members' as const, peerId }),
            historyMode: target.historyMode,
            historyLimit: target.historyLimit,
            historySince: target.historySince,
            expiresAt: target.expiresAt,
            memberMode: selectedMembers.length ? 'selected' : 'all',
            memberIds: selectedMembers,
            accountId: account.id,
            ...(guest!.user ? { granteeUserId: guest!.user.id } : { grantee: guest!.candidate! }),
          });
        }
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
  // Chats of other owners may sit in the folder too: they are not this account's to share
  const folderChatIds = folder ? getOrderedIds(folder.id) : undefined;
  const folderChats = useMemo(() => {
    // Telegram's service chat with login codes stays closed even inside a shared folder: the server skips it
    const ids = (folderChatIds ?? []).filter((id) => !isProxyPeerId(id) && id !== SERVICE_NOTIFICATIONS_USER_ID);
    return ids.map((id) => ({ peerId: Number(id), title: selectChat(getGlobal(), id)?.title ?? id }));
  }, [folderChatIds]);
  const settings = useMemo<ShareSettings>(() => ({
    preset, permissions, isCustomizing, historyMode, historyLimit, historySince, expiry, label,
    sendLimit, deleteLimit, starsLimit, excludePeerIds: excludedIds,
  }), [preset, permissions, isCustomizing, historyMode, historyLimit, historySince, expiry, label,
    sendLimit, deleteLimit, starsLimit, excludedIds]);
  const changeSettings = useLastCallback((patch: Partial<ShareSettings>) => {
    if (patch.preset !== undefined) setPreset(patch.preset);
    if (patch.permissions !== undefined) setPermissions(patch.permissions);
    if (patch.isCustomizing !== undefined) setIsCustomizing(patch.isCustomizing);
    if (patch.historyMode !== undefined) setHistoryMode(patch.historyMode);
    if (patch.historyLimit !== undefined) setHistoryLimit(patch.historyLimit);
    if (patch.historySince !== undefined) setHistorySince(patch.historySince);
    if (patch.expiry !== undefined) setExpiry(patch.expiry);
    if (patch.label !== undefined) setLabel(patch.label);
    if (patch.sendLimit !== undefined) setSendLimit(patch.sendLimit);
    if (patch.deleteLimit !== undefined) setDeleteLimit(patch.deleteLimit);
    if (patch.starsLimit !== undefined) setStarsLimit(patch.starsLimit);
    if (patch.excludePeerIds !== undefined) setExcludedIds(patch.excludePeerIds);
  });
  const suggestions = buildSuggestions();

  function renderForm() {
    return (
      <>
        <ShareSettingsFields
          value={settings}
          isFolder={Boolean(folder)}
          editingHistory={editing?.historyMode}
          expiresAt={editing?.expiresAt ?? undefined}
          folderChats={folderChats}
          onChange={changeSettings}
        />

        {canCoverMembers && (
          <div className={styles.section}>
            <Checkbox
              checked={coverMembers}
              onCheck={(isChecked) => {
                setCoverMembers(isChecked);
                if (!isChecked) setSelectedMembers([]);
              }}
              label={lang(folder ? 'PxgShareMembersFolder' : 'PxgShareMembersChat')}
              subLabel={lang('PxgShareMembersHint')}
            />
            {coverMembers && (
              <>
                <InputText
                  label={lang('PxgShareMembersFind')}
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                />
                {memberPage?.people.length ? (
                  <div className={styles.memberList}>
                    {memberPage.people.map((person) => {
                      const name = [person.firstName, person.lastName].filter(Boolean).join(' ')
                        || person.username || String(person.tgUserId);
                      const sourceTitles = person.sources
                        .map((source) => source.title || lang('PxgShareMembersSource'))
                        .join(' · ');
                      return (
                        <Checkbox
                          key={person.tgUserId}
                          checked={selectedMembers.includes(person.tgUserId)}
                          onCheck={(isChecked) => setSelectedMembers((current) => (isChecked
                            ? [...current, person.tgUserId]
                            : current.filter((id) => id !== person.tgUserId)))}
                          label={name}
                          subLabel={[person.username ? `@${person.username}` : undefined, sourceTitles]
                            .filter(Boolean).join(' · ')}
                        />
                      );
                    })}
                  </div>
                ) : memberPage ? (
                  <p className={styles.secondary}>{lang('PxgShareMembersNobody')}</p>
                ) : undefined}
                <p className={styles.secondary}>
                  {selectedMembers.length
                    ? lang('PxgShareMembersSelected', { count: selectedMembers.length })
                    : lang('PxgShareMembersAll')}
                </p>
              </>
            )}
          </div>
        )}

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

          {suggestions.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                {lang(username.trim() ? 'PxgShareSuggestions' : 'PxgShareContactsInSystem')}
              </div>
              {suggestions.map((item) => (
                <ListItem key={item.tgUserId} narrow onClick={() => pickSuggestion(item)}>
                  <Avatar size="small" peer={item.peer} text={item.name} className={styles.suggestionAvatar} />
                  <span className={styles.suggestionName}>
                    {item.name}
                    {item.username && <span className={styles.secondary}>{` @${item.username}`}</span>}
                  </span>
                  {item.lookup.user && !item.lookup.user.isPending ? (
                    <span className={styles.ok}>{lang('PxgShareChipInSystem')}</span>
                  ) : (
                    <span className={styles.secondary}>{lang('PxgShareChipNotSignedIn')}</span>
                  )}
                </ListItem>
              ))}
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
              {` ${lang(guest.knownToBot ? 'PxgShareBotWillInvite' : 'PxgShareBotCannotInvite')}`}
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
                      {share.scope.endsWith('_members') ? ` · ${lang('PxgShareMembersChip')}` : ''}
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
