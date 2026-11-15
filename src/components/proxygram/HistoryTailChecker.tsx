import { memo, useEffect, useRef } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { ThreadId } from '../../types';

import { selectCurrentMessageList } from '../../global/selectors';
import { checkThreadTail, requestCatchUp, type TailCheckReason } from '../../proxygram/historyCheck';
import { usePxgState } from '../../proxygram/server/store';

type StateProps = {
  chatId?: string;
  threadId?: ThreadId;
  isTelegramReady: boolean;
};

/** Чат на экране: его хвост сверяется с источником с таким шагом, пока приложение видно */
const PERIODIC_CHECK_MS = 3 * 60_000;
/** Вход в чат: даём Web A сначала показать ленту и дозагрузить своё */
const OPEN_DELAY_MS = 1_500;
/** Возврат в приложение и переподключение: сначала догоняем пропущенное, потом сверяем */
const CATCH_UP_DELAY_MS = 3_000;
/** Короче этого приложение не считается уходившим в фон */
const MIN_HIDDEN_MS = 2_000;

/**
 * Защита от потерянных сообщений (STATUS 2026-11-15): лента открытого чата сверяется с Telegram или сервером при
 * входе в чат, при возврате в приложение, при восстановлении связи и время от времени, пока чат на экране.
 * При возврате в приложение и восстановлении сети заодно запрашивается всё пропущенное (getDifference у своей
 * сессии Telegram, `sync.changes` у сервера).
 */
const HistoryTailChecker = ({ chatId, threadId, isTelegramReady }: StateProps) => {
  const pxgConnection = usePxgState((state) => state.connection);
  const currentRef = useRef<{ chatId?: string; threadId?: ThreadId }>({});
  currentRef.current = { chatId, threadId };

  const checkCurrent = (reason: TailCheckReason) => {
    const { chatId: currentChatId, threadId: currentThreadId } = currentRef.current;
    if (!currentChatId || currentThreadId === undefined) return;
    void checkThreadTail(currentChatId, currentThreadId, reason);
  };

  // Вход в чат
  useEffect(() => {
    if (!chatId || threadId === undefined) return undefined;
    const timer = window.setTimeout(() => checkCurrent('open'), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [chatId, threadId]);

  // Связь вернулась: у своей сессии Telegram или у сервера Proxygram
  const wasTelegramReadyRef = useRef(isTelegramReady);
  const wasServerOnlineRef = useRef(pxgConnection === 'online');
  useEffect(() => {
    const isServerOnline = pxgConnection === 'online';
    const isBack = (isTelegramReady && !wasTelegramReadyRef.current) || (isServerOnline && !wasServerOnlineRef.current);
    wasTelegramReadyRef.current = isTelegramReady;
    wasServerOnlineRef.current = isServerOnline;
    if (!isBack) return undefined;
    const timer = window.setTimeout(() => checkCurrent('reconnect'), CATCH_UP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isTelegramReady, pxgConnection]);

  // Возврат в приложение (телефон из фона, окно из трея) и восстановление сети
  useEffect(() => {
    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : undefined;
    let timer: number | undefined;
    const catchUp = () => {
      requestCatchUp();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => checkCurrent('resume'), CATCH_UP_DELAY_MS);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const wasAway = hiddenAt !== undefined && Date.now() - hiddenAt >= MIN_HIDDEN_MS;
      hiddenAt = undefined;
      if (wasAway) catchUp();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', catchUp);
      window.clearTimeout(timer);
    };
  }, []);

  // Плановая сверка, пока чат на экране
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') checkCurrent('periodic');
    }, PERIODIC_CHECK_MS);
    return () => window.clearInterval(interval);
  }, []);

  return undefined;
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    const list = selectCurrentMessageList(global);
    const isThread = list?.type === 'thread';
    return {
      chatId: isThread ? list.chatId : undefined,
      threadId: isThread ? list.threadId : undefined,
      isTelegramReady: global.connectionState === 'connectionStateReady' && Boolean(global.isSynced),
    };
  },
)(HistoryTailChecker));
