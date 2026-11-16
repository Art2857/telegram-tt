import { memo, useEffect, useMemo, useRef, useState } from '../../lib/teact/teact';

import type { ApiUser } from '../../api/types';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from '../common/Avatar';
import Button from '../ui/Button';
import CropModal from '../ui/CropModal';

import styles from './PersonalContactModal.module.scss';

type OwnProps = {
  user?: ApiUser;
  file?: File;
  shouldRemove?: boolean;
  disabled?: boolean;
  onChange: (file?: File, shouldRemove?: boolean) => void;
};

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

const PersonalContactPhotoEditor = ({ user, file, shouldRemove, disabled, onChange }: OwnProps) => {
  const lang = useLang();
  const inputRef = useRef<HTMLInputElement>();
  const [cropFile, setCropFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [hasError, setHasError] = useState(false);
  const displayUser = useMemo(() => shouldRemove && user
    ? { ...user, avatarPhotoId: user.pxgOriginalPhotoId } : user, [user, shouldRemove]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(undefined);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const closeCrop = useLastCallback(() => setCropFile(undefined));
  const handleCropError = useLastCallback(() => setHasError(true));
  const handleCrop = useLastCallback((cropped: File) => {
    setCropFile(undefined);
    onChange(cropped);
  });

  return (
    <div className={styles.photoEditor}>
      <Avatar peer={displayUser} previewUrl={previewUrl} size="jumbo" />
      <input
        ref={inputRef}
        className={styles.photoInput}
        type="file"
        accept="image/jpeg,image/png"
        disabled={disabled}
        onChange={(e) => {
          const selected = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!selected) return;
          if (!['image/jpeg', 'image/png'].includes(selected.type) || selected.size > MAX_SOURCE_BYTES) {
            setHasError(true);
            return;
          }
          setHasError(false);
          setCropFile(selected);
        }}
      />
      <Button
        className={styles.photoAction}
        size="smaller"
        isText
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {lang('PxgContactSetPhoto')}
      </Button>
      {file && (
        <Button className={styles.photoAction} size="smaller" isText disabled={disabled} onClick={() => onChange()}>
          {lang('PxgContactCancelPhoto')}
        </Button>
      )}
      {user?.pxgPersonalPhoto && !shouldRemove && (
        <Button
          className={styles.photoAction}
          size="smaller"
          isText
          disabled={disabled}
          onClick={() => onChange(undefined, true)}
        >
          {lang('PxgContactResetPhoto')}
        </Button>
      )}
      {file && <p className={styles.hint}>{lang('PxgContactPhotoPending')}</p>}
      {shouldRemove && <p className={styles.hint}>{lang('PxgContactPhotoResetHint')}</p>}
      {hasError && <p role="alert" className={styles.error}>{lang('PxgErrContactPhotoInvalid')}</p>}
      <CropModal file={cropFile} onChange={handleCrop} onClose={closeCrop} onError={handleCropError} />
    </div>
  );
};

export default memo(PersonalContactPhotoEditor);
