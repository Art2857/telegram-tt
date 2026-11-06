import type { ApiChat } from '../../../api/types';
import type { AccessChat, ChatStateDto, ChatUnreadDto } from '../../../proxygram/server/types';
import type { ActionReturnType } from '../../types';
import { PROXY_CONFIG, PROXY_REACTION_EMOJIS } from '../../../api/proxy/types';
import { MAIN_THREAD_ID } from '../../../api/types';
import { LoadMoreDirection } from '../../../types';

import { ARCHIVED_FOLDER_ID } from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { buildCollectionByKey } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import { updatePeerColors } from '../../../util/theme';
import { callApi, closeApi } from '../../../api/gramjs';
import {
  emitProxyUpdate, getProxyPeerId, isProxyGuest, resolveProxyPeer, setProxyUpdateHandler,
} from '../../../api/proxy';
import { buildProxyChat, buildProxyUser } from '../../../api/proxy/builders';
import { isProxyPeerId } from '../../../api/proxy/ids';
import { buildProxyReadStates, fetchProxyChats } from '../../../api/proxy/methods';
import { buildFallbackReactions } from '../../../api/proxy/stickers';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { getPxgState, setPxgState } from '../../../proxygram/server/store';
import { getIsChatMuted } from '../../helpers/notifications';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { INITIAL_GLOBAL_STATE, INITIAL_SHARED_STATE } from '../../initialState';
import {
  addChatListIds, addNotifyExceptions, addUserStatuses, updateChatFullInfo, updateChats, updateChatsLastMessageId,
  updateUsers,
} from '../../reducers';
import { replaceMessages } from '../../reducers/messages';
import { clearProxyChats, updateProxyFolder } from '../../reducers/proxy';
import { replaceThreadLocalStateParam, updateMainThreadReadStates, updateThreadInfo } from '../../reducers/threads';
import { updateTopicsInfo } from '../../reducers/topics';
import {
  selectChatMessage, selectCurrentMessageList, selectNotifyDefaults, selectNotifyException, selectProxyUnsentMessages,
} from '../../selectors';
import { selectDraft } from '../../selectors/threads';
import { initSharedState } from '../../shared/sharedStateConnector';

let loadGeneration = 0;
let mentionGeneration = 0;

/** Упоминание открывает только доступный чат, в первую очередь — у владельца исходного сообщения */
addActionHandler('openProxyMention', async (global, actions, payload): Promise<void> => {
  const { chatId, userId, username, tabId = getCurrentTabId() } = payload;
  const sessionUserId = getPxgState().session?.user.id;
  const mentionedPeer = userId ? resolveProxyPeer(userId) : undefined;
  const normalizedUsername = username?.replace(/^@/, '').toLowerCase();
  if (!sessionUserId) return;
  if (!mentionedPeer && !normalizedUsername) {
    actions.showNotification({ message: { key: 'PxgChatNotShared' }, tabId });
    return;
  }
  const accountId = (chatId && resolveProxyPeer(chatId)?.accountId) || mentionedPeer?.accountId;
  const generation = ++mentionGeneration;
  try {
    const access = await pxgRpc.call<AccessChat[]>('access.chats');
    if (generation !== mentionGeneration || sessionUserId !== getPxgState().session?.user.id) return;
    const matches = access.filter((chat) => (
      mentionedPeer ? chat.peerId === mentionedPeer.peerId
        : [chat.username, ...chat.info?.usernames || []].some((name) => name?.toLowerCase() === normalizedUsername)
    ));
    const target = matches.find((chat) => chat.accountId === accountId) || matches[0];
    if (!target) {
      actions.showNotification({ message: { key: 'PxgChatNotShared' }, tabId });
      return;
    }
    const chat = buildProxyChat(target);
    global = getGlobal();
    global = updateChats(global, { [chat.id]: chat });
    if (target.peerId > 0) {
      const user = buildProxyUser(target.accountId, target.peerId,
        target.title || target.username || undefined, target.photoId, target.badges);
      user.usernames = chat.usernames;
      user.hasUsername = chat.hasUsername;
      global = updateUsers(global, { [user.id]: user });
    }
    setGlobal(global);
    actions.openChat({ id: chat.id, tabId });
  } catch {
    if (generation === mentionGeneration && sessionUserId === getPxgState().session?.user.id) {
      actions.showNotification({ message: { key: 'PxgErrorNetwork' }, tabId });
    }
  }
});

addActionHandler('initProxyGuest', async (global, actions): Promise<void> => {
  const { session } = getPxgState();
  if (session?.level !== 'guest') return;
  setProxyUpdateHandler(actions.apiUpdate);
  await closeApi(false);
  if (getPxgState().session?.user.id !== session.user.id) return;
  global = getGlobal();
  Object.values(global.byTabId).forEach(({ id: tabId }) => {
    const chatId = selectCurrentMessageList(global, tabId)?.chatId;
    if (chatId && !isProxyPeerId(chatId)) actions.openChat({ id: undefined, tabId });
    actions.closeMediaViewer({ tabId });
  });
  // A guest slot never inherits Telegram data cached by a previous full login
  global = getGlobal();
  global = {
    ...global, chats: INITIAL_GLOBAL_STATE.chats, users: INITIAL_GLOBAL_STATE.users,
    messages: INITIAL_GLOBAL_STATE.messages, chatFolders: INITIAL_GLOBAL_STATE.chatFolders,
    contactList: { ...INITIAL_GLOBAL_STATE.contactList, userIds: [] },
  };
  const accountId = `self:${session.user.id}`;
  const id = getProxyPeerId(accountId, session.user.tgUserId);
  const user = buildProxyUser(accountId, session.user.tgUserId,
    session.user.firstName || session.user.username || undefined);
  user.isSelf = true;
  global = updateUsers(global, { [id]: user });
  global = {
    ...global, currentUserId: id,
    auth: { ...global.auth, state: 'authorizationStateReady', isLoading: false },
    connectionState: 'connectionStateReady', isSynced: true, isSyncing: false,
    config: { ...PROXY_CONFIG },
    reactions: {
      ...global.reactions,
      availableReactions: buildFallbackReactions(),
      // Telegram's reactions come in their own order; these go first, as the usual top reactions of an account
      topReactions: PROXY_REACTION_EMOJIS.map((emoticon) => ({ type: 'emoji' as const, emoticon })),
    },
  };
  setGlobal(global);
  initSharedState(global.sharedState);
  // Telegram's peer colors never reach a guest, so avatar placeholders and names use the built-in palette
  if (!global.peerColors) updatePeerColors({});
  actions.loadProxyChats();
  actions.loadChatFolders();
});

addActionHandler('resetProxyGuest', (global, actions): ActionReturnType => {
  if (!global.currentUserId || !isProxyPeerId(global.currentUserId)) return;
  loadGeneration++;
  global = clearProxyChats({ ...global, currentUserId: undefined });
  global = {
    ...global, auth: { ...global.auth, state: 'authorizationStateWaitPhoneNumber' },
    isSynced: false, isSyncing: false,
  };
  setGlobal(global);
  actions.initApi();
  initSharedState(INITIAL_SHARED_STATE);
});

addActionHandler('loadProxyChats', async (global, actions, payload): Promise<void> => {
  const generation = ++loadGeneration;
  const userId = getPxgState().session?.user.id;
  if (!userId) return;
  try {
    const result = await fetchProxyChats();
    if (!result || generation !== loadGeneration || userId !== getPxgState().session?.user.id) return;
    global = getGlobal();
    const allowedIds = new Set(result.chatIds);
    Object.values(global.byTabId).forEach(({ id: tabId, mediaViewer }) => {
      const chatId = selectCurrentMessageList(global, tabId)?.chatId;
      if (chatId && isProxyPeerId(chatId) && !allowedIds.has(chatId)) actions.openChat({ id: undefined, tabId });
      if (mediaViewer?.chatId && isProxyPeerId(mediaViewer.chatId) && !allowedIds.has(mediaViewer.chatId)) {
        actions.closeMediaViewer({ tabId });
      }
    });
    global = getGlobal();
    const previousChats = global.chats.byId;
    const unsentMessages = selectProxyUnsentMessages(global);
    const keptChatIds = payload?.shouldKeepUnchanged ? new Set(result.chats.filter((chat) => (
      isSameProxyAccess(previousChats[chat.id]?.pxgProxy, chat.pxgProxy)
    )).map((chat) => chat.id)) : undefined;
    global = clearProxyChats(global, keptChatIds);
    global = updateChats(global, buildCollectionByKey([...result.authorChats, ...result.chats], 'id'));
    global = updateUsers(global, buildCollectionByKey(result.users, 'id'));
    global = addUserStatuses(global, result.userStatusesById);
    global = replaceMessages(global, result.messages);
    const archivedIds = new Set(result.archivedChatIds);
    global = addChatListIds(global, 'active', result.chatIds.filter((id) => !archivedIds.has(id)));
    global = addChatListIds(global, 'archived', result.archivedChatIds);
    if (isProxyGuest()) {
      // A guest slot has only shared chats, so the pinned order is entirely the guest's own
      global = {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            active: result.pinnedChatIds.filter((id) => !archivedIds.has(id)),
            archived: result.pinnedChatIds.filter((id) => archivedIds.has(id)),
          },
          // Every access arrives at once: an empty list is final rather than still loading
          isFullyLoaded: { ...global.chats.isFullyLoaded, active: true, archived: true },
        },
      };
    }
    global = updateChatsLastMessageId(global, result.lastMessageByChatId);
    // Mutes of shared chats are stored by the server for every device of the guest
    // Without its own setting a chat follows the defaults for its type
    global = addNotifyExceptions(global, Object.fromEntries(result.chatIds.map((id) => [
      id, result.notifyExceptionById[id] || { mutedUntil: undefined },
    ])));
    result.threadInfos.forEach((info) => {
      global = updateThreadInfo(global, info);
    });
    // An open forum topic needs its thread before the feed arrives: Web A drops listed IDs of an unknown thread,
    // and the topics themselves are loaded later by the forum panel
    Object.values(global.byTabId).forEach(({ id: tabId }) => {
      const list = selectCurrentMessageList(global, tabId);
      const chat = list && global.chats.byId[list.chatId];
      if (!chat?.pxgProxy || !chat.isForum || list!.threadId === MAIN_THREAD_ID) return;
      global = updateThreadInfo(global, { chatId: chat.id, threadId: list!.threadId, isCommentsInfo: false });
    });
    global = updateMainThreadReadStates(global, result.threadReadStatesById);
    // A draft being written here stays until it is saved; otherwise the server's one is the guest's latest
    result.chatIds.forEach((id) => {
      if (selectDraft(global, id, MAIN_THREAD_ID)?.isLocal) return;
      global = replaceThreadLocalStateParam(global, id, MAIN_THREAD_ID, 'draft', result.draftsById[id]);
    });
    // The chat's profile and reaction settings arrive with the accesses and change with them
    Object.entries(result.fullInfoById).forEach(([id, fullInfo]) => {
      global = updateChatFullInfo(global, id, fullInfo);
    });
    global = updateProxyFolder(global);
    setGlobal(global);
    // A reconnect reloads every access: an unsent message stays for its completion or a retry
    unsentMessages.forEach((message) => {
      if (!allowedIds.has(message.chatId) || keptChatIds?.has(message.chatId)) return;
      actions.apiUpdate({ '@type': 'newMessage', id: message.id, chatId: message.chatId, message });
    });
    setPxgState({ sharedCount: result.chats.length });
    // Telegram's reactions and message effects are read through a provider: the first shared chat brings them
    if (isProxyGuest() && result.chats.length) {
      if (!global.reactions.availableReactions?.some((reaction) => reaction.staticIcon)) {
        actions.loadAvailableReactions();
      }
      if (!Object.keys(global.availableEffectById).length) actions.loadAvailableEffects();
    }
    Object.values(global.byTabId).forEach(({ id: tabId }) => {
      const list = selectCurrentMessageList(global, tabId);
      if (list && isProxyPeerId(list.chatId)) {
        actions.loadViewportMessages({ chatId: list.chatId, threadId: list.threadId, tabId });
      }
    });
  } catch {
    // The RPC reconnect event retries without interrupting the Telegram account
  }
});

/** The same permissions and the same grants: what the guest already sees of this chat stays valid */
function isSameProxyAccess(previous: ApiChat['pxgProxy'], next: ApiChat['pxgProxy']) {
  return previous && next && previous.restricted === next.restricted
    && previous.shareIds.join() === next.shareIds.join()
    && JSON.stringify(previous.permissions) === JSON.stringify(next.permissions);
}

addActionHandler('refreshProxyMessage', async (global, actions, {
  accountId, peerId, msgId, kind,
}): Promise<void> => {
  const id = getProxyPeerId(accountId, peerId);
  const chat = global.chats.byId[id];
  if (!chat?.pxgProxy) return;
  const generation = loadGeneration;
  try {
    const result = await callApi('fetchMessage', { chat, messageId: msgId });
    if (generation !== loadGeneration) return;
    global = getGlobal();
    if (!global.chats.byId[id]?.pxgProxy) return;
    const current = selectChatMessage(global, id, msgId);
    if (!result || typeof result === 'string') {
      if (current) emitProxyUpdate({ '@type': 'deleteMessages', chatId: id, ids: [msgId] });
      return;
    }
    // Pinning changes the chat's pinned list even when the message itself is not loaded
    if (kind === 'pin' || (current && Boolean(current.isPinned) !== Boolean(result.message.isPinned))) {
      emitProxyUpdate({
        '@type': 'updatePinnedIds', chatId: id, messageIds: [msgId], isPinned: Boolean(result.message.isPinned),
      });
      global = getGlobal();
    }
    // Unread reactions are the guest's own, so the server decides what is unread, even if the message is not loaded
    if (kind === 'reactions' && result.message.pxgIsOwn) {
      actions.loadUnreadReactions({ chatId: id });
      actions.refreshProxyTopics({ accountId, peerId });
    }
    if (!current && msgId < (global.chats.lastMessageIds.all?.[id] || 0)) return;
    actions.apiUpdate(current ? {
      '@type': 'updateMessage', id: msgId, chatId: id, message: { ...result.message, isDeleting: false }, isFull: true,
    } : { '@type': 'newMessage', id: msgId, chatId: id, message: result.message });
    // As in Telegram, a new incoming message brings an unmuted chat back from the archive
    global = getGlobal();
    const updatedChat = global.chats.byId[id];
    if (!current && !result.message.isOutgoing && updatedChat?.folderId === ARCHIVED_FOLDER_ID
      && !getIsChatMuted(updatedChat, selectNotifyDefaults(global), selectNotifyException(global, id))) {
      void callApi('toggleChatArchived', { chat: updatedChat, folderId: 0 });
    }
  } catch {
    // Reconnect reloads proxy history with a fresh access check
  }
});

/** The person who shared a chat, in the viewer's own Telegram: by a known dialog, otherwise by username */
addActionHandler('openProxyChatOwner', (global, actions, payload): ActionReturnType => {
  const { chatId, tabId = getCurrentTabId() } = payload;
  const proxy = global.chats.byId[chatId]?.pxgProxy;
  if (!proxy) return;
  const { providerUserId, providerUsername, providerName } = proxy;
  const ownerId = providerUserId ? String(providerUserId) : undefined;
  if (ownerId && global.users.byId[ownerId]) {
    actions.openChat({ id: ownerId, tabId });
    return;
  }
  if (providerUsername) {
    actions.openChatByUsername({ username: providerUsername, tabId });
    return;
  }
  actions.showNotification({ message: { key: 'PxgOwnerUnreachable', variables: { name: providerName } }, tabId });
});

/** Someone is typing in a shared chat; Web A clears the status by itself when no new one comes */
addActionHandler('applyProxyTyping', (global, actions, {
  accountId, peerId, topicId, userId, name, action,
}): ActionReturnType => {
  const id = getProxyPeerId(accountId, peerId);
  if (!global.chats.byId[id]?.pxgProxy) return;
  const user = buildProxyUser(accountId, userId, name || undefined);
  if (!global.users.byId[user.id]) emitProxyUpdate({ '@type': 'updateUser', id: user.id, user });
  emitProxyUpdate({
    '@type': 'updateChatTypingStatus',
    id,
    peerId: user.id,
    threadId: topicId,
    typingStatus: action === 'cancel' ? undefined : { type: action, timestamp: getServerTime() },
  });
});

/** Another device of the guest muted, pinned or archived a shared chat */
addActionHandler('applyProxyChatState', (global, actions, state: ChatStateDto): ActionReturnType => {
  const id = getProxyPeerId(state.accountId, state.peerId);
  const chat = global.chats.byId[id];
  if (!chat?.pxgProxy || !isProxyGuest()) return;
  const folderId = state.archivedAt ? ARCHIVED_FOLDER_ID : 0;
  emitProxyUpdate({
    '@type': 'updateChatNotifySettings', chatId: id, settings: { mutedUntil: state.mutedUntil ?? undefined },
  });
  if ((chat.folderId || 0) !== folderId) {
    emitProxyUpdate({ '@type': 'updateChatPinned', id, isPinned: false });
    emitProxyUpdate({ '@type': 'updateChatListType', id, folderId });
  }
  emitProxyUpdate({ '@type': 'updateChatPinned', id, isPinned: Boolean(state.pinnedAt) });
  const sendAsPeerId = state.sendAsPeerId || chat.pxgProxy.providerUserId;
  global = getGlobal();
  return updateChatFullInfo(global, id, {
    sendAsId: sendAsPeerId ? getProxyPeerId(state.accountId, sendAsPeerId) : undefined,
  });
});

/** Another device of the guest read a chat or a topic: the counters come from the server again */
addActionHandler('refreshProxyUnread', async (global, actions, { accountId, peerId, topicId }): Promise<void> => {
  const generation = loadGeneration;
  try {
    const unread = await pxgRpc.call<ChatUnreadDto[]>('chats.unread');
    if (generation !== loadGeneration) return;
    global = getGlobal();
    const readStates = buildProxyReadStates(unread.filter((item) => global.chats.byId[
      getProxyPeerId(item.accountId, item.peerId)
    ]?.pxgProxy));
    global = updateMainThreadReadStates(global, readStates);
    setGlobal(global);
    if (topicId) actions.refreshProxyTopics({ accountId, peerId });
  } catch {
    // The next chat reload brings the counters
  }
});

/** The forum panel and the chat list reload cached topics: closed, renamed and removed topics update in place */
addActionHandler('refreshProxyTopics', (global, actions, { accountId, peerId }): ActionReturnType => {
  const chatId = getProxyPeerId(accountId, peerId);
  if (!global.chats.byId[chatId]?.isForum || !global.chats.topicsInfoById[chatId]) return undefined;
  return updateTopicsInfo(global, chatId, { isCache: true });
});

addActionHandler('refreshProxyHistory', (global, actions, { accountId, peerId }): ActionReturnType => {
  const chatId = getProxyPeerId(accountId, peerId);
  Object.values(global.byTabId).forEach(({ id: tabId }) => {
    const list = selectCurrentMessageList(global, tabId);
    if (list?.chatId === chatId) {
      actions.loadViewportMessages({ chatId, threadId: list.threadId, tabId, direction: LoadMoreDirection.Backwards });
    }
  });
});
