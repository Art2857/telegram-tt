import type { ApiMessage, PxgEditVersion } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { updateChatMessage } from '../../global/reducers';
import { getServerTime } from '../../util/serverTime';
import { isProxyPeerId } from '../../api/proxy/ids';

/**
 * История правок на устройстве (L1, PLAN.md 9). Перед применением правки прежний текст
 * сохраняется в `pxgEditHistory`. Правки, сделанные пока клиент был закрыт, приходят сразу
 * финальной версией — их промежуточные варианты на устройстве не восстановить (это задача L2).
 */
export function recordEditVersion<T extends GlobalState>(
  global: T, chatId: string, id: number, current: ApiMessage, incoming: Partial<ApiMessage>,
): T {
  // Proxy history is authorized by the server, including access to previous versions
  if (isProxyPeerId(chatId)) return global;
  const previousText = current.content.text;
  const nextText = incoming.content?.text;
  if (!incoming.content || previousText?.text === nextText?.text) return global;

  const version: PxgEditVersion = {
    text: previousText,
    date: current.editDate ?? current.date,
    capturedAt: getServerTime(),
  };

  return updateChatMessage(global, chatId, id, {
    pxgEditHistory: [...(current.pxgEditHistory ?? []), version],
  });
}

export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };

/** Пословное сравнение двух версий для подсветки: добавленное и удалённое */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  // Таблица длин общей подпоследовательности (тексты сообщений короткие — квадрат допустим)
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('removed', a[i++]);
    } else {
      push('added', b[j++]);
    }
  }
  while (i < a.length) push('removed', a[i++]);
  while (j < b.length) push('added', b[j++]);
  return parts;
}

/** Слова вместе с пробелами после них: так склейка частей даёт исходный текст */
function tokenize(text: string) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}
