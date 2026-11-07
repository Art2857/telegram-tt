import { getActions, getGlobal } from '../global';

import { selectChat } from '../global/selectors';
import { getTranslationFn } from '../util/localization';
import { resolveProxyPeer } from '../api/proxy';
import { describePxgError } from '../components/proxygram/helpers';
import { pxgRpc } from './server/rpc';

/**
 * docs/RELEASE.md, "Access request": a guest who sees a member of a shared group may ask its owner for the private
 * chat with that person. Offered only while that chat is not open to the guest
 */
export function canRequestMemberAccess(chatId: string, memberId: string) {
  const global = getGlobal();
  const chat = selectChat(global, chatId);
  if (!chat?.pxgProxy || chat.pxgProxy.isOwn || memberId === global.currentUserId) return false;
  const member = resolveProxyPeer(memberId);
  return Boolean(member && member.accountId === chat.pxgProxy.accountId && !selectChat(global, memberId)?.pxgProxy);
}

export async function requestMemberAccess(chatId: string, memberId: string) {
  const chat = selectChat(getGlobal(), chatId);
  const member = resolveProxyPeer(memberId);
  if (!chat?.pxgProxy || !member) return;
  const { showNotification } = getActions();
  try {
    await pxgRpc.call('requests.create', {
      accountId: chat.pxgProxy.accountId, userId: member.peerId, originPeerId: chat.pxgProxy.peerId,
    });
    showNotification({ message: { key: 'PxgRequestSent' } });
  } catch (err) {
    showNotification({ message: describePxgError(getTranslationFn(), err) });
  }
}
