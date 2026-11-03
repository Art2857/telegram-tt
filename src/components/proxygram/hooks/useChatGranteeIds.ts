import { useEffect, useState } from '../../../lib/teact/teact';

import { isProxyPeerId } from '../../../api/proxy/ids';
import { getOwnAccountId } from '../../../proxygram/server/ownAccount';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { usePxgState } from '../../../proxygram/server/store';

import useLastCallback from '../../../hooks/useLastCallback';

type ChatShare = {
  folderId: number | null;
  excludePeerIds: number[];
  grantee: { tgUserId: number };
};

/** PLAN.md 14: who among the members of the owner's group also has access to it through the server */
export default function useChatGranteeIds(chatId?: string) {
  const accountId = usePxgState(() => getOwnAccountId());
  const connection = usePxgState((state) => state.connection);
  const [ids, setIds] = useState<Set<string>>();
  const peerId = Number(chatId);
  const isAvailable = Boolean(chatId && accountId && peerId < 0) && connection === 'online' && !isProxyPeerId(chatId!);

  const load = useLastCallback(() => {
    if (!isAvailable) return;
    pxgRpc.call<ChatShare[]>('shares.forChat', { accountId, peerId })
      .then((shares) => setIds(new Set(shares
        .filter((share) => !share.excludePeerIds.includes(peerId))
        .map((share) => String(share.grantee.tgUserId)))))
      .catch(() => undefined);
  });

  useEffect(() => {
    setIds(undefined);
    load();
  }, [isAvailable, chatId, load]);

  useEffect(() => pxgRpc.on((event) => {
    if (event.e === 'shares.changed' || event.e === 'access.changed') load();
  }), [load]);

  return ids;
}
