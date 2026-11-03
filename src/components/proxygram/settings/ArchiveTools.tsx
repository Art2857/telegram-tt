import { memo, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { ArchiveSearchResult } from '../../../proxygram/server/types';

import { PXG_SERVER_URL } from '../../../proxygram/server/http';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError, formatDateTime } from '../helpers';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import InputText from '../../ui/InputText';

import styles from '../admin/AdminPanel.module.scss';

type OwnProps = {
  accountId: string;
};

type ChatFilter = {
  peerId: number;
  title: string;
};

const SEARCH_PAGE = 30;
const SNIPPET_LENGTH = 200;

/** Phase 6: the owner searches the whole archive, deleted messages too, and downloads it as a file */
const ArchiveTools = ({ accountId }: OwnProps) => {
  const { focusMessage, openChat } = getActions();
  const lang = useLang();
  const canOpenChats = usePxgState((state) => state.session?.level === 'client');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [result, setResult] = useState<ArchiveSearchResult>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [withFiles, setWithFiles] = useState(false);
  const [chat, setChat] = useState<ChatFilter>();

  const load = useLastCallback(async (searched: string, offset: number, peerId = chat?.peerId) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const page = await pxgRpc.call<ArchiveSearchResult>('archive.search', {
        accountId, query: searched, peerId, limit: SEARCH_PAGE, offset,
      });
      setResult((current) => (
        offset && current ? { ...page, messages: [...current.messages, ...page.messages] } : page
      ));
    } catch (err) {
      setError(describePxgError(lang, err));
    }
    setIsLoading(false);
  });

  const handleSubmit = useLastCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSubmittedQuery(trimmed);
    void load(trimmed, 0);
  });

  const handleChatFilter = useLastCallback((filter?: ChatFilter) => {
    setChat(filter);
    void load(submittedQuery, 0, filter?.peerId);
  });

  const handleOpen = useLastCallback((peerId: number, msgId: number) => {
    const chatId = String(peerId);
    setPxgState({ isSettingsOpen: false });
    openChat({ id: chatId });
    focusMessage({ chatId, messageId: msgId });
  });

  const handleExport = useLastCallback(async () => {
    setError(undefined);
    try {
      const { url } = await pxgRpc.call<{ url: string }>('archive.exportUrl', {
        accountId, peerId: chat?.peerId, withFiles,
      });
      const link = document.createElement('a');
      link.href = `${PXG_SERVER_URL}${url}`;
      link.download = '';
      link.click();
    } catch (err) {
      setError(describePxgError(lang, err));
    }
  });

  return (
    <>
      <div className={styles.form}>
        <h3 className={styles.name}>{lang('PxgArchiveSearch')}</h3>
        <form onSubmit={handleSubmit}>
          <InputText
            label={lang('PxgArchiveSearchLabel')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" disabled={isLoading || !query.trim()}>
            {lang('PxgArchiveSearchRun')}
          </Button>
        </form>
        {chat && (
          <div className={styles.formButtons}>
            <span className={styles.secondary}>{lang('PxgArchiveOnlyChat', { title: chat.title })}</span>
            <Button size="tiny" isText fluid={false} onClick={() => handleChatFilter(undefined)}>
              {lang('PxgArchiveAllChats')}
            </Button>
          </div>
        )}
        {error && <p className={styles.empty}>{error}</p>}
        {result && <p className={styles.secondary}>{lang('PxgArchiveFound', { count: result.count })}</p>}
      </div>
      {Boolean(result?.messages.length) && (
        <table className={styles.table}>
          <tbody>
            {result.messages.map((row) => (
              <tr key={`${row.peerId}:${row.msgId}`}>
                <td>
                  <div className={styles.name}>{row.peerTitle || row.peerId}</div>
                  <div className={styles.secondary}>{formatDateTime(row.date)}</div>
                </td>
                <td>
                  {row.text.slice(0, SNIPPET_LENGTH) || `[${row.mediaKind ?? '…'}]`}
                  {(row.deletedAt || row.version > 1) && (
                    <div className={styles.secondary}>
                      {row.deletedAt && lang('PxgArchiveDeleted', { date: formatDateTime(row.deletedAt) })}
                      {row.deletedAt && row.version > 1 && ' · '}
                      {row.version > 1 && lang('PxgArchiveEdited')}
                    </div>
                  )}
                </td>
                <td className={styles.actions}>
                  {!chat && (
                    <Button
                      size="tiny"
                      isText
                      onClick={() => handleChatFilter({
                        peerId: row.peerId,
                        title: row.peerTitle || String(row.peerId),
                      })}
                    >
                      {lang('PxgArchiveThisChat')}
                    </Button>
                  )}
                  {canOpenChats && (
                    <Button size="tiny" isText onClick={() => handleOpen(row.peerId, row.msgId)}>
                      {lang('PxgArchiveOpen')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && result.messages.length < result.count && (
        <Button
          size="smaller"
          isText
          disabled={isLoading}
          onClick={() => void load(submittedQuery, result.messages.length)}
        >
          {lang('PxgArchiveMore')}
        </Button>
      )}

      <div className={styles.form}>
        <h3 className={styles.name}>{lang('PxgArchiveExport')}</h3>
        <p className={styles.secondary}>
          {chat ? lang('PxgArchiveExportChatHint', { title: chat.title }) : lang('PxgArchiveExportHint')}
        </p>
        <Checkbox label={lang('PxgArchiveExportFiles')} checked={withFiles} onCheck={setWithFiles} />
        <Button onClick={() => void handleExport()}>{lang('PxgArchiveExportRun')}</Button>
      </div>
    </>
  );
};

export default memo(ArchiveTools);
