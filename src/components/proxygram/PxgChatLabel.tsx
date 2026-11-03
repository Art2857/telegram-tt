import { memo } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ApiChat } from '../../api/types';

import buildClassName from '../../util/buildClassName';
import { isProxyGuest } from '../../api/proxy';
import { setPxgState, usePxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

type OwnProps = {
  chatId: string;
  proxy?: ApiChat['pxgProxy'];
};

/**
 * A full login has its own chats and shared ones in one list, so each says who it is shared with.
 * «from» leads to the person who shared the chat, «for» opens the access of a chat the viewer shared.
 * A guest has only shared chats and no Telegram of their own to go anywhere from, so all they see is the label
 * the owner gave this access (PLAN.md 7.5).
 */
const PxgChatLabel = ({ chatId, proxy }: OwnProps) => {
  const { openProxyChatOwner } = getActions();
  const lang = useLang();
  const grantees = usePxgState((state) => state.sharedChats?.[chatId]);

  // The chat row opens the chat on mouse down, before the click arrives
  const handleMouseDown = useLastCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
  });

  const handleOwnerClick = useLastCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    openProxyChatOwner({ chatId });
  });

  const handleGranteesClick = useLastCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setPxgState({ shareChatId: chatId });
  });

  if (isProxyGuest()) return proxy?.label ? <span className="pxg-via">{proxy.label}</span> : undefined;

  if (proxy?.providerName) {
    return (
      <span
        className="pxg-via"
        role="button"
        tabIndex={0}
        title={lang('PxgFromOwnerHint', { name: proxy.providerName })}
        onMouseDown={handleMouseDown}
        onClick={handleOwnerClick}
      >
        {[lang('PxgFromOwner', { name: proxy.providerName }), proxy.label].filter(Boolean).join(' · ')}
      </span>
    );
  }

  if (!grantees?.length) return undefined;

  return (
    <span
      className={buildClassName('pxg-via', 'pxg-shared')}
      role="button"
      tabIndex={0}
      title={lang('PxgSharedForHint', { names: grantees.join(', ') })}
      onMouseDown={handleMouseDown}
      onClick={handleGranteesClick}
    >
      {grantees.length > 1
        ? lang('PxgSharedForMany', { name: grantees[0], count: grantees.length - 1 })
        : lang('PxgSharedFor', { name: grantees[0] })}
    </span>
  );
};

export default memo(PxgChatLabel);
