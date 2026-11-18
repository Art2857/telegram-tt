import { memo, useState } from '../../../lib/teact/teact';

import type { AccountRow, ShareFilters, TabProps } from './adminTypes';
import type { AdminShare as ShareRow } from './types';

import buildClassName from '../../../util/buildClassName';
import { getServerTime } from '../../../util/serverTime';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { displayName, formatDateTime } from '../helpers';
import { TAB_TOPICS } from './adminNavigation';
import {
  Badge, call, Loading, SHARE_STATUS, SHARES_PAGE_SIZE, SYSTEM_REFRESH_MS, t, useAdminData,
} from './adminShared';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import InputText from '../../ui/InputText';
import Modal from '../../ui/Modal';
import { HISTORY_KEYS } from '../ShareSettingsFields';
import AdminShareForm from './AdminShareForm';

import panelStyles from './AdminPanel.module.scss';
import styles from './SharesTab.module.scss';

const STATUS_FILTERS = [
  ['active', 'PxgAdminSharesActive'],
  ['paused', 'PxgAdminSharesPaused'],
  ['source_lost', 'PxgAdminSharesLost'],
  ['expired', 'PxgAdminSharesExpired'],
  ['revoked', 'PxgAdminSharesRevoked'],
  [undefined, 'PxgAdminAll'],
] as const;

const CHAT_FILTER_ERROR = 'pxg-admin-share-peer-error';

export const SharesTab = memo(({ lang, ask, run, topics }: TabProps) => {
  const [filters, setFilters] = useState<ShareFilters>({
    status: 'active', accountId: '', granteeQuery: '', peer: '', offset: 0,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShareRow>();
  const { data: accounts } = useAdminData<AccountRow[]>('admin.accounts', {}, TAB_TOPICS.accounts);
  const peerQuery = filters.peer.trim();
  const peerNumber = Number(peerQuery);
  const isPeerId = /^-?\d+$/.test(peerQuery) && peerNumber !== 0 && Number.isSafeInteger(peerNumber);
  const peerId = isPeerId ? peerNumber : undefined;
  const isPeerInvalid = Boolean(peerQuery) && peerId === undefined;
  const { data, error } = useAdminData<ShareRow[]>('admin.shares', {
    status: filters.status,
    accountId: filters.accountId || undefined,
    granteeQuery: filters.granteeQuery.trim() || undefined,
    peerId,
    limit: SHARES_PAGE_SIZE + 1,
    offset: filters.offset,
  }, topics, SYSTEM_REFRESH_MS);
  const rows = data?.slice(0, SHARES_PAGE_SIZE);
  const hasNext = Boolean(data && data.length > SHARES_PAGE_SIZE);
  const selectableIds = rows?.filter((share) => share.status !== 'revoked').map((share) => share.id) ?? [];
  const selected = selectedIds.filter((id) => selectableIds.includes(id));

  function changeFilters(patch: Partial<ShareFilters>) {
    setFilters((current) => ({ ...current, offset: 0, ...patch }));
    setSelectedIds([]);
  }

  function toggleSelected(id: string, isChecked: boolean) {
    setSelectedIds(isChecked ? [...selected, id] : selected.filter((item) => item !== id));
  }

  function openForm(share?: ShareRow) {
    setEditing(share);
    setIsFormOpen(true);
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.statusFilters} role="group" aria-label={lang('PxgAdminColStatus')}>
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              type="button"
              key={label}
              className={styles.statusFilter}
              aria-pressed={filters.status === value}
              onClick={() => changeFilters({ status: value })}
            >
              {lang(label)}
            </button>
          ))}
        </div>
        <Button
          noFastClick
          size="smaller"
          iconName="add"
          className={styles.grant}
          onClick={() => openForm()}
        >
          {lang('PxgAdminGrant')}
        </Button>
      </div>
      <div className={styles.searchFields}>
        <div className={styles.field}>
          <label htmlFor="pxg-admin-share-account" className={styles.fieldLabel}>{lang('PxgAdminColAccount')}</label>
          <select
            id="pxg-admin-share-account"
            className={styles.accountFilter}
            value={filters.accountId}
            onChange={(e) => changeFilters({ accountId: e.currentTarget.value })}
          >
            <option value="">{lang('PxgAdminAll')}</option>
            {accounts?.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName ?? account.id}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="pxg-admin-share-guest" className={styles.fieldLabel}>{lang('PxgAdminGuestFilter')}</label>
          <InputText
            id="pxg-admin-share-guest"
            value={filters.granteeQuery}
            maxLength={64}
            noMargin
            onChange={(e) => changeFilters({ granteeQuery: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="pxg-admin-share-peer" className={styles.fieldLabel}>{lang('PxgAdminAuditChat')}</label>
          <InputText
            id="pxg-admin-share-peer"
            value={filters.peer}
            maxLength={20}
            noMargin
            ariaDescribedBy={isPeerInvalid ? CHAT_FILTER_ERROR : undefined}
            onChange={(e) => changeFilters({ peer: e.target.value })}
          />
        </div>
      </div>
      <Modal
        isOpen={isFormOpen}
        title={lang(editing ? 'PxgShareEdit' : 'PxgAdminGrant')}
        hasCloseButton
        onClose={() => setIsFormOpen(false)}
        className={styles.formModal}
      >
        {isFormOpen && (
          <AdminShareForm
            key={editing?.id ?? 'new'}
            share={editing}
            initialAccountId={filters.accountId || undefined}
            onClose={() => setIsFormOpen(false)}
          />
        )}
      </Modal>
      {isPeerInvalid ? (
        <p id={CHAT_FILTER_ERROR} className={panelStyles.errorText} role="status">{lang('PxgAdminSharePeerInvalid')}</p>
      ) : !rows ? <Loading error={error} lang={lang} /> : (
        <>
          {Boolean(selectableIds.length) && (
            <div className={styles.selection}>
              <Checkbox
                label={lang('ContextMenuItemSelectAll')}
                checked={Boolean(selectableIds.length && selected.length === selectableIds.length)}
                onCheck={(isChecked) => setSelectedIds(isChecked ? selectableIds : [])}
              />
              {Boolean(selected.length) && (
                <Button
                  noFastClick
                  size="smaller"
                  color="danger"
                  isText
                  fluid={false}
                  onClick={() => ask(lang('PxgAdminBulkRevokeConfirm', { count: selected.length }),
                    lang('PxgShareRevoke'), async () => {
                      await pxgRpc.call('admin.shares.revokeMany', { shareIds: selected });
                      setSelectedIds([]);
                    })}
                >
                  {lang('PxgAdminRevokeSelected', { count: selected.length })}
                </Button>
              )}
            </div>
          )}
          {rows.length === 0 ? <p className={panelStyles.empty}>{lang('PxgAdminSharesNoMatches')}</p> : (
            <table className={styles.table} role="table">
              <thead className={styles.head}>
                <tr>
                  <th scope="col" className={styles.column} aria-label={lang('ContextMenuItemSelectAll')} />
                  <th scope="col" className={styles.column}>{lang('PxgAdminColChat')}</th>
                  <th scope="col" className={styles.column}>{lang('PxgAdminColGuest')}</th>
                  <th scope="col" className={styles.column}>{lang('PxgAdminColPermissions')}</th>
                  <th scope="col" className={styles.column}>{lang('PxgShareExpiry')}</th>
                  <th scope="col" className={styles.column}>{lang('PxgAdminLastUsed')}</th>
                  <th scope="col" className={styles.column}>{lang('PxgAdminColStatus')}</th>
                  <th scope="col" className={styles.column} aria-label={lang('PxgAdminColActions')} />
                </tr>
              </thead>
              <tbody role="rowgroup" className={styles.body}>
                {rows.map((share) => {
                  const isExpiringStatus = share.status === 'active' || share.status === 'source_lost';
                  const isExpired = isExpiringStatus && Boolean(share.expiresAt)
                    && Date.parse(share.expiresAt) <= getServerTime() * 1000;
                  const shareStatus = isExpired
                    ? { key: 'PxgShareStatusExpired', tone: 'gray' as const }
                    : SHARE_STATUS[share.status];
                  const chatTitle = share.scope.startsWith('folder')
                    ? share.folderTitle ?? share.folderId : share.peerTitle ?? share.peerId;
                  const guestName = [share.grantee?.firstName, share.grantee?.lastName].filter(Boolean).join(' ')
                    || displayName(share.grantee);
                  return (
                    <tr key={share.id} className={styles.row} role="row">
                      <td className={buildClassName(styles.cell, styles.choiceCell)} role="cell">
                        <label className={styles.choice}>
                          <input
                            type="checkbox"
                            className={styles.check}
                            aria-label={`${chatTitle ?? ''}, ${guestName}`}
                            checked={selected.includes(share.id)}
                            disabled={share.status === 'revoked'}
                            onChange={(e) => toggleSelected(share.id, e.currentTarget.checked)}
                          />
                        </label>
                      </td>
                      <td className={buildClassName(styles.cell, styles.chatCell)} role="cell">
                        <div className={styles.name}>
                          {chatTitle}
                          {share.scope.endsWith('_members') && (
                            <span className={styles.secondary}>{` · ${lang('PxgShareMembersChip')}`}</span>
                          )}
                        </div>
                        {share.scope === 'topic' && <div>{share.topicTitle ?? share.topicId}</div>}
                        {share.label && <div>{share.label}</div>}
                        <div className={styles.secondary}>
                          {t(lang, 'PxgAdminFromAccount', { name: share.account.displayName ?? '—' })}
                        </div>
                      </td>
                      <td className={buildClassName(styles.cell, styles.guestCell)} role="cell">
                        <span className={styles.mobileLabel} aria-hidden>{lang('PxgAdminColGuest')}</span>
                        {guestName}
                        {share.grantee?.username && guestName !== '@' + share.grantee.username && (
                          <div className={styles.secondary}>{'@' + share.grantee.username}</div>
                        )}
                      </td>
                      <td className={buildClassName(styles.cell, styles.permissionsCell)} role="cell">
                        <span className={styles.mobileLabel} aria-hidden>{lang('PxgAdminColPermissions')}</span>
                        {t(lang, `PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)}
                        {Object.entries(share.permissions).map(([key, value]) => (
                          <div key={key} className={styles.secondary}>
                            {`${value ? '✓' : '✗'} ${t(lang, `PxgPerm${key[0].toUpperCase()}${key.slice(1)}`)}`}
                          </div>
                        ))}
                        <div className={styles.secondary}>{lang(HISTORY_KEYS[share.historyMode])}</div>
                        {share.historyMode === 'last_n' && (
                          <div className={styles.secondary}>{share.historyLimit}</div>
                        )}
                        {share.historyMode === 'since_date' && (
                          <div className={styles.secondary}>{formatDateTime(share.visibleFromDate)}</div>
                        )}
                      </td>
                      <td className={buildClassName(styles.cell, styles.expiryCell)} role="cell">
                        <span className={styles.mobileLabel} aria-hidden>{lang('PxgShareExpiry')}</span>
                        {share.expiresAt ? formatDateTime(share.expiresAt) : lang('PxgExpiryNever')}
                      </td>
                      <td className={buildClassName(styles.cell, styles.activityCell)} role="cell">
                        <span className={styles.mobileLabel} aria-hidden>{lang('PxgAdminLastUsed')}</span>
                        {formatDateTime(share.lastUsedAt)}
                      </td>
                      <td className={buildClassName(styles.cell, styles.statusCell)} role="cell">
                        <span className={styles.mobileLabel} aria-hidden>{lang('PxgAdminColStatus')}</span>
                        <Badge tone={shareStatus.tone}>{t(lang, shareStatus.key)}</Badge>
                        <div className={styles.secondary}>{formatDateTime(share.createdAt)}</div>
                      </td>
                      <td className={buildClassName(styles.cell, styles.actionsCell)} role="cell">
                        {share.status !== 'revoked' && (
                          <div className={styles.actions}>
                            <Button noFastClick size="tiny" isText onClick={() => openForm(share)}>
                              {lang('PxgShareEdit')}
                            </Button>
                            <Button
                              noFastClick
                              size="tiny"
                              color="translucent"
                              isText
                              disabled={share.status === 'source_lost' || isExpired}
                              onClick={() => void run(call('admin.shares.update', {
                                shareId: share.id, status: share.status === 'paused' ? 'active' : 'paused',
                              }))}
                            >
                              {lang(share.status === 'paused' ? 'PxgAdminResume' : 'PxgAdminPause')}
                            </Button>
                            <Button
                              size="tiny"
                              color="danger"
                              isText
                              onClick={() => ask(t(lang, 'PxgAdminRevokeConfirm', { name: displayName(share.grantee) }),
                                lang('PxgShareRevoke'), call('admin.shares.revoke', { shareId: share.id }))}
                            >
                              {lang('PxgShareRevoke')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {(hasNext || filters.offset > 0) && (
            <div className={styles.pagination}>
              <Button
                noFastClick
                size="smaller"
                color="translucent"
                fluid={false}
                disabled={!filters.offset}
                onClick={() => changeFilters({ offset: Math.max(0, filters.offset - SHARES_PAGE_SIZE) })}
              >
                {lang('AccDescrPrevious')}
              </Button>
              <span>{lang.number(filters.offset / SHARES_PAGE_SIZE + 1)}</span>
              <Button
                noFastClick
                size="smaller"
                color="translucent"
                fluid={false}
                disabled={!hasNext}
                onClick={() => changeFilters({ offset: filters.offset + SHARES_PAGE_SIZE })}
              >
                {lang('Next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
});
