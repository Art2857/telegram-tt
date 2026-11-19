import { memo } from '../../../lib/teact/teact';

import type { ApiChatFolder } from '../../../api/types';

import { setFolderHidden } from '../../../proxygram/hiddenFolders';

import useSelector from '../../../hooks/data/useSelector';
import useLang from '../../../hooks/useLang';

import Island, { IslandTitle } from '../../gili/layout/Island';
import ListItem from '../../ui/ListItem';

/**
 * «Settings → Chat Folders»: tabs that came with accesses («Shared with me», a folder of an owner, a shared folder)
 * with the eye that hides or shows each — a hidden tab is brought back here (docs/spec/13 §8)
 */
const FoldersFromOthersIsland = () => {
  const lang = useLang();
  const folders = useSelector((global) => global.chatFolders.pxgLocalFolders);

  if (!folders?.length) return undefined;

  const titleOf = (folder: ApiChatFolder) => {
    if (folder.pxgCustomTitle && folder.title.text) return folder.title.text;
    if (folder.pxgLocalKind === 'dialogArchive') return lang('PxgDialogArchive');
    if (folder.pxgLocalKind === 'folder') return folder.pxgOriginalTitle || lang('PxgSharedFolder');
    if (folder.pxgLocalKind === 'owner' && folder.pxgOwnerName) {
      return lang('PxgOwnerTab', { name: folder.pxgOwnerName });
    }
    return lang('PxgSharedWithMe');
  };

  return (
    <>
      <IslandTitle dir={lang.isRtl ? 'rtl' : undefined}>{lang('PxgSettingsFolders')}</IslandTitle>
      <Island>
        {folders.map((folder) => {
          const isHidden = Boolean(folder.pxgLocalHidden);
          return (
            <ListItem
              key={folder.pxgLocalKey}
              narrow
              multiline
              secondaryIcon={isHidden ? 'eye-crossed' : 'eye'}
              onSecondaryIconClick={() => void setFolderHidden(folder.pxgLocalKey!, !isHidden, folder.id)}
              onClick={() => void setFolderHidden(folder.pxgLocalKey!, !isHidden, folder.id)}
            >
              <span className="title">{titleOf(folder)}</span>
              <span className="subtitle">
                {isHidden ? lang('PxgFolderHiddenTapToShow') : lang('PxgFolderShownTapToHide')}
              </span>
            </ListItem>
          );
        })}
      </Island>
    </>
  );
};

export default memo(FoldersFromOthersIsland);
