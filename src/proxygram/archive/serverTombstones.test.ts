/* eslint-disable no-null/no-null -- DTO сервера описывает пустые поля через null */
import { describe, expect, it } from 'vitest';

import type { GlobalState } from '../../global/types';
import type { MessageDto } from '../server/types';
import { MAIN_THREAD_ID } from '../../api/types';

import { safeReplaceViewportIds, updateListedIds } from '../../global/reducers';
import { selectChatMessage, selectListedIds, selectViewportIds } from '../../global/selectors';
import { insertTombstones, tombstoneToApiMessage } from './serverTombstones';
import {
  buildGlobal, buildMessage, PRIVATE_CHAT, TEST_TAB_ID,
} from './testGlobal';

function tombstone(msgId: number, overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    accountId: 'acc',
    peerId: Number(PRIVATE_CHAT),
    msgId,
    topicId: null,
    senderId: 100,
    date: '2026-10-31T10:00:00.000Z',
    editDate: null,
    text: `удалённое ${msgId}`,
    entities: [],
    media: null,
    replyTo: null,
    fwdFrom: null,
    reactions: null,
    groupedId: null,
    isOutgoing: false,
    isPost: false,
    isService: false,
    ttlExpiresAt: null,
    version: 1,
    changeSeq: '1',
    deleted: { at: '2026-10-31T11:00:00.000Z', reason: 'external' },
    sentByUserId: null,
    ...overrides,
  };
}

/** Удалённые сообщения сервера в виде сообщений Web A */
function deleted(...ids: number[]) {
  return ids.map((id) => tombstoneToApiMessage(tombstone(id), PRIVATE_CHAT));
}

/** Лента чата: загружены и видны сообщения 10, 12, 14 */
function globalWithViewport(): GlobalState {
  let global = buildGlobal([10, 12, 14].map((id) => buildMessage(PRIVATE_CHAT, id)));
  global = updateListedIds(global, PRIVATE_CHAT, MAIN_THREAD_ID, [10, 12, 14]);
  return safeReplaceViewportIds(global, PRIVATE_CHAT, MAIN_THREAD_ID, [10, 12, 14], TEST_TAB_ID);
}

describe('надгробия из серверного архива', () => {
  it('удалённое встаёт между видимыми сообщениями с пометкой и временем удаления', () => {
    const global = insertTombstones(
      globalWithViewport(), PRIVATE_CHAT, deleted(11, 13), {}, TEST_TAB_ID,
    );

    expect(selectViewportIds(global, PRIVATE_CHAT, MAIN_THREAD_ID, TEST_TAB_ID)).toEqual([10, 11, 12, 13, 14]);
    expect(selectListedIds(global, PRIVATE_CHAT, MAIN_THREAD_ID)).toEqual([10, 11, 12, 13, 14]);
    expect(selectChatMessage(global, PRIVATE_CHAT, 11)).toMatchObject({
      content: { text: { text: 'удалённое 11' } },
      pxgDeletedAt: Date.parse('2026-10-31T11:00:00.000Z') / 1000,
    });
  });

  it('за пределами окна — только в загруженных; после последнего — если окно дошло до конца чата', () => {
    const outside = insertTombstones(
      globalWithViewport(), PRIVATE_CHAT, deleted(5, 20), {}, TEST_TAB_ID,
    );
    expect(selectViewportIds(outside, PRIVATE_CHAT, MAIN_THREAD_ID, TEST_TAB_ID)).toEqual([10, 12, 14]);
    expect(selectListedIds(outside, PRIVATE_CHAT, MAIN_THREAD_ID)).toEqual([5, 10, 12, 14, 20]);

    const atEnd = insertTombstones(
      globalWithViewport(), PRIVATE_CHAT, deleted(20), { isAtEnd: true }, TEST_TAB_ID,
    );
    expect(selectViewportIds(atEnd, PRIVATE_CHAT, MAIN_THREAD_ID, TEST_TAB_ID)).toEqual([10, 12, 14, 20]);
  });

  it('уже известное сообщение не подменяется', () => {
    const global = globalWithViewport();
    expect(insertTombstones(global, PRIVATE_CHAT, deleted(12), {}, TEST_TAB_ID)).toBe(global);
  });

  it('вложение без объекта Web A — значок типа перед текстом', () => {
    const message = tombstoneToApiMessage(
      tombstone(30, { text: 'смотри', media: { kind: 'photo', key: 'photo:1' } }), PRIVATE_CHAT,
    );
    expect(message.content.text?.text).toBe('смотри');
    expect(message.content.photo?.id).toBe(`pxga_acc_${PRIVATE_CHAT}_30`);
  });
});
