import { memo, useEffect, useState } from '../../lib/teact/teact';

import type { AndroidDownloadState, ReleaseManifest } from '../../proxygram/appDownloads';

import { copyTextToClipboard } from '../../util/clipboard';
import {
  fetchReleaseManifest, getAndroidUpdateBridge, isNewerVersion, openAppDownload,
} from '../../proxygram/appDownloads';
import { setPxgState, usePxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Modal from '../ui/Modal';

import styles from './AppUpdateModal.module.scss';

const POLL_INTERVAL_MS = 1000;
const BYTES_PER_MB = 1024 * 1024;
const ACTIVE_STATUSES = new Set<AndroidDownloadState['status']>(['pending', 'running', 'paused', 'verifying']);
const STATUS_KEYS = {
  pending: 'PxgAppUpdatePending',
  running: 'PxgAppUpdateRunning',
  paused: 'PxgAppUpdatePaused',
  verifying: 'PxgAppUpdateVerifying',
  ready: 'PxgAppUpdateReady',
  failed: 'PxgAppUpdateFailed',
  storage: 'PxgAppUpdateStorage',
} as const;

function AppUpdateModal() {
  const lang = useLang();
  const isOpen = usePxgState((state) => state.isAppUpdateOpen);
  const [manifest, setManifest] = useState<ReleaseManifest>();
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetchError, setHasFetchError] = useState(false);
  const [hasActionError, setHasActionError] = useState(false);
  const [needsInstallPermission, setNeedsInstallPermission] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [download, setDownload] = useState<AndroidDownloadState>({ status: 'idle' });
  const bridge = getAndroidUpdateBridge();
  const currentVersion = window.tauri?.version || '';
  const apk = manifest?.android;
  const isNewer = manifest && isNewerVersion(manifest.version, currentVersion);
  const isActive = ACTIVE_STATUSES.has(download.status);
  const hasLatestDownload = download.status === 'ready' && (!manifest || download.version === manifest.version);

  const check = useLastCallback(async () => {
    setIsLoading(true);
    setHasFetchError(false);
    const result = await fetchReleaseManifest();
    setManifest(result);
    setHasFetchError(!result?.android?.url);
    setIsLoading(false);
  });

  useEffect(() => {
    if (!isOpen) return undefined;
    void check();
    if (!bridge) return undefined;
    const poll = () => {
      try {
        setDownload(JSON.parse(bridge.getState()) as AndroidDownloadState);
      } catch {
        setHasActionError(true);
      }
    };
    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isOpen, bridge, check]);

  const start = useLastCallback(async () => {
    if (!apk || !manifest) return;
    setHasActionError(false);
    setIsBrowserOpen(false);
    setNeedsInstallPermission(false);
    try {
      if (bridge && apk.sha256) {
        setDownload(JSON.parse(bridge.start(apk.url, apk.sha256, manifest.version)) as AndroidDownloadState);
      } else {
        await openAppDownload(apk.url);
        setIsBrowserOpen(true);
      }
    } catch {
      setHasActionError(true);
    }
  });

  const install = useLastCallback(() => {
    setHasActionError(false);
    try {
      setNeedsInstallPermission(bridge?.install() === 'permission');
    } catch {
      setHasActionError(true);
    }
  });

  const openBrowser = useLastCallback(async () => {
    if (!apk) return;
    setHasActionError(false);
    try {
      await openAppDownload(apk.url);
      setIsBrowserOpen(true);
    } catch {
      setHasActionError(true);
    }
  });

  const copyLink = useLastCallback(() => {
    if (!apk) return;
    setHasActionError(false);
    try {
      const hasCopied = copyTextToClipboard(apk.url);
      setIsCopied(hasCopied);
      setHasActionError(!hasCopied);
    } catch {
      setHasActionError(true);
    }
  });

  const cancel = useLastCallback(() => {
    try {
      bridge?.cancel();
      setDownload({ status: 'idle' });
    } catch {
      setHasActionError(true);
    }
  });

  return (
    <Modal
      isOpen={Boolean(isOpen)}
      title={lang('PxgAppUpdates')}
      hasCloseButton
      onClose={() => setPxgState({ isAppUpdateOpen: false })}
    >
      <div className={styles.content}>
        <p className={styles.secondary}>{lang('PxgAppUpdateInstalled', { version: currentVersion })}</p>
        {isLoading && <p className={styles.secondary}>{lang('Loading')}</p>}
        {hasFetchError && <p className={styles.error} role="alert">{lang('PxgAppUpdateCheckFailed')}</p>}
        {manifest && apk && (
          <>
            <p className={styles.version}>
              {lang(isNewer ? 'PxgAppUpdateAvailable' : 'PxgAppUpdateLatest', { version: manifest.version })}
            </p>
            <p className={styles.secondary}>{lang(bridge ? 'PxgAppUpdateHint' : 'PxgAppUpdateBrowserHint')}</p>
          </>
        )}
        {download.status !== 'idle' && (
          <div className={styles.status} role="status" aria-live="polite">
            <p className={download.status === 'failed' ? styles.error : styles.secondary}>
              {lang(STATUS_KEYS[download.status])}
            </p>
            {download.status === 'running' && (
              <>
                <progress
                  className={styles.progress}
                  value={download.total ? download.downloaded || 0 : undefined}
                  max={download.total || undefined}
                />
                <p className={styles.secondary}>
                  {`${((download.downloaded || 0) / BYTES_PER_MB).toFixed(1)} MB`}
                  {download.total !== undefined && ` / ${(download.total / BYTES_PER_MB).toFixed(1)} MB`}
                </p>
              </>
            )}
            {download.filename && <p className={styles.link}>{download.filename}</p>}
            {download.error === 'SHA256_MISMATCH' && (
              <p className={styles.error}>{lang('PxgAppUpdateInvalidFile')}</p>
            )}
          </div>
        )}
        {needsInstallPermission && <p className={styles.secondary}>{lang('PxgAppUpdatePermission')}</p>}
        {isBrowserOpen && <p className={styles.secondary} role="status">{lang('PxgAppUpdateBrowserOpened')}</p>}
        {hasActionError && <p className={styles.error} role="alert">{lang('PxgAppUpdateActionFailed')}</p>}
        <div className={styles.buttons}>
          {hasLatestDownload && <Button onClick={install}>{lang('PxgAppUpdateInstall')}</Button>}
          {apk && !isActive && !hasLatestDownload && (
            <Button onClick={start}>{lang('PxgAppUpdateDownload')}</Button>
          )}
          {isActive && <Button color="translucent" onClick={cancel}>{lang('Cancel')}</Button>}
          {apk && <Button color="translucent" onClick={openBrowser}>{lang('PxgAppUpdateBrowser')}</Button>}
          {apk && <Button color="translucent" onClick={copyLink}>{lang(isCopied ? 'LinkCopied' : 'CopyLink')}</Button>}
          <Button color="translucent" disabled={isLoading} onClick={check}>{lang('PxgAppUpdateCheck')}</Button>
        </div>
        {apk && <a className={styles.link} href={apk.url} target="_blank" rel="noopener noreferrer">{apk.url}</a>}
      </div>
    </Modal>
  );
}

export default memo(AppUpdateModal);
