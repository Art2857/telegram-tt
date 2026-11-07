import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../../global/types';
import type { HiddenMessageDto } from '../server/types';

import { updateChatMessage } from '../../global/reducers';
import { selectChatMessages } from '../../global/selectors';

/**
 * The owner's marks of messages hidden from guests ("Hide from guests"). `entries` are all marks known for the chat:
 * a loaded message without one is visible to guests
 */
export function applyHiddenMarks<T extends GlobalState>(
  global: T, chatId: string, entries: ReadonlyMap<number, HiddenMessageDto>,
): T {
  const byId = selectChatMessages(global, chatId);
  if (!byId) return global;
  Object.values(byId).forEach((message) => {
    const entry = entries.get(message.id);
    const mark = entry && (entry.all || entry.users.length)
      ? { isAll: entry.all || undefined, names: entry.users.map(({ name }) => name) } : undefined;
    if (isSameMark(message.pxgHiddenFrom, mark)) return;
    global = updateChatMessage(global, chatId, message.id, { pxgHiddenFrom: mark });
  });
  return global;
}

function isSameMark(a: ApiMessage['pxgHiddenFrom'], b: ApiMessage['pxgHiddenFrom']) {
  if (!a || !b) return a === b;
  return a.isAll === b.isAll && a.names.join('\n') === b.names.join('\n');
}
