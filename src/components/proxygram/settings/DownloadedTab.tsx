import { memo, useRef, useState } from '../../../lib/teact/teact';

import type { TabProps } from './settingsTypes';

import { parsePxgChatFile, releaseDownloadedChat } from '../../../proxygram/downloadedChat';
import { getPxgState, setPxgState } from '../../../proxygram/server/store';

import Button from '../../ui/Button';

import styles from '../admin/AdminPanel.module.scss';

export const DownloadedTab = memo(({ lang, t }: TabProps) => {
  const inputRef = useRef<HTMLInputElement>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setIsLoading(true);
    try {
      const chat = await parsePxgChatFile(file);
      const previous = getPxgState().downloadedChat;
      if (previous) releaseDownloadedChat(previous);
      setPxgState({ downloadedChat: chat, isSettingsOpen: false });
    } catch (err) {
      setError(err instanceof Error && err.message === 'too_large'
        ? t('PxgDownloadedTooLarge')
        : t('PxgDownloadedBadFile'));
    } finally {
      setIsLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <p className={styles.secondary}>{t('PxgDownloadedHint')}</p>
      <input
        ref={inputRef}
        className={styles.hiddenInput}
        type="file"
        accept=".pxgchat,application/zip"
        onClick={(e) => {
          // повторный выбор того же файла тоже должен открывать его
          (e.target as HTMLInputElement).value = '';
        }}
        onChange={(e) => void onFile((e.target).files?.[0])}
      />
      <div className={styles.filters}>
        <Button isLoading={isLoading} onClick={() => inputRef.current?.click()}>
          {t('PxgDownloadedOpen')}
        </Button>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
    </>
  );
});
