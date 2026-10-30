import { describe, expect, it } from 'vitest';

import type { ApiChat, ApiMessage } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { INITIAL_GLOBAL_STATE } from '../../global/initialState';
import { selectChatMessage } from '../../global/selectors';
import { keepDeletedMessages } from './keepDeletedMessages';

const PRIVATE_CHAT = '100';
const CHANNEL = '-1000000000777';

function buildMessage(chatId: string, id: number, overrides: Partial<ApiMessage> = {}): ApiMessage {
  return {
    id,
    chatId,
    date: 1_790_000_000,
    isOutgoing: false,
    content: { text: { text: `message ${id}` } },
    ...overrides,
  };
}

function buildGlobal(messages: ApiMessage[]): GlobalState {
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

describe('keepDeletedMessages', () => {
  it('keeps a deleted message in a channel with a deletion mark', () => {
    const global = buildGlobal([buildMessage(CHANNEL, 5)]);
    const result = keepDeletedMessages(global, CHANNEL, [5]);

    expect(result.remainingIds).toEqual([]);
    expect(selectChatMessage(result.global, CHANNEL, 5)?.pxgDeletedAt).toBeGreaterThan(0);
  });

  it('finds the chat of a private-chat deletion that comes without a chat id', () => {
    const global = buildGlobal([buildMessage(PRIVATE_CHAT, 42)]);
    const result = keepDeletedMessages(global, undefined, [42]);

    expect(result.remainingIds).toEqual([]);
    expect(selectChatMessage(result.global, PRIVATE_CHAT, 42)?.pxgDeletedAt).toBeDefined();
  });

  it('lets self-destructing content, auto-delete timers and service messages go away', () => {
    const global = buildGlobal([
      buildMessage(CHANNEL, 1, { ttlPeriod: 86400 }),
      buildMessage(CHANNEL, 2, { content: { ttlSeconds: 10 } }),
      buildMessage(CHANNEL, 3, { content: { action: { mediaType: 'action', type: 'chatJoinedByLink' } } as never }),
      buildMessage(CHANNEL, 4),
    ]);
    const result = keepDeletedMessages(global, CHANNEL, [1, 2, 3, 4]);

    expect(result.remainingIds).toEqual([1, 2, 3]);
    expect(selectChatMessage(result.global, CHANNEL, 4)?.pxgDeletedAt).toBeDefined();
  });

  it('passes through messages it does not know about', () => {
    const result = keepDeletedMessages(buildGlobal([]), CHANNEL, [99]);
    expect(result.remainingIds).toEqual([99]);
  });

  it('does not move the deletion time of an already kept message', () => {
    const global = buildGlobal([buildMessage(CHANNEL, 7, { pxgDeletedAt: 123 })]);
    const result = keepDeletedMessages(global, CHANNEL, [7]);

    expect(result.remainingIds).toEqual([7]);
    expect(selectChatMessage(global, CHANNEL, 7)?.pxgDeletedAt).toBe(123);
  });
});
