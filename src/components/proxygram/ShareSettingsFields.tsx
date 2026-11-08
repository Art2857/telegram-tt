import { memo } from '../../lib/teact/teact';

import type { Permissions, PresetKey } from '../../proxygram/server/types';

import { PERMISSION_KEYS, resolvePermissions } from '../../proxygram/permissions';
import { formatDateTime } from './helpers';

import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';

import styles from './ConnectServerModal.module.scss';

export type HistoryMode = 'all' | 'new_only' | 'last_n' | 'since_date';
export type Expiry = 'keep' | 'never' | 'day' | 'week' | 'month';
export type ShareSettings = {
  preset: PresetKey;
  permissions: Permissions;
  isCustomizing: boolean;
  historyMode: HistoryMode;
  historyLimit: string;
  historySince: string;
  expiry: Expiry;
  label: string;
  sendLimit: string;
  deleteLimit: string;
  /** The owner's Stars a day for paid messages; only with `spendStars` */
  starsLimit: string;
  excludePeerIds: number[];
};

type OwnProps = {
  value: ShareSettings;
  isFolder?: boolean;
  editingHistory?: HistoryMode;
  expiresAt?: string;
  folderChats?: { peerId: number; title: string }[];
  onChange: (patch: Partial<ShareSettings>) => void;
};

const PRESETS: PresetKey[] = ['readOnly', 'assistant', 'full'];
const HISTORY_MODES: HistoryMode[] = ['all', 'new_only', 'last_n', 'since_date'];
const EXPIRIES: Expiry[] = ['never', 'day', 'week', 'month'];
const EDIT_EXPIRIES: Expiry[] = ['keep', ...EXPIRIES];
const LABEL_MAX_LENGTH = 64;
/** As the server's limit: a guest never gets more of the owner's Stars a day */
const MAX_STARS_PER_DAY = 100_000;
export const HISTORY_KEYS = {
  all: 'PxgHistoryAll', new_only: 'PxgHistoryNew', last_n: 'PxgHistoryLastN', since_date: 'PxgHistorySince',
} as const;
const EXPIRY_KEYS = {
  keep: 'PxgExpiryKeep',
  never: 'PxgExpiryNever', day: 'PxgExpiryDay', week: 'PxgExpiryWeek', month: 'PxgExpiryMonth',
} as const;

/** Общие параметры выдачи и правки доступа владельцем и администратором */
const ShareSettingsFields = ({ value, isFolder, editingHistory, expiresAt, folderChats, onChange }: OwnProps) => {
  const lang = useLang();
  const t = lang as unknown as (key: string) => string;
  const {
    preset, permissions, isCustomizing, historyMode, historyLimit, historySince, expiry, label,
    sendLimit, deleteLimit, starsLimit, excludePeerIds,
  } = value;

  function renderOptions<T extends string>(
    items: T[], selected: T, getLabel: (item: T) => string, onSelect: (item: T) => void,
  ) {
    return (
      <div className={styles.options}>
        {items.map((item) => (
          <Button
            key={item}
            size="smaller"
            pill
            fluid={false}
            color={selected === item ? 'primary' : 'translucent'}
            onClick={() => onSelect(item)}
          >
            {getLabel(item)}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className={styles.sectionTitle}>{lang('PxgSharePreset')}</div>
      {renderOptions(PRESETS, preset, (key) => t(`PxgPreset${key[0].toUpperCase()}${key.slice(1)}`),
        (key) => onChange({ preset: key, permissions: resolvePermissions(key) }))}
      <Button size="smaller" isText fluid={false} onClick={() => onChange({ isCustomizing: !isCustomizing })}>
        {lang('PxgShareCustomize')}
      </Button>
      {isCustomizing && (
        <div className={styles.permissions}>
          {PERMISSION_KEYS.filter((key) => key !== 'read').map((key) => (
            <Checkbox
              key={key}
              label={t(`PxgPerm${key[0].toUpperCase()}${key.slice(1)}`)}
              checked={permissions[key]}
              onCheck={(isChecked) => onChange({ permissions: { ...permissions, [key]: isChecked } })}
            />
          ))}
        </div>
      )}
      {permissions.markRead && <p className={styles.secondary}>{lang('PxgShareReadWarning')}</p>}
      {isFolder && Boolean(folderChats?.length) && (
        <>
          <div className={styles.sectionTitle}>{lang('PxgShareFolderChats')}</div>
          <p className={styles.secondary}>{lang('PxgShareFolderChatsHint')}</p>
          <div className={styles.folderChats}>
            {folderChats.map((chat) => (
              <Checkbox
                key={chat.peerId}
                label={chat.title}
                checked={!excludePeerIds.includes(chat.peerId)}
                onCheck={(isChecked) => onChange({
                  excludePeerIds: isChecked
                    ? excludePeerIds.filter((id) => id !== chat.peerId) : [...excludePeerIds, chat.peerId],
                })}
              />
            ))}
          </div>
        </>
      )}
      <div className={styles.sectionTitle}>{lang('PxgShareHistory')}</div>
      {editingHistory ? (
        <p className={styles.secondary}>
          {`${lang(HISTORY_KEYS[editingHistory])}. ${lang('PxgShareHistoryFixed')}`}
        </p>
      ) : (
        <>
          {renderOptions(HISTORY_MODES.filter((mode) => !isFolder || mode !== 'last_n'), historyMode,
            (mode) => lang(HISTORY_KEYS[mode]), (mode) => onChange({ historyMode: mode }))}
          {historyMode === 'last_n' && (
            <InputText
              label={lang('PxgHistoryCount')}
              inputMode="numeric"
              value={historyLimit}
              onChange={(e) => onChange({ historyLimit: e.target.value.replace(/\D/g, '') })}
            />
          )}
          {historyMode === 'since_date' && (
            <label className={styles.dateField}>
              <span className={styles.secondary}>{lang('PxgHistoryDate')}</span>
              <input
                type="date"
                className="form-control"
                value={historySince}
                onChange={(e) => onChange({ historySince: e.currentTarget.value })}
              />
            </label>
          )}
        </>
      )}
      <div className={styles.sectionTitle}>{lang('PxgShareExpiry')}</div>
      {expiresAt && (
        <p className={styles.secondary}>{lang('PxgShareExpires', { date: formatDateTime(expiresAt) })}</p>
      )}
      {renderOptions(editingHistory ? EDIT_EXPIRIES : EXPIRIES, expiry, (item) => lang(EXPIRY_KEYS[item]),
        (item) => onChange({ expiry: item }))}
      <InputText
        label={lang('PxgShareLabel')}
        value={label}
        maxLength={LABEL_MAX_LENGTH}
        onChange={(e) => onChange({ label: e.target.value })}
      />
      <div className={styles.sectionTitle}>{lang('PxgShareLimits')}</div>
      <p className={styles.secondary}>{lang('PxgShareLimitsHint')}</p>
      <div className={styles.limits}>
        <InputText
          label={lang('PxgShareLimitSend')}
          inputMode="numeric"
          value={sendLimit}
          onChange={(e) => onChange({ sendLimit: e.target.value.replace(/\D/g, '') })}
        />
        <InputText
          label={lang('PxgShareLimitDelete')}
          inputMode="numeric"
          value={deleteLimit}
          onChange={(e) => onChange({ deleteLimit: e.target.value.replace(/\D/g, '') })}
        />
      </div>
      {permissions.spendStars && (
        <>
          <InputText
            label={lang('PxgShareLimitStars')}
            inputMode="numeric"
            value={starsLimit}
            onChange={(e) => onChange({ starsLimit: e.target.value.replace(/\D/g, '') })}
          />
          <p className={styles.secondary}>{lang('PxgShareLimitStarsHint')}</p>
        </>
      )}
    </>
  );
};

/** Without a limit the guest spends nothing: the right alone gives no Stars */
export function parseStarsLimit(value: string, permissions: Permissions) {
  const limit = Number(value);
  return permissions.spendStars && limit > 0 ? Math.min(limit, MAX_STARS_PER_DAY) : undefined;
}

export default memo(ShareSettingsFields);
