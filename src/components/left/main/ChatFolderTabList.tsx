import { memo } from '../../../lib/teact/teact';

import type { TabWithProperties } from '../../ui/TabList';

import buildClassName from '../../../util/buildClassName';

import useLastCallback from '../../../hooks/useLastCallback';

import Icon from '../../common/icons/Icon';
import TabList from '../../ui/TabList';

import styles from './ChatFolderTabList.module.scss';

type OwnProps = {
  tabs: readonly TabWithProperties[];
  activeTab: number;
  className?: string;
  onSwitchTab: (index: number) => void;
  onFileHoverOpen: (index: number) => void;
};

const ChatFolderTabList = ({
  tabs,
  activeTab,
  className,
  onSwitchTab,
  onFileHoverOpen,
}: OwnProps) => {
  const renderExtra = useLastCallback((tab: TabWithProperties) => {
    if (!tab.isPxgShared && !tab.badgeCount) return undefined;
    return (
      <span className={styles.extras}>
        {tab.isPxgShared && (
          <span className={styles.shared} title={tab.pxgSharedTitle}>
            <Icon name="share-filled" />
          </span>
        )}
        {Boolean(tab.badgeCount) && (
          <span className={buildClassName(styles.badge, tab.isBadgeActive && styles.badgeActive)}>
            {tab.badgeCount}
          </span>
        )}
      </span>
    );
  });

  return (
    <div className={buildClassName(styles.root)}>
      <TabList
        tabs={tabs}
        activeTab={activeTab}
        withFadeMask
        renderExtra={renderExtra}
        className={buildClassName(styles.tabList, className)}
        onSwitchTab={onSwitchTab}
        onFileHoverOpen={onFileHoverOpen}
      />
    </div>
  );
};

export default memo(ChatFolderTabList);
