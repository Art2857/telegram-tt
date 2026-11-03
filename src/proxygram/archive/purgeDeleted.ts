import { getGlobal, setGlobal } from '../../global';

import type { ApiMessage } from '../../api/types';

import { deleteChatMessages } from '../../global/reducers';
import { getOwnAccountId } from '../server/ownAccount';
import { pxgRpc } from '../server/rpc';
import { removeFromLocalArchive } from './localArchive';

/** The server's archive first: if it refuses, the message stays where it is */
export async function purgeDeletedMessage({ chatId, id }: ApiMessage) {
  const accountId = getOwnAccountId();
  if (accountId) await pxgRpc.call('archive.purge', { accountId, peerId: Number(chatId), msgIds: [id] });

  const ownerId = getGlobal().currentUserId;
  if (ownerId) await removeFromLocalArchive(ownerId, chatId, [id]);

  const global = deleteChatMessages(getGlobal(), chatId, [id]);
  setGlobal(global);
}
