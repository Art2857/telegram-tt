import { getActions, getGlobal } from '../global';

import { isChatGroup } from '../global/helpers';
import { selectChat, selectUser } from '../global/selectors';
import { getTranslationFn } from '../util/localization';
import { resolveProxyPeer } from '../api/proxy';
import { describePxgError } from '../components/proxygram/helpers';
import { pxgRpc } from './server/rpc';
import { getPxgState, setPxgState } from './server/store';

/** Открывает известного автора поверх группы, сохраняя место в переписке */
export function openProxyMemberProfile(chatId: string, memberId: string, isMember?: boolean) {
  if (!getPxgState().session || !canRequestMemberAccess(chatId, memberId)) return false;
  setPxgState({ memberProfile: { chatId, memberId, isMember } });
  return true;
}

/**
 * docs/RELEASE.md, "Access request": a guest who sees a member of a shared group may ask its owner for the private
 * chat with that person. Offered only while that chat is not open to the guest
 */
export function canRequestMemberAccess(chatId: string, memberId: string) {
  const global = getGlobal();
  const chat = selectChat(global, chatId);
  if (!chat?.pxgProxy || chat.pxgProxy.isOwn || !isChatGroup(chat) || memberId === global.currentUserId
    || !selectUser(global, memberId)) return false;
  const member = resolveProxyPeer(memberId);
  return Boolean(member && member.peerId > 0 && member.accountId === chat.pxgProxy.accountId
    && !selectChat(global, memberId)?.pxgProxy);
}

export async function requestMemberAccess(chatId: string, memberId: string) {
  if (!canRequestMemberAccess(chatId, memberId)) return false;
  const chat = selectChat(getGlobal(), chatId);
  const member = resolveProxyPeer(memberId);
  if (!chat?.pxgProxy || !member) return false;
  const { showNotification } = getActions();
  try {
    await pxgRpc.call('requests.create', {
      accountId: chat.pxgProxy.accountId, userId: member.peerId, originPeerId: chat.pxgProxy.peerId,
    });
    showNotification({ message: { key: 'PxgRequestSent' } });
    return true;
  } catch (err) {
    showNotification({ message: describePxgError(getTranslationFn(), err) });
    return false;
  }
}
