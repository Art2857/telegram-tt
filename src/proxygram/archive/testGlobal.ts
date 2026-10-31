import type { ApiChat, ApiMessage } from '../../api/types';
import type { GlobalState } from '../../global/types';
import type { Thread } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';

import { INITIAL_GLOBAL_STATE, INITIAL_TAB_STATE } from '../../global/initialState';

/** Вкладка, от имени которой тесты читают и пишут состояние ленты */
export const TEST_TAB_ID = 1;

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
    // основной поток есть у любого открытого чата — без него Web A не меняет списки сообщений
    byChatId[message.chatId] ??= {
      byId: {},
      threadsById: { [MAIN_THREAD_ID]: { localState: {} } as Thread },
    } as unknown as GlobalState['messages']['byChatId'][string];
    byChatId[message.chatId].byId[message.id] = message;
  });

  return {
    ...INITIAL_GLOBAL_STATE,
    chats: { ...INITIAL_GLOBAL_STATE.chats, byId: chats },
    messages: { ...INITIAL_GLOBAL_STATE.messages, byChatId },
    byTabId: { [TEST_TAB_ID]: { ...INITIAL_TAB_STATE, id: TEST_TAB_ID } },
  };
}
