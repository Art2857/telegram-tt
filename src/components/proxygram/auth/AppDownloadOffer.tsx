import { memo, useEffect, useState } from '../../../lib/teact/teact';

import type { AppDownload, AppPlatform } from '../../../proxygram/appDownloads';

import buildClassName from '../../../util/buildClassName';
import {
  DEFAULT_SERVER_HOST, fetchReleaseManifest, getAppDownloads, getDevicePlatform,
} from '../../../proxygram/appDownloads';

import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';

import styles from './AuthChoice.module.scss';

const PLATFORM_NAMES: Record<AppPlatform, string> = { windows: 'Windows', android: 'Android' };

/** In a browser, right on the first screen: the app for this device and links to the others */
const AppDownloadOffer = () => {
  const lang = useLang();
  const [downloads, setDownloads] = useState<AppDownload[]>([]);

  useEffect(() => {
    let isActive = true;
    void fetchReleaseManifest().then((manifest) => {
      if (isActive && manifest) setDownloads(getAppDownloads(manifest));
    });
    return () => {
      isActive = false;
    };
  }, []);

  if (!downloads.length) return undefined;

  const own = getDevicePlatform();
  const primary = downloads[0].platform === own ? downloads[0] : undefined;
  const others = primary ? downloads.slice(1) : downloads;
  const host = window.location.host;

  return (
    <div className={styles.downloads}>
      {primary && (
        <a className={buildClassName(styles.option, styles.download)} href={primary.url} download rel="noopener">
          <Icon name="download" className={styles.icon} />
          <span className={styles.text}>
            <span className={styles.title}>
              {lang(primary.platform === 'windows' ? 'PxgAppDownloadWindows' : 'PxgAppDownloadAndroid')}
            </span>
            <span className={styles.hint}>
              {host === DEFAULT_SERVER_HOST
                ? lang('PxgAppDownloadHint', { version: primary.version })
                : lang('PxgAppDownloadHintServer', { version: primary.version, host })}
            </span>
          </span>
        </a>
      )}
      {others.length > 0 && (
        <p className={styles.otherApps}>
          <Icon name="download" />
          {primary ? lang('PxgAppDownloadAlso') : lang('PxgAppDownloadApps', { version: others[0].version })}
          {others.map((item, index) => (
            <span key={item.platform}>
              {index > 0 ? ' · ' : ' '}
              <a href={item.url} download rel="noopener">{PLATFORM_NAMES[item.platform]}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
};

export default memo(AppDownloadOffer);
