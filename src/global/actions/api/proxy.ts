import type { ChatUnreadDto } from '../../../proxygram/server/types';
import type { ActionReturnType } from '../../types';
import { PROXY_CONFIG, PROXY_REACTION_EMOJIS } from '../../../api/proxy/types';
import { LoadMoreDirection } from '../../../types';

import { buildCollectionByKey } from '../../../util/iteratees';
import { updatePeerColors } from '../../../util/theme';
import { callApi, closeApi } from '../../../api/gramjs';
import { emitProxyUpdate, getProxyPeerId, setProxyUpdateHandler } from '../../../api/proxy';
import { buildProxyUser } from '../../../api/proxy/builders';
import { isProxyPeerId } from '../../../api/proxy/ids';
import { buildProxyReadStates, fetchProxyChats } from '../../../api/proxy/methods';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { getPxgState, setPxgState } from '../../../proxygram/server/store';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { INITIAL_GLOBAL_STATE } from '../../initialState';
import {
  addChatListIds, addNotifyExceptions, updateChats, updateChatsLastMessageId, updateUsers,
} from '../../reducers';
import { replaceMessages } from '../../reducers/messages';
import { clearProxyChats, updateProxyFolder } from '../../reducers/proxy';
import { updateMainThreadReadStates, updateThreadInfo } from '../../reducers/threads';
import { updateTopicsInfo } from '../../reducers/topics';
import { selectChatMessage, selectCurrentMessageList } from '../../selectors';

let loadGeneration = 0;

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
      availableReactions: PROXY_REACTION_EMOJIS.map((emoticon) => ({
        reaction: { type: 'emoji' as const, emoticon }, title: emoticon,
      })),
      topReactions: PROXY_REACTION_EMOJIS.map((emoticon) => ({ type: 'emoji' as const, emoticon })),
    },
  };
  setGlobal(global);
  // Telegram's peer colors never reach a guest, so avatar placeholders and names use the built-in palette
  if (!global.peerColors) updatePeerColors({});
  actions.loadProxyChats();
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
});

addActionHandler('loadProxyChats', async (global, actions): Promise<void> => {
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
    global = clearProxyChats(global);
    global = updateChats(global, buildCollectionByKey(result.chats, 'id'));
    global = updateUsers(global, buildCollectionByKey(result.users, 'id'));
    global = replaceMessages(global, result.messages);
    global = addChatListIds(global, 'active', result.chatIds);
    global = updateChatsLastMessageId(global, result.lastMessageByChatId);
    // Mutes of shared chats are stored by the server for every device of the guest
    global = addNotifyExceptions(global, Object.fromEntries(result.chatIds.map((id) => [
      id, result.notifyExceptionById[id] || { mutedUntil: 0 },
    ])));
    result.threadInfos.forEach((info) => {
      global = updateThreadInfo(global, info);
    });
    global = updateMainThreadReadStates(global, result.threadReadStatesById);
    global = updateProxyFolder(global);
    setGlobal(global);
    setPxgState({ sharedCount: result.chats.length });
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

addActionHandler('clearProxyChats', (global, actions): ActionReturnType => {
  loadGeneration++;
  Object.values(global.byTabId).forEach(({ id: tabId, mediaViewer }) => {
    const chatId = selectCurrentMessageList(global, tabId)?.chatId;
    if (chatId && isProxyPeerId(chatId)) actions.openChat({ id: undefined, tabId });
    if (mediaViewer?.chatId && isProxyPeerId(mediaViewer.chatId)) actions.closeMediaViewer({ tabId });
  });
  global = getGlobal();
  return clearProxyChats(global);
});

addActionHandler('refreshProxyMessage', async (global, actions, { accountId, peerId, msgId }): Promise<void> => {
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
    if (!current && msgId < (global.chats.lastMessageIds.all?.[id] || 0)) return;
    actions.apiUpdate(current ? {
      '@type': 'updateMessage', id: msgId, chatId: id, message: { ...result.message, isDeleting: false }, isFull: true,
    } : { '@type': 'newMessage', id: msgId, chatId: id, message: result.message });
  } catch {
    // Reconnect reloads proxy history with a fresh access check
  }
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
