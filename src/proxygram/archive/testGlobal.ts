import type { ApiChat, ApiMessage } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { INITIAL_GLOBAL_STATE } from '../../global/initialState';

// Минимальное глобальное состояние для тестов модулей архива

export const PRIVATE_CHAT = '100';
export const CHANNEL = '-1000000000777';

export function buildMessage(chatId: string, id: number, overrides: Partial<ApiMessage> = {}): ApiMessage {
  return {
    id,
    chatId,
    date: 1_790_000_000,
    isOutgoing: false,
    content: { text: { text: `message ${id}` } },
    ...overrides,
  };
}

export function buildGlobal(messages: ApiMessage[]): GlobalState {
  const chats: Record<string, ApiChat> = {
    [PRIVATE_CHAT]: { id: PRIVATE_CHAT, type: 'chatTypePrivate', title: 'Friend' },
    [CHANNEL]: { id: CHANNEL, type: 'chatTypeSuperGroup', title: 'Group' },
  };
  const byChatId: GlobalState['messages']['byChatId'] = {};
  messages.forEach((message) => {
    byChatId[message.chatId] ??= { byId: {}, threadsById: {} } as GlobalState['messages']['byChatId'][string];
    byChatId[message.chatId].byId[message.id] = message;
  });

  return {
    ...INITIAL_GLOBAL_STATE,
    chats: { ...INITIAL_GLOBAL_STATE.chats, byId: chats },
    messages: { ...INITIAL_GLOBAL_STATE.messages, byChatId },
  };
}
