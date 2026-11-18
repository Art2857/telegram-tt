import { memo, useEffect, useMemo, useRef, useState } from '../../lib/teact/teact';
import { getActions, getGlobal } from '../../global';

import type { ApiUser } from '../../api/types';
import type {
  GuestCandidate, MemberCoverageSettings, Permissions, PresetKey, ReachablePage, UserLookup,
} from '../../proxygram/server/types';
import type { Expiry, HistoryMode, ShareSettings } from './ShareSettingsFields';
import { REACHABLE_MEMBERS_PAGE_SIZE } from '../../proxygram/server/types';

import { SERVICE_NOTIFICATIONS_USER_ID } from '../../config';
import { getMainUsername, getUserFullName, isChatChannel } from '../../global/helpers';
import { selectChat, selectChatFullInfo, selectUser } from '../../global/selectors';
import { copyTextToClipboard } from '../../util/clipboard';
import { getOrderedIds } from '../../util/folderManager';
import { getServerTime } from '../../util/serverTime';
import { callApi } from '../../api/gramjs';
import { isProxyPeerId } from '../../api/proxy/ids';
import { diffPermissions, resolvePermissions, samePermissions } from '../../proxygram/permissions';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import {
  describeMemberCoverage, describePxgError, displayName, formatDateTime, getShareGrantee,
} from './helpers';

import useSelector from '../../hooks/data/useSelector';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from '../common/Avatar';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import ConfirmDialog from '../ui/ConfirmDialog';
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
  peerTitle?: string | null;
  peerType?: string | null;
  topicId: number | null;
  folderId: number | null;
  excludePeerIds: number[];
  memberMode?: 'all' | 'selected' | 'none';
  memberIds?: number[];
  memberCoverage?: MemberCoverageSettings | null;
  excludeMemberIds?: number[];
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
  scope: 'chat' | 'topic' | 'folder' | 'chat_members' | 'folder_members';
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
const MAX_MEMBER_SELECTION = 5000;
const MEMBER_CHOICES = {
  all: 'PxgShareMembersAll',
  selected: 'PxgShareMembersOnly',
  except: 'PxgShareMembersExcept',
} as const;
type MemberChoice = keyof typeof MEMBER_CHOICES;
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
  const shareAccountId = usePxgState((state) => state.shareAccountId);
  const shareRequest = usePxgState((state) => state.shareRequest);
  const contactIds = useSelector((global) => global.contactList?.userIds);
  const [shares, setShares] = useState<OutgoingShare[]>();
  const [grantees, setGrantees] = useState<OutgoingShare['grantee'][]>();
  const [knownPeople, setKnownPeople] = useState<Map<number, UserLookup>>();
  const [username, setUsername] = useState('');
  const [guest, setGuest] = useState<UserLookup>();
  const [editing, setEditing] = useState<OutgoingShare>();
  const [preset, setPreset] = useState<PresetKey>('full');
  const [permissions, setPermissions] = useState<Permissions>(() => resolvePermissions('full'));
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
  const [revokeTarget, setRevokeTarget] = useState<{ kind: 'share' | 'invite'; id: string; name: string }>();
  const [isInviting, setIsInviting] = useState(false);
  const [coverMembers, setCoverMembers] = useState(false);
  const [memberChoice, setMemberChoice] = useState<MemberChoice>('all');
  const [chosenMembers, setChosenMembers] = useState<number[]>([]);
  const [includeBots, setIncludeBots] = useState(false);
  const [useSharePermissions, setUseSharePermissions] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberOffset, setMemberOffset] = useState(0);
  const [memberPage, setMemberPage] = useState<ReachablePage>();
  const [memberError, setMemberError] = useState<string>();
  const [memberAttempt, setMemberAttempt] = useState(0);
  const [inviteLink, setInviteLink] = useState<string>();
  const [invites, setInvites] = useState<Invite[]>();
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [isFinding, setIsFinding] = useState(false);
  const lookupRequestRef = useRef(0);
  const loadRequestRef = useRef(0);

  const currentUserId = getGlobal().currentUserId;
  const account = accounts?.find((item) => item.status !== 'revoked'
    && (shareAccountId ? item.id === shareAccountId : String(item.tgUserId) === currentUserId));
  const isCurrentAccount = Boolean(account && String(account.tgUserId) === currentUserId);
  const chat = chatId && isCurrentAccount ? selectChat(getGlobal(), chatId) : undefined;
  const peerTitle = shareRequest?.peerTitle ?? (chatId && chatId === currentUserId && isCurrentAccount
    ? lang('SavedMessages') : chat?.title ?? editing?.peerTitle ?? folder?.title);
  const isMemberScope = Boolean(editing?.scope.endsWith('_members'));
  const groupSource = Boolean(chat && !isChatChannel(chat)
    && (chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup'))
  || ['chat', 'megagroup', 'forum'].includes(editing?.peerType ?? '');
  const canCoverMembers = !isInviting && !topic
    && Boolean(isMemberScope || editing?.memberCoverage || folder || groupSource);
  const coverage = editing?.memberCoverage;
  const isChangingPermissions = Boolean(editing && (preset !== editing.preset
    || !samePermissions(permissions, resolvePermissions(editing.preset, editing.permissions))));
  const hasSeparateMemberPermissions = Boolean(editing && coverage
    && !samePermissions(resolvePermissions(coverage.preset, coverage.permissions),
      resolvePermissions(editing.preset, editing.permissions)));
  const usesSavedMemberPermissions = Boolean(coverage && hasSeparateMemberPermissions
    && !useSharePermissions && !isChangingPermissions);
  const memberPermissions = coverage && usesSavedMemberPermissions
    ? resolvePermissions(coverage.preset, coverage.permissions) : permissions;
  const chatTitle = topic ? `${peerTitle} › ${topic.title}` : peerTitle;
  const peerId = chatId ? Number(chatId) : undefined;
  const t = lang as unknown as (key: string, params?: Record<string, string | number>) => string;
  const accountId = account?.id;
  const folderId = folder?.id;

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
    setMemberPage(undefined);
    setMemberError(undefined);
    if (!coverMembers || !canCoverMembers || memberChoice === 'all' || !accountId || connection !== 'online') {
      return undefined;
    }
    let isActive = true;
    const refreshUntil = Date.now() + 25_000;
    const fetchPage = () => {
      void pxgRpc.call<ReachablePage>('members.source', {
        accountId,
        ...(folderId !== undefined ? { folderId, excludePeerIds: excludedIds } : { peerId }),
        query: memberQuery.trim() || undefined,
        offset: memberOffset,
        includeBots,
      })
        .then((page) => {
          if (!isActive) return;
          const lastOffset = Math.floor(Math.max(0, page.total - 1) / REACHABLE_MEMBERS_PAGE_SIZE)
            * REACHABLE_MEMBERS_PAGE_SIZE;
          if (memberOffset > lastOffset) setMemberOffset(lastOffset);
          else {
            setMemberPage(page);
            if (page.sourceSyncPending && Date.now() < refreshUntil) timer = setTimeout(fetchPage, 2500);
          }
        })
        .catch((err: unknown) => {
          if (isActive) setMemberError(describePxgError(lang, err));
        });
    };
    let timer = setTimeout(fetchPage, 250);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [
    coverMembers, canCoverMembers, memberChoice, accountId, folderId, peerId, memberQuery,
    memberOffset, memberAttempt, excludedIds, includeBots, connection, lang,
  ]);

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
    shareRequest: undefined, shareAccountId: undefined,
  });

  const resetForm = () => {
    lookupRequestRef.current++;
    setIsFinding(false);
    setEditing(undefined);
    setGuest(undefined);
    setUsername('');
    setPreset('full');
    setPermissions(resolvePermissions('full'));
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
    setMemberChoice('all');
    setChosenMembers([]);
    setIncludeBots(false);
    setUseSharePermissions(false);
    setMemberOffset(0);
    setMemberQuery('');
    setMemberPage(undefined);
    setError(undefined);
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
      const tgUserId = found.user?.tgUserId ?? candidate?.tgUserId;
      const existing = tgUserId === undefined ? undefined : shares?.find((item) =>
        item.grantee.tgUserId === tgUserId && !item.scope.endsWith('_members'));
      if (existing && !shareRequest) {
        startEdit(existing);
        return;
      }
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
    if (!user || user.type !== 'userTypeRegular' || result.chat.id !== user.id) return undefined;
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
    setError(undefined);
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
    const savedCoverage = share.scope.endsWith('_members') ? share : share.memberCoverage;
    setCoverMembers(Boolean(savedCoverage && savedCoverage.memberMode !== 'none'));
    setMemberChoice(savedCoverage?.memberMode === 'selected' ? 'selected'
      : savedCoverage?.excludeMemberIds?.length ? 'except' : 'all');
    setChosenMembers(savedCoverage?.memberMode === 'selected'
      ? savedCoverage.memberIds ?? [] : savedCoverage?.excludeMemberIds ?? []);
    setIncludeBots(Boolean(savedCoverage?.includeBots));
    setUseSharePermissions(false);
    setMemberOffset(0);
    setMemberQuery('');
    setMemberPage(undefined);
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
    const days = EXPIRY_DAYS[expiry];
    return days ? new Date(getServerTime() * 1000 + days * DAY_MS).toISOString() : undefined;
  };

  const save = async () => {
    if (isSaving || !account || !isHistoryValid) return;
    if (!editing && !isInviting && !grantee) return;
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
      historySince: historyMode === 'since_date' && historySince
        ? new Date(`${historySince}T00:00:00`).toISOString() : undefined,
      expiresAt: expiresAt(),
    };
    const memberMode = memberChoice === 'selected' ? 'selected' : 'all';
    const memberIds = memberChoice === 'selected' ? chosenMembers : [];
    const excludeMemberIds = memberChoice === 'except' ? chosenMembers
      : memberChoice === 'selected'
        ? (isMemberScope ? editing?.excludeMemberIds : coverage?.excludeMemberIds) ?? [] : [];
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
          shareId: editing.id, ...common,
          permissions: isChangingPermissions ? common.permissions : undefined,
          label: label.trim(),
          // The server clears the expiry only on an explicit JSON `null`
          // eslint-disable-next-line no-null/no-null
          expiresAt: expiry === 'keep' ? undefined : target.expiresAt ?? null,
          ...(isMemberScope ? {
            memberMode: coverMembers ? memberMode : 'none', memberIds, excludeMemberIds, includeBots,
          } : canCoverMembers ? {
            memberCoverage: coverMembers ? { memberMode, memberIds, excludeMemberIds, includeBots, useSharePermissions }
              // eslint-disable-next-line no-null/no-null
              : null,
          } : {}),
        });
      } else if (grantee) {
        const withMembers = coverMembers && canCoverMembers;
        await pxgRpc.call(withMembers ? 'shares.createWithMembers' : 'shares.create', {
          ...common,
          ...target,
          accountId: account.id,
          // The access answers the guest's request: it becomes "approved" with a link to this access
          requestId: shareRequest?.id,
          ...grantee,
          ...(withMembers ? { coverageMemberIds: memberIds, memberMode, excludeMemberIds, includeBots } : {}),
        });
        if (shareRequest) {
          close();
          return;
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

  const confirmRevoke = async () => {
    const target = revokeTarget;
    if (!target) return;
    setRevokeTarget(undefined);
    if (target.kind === 'share') await revoke(target.id);
    else await revokeInvite(target.id);
  };

  const copyInviteLink = () => {
    if (inviteLink && copyTextToClipboard(inviteLink)) showNotification({ message: { key: 'LinkCopied' } });
  };

  const presetLabel = (key: PresetKey) => t(`PxgPreset${key[0].toUpperCase()}${key.slice(1)}`);
  const grantee = getShareGrantee(guest);
  const isFormVisible = Boolean(editing || grantee || isInviting);
  const guestTgUserId = guest?.user?.tgUserId ?? guest?.candidate?.tgUserId;
  // PLAN.md 13: a member of the group sees it in their own Telegram as well, as long as the owner's client knows
  const isGuestMember = Boolean(isCurrentAccount && chatId && guestTgUserId !== undefined
    && selectChatFullInfo(getGlobal(), chatId)?.members?.some((member) => member.userId === String(guestTgUserId)));
  const isHistoryValid = Boolean(editing) || historyMode !== 'since_date'
    || Number.isFinite(Date.parse(historySince));
  // Chats of other owners may sit in the folder too: they are not this account's to share
  const folderChatIds = folder && isCurrentAccount ? getOrderedIds(folder.id) : undefined;
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
    if (patch.excludePeerIds !== undefined) {
      setExcludedIds(patch.excludePeerIds);
      setMemberOffset(0);
    }
  });
  const suggestions = buildSuggestions();

  function renderMemberSelection() {
    return (
      <>
        <InputText
          label={lang('PxgShareMembersFind')}
          value={memberQuery}
          onChange={(e) => {
            setMemberQuery(e.target.value);
            setMemberOffset(0);
          }}
        />
        {memberError ? (
          <div className={styles.options}>
            <span role="alert" className={styles.secondary}>{memberError}</span>
            <Button size="smaller" fluid={false} noFastClick onClick={() => setMemberAttempt((attempt) => attempt + 1)}>
              {lang('Retry')}
            </Button>
          </div>
        ) : !memberPage ? (
          <p role="status" className={styles.secondary}>{lang('PxgAdminLoading')}</p>
        ) : memberPage.people.length ? (
          <div className={styles.memberList}>
            {memberPage.people.map((person) => {
              const name = [person.firstName, person.lastName].filter(Boolean).join(' ')
                || person.username || String(person.tgUserId);
              const sourceTitles = person.sources
                .map((source) => source.title || lang('PxgShareMembersSource'))
                .join(' · ');
              const checked = chosenMembers.includes(person.tgUserId);
              return (
                <Checkbox
                  key={person.tgUserId}
                  checked={checked}
                  disabled={isSaving || (!checked && chosenMembers.length >= MAX_MEMBER_SELECTION)}
                  onCheck={(isChecked) => setChosenMembers((current) => (isChecked
                    ? [...current, person.tgUserId]
                    : current.filter((id) => id !== person.tgUserId)))}
                  label={name}
                  subLabel={[person.username ? `@${person.username}` : undefined, sourceTitles]
                    .filter(Boolean).join(' · ')}
                />
              );
            })}
          </div>
        ) : !memberPage.sourceSyncPending ? (
          <p className={styles.secondary}>{lang('PxgShareMembersNobody')}</p>
        ) : undefined}
        {memberPage?.sourceSyncPending && (
          <p role="status" className={styles.secondary}>{lang('PxgShareMembersSyncPending')}</p>
        )}
        <p className={styles.secondary}>
          {memberChoice === 'selected' && !chosenMembers.length
            ? lang('PxgShareMembersEmptySelection')
            : lang(memberChoice === 'selected' ? 'PxgShareMembersSelected' : 'PxgShareMembersExcluded', {
              count: chosenMembers.length,
            })}
        </p>
        {memberPage && memberPage.total > REACHABLE_MEMBERS_PAGE_SIZE && (
          <div className={styles.options}>
            <Button
              size="smaller"
              fluid={false}
              noFastClick
              disabled={!memberOffset}
              onClick={() => setMemberOffset(memberOffset - REACHABLE_MEMBERS_PAGE_SIZE)}
            >
              {lang('Back')}
            </Button>
            <span className={styles.secondary}>
              {lang('PxgMembersPage', {
                page: memberOffset / REACHABLE_MEMBERS_PAGE_SIZE + 1,
                total: Math.ceil(memberPage.total / REACHABLE_MEMBERS_PAGE_SIZE),
              })}
            </span>
            <Button
              size="smaller"
              fluid={false}
              noFastClick
              disabled={memberOffset + REACHABLE_MEMBERS_PAGE_SIZE >= memberPage.total}
              onClick={() => setMemberOffset(memberOffset + REACHABLE_MEMBERS_PAGE_SIZE)}
            >
              {lang('Next')}
            </Button>
          </div>
        )}
      </>
    );
  }

  function renderForm() {
    const isCoverageBlockedByHistory = !isMemberScope && !coverage
      && (editing?.historyMode ?? historyMode) === 'last_n';
    return (
      <>
        {canCoverMembers && (
          <div className={styles.section}>
            <Checkbox
              checked={coverMembers}
              disabled={isCoverageBlockedByHistory || isSaving}
              onCheck={setCoverMembers}
              label={lang(folder ? 'PxgShareMembersFolder' : 'PxgShareMembersChat')}
              subLabel={lang(isCoverageBlockedByHistory ? 'PxgErrShareMembersHistory' : 'PxgShareMembersHint')}
            />
            {coverMembers && (
              <>
                <div className={styles.options} role="radiogroup" aria-label={lang('PxgShareMembersMode')}>
                  {(Object.keys(MEMBER_CHOICES) as MemberChoice[]).map((choice) => (
                    <label key={choice} className={styles.memberMode}>
                      <input
                        className={styles.memberRadio}
                        type="radio"
                        value={choice}
                        name="pxg-member-coverage"
                        checked={memberChoice === choice}
                        disabled={isSaving}
                        onChange={() => {
                          setMemberChoice(choice);
                          setChosenMembers([]);
                          setMemberQuery('');
                          setMemberOffset(0);
                        }}
                      />
                      {lang(MEMBER_CHOICES[choice])}
                    </label>
                  ))}
                </div>
                <Checkbox
                  label={lang('PxgShareMembersBots')}
                  checked={includeBots}
                  disabled={isSaving}
                  onCheck={(value) => {
                    setIncludeBots(value);
                    setMemberOffset(0);
                  }}
                />
                <p className={styles.secondary}>
                  {lang(!memberPermissions.write ? 'PxgShareMembersReadOnly'
                    : memberPermissions.startChats ? 'PxgShareMembersCanStart' : 'PxgShareMembersExisting')}
                </p>
                {hasSeparateMemberPermissions && !isChangingPermissions && (
                  <Checkbox
                    label={lang('PxgShareUseSameMemberRights')}
                    subLabel={lang('PxgShareSeparateMemberRights')}
                    checked={useSharePermissions}
                    disabled={isSaving}
                    onCheck={setUseSharePermissions}
                  />
                )}
                {memberChoice !== 'all' && renderMemberSelection()}
              </>
            )}
          </div>
        )}

        <ShareSettingsFields
          value={settings}
          isFolder={Boolean(folder)}
          isMemberCoverage={coverMembers}
          editingHistory={editing?.historyMode}
          expiresAt={editing?.expiresAt ?? undefined}
          folderChats={folderChats}
          onChange={changeSettings}
        />

        <div className={styles.buttons}>
          <Button noFastClick isLoading={isSaving} disabled={!isHistoryValid || isSaving} onClick={() => void save()}>
            {lang(editing ? 'PxgShareSave' : isInviting ? 'PxgInviteMake' : 'PxgShareGrant')}
          </Button>
          {(editing || isInviting) && (
            <Button color="translucent" disabled={isSaving} onClick={resetForm}>{lang('PxgShareCancelEdit')}</Button>
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
                shareChatId: undefined, shareFolder: undefined, shareTopic: undefined, shareEditId: undefined,
                shareRequest: undefined, shareAccountId: undefined, isConnectOpen: true,
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
          ) : !shareRequest && (
            <div className={styles.find}>
              <InputText
                label={lang('PxgShareUsername')}
                value={username}
                disabled={isSaving}
                onChange={(e) => {
                  lookupRequestRef.current++;
                  setIsFinding(false);
                  setUsername(e.target.value);
                  setGuest(undefined);
                  setError(undefined);
                }}
              />
              <Button
                noFastClick
                fluid={false}
                size="smaller"
                isLoading={isFinding}
                disabled={isFinding || isSaving || (!USERNAME.test(username.trim()) && !PHONE.test(username.trim()))}
                onClick={() => void find()}
              >
                {lang('PxgShareFind')}
              </Button>
            </div>
          )}

          {!shareRequest && suggestions.length > 0 && (
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
          {!editing && !isInviting && !shareRequest && (
            <Button size="smaller" noFastClick isText fluid={false} onClick={startInvite}>
              {lang('PxgInviteCreate')}
            </Button>
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

          {error && <p className={styles.error} role="alert">{error}</p>}

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
                        onClick={() => setRevokeTarget({
                          kind: 'invite',
                          id: invite.id,
                          name: invite.candidate?.firstName || invite.candidate?.username || '—',
                        })}
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
                      {share.memberCoverage && share.memberCoverage.memberMode !== 'none'
                        ? ` · ${describeMemberCoverage(t, share.memberCoverage)}` : ''}
                    </span>
                  </span>
                  <span className={styles.rowActions}>
                    <Button size="tiny" isText fluid={false} noFastClick onClick={() => startEdit(share)}>
                      {lang('PxgShareEdit')}
                    </Button>
                    <Button
                      size="tiny"
                      isText
                      fluid={false}
                      noFastClick
                      disabled={share.status === 'source_lost'}
                      onClick={() => void setStatus(share, share.status === 'paused' ? 'active' : 'paused')}
                    >
                      {lang(share.status === 'paused' ? 'PxgShareResume' : 'PxgSharePause')}
                    </Button>
                    <Button
                      size="tiny"
                      color="danger"
                      isText
                      fluid={false}
                      onClick={() => setRevokeTarget({
                        kind: 'share',
                        id: share.id,
                        name: displayName(share.grantee),
                      })}
                    >
                      {lang('PxgShareRevoke')}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        isOpen={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(undefined)}
        text={revokeTarget ? t('PxgSettingsRevokeConfirm', {
          name: revokeTarget.name,
          title: chatTitle ?? '',
        }) : undefined}
        confirmLabel={lang('PxgShareRevoke')}
        confirmIsDestructive
        confirmHandler={confirmRevoke}
      />
    </Modal>
  );
};

function parseLimit(value: string) {
  const limit = Number(value);
  return limit > 0 ? Math.min(limit, MAX_RATE_LIMIT) : undefined;
}

export default memo(ShareChatModal);
