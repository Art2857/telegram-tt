import { memo, useEffect, useState } from '../../../lib/teact/teact';

import type { AppDownload } from '../../../proxygram/appDownloads';

import { DEFAULT_SERVER_HOST, fetchReleaseManifest, getAppDownload } from '../../../proxygram/appDownloads';

import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';

import styles from './AuthChoice.module.scss';

/** In a browser: the app for this device, if a release has one */
const AppDownloadOffer = () => {
  const lang = useLang();
  const [download, setDownload] = useState<AppDownload>();

  useEffect(() => {
    let isActive = true;
    void fetchReleaseManifest().then((manifest) => {
      if (isActive && manifest) setDownload(getAppDownload(manifest));
    });
    return () => {
      isActive = false;
    };
  }, []);

  if (!download) return undefined;

  const host = window.location.host;

  return (
    <a className={styles.option} href={download.url} download rel="noopener">
      <Icon name="download" className={styles.icon} />
      <span className={styles.text}>
        <span className={styles.title}>
          {lang(download.platform === 'windows' ? 'PxgAppDownloadWindows' : 'PxgAppDownloadAndroid')}
        </span>
        <span className={styles.hint}>
          {host === DEFAULT_SERVER_HOST
            ? lang('PxgAppDownloadHint', { version: download.version })
            : lang('PxgAppDownloadHintServer', { version: download.version, host })}
        </span>
      </span>
    </a>
  );
};

export default memo(AppDownloadOffer);
