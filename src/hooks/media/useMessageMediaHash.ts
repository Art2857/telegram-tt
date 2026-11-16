import type { MediaContainer, SizeTarget } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { getMessageMediaHash } from '../../global/helpers/messageMedia';
import { selectIsChatProtected } from '../../global/selectors/messages';
import useSelector from '../data/useSelector';

function selectWebPagesById(global: GlobalState) {
  return global.messages.webPageById;
}

export default function useMessageMediaHash(message: MediaContainer | undefined, target: SizeTarget) {
  const webPagesById = useSelector(selectWebPagesById);
  const isProtected = useSelector((global) => (
    message?.chatId ? selectIsChatProtected(global, message.chatId) : false
  ));
  if (!message) return undefined;

  const webPageId = message.content.webPage?.id;
  const webPage = webPageId ? webPagesById[webPageId] : undefined;

  return getMessageMediaHash(message, { webPage }, target, isProtected);
}
