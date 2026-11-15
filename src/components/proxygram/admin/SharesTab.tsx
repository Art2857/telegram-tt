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
import { HISTORY_KEYS } from '../ShareSettingsFields';
import AdminShareForm from './AdminShareForm';

import styles from './AdminPanel.module.scss';

export const SharesTab = memo(({ lang, ask, run, topics }: TabProps) => {
  const [filters, setFilters] = useState<ShareFilters>({
    status: 'active', accountId: '', granteeQuery: '', peer: '', offset: 0,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShareRow>();
  const { data: accounts } = useAdminData<AccountRow[]>('admin.accounts', {}, TAB_TOPICS.accounts);
  const peerNumber = Number(filters.peer.trim());
  const peerId = /^-?\d+$/.test(filters.peer.trim()) && Number.isSafeInteger(peerNumber) ? peerNumber : undefined;
  const { data, error } = useAdminData<ShareRow[]>('admin.shares', {
    status: filters.status,
    accountId: filters.accountId || undefined,
    granteeQuery: filters.granteeQuery.trim() || undefined,
    peerId,
    limit: SHARES_PAGE_SIZE,
    offset: filters.offset,
  }, topics, SYSTEM_REFRESH_MS);
  const selectableIds = data?.filter((share) => share.status !== 'revoked').map((share) => share.id) ?? [];
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
    <>
      <div className={styles.filters}>
        {(['active', 'paused', 'source_lost', 'revoked', undefined] as const).map((value) => (
          <Button
            key={value ?? 'all'}
            size="smaller"
            pill
            fluid={false}
            color={filters.status === value ? 'primary' : 'translucent'}
            onClick={() => changeFilters({ status: value })}
          >
            {value ? t(lang, SHARE_STATUS[value].key) : lang('PxgAdminAll')}
          </Button>
        ))}
        <Button
          size="smaller"
          pill
          fluid={false}
          color="green"
          iconName="add"
          className={styles.push}
          onClick={() => openForm()}
        >
          {lang('PxgAdminGrant')}
        </Button>
      </div>
      <div className={styles.shareFilters}>
        <label className={styles.field}>
          <span>{lang('PxgAdminColAccount')}</span>
          <select value={filters.accountId} onChange={(e) => changeFilters({ accountId: e.currentTarget.value })}>
            <option value="">{lang('PxgAdminAll')}</option>
            {accounts?.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName ?? account.id}</option>
            ))}
          </select>
        </label>
        <InputText
          label={lang('PxgAdminGuestFilter')}
          className={styles.shareGuestFilter}
          value={filters.granteeQuery}
          maxLength={64}
          onChange={(e) => changeFilters({ granteeQuery: e.target.value })}
        />
        <InputText
          label={lang('PxgAdminAuditChat')}
          value={filters.peer}
          inputMode="text"
          onChange={(e) => changeFilters({ peer: e.target.value })}
        />
      </div>
      {isFormOpen && <AdminShareForm key={editing?.id ?? 'new'} share={editing} onClose={() => setIsFormOpen(false)} />}
      {!data ? <Loading error={error} lang={lang} /> : (
        <>
          <div className={styles.filters}>
            <Checkbox
              label={lang('ContextMenuItemSelectAll')}
              checked={Boolean(selectableIds.length && selected.length === selectableIds.length)}
              disabled={!selectableIds.length}
              onCheck={(isChecked) => setSelectedIds(isChecked ? selectableIds : [])}
            />
            <Button
              size="smaller"
              color="danger"
              fluid={false}
              disabled={!selected.length}
              onClick={() => ask(lang('PxgAdminBulkRevokeConfirm', { count: selected.length }),
                lang('PxgShareRevoke'), async () => {
                  await pxgRpc.call('admin.shares.revokeMany', { shareIds: selected });
                  setSelectedIds([]);
                })}
            >
              {lang('PxgAdminRevokeSelected', { count: selected.length })}
            </Button>
          </div>
          {data.length === 0 ? <p className={styles.empty}>{lang('PxgAdminEmpty')}</p> : (
            <table className={buildClassName(styles.table, styles.stacked)}>
              <thead>
                <tr>
                  <th aria-label={lang('ContextMenuItemSelectAll')} />
                  <th>{lang('PxgAdminColChat')}</th>
                  <th>{lang('PxgAdminColGuest')}</th>
                  <th>{lang('PxgAdminColPermissions')}</th>
                  <th>{lang('PxgShareExpiry')}</th>
                  <th>{lang('PxgAdminLastUsed')}</th>
                  <th>{lang('PxgAdminColStatus')}</th>
                  <th aria-label={lang('PxgAdminColActions')} />
                </tr>
              </thead>
              <tbody>
                {data.map((share) => {
                  const isExpired = share.status === 'active' && Boolean(share.expiresAt)
                    && Date.parse(share.expiresAt) <= getServerTime() * 1000;
                  const shareStatus = isExpired
                    ? { key: 'PxgShareStatusExpired', tone: 'gray' as const }
                    : SHARE_STATUS[share.status];
                  return (
                    <tr key={share.id}>
                      <td>
                        <Checkbox
                          label={<span className="visually-hidden">{share.label || displayName(share.grantee)}</span>}
                          className={styles.shareSelect}
                          onlyInput
                          checked={selected.includes(share.id)}
                          disabled={share.status === 'revoked'}
                          onCheck={(isChecked) => toggleSelected(share.id, isChecked)}
                        />
                      </td>
                      <td>
                        <div className={styles.name}>
                          {share.scope === 'folder' || share.scope === 'folder_members'
                            ? share.folderTitle ?? share.folderId
                            : share.peerTitle ?? share.peerId}
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
                      <td>
                        {displayName(share.grantee)}
                        {share.grantee?.username && (
                          <div className={styles.secondary}>{'@' + share.grantee.username}</div>
                        )}
                      </td>
                      <td>
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
                      <td>{share.expiresAt ? formatDateTime(share.expiresAt) : lang('PxgExpiryNever')}</td>
                      <td>{formatDateTime(share.lastUsedAt)}</td>
                      <td>
                        <Badge tone={shareStatus.tone}>{t(lang, shareStatus.key)}</Badge>
                        <div className={styles.secondary}>{formatDateTime(share.createdAt)}</div>
                      </td>
                      <td className={styles.actions}>
                        {share.status !== 'revoked' && (
                          <>
                            <Button size="tiny" isText onClick={() => openForm(share)}>{lang('PxgShareEdit')}</Button>
                            <Button
                              size="tiny"
                              color="translucent"
                              isText
                              disabled={share.status === 'source_lost'}
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
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className={styles.filters}>
            <Button
              size="smaller"
              fluid={false}
              disabled={!filters.offset}
              onClick={() => changeFilters({ offset: Math.max(0, filters.offset - SHARES_PAGE_SIZE) })}
            >
              {lang('AccDescrPrevious')}
            </Button>
            <span>{lang.number(filters.offset / SHARES_PAGE_SIZE + 1)}</span>
            <Button
              size="smaller"
              fluid={false}
              disabled={data.length < SHARES_PAGE_SIZE}
              onClick={() => changeFilters({ offset: filters.offset + SHARES_PAGE_SIZE })}
            >
              {lang('Next')}
            </Button>
          </div>
        </>
      )}
    </>
  );
});
