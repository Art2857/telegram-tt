import { memo, useCallback, useEffect, useMemo, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { ApiChatFolder } from '../../../api/types';

import buildClassName from '../../../util/buildClassName';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { setPxgState } from '../../../proxygram/server/store';
import {
  openSharedFolderEditor, prefsByKey, reorderSharedFolders, saveSharedFolder,
} from '../../../proxygram/sharedFolders';

import useSelector from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';
import Loading from '../../ui/Loading';

import styles from './SharedFoldersTab.module.scss';

const SharedFoldersTab = () => {
  const { loadProxyFolderPrefs, setActiveChatFolder, showNotification, applyProxyFolderPrefs } = getActions();
  const lang = useLang();
  const localFolders = useSelector((global) => global.chatFolders.pxgLocalFolders);
  const orderedIds = useSelector((global) => global.chatFolders.orderedIds);
  const [draggingKey, setDraggingKey] = useState<string>();
  const [overKey, setOverKey] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadProxyFolderPrefs();
  }, [loadProxyFolderPrefs]);

  const visible = useMemo(() => (localFolders ?? []).filter((folder) => !folder.pxgLocalHidden), [localFolders]);
  const hidden = useMemo(() => (localFolders ?? []).filter((folder) => folder.pxgLocalHidden), [localFolders]);

  const titleOf = useCallback((folder: ApiChatFolder) => {
    if (folder.pxgCustomTitle && folder.title.text) return folder.title.text;
    if (folder.pxgLocalKind === 'folder') return folder.pxgOriginalTitle || lang('PxgSharedFolder');
    if (folder.pxgLocalKind === 'owner' && folder.pxgOwnerName) {
      return lang('PxgOwnerTab', { name: folder.pxgOwnerName });
    }
    return lang('PxgSharedWithMe');
  }, [lang]);

  const allKeys = useMemo(() => (localFolders ?? []).map((folder) => folder.pxgLocalKey!)
    .filter(Boolean), [localFolders]);

  const saveOrder = useCallback(async (visibleKeys: string[]) => {
    const hiddenKeys = hidden.map((folder) => folder.pxgLocalKey!).filter(Boolean);
    const keys = [...visibleKeys, ...hiddenKeys].filter((key) => allKeys.includes(key));
    setIsSaving(true);
    try {
      const { prefs } = await reorderSharedFolders(keys);
      applyProxyFolderPrefs({ prefs: prefsByKey(prefs) });
    } catch {
      showNotification({ message: { key: 'PxgErrorGeneric' } });
    } finally {
      setIsSaving(false);
    }
  }, [allKeys, hidden, showNotification]);

  const move = useCallback((key: string, delta: number) => {
    const keys = visible.map((folder) => folder.pxgLocalKey!).filter(Boolean);
    const index = keys.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= keys.length) return;
    keys.splice(target, 0, ...keys.splice(index, 1));
    void saveOrder(keys);
  }, [saveOrder, visible]);

  const setVisibility = useCallback(async (folder: ApiChatFolder, isHidden: boolean) => {
    setIsSaving(true);
    try {
      const { prefs } = await saveSharedFolder(folder.pxgLocalKey!, { hidden: isHidden });
      applyProxyFolderPrefs({ prefs: prefsByKey(prefs) });
    } catch {
      showNotification({ message: { key: 'PxgErrorGeneric' } });
    } finally {
      setIsSaving(false);
    }
  }, [showNotification]);

  const openFolder = useCallback((folder: ApiChatFolder) => {
    const index = orderedIds?.indexOf(folder.id) ?? -1;
    if (index < 0) return;
    setActiveChatFolder({ activeChatFolder: index, tabId: getCurrentTabId() });
    setPxgState({ isSettingsOpen: false });
  }, [orderedIds, setActiveChatFolder]);

  const handleDrop = useCallback((targetKey: string) => {
    if (!draggingKey || draggingKey === targetKey) return;
    const keys = visible.map((folder) => folder.pxgLocalKey!).filter(Boolean);
    const from = keys.indexOf(draggingKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    keys.splice(to, 0, ...keys.splice(from, 1));
    void saveOrder(keys);
    setDraggingKey(undefined);
    setOverKey(undefined);
  }, [draggingKey, saveOrder, visible]);

  if (!localFolders) return <Loading />;

  const renderRow = (folder: ApiChatFolder, index: number, isHidden = false) => {
    const key = folder.pxgLocalKey!;
    const title = titleOf(folder);
    const owner = folder.pxgOwnerName;
    const isCustom = Boolean(folder.pxgCustomTitle);
    return (
      <div
        key={key}
        className={buildClassName(
          styles.row,
          isHidden && styles.rowHidden,
          overKey === key && styles.rowOver,
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isHidden) setOverKey(key);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!isHidden) handleDrop(key);
        }}
      >
        {!isHidden && (
          <span
            className={styles.handle}
            aria-hidden="true"
            draggable
            onDragStart={() => setDraggingKey(key)}
            onDragEnd={() => {
              setDraggingKey(undefined);
              setOverKey(undefined);
            }}
          >
            <Icon name="more" />
          </span>
        )}
        <div className={styles.main}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{title}</span>
            {isCustom && <span className={styles.custom}>{lang('PxgFolderCustomMark')}</span>}
          </div>
          <div className={styles.meta}>
            {folder.pxgLocalKind === 'accesses' && lang('PxgFolderKindAccesses')}
            {folder.pxgLocalKind === 'owner' && lang('PxgFolderKindOwner')}
            {folder.pxgLocalKind === 'folder' && lang('PxgFolderKindShared')}
            {owner && ` · ${lang('PxgFolderFrom', { name: owner })}`}
            {isHidden && ` · ${lang('PxgFolderHidden')}`}
          </div>
        </div>
        <div className={styles.actions}>
          {!isHidden && (
            <>
              <Button
                size="tiny"
                isText
                color="translucent"
                ariaLabel={lang('PxgFolderMoveUp')}
                disabled={index === 0 || isSaving}
                onClick={() => move(key, -1)}
              >
                <Icon name="up" />
              </Button>
              <Button
                size="tiny"
                isText
                color="translucent"
                ariaLabel={lang('PxgFolderMoveDown')}
                disabled={index === visible.length - 1 || isSaving}
                onClick={() => move(key, 1)}
              >
                <Icon name="down" />
              </Button>
              <Button
                size="tiny"
                isText
                color="translucent"
                ariaLabel={lang('PxgFolderOpen')}
                onClick={() => openFolder(folder)}
              >
                {lang('PxgFolderOpen')}
              </Button>
            </>
          )}
          <Button
            size="tiny"
            isText
            color="translucent"
            ariaLabel={lang('PxgFolderRename')}
            onClick={() => openSharedFolderEditor(folder)}
          >
            <Icon name="edit" />
          </Button>
          <Button
            size="tiny"
            isText
            color="translucent"
            ariaLabel={isHidden ? lang('PxgFolderShow') : lang('PxgFolderHide')}
            onClick={() => void setVisibility(folder, !isHidden)}
          >
            <Icon name={isHidden ? 'eye' : 'eye-crossed'} />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.root}>
      <p className={styles.hint}>{lang('PxgFoldersHint')}</p>
      {visible.length ? (
        <div className={styles.list}>
          {visible.map((folder, index) => renderRow(folder, index))}
        </div>
      ) : (
        <p className={styles.empty}>
          {lang(hidden.length ? 'PxgFoldersAllHidden' : 'PxgFoldersEmpty')}
        </p>
      )}
      {hidden.length > 0 && (
        <>
          <h3 className={styles.sectionTitle}>{lang('PxgFoldersHiddenTitle')}</h3>
          <div className={styles.list}>
            {hidden.map((folder, index) => renderRow(folder, index, true))}
          </div>
        </>
      )}
    </div>
  );
};

export default memo(SharedFoldersTab);
