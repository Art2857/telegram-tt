import type { TeactNode } from '../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../global';

import type { ApiPeer } from '../../../api/types';
import { ApiMessageEntityTypes } from '../../../api/types';

import { selectChat, selectUser } from '../../../global/selectors';
import { isProxyGuest } from '../../../api/proxy';
import { isProxyPeerId } from '../../../api/proxy/ids';

import useAppLayout from '../../../hooks/useAppLayout';

type OwnProps = {
  userId?: string;
  username?: string;
  chatId?: string;
  children: TeactNode;
};

type StateProps = {
  userOrChat?: ApiPeer;
  isProxy?: boolean;
};

const MentionLink = ({
  userId,
  username,
  chatId,
  userOrChat,
  isProxy,
  children,
}: OwnProps & StateProps) => {
  const {
    openChat,
    openChatByUsername,
    openProxyMention,
    closeStoryViewer,
    setShouldCloseRightColumn,
  } = getActions();

  const { isMobile } = useAppLayout();

  const handleClick = () => {
    if (isMobile) {
      setShouldCloseRightColumn({
        value: true,
      });
    }

    if (isProxy) {
      closeStoryViewer();
      openProxyMention({ chatId, userId, username });
    } else if (userOrChat) {
      openChat({ id: userOrChat.id });
    } else if (username) {
      closeStoryViewer();
      openChatByUsername({ username: username.substring(1) });
    }
  };

  return (
    <a
      onClick={handleClick}
      className="text-entity-link"
      dir="auto"
      data-entity-type={userId ? ApiMessageEntityTypes.MentionName : ApiMessageEntityTypes.Mention}
    >
      {children}
    </a>
  );
};

export default withGlobal<OwnProps>(
  (global, { userId, chatId }): Complete<StateProps> => {
    return {
      userOrChat: userId ? selectUser(global, userId) : undefined,
      isProxy: isProxyGuest() || Boolean((chatId && selectChat(global, chatId)?.pxgProxy) || isProxyPeerId(userId)),
    };
  },
)(MentionLink);
