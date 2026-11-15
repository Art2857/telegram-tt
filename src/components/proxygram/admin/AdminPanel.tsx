import { memo, useState } from '../../../lib/teact/teact';

import type { Confirm } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError } from '../helpers';
import { TAB_TOPICS, TABS } from './adminNavigation';

import useAppLayout from '../../../hooks/useAppLayout';
import useLang from '../../../hooks/useLang';

import Icon from '../../common/icons/Icon';
import Button from '../../ui/Button';
import ConfirmDialog from '../../ui/ConfirmDialog';
import { AccountsTab } from './AccountsTab';
import { VpnAlert, VpnTab } from './AdminVpn';
import { AuditTab } from './AuditTab';
import { ExportsTab } from './ExportsTab';
import { OutboxTab } from './OutboxTab';
import { OverviewTab } from './OverviewTab';
import { RequestsTab } from './RequestsTab';
import { SessionsTab } from './SessionsTab';
import { SharesTab } from './SharesTab';
import { SystemTab } from './SystemTab';
import { UsersTab } from './UsersTab';

import styles from './AdminPanel.module.scss';

/** Админка (PLAN.md, 7.15): только метаданные — кто, какой чат, когда; не переписка */
const AdminPanel = () => {
  const lang = useLang();
  const { isMobile } = useAppLayout();
  const session = usePxgState((state) => state.session);
  const [tab, setTab] = useState(0);
  const [isSectionOpen, setIsSectionOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>();
  const [actionError, setActionError] = useState<string>();
  const tabKey = TABS[tab].key;

  const close = () => setPxgState({ isAdminOpen: false });

  const ask = (text: string, label: string, action: () => Promise<unknown>) => setConfirm({ text, label, action });
  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
    } catch (err) {
      setActionError(describePxgError(lang, err));
    }
  };

  const openTab = (key: (typeof TABS)[number]['key']) => {
    setTab(TABS.findIndex((item) => item.key === key));
    setIsSectionOpen(true);
  };
  const props = { lang, ask, run, selfId: session?.user.id, topics: TAB_TOPICS[tabKey], openTab };

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
            <h2 className={styles.title}>{lang('PxgAdminTitle')}</h2>
          </header>
          <nav className={styles.nav}>
            {TABS.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={buildClassName(styles.navItem, index === tab && styles.navItemActive)}
                aria-current={index === tab ? 'page' : undefined}
                onClick={() => {
                  setTab(index);
                  setIsSectionOpen(true);
                }}
              >
                <span>{lang(item.title)}</span>
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
                onClick={() => setIsSectionOpen(false)}
                ariaLabel={lang('Back')}
              />
            )}
            <h2 className={styles.title}>{lang(TABS[tab].title)}</h2>
          </header>
          {tabKey !== 'vpn' && (
            <VpnAlert onOpen={() => {
              setTab(TABS.findIndex((item) => item.key === 'vpn'));
              setIsSectionOpen(true);
            }}
            />
          )}
          {actionError && <div className={styles.actionError}>{actionError}</div>}
          <div className={buildClassName(styles.contentBody, 'custom-scroll')}>
            {tabKey === 'overview' && <OverviewTab {...props} />}
            {tabKey === 'users' && <UsersTab {...props} />}
            {tabKey === 'sessions' && <SessionsTab {...props} />}
            {tabKey === 'accounts' && <AccountsTab {...props} />}
            {tabKey === 'shares' && <SharesTab {...props} />}
            {tabKey === 'requests' && <RequestsTab {...props} />}
            {tabKey === 'audit' && <AuditTab {...props} />}
            {tabKey === 'outbox' && <OutboxTab {...props} />}
            {tabKey === 'exports' && <ExportsTab {...props} />}
            {tabKey === 'vpn' && <VpnTab run={run} />}
            {tabKey === 'system' && <SystemTab {...props} />}
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

export { groupSessions } from './SessionsTab';
export default memo(AdminPanel);
