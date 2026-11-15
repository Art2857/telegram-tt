import type { TeactNode } from '../../../lib/teact/teact';
import { useEffect, useState } from '../../../lib/teact/teact';

import type { AdminTopic,
} from '../../../proxygram/server/types';
import type { TabProps } from './adminTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { usePxgState } from '../../../proxygram/server/store';
import { describePxgError } from '../helpers';

import styles from './AdminPanel.module.scss';

/** PLAN.md 13: the admin is warned before the storage disk runs out */
export const DISK_WARNING_PERCENT = 80;

export const SYSTEM_REFRESH_MS = 15000;

export const AUDIT_PAGE = 200;

/** Загрузка раздела админки с живым обновлением по событию admin.changed */
export function useAdminData<T>(method: string, params: unknown, topics: AdminTopic[], refreshMs?: number) {
  const [loaded, setLoaded] = useState<{ key: string; value: T }>();
  const [failure, setFailure] = useState<{ key: string; error: unknown }>();
  const connection = usePxgState((state) => state.connection);
  const paramsKey = JSON.stringify(params ?? {});
  const requestKey = `${method}:${paramsKey}`;
  const topicsKey = JSON.stringify(topics);

  useEffect(() => {
    if (connection !== 'online') return undefined;
    let isActive = true;
    let requestId = 0;

    function reload() {
      const currentId = ++requestId;
      pxgRpc.call<T>(method, JSON.parse(paramsKey))
        .then((result) => {
          if (!isActive || currentId !== requestId) return;
          setLoaded({ key: requestKey, value: result });
          setFailure(undefined);
        })
        .catch((err) => {
          if (isActive && currentId === requestId) setFailure({ key: requestKey, error: err });
        });
    }

    reload();
    const subscribedTopics = JSON.parse(topicsKey) as AdminTopic[];
    const unsubscribe = pxgRpc.on((event) => {
      if (event.e === 'admin.changed' && event.d.topics.some((topic) => subscribedTopics.includes(topic))) reload();
    });
    const timer = refreshMs ? window.setInterval(reload, refreshMs) : undefined;
    return () => {
      isActive = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [method, paramsKey, requestKey, topicsKey, refreshMs, connection]);

  return {
    data: loaded?.key === requestKey ? loaded.value : undefined,
    error: failure?.key === requestKey ? failure.error : undefined,
  };
}

export const call = (method: string, params?: unknown) => () => pxgRpc.call(method, params);

export function Loading({ error, lang }: { error: unknown; lang: TabProps['lang'] }) {
  return <p className={styles.empty}>{error ? describePxgError(lang, error) : lang('PxgAdminLoading')}</p>;
}

export function Badge({ children, tone }: { children: TeactNode; tone?: 'green' | 'red' | 'blue' | 'gray' }) {
  return <span className={buildClassName(styles.badge, tone && styles[tone])}>{children}</span>;
}

/** Кружок с инициалами: у людей админки нет фотографий Telegram, цвет стабилен для одного и того же id */
export function AdminAvatar({ name, id }: { name: string; id: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % 360;
  return (
    <span className={styles.avatar} style={`background: hsl(${hash} 45% 45%)`}>
      {initials || '?'}
    </span>
  );
}

export function LevelBadge({ level, lang }: { level: 'guest' | 'client' | null; lang: TabProps['lang'] }) {
  if (!level) return undefined;
  return (
    <Badge tone={level === 'client' ? 'blue' : 'gray'}>
      {level === 'client' ? lang('PxgLevelClient') : lang('PxgLevelGuest')}
    </Badge>
  );
}

export const ACCOUNT_STATUS: Record<string, { key: string; tone: 'green' | 'red' | 'blue' | 'gray' }> = {
  active: { key: 'PxgStatusActive', tone: 'green' },
  paused: { key: 'PxgStatusPaused', tone: 'gray' },
  auth_lost: { key: 'PxgStatusAuthLost', tone: 'red' },
  flood: { key: 'PxgStatusFlood', tone: 'red' },
  revoked: { key: 'PxgStatusRevoked', tone: 'gray' },
  connecting: { key: 'PxgStatusConnecting', tone: 'blue' },
};

export const SHARE_STATUS: Record<string, { key: string; tone: 'green' | 'red' | 'blue' | 'gray' }> = {
  active: { key: 'PxgShareStatusActive', tone: 'green' },
  paused: { key: 'PxgShareStatusPaused', tone: 'gray' },
  revoked: { key: 'PxgShareStatusRevoked', tone: 'gray' },
  source_lost: { key: 'PxgShareStatusLost', tone: 'red' },
};

export const t = (lang: TabProps['lang'], key: string, vars?: Record<string, string | number>) => (
  (lang as unknown as (k: string, v?: Record<string, string | number>) => string)(key, vars)
);

// ─── Доступы ────────────────────────────────────────────────────────────────

export const SHARES_PAGE_SIZE = 200;

export const REQUESTS_PAGE_SIZE = 50;

export const USERS_PAGE_SIZE = 100;
