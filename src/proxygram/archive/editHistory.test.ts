import { describe, expect, it } from 'vitest';

import { selectChatMessage } from '../../global/selectors';
import { diffWords, recordEditVersion } from './editHistory';
import { buildGlobal, buildMessage, CHANNEL } from './testGlobal';

describe('recordEditVersion', () => {
  it('saves the previous text before an edit, oldest first', () => {
    let global = buildGlobal([buildMessage(CHANNEL, 1, { content: { text: { text: 'v1' } }, date: 100 })]);

    global = recordEditVersion(
      global, CHANNEL, 1, selectChatMessage(global, CHANNEL, 1)!, { content: { text: { text: 'v2' } } },
    );
    const afterFirst = selectChatMessage(global, CHANNEL, 1)!;
    global = recordEditVersion(
      global, CHANNEL, 1, { ...afterFirst, content: { text: { text: 'v2' } }, editDate: 200 },
      { content: { text: { text: 'v3' } } },
    );

    const history = selectChatMessage(global, CHANNEL, 1)?.pxgEditHistory;
    expect(history?.map((version) => [version.text?.text, version.date])).toEqual([['v1', 100], ['v2', 200]]);
  });

  it('ignores updates that do not change the text (reactions, link previews)', () => {
    const global = buildGlobal([buildMessage(CHANNEL, 1)]);
    const current = selectChatMessage(global, CHANNEL, 1)!;

    expect(recordEditVersion(global, CHANNEL, 1, current, { content: { text: current.content.text } })).toBe(global);
    expect(recordEditVersion(global, CHANNEL, 1, current, { reactions: undefined })).toBe(global);
  });
});

describe('diffWords', () => {
  it('marks added and removed words and keeps the text intact', () => {
    const parts = diffWords('Встречаемся в 18:00 у входа', 'Встречаемся в 19:00 у метро');

    expect(parts.filter((part) => part.type !== 'added').map((part) => part.text).join(''))
      .toBe('Встречаемся в 18:00 у входа');
    expect(parts.filter((part) => part.type !== 'removed').map((part) => part.text).join(''))
      .toBe('Встречаемся в 19:00 у метро');
    expect(parts.filter((part) => part.type === 'removed').map((part) => part.text.trim())).toEqual(['18:00', 'входа']);
    expect(parts.filter((part) => part.type === 'added').map((part) => part.text.trim())).toEqual(['19:00', 'метро']);
  });

  it('handles empty versions', () => {
    expect(diffWords('', 'новый текст')).toEqual([{ type: 'added', text: 'новый текст' }]);
    expect(diffWords('старый', '')).toEqual([{ type: 'removed', text: 'старый' }]);
  });
});
