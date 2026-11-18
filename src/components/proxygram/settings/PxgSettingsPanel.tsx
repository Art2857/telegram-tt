import { memo, useRef, useState } from '../../../lib/teact/teact';

import type { AccountRow, Confirm, Translate } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError } from '../helpers';
import { TABS } from './settingsNavigation';
import { usePxgData } from './settingsShared';

import useAppLayout from '../../../hooks/useAppLayout';
import useFlag from '../../../hooks/useFlag';
import useLang from '../../../hooks/useLang';
import useSettingsHighlight from '../../left/settings/hooks/useSettingsHighlight';

import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { VpnAlert } from '../admin/AdminVpn';
import { ArchiveTab, HideDeletedOption } from './ArchiveTab';
import { AuditTab } from './AuditTab';
import { DevicesTab } from './DevicesTab';
import { DownloadedTab } from './DownloadedTab';
import { IncomingTab } from './IncomingTab';
import { MyRequestsTab } from './MyRequestsTab';
import { OutgoingTab } from './OutgoingTab';
import { ReachableTab } from './ReachableTab';
import { ServerTab } from './ServerTab';
import SharedFoldersTab from './SharedFoldersTab';
import StorageTab from './StorageTab';

import styles from '../admin/AdminPanel.module.scss';

/** «Настройки Proxygram» (PLAN.md, 7.12): сервер, доступы в обе стороны, архив, журнал, устройства */
const PxgSettingsPanel = () => {
  const lang = useLang();
  const { isMobile } = useAppLayout();
  const target = usePxgState((state) => state.settingsTarget);
  const [isSectionOpen, openSection, closeSection] = useFlag(Boolean(target));
  const contentRef = useRef<HTMLDivElement>();
  const session = usePxgState((state) => state.session);
  // Managing shares needs only the server session: an owner signed in as a guest keeps these tabs
  const { data: accounts, error: accountsError, reload: reloadAccounts } = usePxgData<AccountRow[]>(
    'accounts.mine', {}, ['accounts.changed'],
  );
  const ownAccounts = accounts?.filter((account) => account.status !== 'revoked');
  const isOwner = session?.level === 'client' || Boolean(ownAccounts?.length);
  const tabs = TABS.filter((item) => isOwner || !item.isOwnerOnly);
  const [selectedTabKey, setSelectedTabKey] = useState<typeof TABS[number]['key']>(
    target?.tab ?? (session?.level === 'client' ? 'server' : 'incoming'),
  );
  const [confirm, setConfirm] = useState<Confirm>();
  const [actionError, setActionError] = useState<{ tab: string; message: string }>();
  const tab = Math.max(0, tabs.findIndex((item) => item.key === selectedTabKey));
  const tabKey = tabs[tab].key;
  const highlight = tabKey === target?.tab && (!isMobile || isSectionOpen) ? target?.highlight : undefined;
  useSettingsHighlight(contentRef, highlight, true);
  const t = lang as unknown as Translate;

  const close = () => setPxgState({ isSettingsOpen: false });
  const ask = (text: string, label: string, action: () => Promise<unknown>) => setConfirm({ text, label, action });
  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
    } catch (err) {
      setActionError({ tab: tabKey, message: describePxgError(lang, err) });
    }
  };
  const props = {
    lang, t, ask, run, accounts: ownAccounts, accountsError, reloadAccounts,
  };

  return (
    <div className={styles.root}>
      {(!isMobile || !isSectionOpen) && (
        <aside className={styles.sidebar}>
          <header className={styles.sidebarHeader}>
            <Button
              round
              size="smaller"
              color="translucent"
              iconName="close"
              onClick={close}
              ariaLabel={lang('Close')}
            />
            <h2 className={styles.title}>{lang('PxgSettingsTitle')}</h2>
          </header>
          <nav className={styles.nav}>
            {tabs.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={buildClassName(styles.navItem, index === tab && styles.navItemActive)}
                aria-current={index === tab ? 'page' : undefined}
                onClick={() => {
                  setPxgState({ settingsTarget: undefined });
                  setSelectedTabKey(item.key);
                  openSection();
                }}
              >
                <span>{t(item.title)}</span>
                <Icon name="arrow-right" className={styles.navChevron} />
              </button>
            ))}
          </nav>
        </aside>
      )}
      {(!isMobile || isSectionOpen) && (
        <main className={styles.content}>
          <header className={styles.contentHeader}>
            {isMobile && (
              <Button
                round
                size="smaller"
                color="translucent"
                iconName="arrow-left"
                onClick={closeSection}
                ariaLabel={lang('Back')}
              />
            )}
            <h2 className={styles.title}>{t(tabs[tab].title)}</h2>
          </header>
          <VpnAlert onOpen={() => setPxgState({ isSettingsOpen: false, isAdminOpen: true })} />
          {actionError?.tab === tabKey && <div role="alert" className={styles.actionError}>{actionError.message}</div>}
          <div ref={contentRef} className={buildClassName(styles.contentBody, 'custom-scroll')}>
            {tabKey === 'server' && <ServerTab {...props} />}
            {tabKey === 'outgoing' && <OutgoingTab {...props} />}
            {tabKey === 'incoming' && <IncomingTab {...props} />}
            {tabKey === 'folders' && <SharedFoldersTab />}
            {tabKey === 'requests' && <MyRequestsTab {...props} />}
            {tabKey === 'contacts' && <ReachableTab {...props} />}
            {tabKey === 'downloaded' && <DownloadedTab {...props} />}
            {tabKey === 'archive' && <HideDeletedOption lang={lang} />}
            {tabKey === 'archive' && <ArchiveTab {...props} />}
            {tabKey === 'audit' && <AuditTab {...props} />}
            {tabKey === 'devices' && <DevicesTab {...props} />}
            {tabKey === 'storage' && <StorageTab />}
          </div>
        </main>
      )}
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        title={lang('PxgAdminConfirm')}
        text={confirm?.text}
        confirmLabel={confirm?.label}
        confirmIsDestructive
        confirmHandler={() => {
          const action = confirm?.action;
          setConfirm(undefined);
          if (action) void run(action);
        }}
        onClose={() => setConfirm(undefined)}
      />
    </div>
  );
};

export default memo(PxgSettingsPanel);
