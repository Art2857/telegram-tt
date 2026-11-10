import { memo, useEffect, useState } from '../../lib/teact/teact';
import { getActions } from '../../global';

import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { prefsByKey, saveSharedFolder } from '../../proxygram/sharedFolders';
import { describePxgError } from './helpers';

import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';

import styles from './SharedFolderModal.module.scss';

/** Переименование локальной папки доступа: своё название можно вернуть к исходному */
const SharedFolderModal = () => {
  const { applyProxyFolderPrefs } = getActions();
  const lang = useLang();
  const edit = usePxgState((state) => state.sharedFolderEdit);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<unknown>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTitle(edit?.title ?? '');
    setError(undefined);
  }, [edit]);

  if (!edit) return undefined;

  const close = () => setPxgState({ sharedFolderEdit: undefined });
  const fallback = edit.kind === 'folder'
    ? (edit.originalTitle || lang('PxgSharedFolder'))
    : edit.ownerName ? lang('PxgOwnerTab', { name: edit.ownerName }) : lang('PxgSharedWithMe');

  const save = async (nextTitle: string) => {
    setIsSaving(true);
    setError(undefined);
    try {
      const { prefs } = await saveSharedFolder(edit.key, { title: nextTitle });
      applyProxyFolderPrefs({ prefs: prefsByKey(prefs) });
      close();
    } catch (err) {
      setError(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen title={lang('PxgFolderRenameTitle')} hasCloseButton onClose={close}>
      <div className={styles.body}>
        <p className={styles.hint}>{lang('PxgFolderRenameHint')}</p>
        <p className={styles.original}>
          {lang('PxgFolderOriginal', { title: fallback })}
        </p>
        <InputText
          label={lang('PxgFolderName')}
          value={title}
          maxLength={128}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        {Boolean(error) && (
          <p className={styles.error}>{describePxgError(lang, error)}</p>
        )}
        <div className={styles.actions}>
          <Button
            size="smaller"
            isText
            color="translucent"
            disabled={isSaving || (!edit.title && !title.trim())}
            onClick={() => void save('')}
          >
            {lang('PxgFolderReset')}
          </Button>
          <Button
            size="smaller"
            disabled={isSaving || !title.trim() || title.trim() === edit.title.trim()}
            isLoading={isSaving}
            onClick={() => void save(title)}
          >
            {lang('Save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default memo(SharedFolderModal);
