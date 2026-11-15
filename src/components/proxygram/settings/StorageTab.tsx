import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { DeviceStorageUsage } from '../../../proxygram/deviceStorage';

import { formatFileSize } from '../../../util/textFormat';
import {
  clearProxyDeviceCache, FILE_CACHE_LIMITS, getStoredFileCacheLimit, measureDeviceStorage, requestPersistentStorage,
  setStoredFileCacheLimit, trimDeviceFiles,
} from '../../../proxygram/deviceStorage';
import { getPxgErrorMessage } from '../../../proxygram/errorReasons';
import {
  FILE_CACHE_RETENTION_DAYS, getFileCacheRetentionDays, setFileCacheRetentionDays,
} from '../../../proxygram/fileCachePolicy';
import { getPxgState } from '../../../proxygram/server/store';
import { Loading } from './settingsShared';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import RadioGroup from '../../ui/RadioGroup';

import styles from '../admin/AdminPanel.module.scss';

const DEFAULT_VALUE = 'default';

/**
 * Files and history of shared chats on this device (docs/spec/11 C4): what they take, the limit, persistent storage
 * and "Clear cache". The server gives everything again, so clearing loses nothing
 */
const StorageTab = () => {
  const { showNotification } = getActions();
  const lang = useLang();
  const userId = getPxgState().session?.user.id;
  const [usage, setUsage] = useState<DeviceStorageUsage>();
  const [error, setError] = useState<unknown>();
  const [limit, setLimit] = useState<number | undefined>(getStoredFileCacheLimit);
  const [retentionDays, setRetentionDays] = useState(getFileCacheRetentionDays);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const reload = () => {
    if (!userId) return;
    setError(undefined);
    void measureDeviceStorage(userId).then(setUsage)
      .catch((err: unknown) => {
        setUsage(undefined);
        setError(err);
      });
  };

  useEffect(reload, [userId, lang]);

  if (!userId) return undefined;

  const handleLimit = (value: string) => {
    const bytes = value === DEFAULT_VALUE ? undefined : Number(value);
    setLimit(bytes);
    setStoredFileCacheLimit(bytes);
    void trimDeviceFiles().then(reload)
      .catch((err: unknown) => showNotification({ message: getPxgErrorMessage(lang, err) }));
  };

  const handleClear = async () => {
    setIsConfirmOpen(false);
    setIsBusy(true);
    try {
      await clearProxyDeviceCache(userId);
      showNotification({ message: { key: 'PxgStorageCleared' } });
    } catch (err: unknown) {
      showNotification({ message: getPxgErrorMessage(lang, err) });
    } finally {
      setIsBusy(false);
      reload();
    }
  };

  const handlePersist = async () => {
    const isPersisted = await requestPersistentStorage();
    if (!isPersisted) showNotification({ message: { key: 'PxgStoragePersistDenied' } });
    reload();
  };

  const options = [
    { value: DEFAULT_VALUE, label: lang('PxgStorageLimitDefault') },
    ...FILE_CACHE_LIMITS.map((bytes) => ({
      value: String(bytes),
      label: bytes ? formatFileSize(lang, bytes, 0) : lang('PxgStorageLimitNone'),
    })),
  ];

  return (
    <div>
      <p className={styles.secondary}>{lang('PxgStorageAbout')}</p>
      {!usage ? <Loading error={error} lang={lang} isLocal onRetry={reload} /> : (
        <table className={styles.table}>
          <tbody>
            <tr>
              <td>{lang('PxgStorageChatFiles')}</td>
              <td>
                {lang('PxgStorageFiles', { count: usage.files, size: formatFileSize(lang, usage.fileBytes) }, {
                  pluralValue: usage.files,
                })}
              </td>
            </tr>
            <tr>
              <td>{lang('PxgStorageAllProfiles')}</td>
              <td>{formatFileSize(lang, usage.allFileBytes)}</td>
            </tr>
            {usage.usageBytes !== undefined && (
              <tr>
                <td>{lang('PxgStorageSite')}</td>
                <td>
                  {usage.quotaBytes
                    ? lang('PxgStorageOf', {
                      used: formatFileSize(lang, usage.usageBytes),
                      quota: formatFileSize(lang, usage.quotaBytes),
                    })
                    : formatFileSize(lang, usage.usageBytes)}
                </td>
              </tr>
            )}
            <tr>
              <td>{lang('PxgStoragePersist')}</td>
              <td>
                {usage.isPersisted ? lang('PxgStoragePersistOn') : (
                  <Button size="tiny" isText onClick={handlePersist}>{lang('PxgStoragePersistAsk')}</Button>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <h3 className={styles.secondary}>{lang('PxgStorageLimit')}</h3>
      <RadioGroup
        name="pxg-file-cache-limit"
        options={options}
        selected={limit === undefined ? DEFAULT_VALUE : String(limit)}
        onChange={handleLimit}
      />
      <h3 className={styles.secondary}>{lang('PxgStorageRetention')}</h3>
      <RadioGroup
        name="pxg-file-cache-retention"
        options={FILE_CACHE_RETENTION_DAYS.map((days) => ({
          value: String(days),
          label: lang(days === 7 ? 'PxgStorageWeek' : days === 30 ? 'PxgStorageMonth' : 'PxgStorageForever'),
        }))}
        selected={String(retentionDays)}
        onChange={(value) => {
          const days = Number(value);
          setRetentionDays(days);
          setFileCacheRetentionDays(days);
          void trimDeviceFiles().then(reload)
            .catch((err: unknown) => showNotification({ message: getPxgErrorMessage(lang, err) }));
        }}
      />
      <Button color="danger" isText disabled={isBusy} onClick={() => setIsConfirmOpen(true)}>
        {lang('PxgStorageClear')}
      </Button>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title={lang('PxgStorageClear')}
        text={lang('PxgStorageClearConfirm')}
        confirmLabel={lang('PxgStorageClear')}
        confirmIsDestructive
        confirmHandler={handleClear}
      />
    </div>
  );
};

export default memo(StorageTab);
