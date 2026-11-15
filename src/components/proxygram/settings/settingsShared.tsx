import { useCallback, useEffect, useRef, useState } from '../../../lib/teact/teact';

import type { ImportStateDto, ServerEvent,
} from '../../../proxygram/server/types';
import type { AccessRequestRow, Lang, ShareRow, Translate } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { getServerTime } from '../../../util/serverTime';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../../proxygram/server/store';
import { describePxgError, formatDateTime } from '../helpers';

import Button from '../../ui/Button';

import styles from '../admin/AdminPanel.module.scss';

export const MB = 1024 * 1024;

export const ACCOUNT_STATUS: Record<string, { key: string; tone: 'green' | 'red' | 'gray' | 'blue' }> = {
  active: { key: 'PxgStatusActive', tone: 'green' },
  paused: { key: 'PxgStatusPaused', tone: 'gray' },
  auth_lost: { key: 'PxgStatusAuthLost', tone: 'red' },
  flood: { key: 'PxgStatusFlood', tone: 'red' },
  revoked: { key: 'PxgStatusRevoked', tone: 'gray' },
  connecting: { key: 'PxgStatusConnecting', tone: 'blue' },
};

/** Данные раздела; перечитываются по событиям сервера, которые их меняют */
export function usePxgData<T>(method: string, params: unknown, reloadOn: ServerEvent['e'][]) {
  const [loaded, setLoaded] = useState<{ key: string; value: T }>();
  const [failure, setFailure] = useState<{ key: string; error: unknown }>();
  const paramsKey = JSON.stringify(params ?? {});
  const requestKey = `${method}:${paramsKey}`;
  const reloadKey = reloadOn.join();
  const requestRef = useRef(0);
  const connection = usePxgState((state) => state.connection);

  const reload = useCallback(() => {
    const request = ++requestRef.current;
    pxgRpc.call<T>(method, JSON.parse(paramsKey))
      .then((result) => {
        if (request !== requestRef.current) return;
        setLoaded({ key: requestKey, value: result });
        setFailure(undefined);
      })
      .catch((err) => {
        if (request === requestRef.current) setFailure({ key: requestKey, error: err });
      });
  }, [method, paramsKey, requestKey, requestRef]);

  useEffect(() => {
    if (connection !== 'online') return undefined;
    reload();
    const events = new Set(reloadKey.split(','));
    const unsubscribe = pxgRpc.on((event) => {
      if (events.has(event.e)) {
        if (event.e === 'access.changed') setLoaded(undefined);
        reload();
      }
    });
    return () => {
      // This ref tracks RPC generations; cleanup invalidates responses from the previous subscription
      // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
      requestRef.current++;
      unsubscribe();
    };
  }, [reload, reloadKey, connection, requestRef]);

  return {
    data: loaded?.key === requestKey ? loaded.value : undefined,
    error: failure?.key === requestKey ? failure.error : undefined,
    reload,
  };
}

export function Loading({ error, lang, isLocal, onRetry }: {
  error: unknown; lang: Lang; isLocal?: boolean; onRetry?: NoneToVoidFunction;
}) {
  const connection = usePxgState((state) => state.connection);
  const isWaiting = !isLocal && connection !== 'online';
  return (
    <div className={styles.empty}>
      <p>{isWaiting ? lang('WaitingForNetwork') : error ? describePxgError(lang, error) : lang('PxgAdminLoading')}</p>
      {Boolean(error) && onRetry && (
        <Button size="smaller" fluid={false} disabled={isWaiting} onClick={() => onRetry()}>{lang('Retry')}</Button>
      )}
    </div>
  );
}

export function Badge({ tone, text }: { tone: 'green' | 'red' | 'gray' | 'blue'; text: string }) {
  return <span className={buildClassName(styles.badge, styles[tone])}>{text}</span>;
}

/** Reasons the server sets itself are codes; the rest is Telegram's own error text */
const STATUS_REASON_KEYS: Record<string, string> = {
  logout_pending: 'PxgReasonLogoutPending',
  logged_out: 'PxgReasonLoggedOut',
  wipe_pending: 'PxgReasonWipePending',
};

export function describeStatusReason(t: Translate, reason: string) {
  const key = STATUS_REASON_KEYS[reason];
  return key ? t(key) : reason;
}

export function renderImport(t: Translate, state: ImportStateDto | null) {
  if (state?.status !== 'running') return undefined;
  return (
    <div className={styles.secondary}>{t('PxgImportProgress', { done: state.doneCount, total: state.total })}</div>
  );
}

export const REQUEST_STATUS_KEYS: Record<AccessRequestRow['status'], string> = {
  pending: 'PxgRequestPending',
  approved: 'PxgRequestApproved',
  rejected: 'PxgRequestRejected',
  cancelled: 'PxgRequestCancelled',
  expired: 'PxgRequestExpired',
};

/** Откуда у гостя чат: прямой доступ, тема, папка или охват участников */
export function describeSource(t: Translate, share: ShareRow) {
  if (share.scope === 'folder' || share.scope === 'folder_members') {
    return t('PxgSharesViaFolder', {
      title: share.folderTitle || t('PxgSettingsFolder', { id: share.folderId ?? 0 }),
    });
  }
  if (share.scope === 'topic') return t('PxgSharesViaTopic', { title: share.topicTitle ?? '—' });
  if (share.scope === 'chat_members') {
    return t('PxgSharesViaChatMembers', { title: share.peerTitle ?? '—' });
  }
  return t('PxgSharesViaDirect');
}

/** Правка доступа — то же окно «Поделиться», что и из профиля чата */
export function openShareEditor(share: ShareRow) {
  if (share.scope === 'folder' || share.scope === 'folder_members') {
    setPxgState({
      shareChatId: undefined,
      shareFolder: { id: share.folderId!, title: share.folderTitle ?? '' },
      shareTopic: undefined,
      shareEditId: share.id,
    });
    return;
  }
  setPxgState({
    shareChatId: String(share.peerId),
    shareFolder: undefined,
    shareTopic: share.scope === 'topic' && share.topicId
      ? { id: share.topicId, title: share.topicTitle ?? '' } : undefined,
    shareEditId: share.id,
  });
}

export function byExpiry(a: ShareRow, b: ShareRow) {
  return Date.parse(a.expiresAt ?? '') - Date.parse(b.expiresAt ?? '');
}

export function describeTarget(t: Translate, share: ShareRow) {
  if (share.label) return share.label;
  if (share.scope === 'folder' || share.scope === 'folder_members') {
    const title = share.folderTitle || t('PxgSettingsFolder', { id: share.folderId ?? 0 });
    return share.scope === 'folder_members' ? `${title} · ${t('PxgShareMembersChip')}` : title;
  }
  if (share.scope === 'topic' && share.topicTitle) return `${share.peerTitle ?? '—'} › ${share.topicTitle}`;
  if (share.scope === 'chat_members') {
    return `${share.peerTitle ?? '—'} · ${t('PxgShareMembersChip')}`;
  }
  return share.peerTitle ?? '—';
}

export function describeShare(t: Translate, share: ShareRow) {
  const parts = [t(`PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)];
  if (share.expiresAt && Date.parse(share.expiresAt) <= getServerTime() * 1000) {
    parts.push(t('PxgShareStatusExpired'));
  }
  if (share.status === 'paused') parts.push(t('PxgShareStatusPaused'));
  if (share.status === 'source_lost') parts.push(t('PxgShareStatusLost'));
  if (share.expiresAt) parts.push(t('PxgShareExpires', { date: formatDateTime(share.expiresAt) }));
  return parts.join(' · ');
}

export function formatMegabytes(bytes: number) {
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups.entries()];
}
