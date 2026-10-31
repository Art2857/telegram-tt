import { useEffect, useRef, useState } from '../../../lib/teact/teact';

import type { MessageDto } from '../../../proxygram/server/types';

import { pxgRpc } from '../../../proxygram/server/rpc';

const PAGE_SIZE = 50;
/** Событие о конце подгрузки получает только тот, кто её запросил, — остальные перепроверяют сами */
const IMPORT_FALLBACK_MS = 20_000;
/** Подгрузка пишет в архив пачкой — сотня событий archive.change подряд превращается в один запрос */
const REFRESH_DEBOUNCE_MS = 300;

type ImportResult = { imported?: number; complete?: boolean };

/**
 * История чата для гостя: сначала архив сервера, а когда он кончился — подгрузка из Telegram
 * через `messages.loadOlder` (PLAN.md, 5.4). Свежие сообщения, правки и удаления приходят событиями.
 */
export default function useGuestHistory(accountId: string, peerId: number, onError: (error: unknown) => void) {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  // в архиве могут быть сообщения старше загруженных
  const [hasArchiveMore, setHasArchiveMore] = useState(true);
  // в Telegram раньше ничего нет (или не видно по правилам доступа)
  const [isComplete, setIsComplete] = useState(false);
  const messagesRef = useRef<MessageDto[]>([]);
  const importJobRef = useRef<string>();
  const busyRef = useRef(false);

  const merge = (incoming: MessageDto[]) => {
    const byId = new Map(messagesRef.current.map((message) => [message.msgId, message]));
    incoming.forEach((message) => byId.set(message.msgId, message));
    messagesRef.current = [...byId.values()].sort((a, b) => a.msgId - b.msgId);
    setMessages(messagesRef.current);
  };

  const fetchPage = (beforeMsgId?: number) => pxgRpc.call<MessageDto[]>('messages.history', {
    accountId, peerId, beforeMsgId, limit: PAGE_SIZE,
  });

  // одна подгрузка из Telegram за раз; итог — событием outbox.done или по таймеру
  const requestImport = async () => {
    if (importJobRef.current) return;
    const result = await pxgRpc.call<{ status: 'complete' } | { status: 'loading'; id: string }>(
      'messages.loadOlder', { accountId, peerId, beforeMsgId: messagesRef.current[0]?.msgId },
    );
    if (result.status === 'complete') {
      setIsComplete(true);
      return;
    }
    importJobRef.current = result.id;
    setIsImporting(true);
    const jobId = result.id;
    window.setTimeout(() => {
      if (importJobRef.current === jobId) void finishImport({});
    }, IMPORT_FALLBACK_MS);
  };

  const finishImport = async (result: ImportResult) => {
    importJobRef.current = undefined;
    try {
      const page = await fetchPage(messagesRef.current[0]?.msgId);
      merge(page);
      // без события не знаем, дошли ли до начала: спросим сервер ещё раз при следующей прокрутке
      if (result.complete) setIsComplete(true);
      if (page.length === 0 && result.imported === 0) setIsComplete(true);
    } catch (error) {
      onError(error);
    } finally {
      setIsImporting(false);
    }
  };

  const loadOlder = async () => {
    if (busyRef.current || importJobRef.current) return;
    busyRef.current = true;
    setIsLoading(true);
    try {
      if (hasArchiveMore) {
        const page = await fetchPage(messagesRef.current[0]?.msgId);
        merge(page);
        if (page.length === PAGE_SIZE) return;
        setHasArchiveMore(false);
      }
      if (!isComplete) await requestImport();
    } catch (error) {
      onError(error);
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    messagesRef.current = [];
    importJobRef.current = undefined;
    let refreshTimer: number | undefined;

    void (async () => {
      try {
        const page = await fetchPage();
        merge(page);
        if (page.length < PAGE_SIZE) {
          setHasArchiveMore(false);
          // в архиве мало — сразу подтягиваем историю из Telegram, как это сделал бы обычный клиент
          await requestImport();
        }
      } catch (error) {
        onError(error);
      } finally {
        setIsLoading(false);
      }
    })();

    const unsubscribe = pxgRpc.on((event) => {
      if (event.e === 'archive.change' && event.d.accountId === accountId && event.d.peerId === peerId) {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          fetchPage().then(merge).catch(onError);
        }, REFRESH_DEBOUNCE_MS);
      }
      if (event.e === 'outbox.done' && event.d.id === importJobRef.current) {
        void finishImport((event.d.result ?? {}));
      }
    });
    return () => {
      unsubscribe();
      window.clearTimeout(refreshTimer);
    };
    // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
  }, [accountId, peerId]);

  return {
    messages,
    isLoading,
    isImporting,
    canLoadOlder: hasArchiveMore || !isComplete,
    loadOlder,
  };
}
