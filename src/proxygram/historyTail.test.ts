import { describe, expect, it } from 'vitest';

import type { GlobalState } from '../global/types';
import { MAIN_THREAD_ID } from '../api/types';

import { replaceTabThreadParam, replaceThreadLocalStateParam } from '../global/reducers/threads';
import {
  selectChatLastMessageId, selectChatMessage, selectListedIds, selectViewportIds,
} from '../global/selectors';
import {
  buildGlobal, buildMessage, PRIVATE_CHAT, TEST_TAB_ID,
} from './archive/testGlobal';
import { applyTailMessages, planTailMerge } from './historyTail';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('planTailMerge', () => {
  it('ничего не потеряно — сверка ничего не меняет', () => {
    expect(planTailMerge(range(1, 50), range(21, 50), false)).toEqual({ kind: 'ok' });
  });

  it('новые сообщения после конца ленты стыкуются с ней', () => {
    // случай владельца: лента кончалась на 42, у Telegram уже 43–50
    expect(planTailMerge(range(1, 42), range(21, 50), false)).toEqual({ kind: 'merge', missingIds: range(43, 50) });
  });

  it('потерянное посреди ленты тоже находится', () => {
    const listed = range(1, 50).filter((id) => id !== 30 && id !== 31);
    expect(planTailMerge(listed, range(21, 50), false)).toEqual({ kind: 'merge', missingIds: [30, 31] });
  });

  it('разрыв больше страницы — лента не стыкуется, нужны страницы постарше', () => {
    expect(planTailMerge(range(1, 10), range(100, 129), false))
      .toEqual({ kind: 'detached', missingIds: range(100, 129) });
  });

  it('у источника меньше страницы — это вся история, стыковать не с чем', () => {
    expect(planTailMerge([], [1, 2, 3], true)).toEqual({ kind: 'merge', missingIds: [1, 2, 3] });
  });

  it('отправляемые сообщения с временными номерами не считаются расхождением', () => {
    expect(planTailMerge([...range(1, 50), 50.0001], range(21, 50), false)).toEqual({ kind: 'ok' });
  });

  it('удалённое у источника не удаляется из ленты: сверка только добавляет', () => {
    // 45 нет у источника — антиудаление держит его в ленте
    expect(planTailMerge(range(1, 50), range(21, 50).filter((id) => id !== 45), false)).toEqual({ kind: 'ok' });
  });
});

function withList(global: GlobalState, listed: number[], viewport: number[]) {
  global = replaceThreadLocalStateParam(global, PRIVATE_CHAT, MAIN_THREAD_ID, 'listedIds', listed);
  return replaceTabThreadParam(global, PRIVATE_CHAT, MAIN_THREAD_ID, 'viewportIds', viewport, TEST_TAB_ID);
}

describe('applyTailMessages', () => {
  it('вставляет потерянное в ленту, в окно, стоящее в конце, и в последнее сообщение чата', () => {
    let global = withList(buildGlobal(range(1, 42).map((id) => buildMessage(PRIVATE_CHAT, id))), range(1, 42),
      range(20, 42));
    const server = range(21, 50).map((id) => buildMessage(PRIVATE_CHAT, id, { content: { text: { text: `s${id}` } } }));
    global = applyTailMessages(global, PRIVATE_CHAT, MAIN_THREAD_ID, server, range(43, 50), [TEST_TAB_ID]);

    expect(selectListedIds(global, PRIVATE_CHAT, MAIN_THREAD_ID)).toEqual(range(1, 50));
    expect(selectViewportIds(global, PRIVATE_CHAT, MAIN_THREAD_ID, TEST_TAB_ID)).toEqual(range(20, 50));
    expect(selectChatMessage(global, PRIVATE_CHAT, 50)?.content.text?.text).toBe('s50');
    // то, что уже было, не перезаписывается
    expect(selectChatMessage(global, PRIVATE_CHAT, 30)?.content.text?.text).toBe('message 30');
    expect(selectChatLastMessageId(global, PRIVATE_CHAT)).toBe(50);
  });

  it('окно, прокрученное вверх, не прыгает: новое попадает только в ленту', () => {
    let global = withList(buildGlobal(range(1, 42).map((id) => buildMessage(PRIVATE_CHAT, id))), range(1, 42),
      range(1, 20));
    const server = range(21, 50).map((id) => buildMessage(PRIVATE_CHAT, id));
    global = applyTailMessages(global, PRIVATE_CHAT, MAIN_THREAD_ID, server, range(43, 50), [TEST_TAB_ID]);

    expect(selectListedIds(global, PRIVATE_CHAT, MAIN_THREAD_ID)).toEqual(range(1, 50));
    expect(selectViewportIds(global, PRIVATE_CHAT, MAIN_THREAD_ID, TEST_TAB_ID)).toEqual(range(1, 20));
  });

  it('слишком большой разрыв — лента начинается заново с последних сообщений', () => {
    let global = withList(buildGlobal(range(1, 10).map((id) => buildMessage(PRIVATE_CHAT, id))), range(1, 10),
      range(1, 10));
    const server = range(500, 529).map((id) => buildMessage(PRIVATE_CHAT, id));
    global = applyTailMessages(global, PRIVATE_CHAT, MAIN_THREAD_ID, server, range(500, 529), [TEST_TAB_ID], true);

    expect(selectListedIds(global, PRIVATE_CHAT, MAIN_THREAD_ID)).toEqual(range(500, 529));
    expect(selectViewportIds(global, PRIVATE_CHAT, MAIN_THREAD_ID, TEST_TAB_ID)).toEqual(range(500, 529));
    expect(selectChatLastMessageId(global, PRIVATE_CHAT)).toBe(529);
  });
});
