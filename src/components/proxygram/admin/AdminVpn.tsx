import { memo, useEffect, useState } from '../../../lib/teact/teact';

import buildClassName from '../../../util/buildClassName';
import { formatFileSize } from '../../../util/textFormat';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { usePxgState } from '../../../proxygram/server/store';
import { describePxgError, formatDateTime } from '../helpers';

import useLang from '../../../hooks/useLang';

import Button from '../../ui/Button';
import TextArea from '../../ui/TextArea';

import styles from './AdminPanel.module.scss';

/** Как сервер видит свой VPN-выход (apps/server/src/admin/vpn-admin.ts, VpnStatusDto) */
export type VpnStatus = {
  isReachable: boolean;
  isHealthy: boolean;
  active: string | null;
  lastSweepAt: string | null;
  lastActiveOkAt: string | null;
  failsInRow: number;
  nodes: {
    tag: string;
    ok: boolean;
    usable: boolean;
    rttMs: number | null;
    kbps: number | null;
    reason: string | null;
    excludedUntil: string | null;
  }[];
  switches: { at: string; from: string | null; to: string; reason: string }[];
  subscription: {
    origin: 'env' | 'admin' | 'file';
    refreshedAt: string | null;
    changedAt: string | null;
    error: string | null;
    nodes: number;
    expireAt: string | null;
    usedBytes: number | null;
    totalBytes: number | null;
    canControl: boolean;
  } | null;
};

type CommandResult = { nodes: number; answering: number; working: number; active: string | null };

type Lang = ReturnType<typeof useLang>;

const REFRESH_MS = 15000;
const ALERT_REFRESH_MS = 30000;
/** Предупреждать о конце подписки заранее: продлить или заменить успеют */
const EXPIRY_WARNING_DAYS = 3;
const TRAFFIC_WARNING_SHARE = 0.9;
/** Исключение узла — проверка переключения: на 10 минут */
const EXCLUDE_MINUTES = 10;

const t = (lang: Lang, key: string, vars?: Record<string, string | number>) => (
  (lang as unknown as (k: string, v?: Record<string, string | number>) => string)(key, vars)
);

function useVpnStatus(refreshMs: number, isEnabled = true) {
  const [status, setStatus] = useState<VpnStatus | null>();
  const [error, setError] = useState<unknown>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isEnabled) return undefined;
    let isActive = true;
    const load = () => {
      pxgRpc.call<VpnStatus | null>('admin.vpn', {})
        .then((result) => {
          if (!isActive) return;
          setStatus(result);
          setError(undefined);
        })
        .catch((err) => {
          if (isActive) setError(err);
        });
    };
    load();
    const timer = window.setInterval(load, refreshMs);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [refreshMs, isEnabled, version]);

  return { status, error, reload: () => setVersion((value) => value + 1) };
}

/** Что сейчас не так со связью — для яркого предупреждения; всё хорошо — undefined */
function problemOf(lang: Lang, status: VpnStatus | null | undefined): string | undefined {
  if (!status) return undefined;
  if (!status.isReachable) return lang('PxgAdminVpnAlertUnreachable');
  if (!status.isHealthy) return lang('PxgAdminVpnAlertDown');
  const sub = status.subscription;
  if (sub?.expireAt && new Date(sub.expireAt).getTime() - Date.now() < EXPIRY_WARNING_DAYS * 24 * 3600 * 1000) {
    return t(lang, 'PxgAdminVpnAlertExpiring', { date: formatDateTime(sub.expireAt) });
  }
  const used = sub?.usedBytes ?? undefined;
  if (sub?.totalBytes && used !== undefined && used > sub.totalBytes * TRAFFIC_WARNING_SHARE) {
    return t(lang, 'PxgAdminVpnAlertTraffic', {
      used: formatFileSize(lang, used), total: formatFileSize(lang, sub.totalBytes),
    });
  }
  return undefined;
}

/**
 * Яркое предупреждение администратору: нет связи с Telegram, служба VPN молчит, подписка кончается.
 * Показывается сверху админки и настроек; у остальных ничего не запрашивает
 */
export const VpnAlert = memo(({ onOpen }: { onOpen?: () => void }) => {
  const lang = useLang();
  const isAdmin = usePxgState((state) => state.session?.user.role === 'admin');
  const { status } = useVpnStatus(ALERT_REFRESH_MS, isAdmin);
  const problem = isAdmin ? problemOf(lang, status) : undefined;
  if (!problem) return undefined;

  return (
    <div className={styles.vpnAlert} role="alert">
      <span>{problem}</span>
      {onOpen && (
        <Button size="smaller" color="danger" fluid={false} onClick={onOpen}>
          {lang('PxgAdminVpnOpen')}
        </Button>
      )}
    </div>
  );
});

function nodeState(lang: Lang, node: VpnStatus['nodes'][number]) {
  if (node.excludedUntil) {
    return { text: t(lang, 'PxgAdminVpnNodeExcluded', { time: formatDateTime(node.excludedUntil) }), tone: 'gray' };
  }
  if (node.usable) return { text: lang('PxgAdminVpnNodeWorking'), tone: 'green' };
  if (node.ok && !node.reason) return { text: lang('PxgAdminVpnNodeAnswers'), tone: 'blue' };
  return { text: lang('PxgAdminVpnNodeDown'), tone: 'red' };
}

/** Раздел «Связь с Telegram»: какой узел выбран, какие работают, переключения и подписка (docs/spec/11 §6) */
export const VpnTab = memo(({ run }: { run: (action: () => Promise<unknown>) => Promise<void> }) => {
  const lang = useLang();
  const { status, error, reload } = useVpnStatus(REFRESH_MS);
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<string>();
  const [isReplacing, setIsReplacing] = useState(false);
  const [subscription, setSubscription] = useState('');

  if (status === undefined) {
    return <p className={styles.empty}>{error ? describePxgError(lang, error) : lang('PxgAdminLoading')}</p>;
  }
  // Без VPN сервер ходит в Telegram напрямую: показывать нечего
  if (!status) return <p className={styles.empty}>{lang('PxgAdminVpnNotUsed')}</p>;

  const command = (key: string, method: string, params: unknown, describe: (r: CommandResult) => string) => {
    setResult(undefined);
    setBusy(key);
    void run(async () => {
      try {
        const response = await pxgRpc.call<CommandResult>(method, params);
        setResult(describe(response));
        if (key === 'replace') {
          setIsReplacing(false);
          setSubscription('');
        }
      } finally {
        setBusy(undefined);
        reload();
      }
    });
  };
  const checked = (r: CommandResult) => t(lang, 'PxgAdminVpnChecked', {
    answering: r.answering, nodes: r.nodes, working: r.working, active: r.active ?? '—',
  });

  const sub = status.subscription;
  const subUsed = sub?.usedBytes ?? undefined;
  const canControl = Boolean(sub?.canControl);
  const active = status.nodes.find((node) => node.tag === status.active);
  const problem = problemOf(lang, status);

  return (
    <>
      {problem && <div className={styles.vpnAlert} role="alert"><span>{problem}</span></div>}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={buildClassName(styles.statValue, status.isHealthy ? styles.green : styles.red)}>
            {lang(status.isHealthy ? 'PxgAdminVpnHealthy' : 'PxgAdminVpnDown')}
          </span>
          <span className={styles.statLabel}>{lang('PxgAdminVpn')}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{status.active ?? '—'}</span>
          <span className={styles.statLabel}>
            {active?.rttMs
              ? `${lang('PxgAdminVpnActive')} · ${t(lang, 'PxgAdminVpnMs', { value: active.rttMs })}`
              : lang('PxgAdminVpnActive')}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>
            {`${status.nodes.filter((node) => node.usable).length} / ${status.nodes.filter((node) => node.ok).length}`
              + ` / ${status.nodes.length}`}
          </span>
          <span className={styles.statLabel}>{lang('PxgAdminVpnCounts')}</span>
        </div>
      </div>
      <p className={styles.secondary}>
        {status.lastSweepAt ? t(lang, 'PxgAdminVpnLastCheck', { date: formatDateTime(status.lastSweepAt) }) : ''}
      </p>

      {canControl ? (
        <div className={styles.actions}>
          <Button
            size="smaller"
            fluid={false}
            disabled={Boolean(busy)}
            onClick={() => command('check', 'admin.vpn.command', { command: 'check' }, checked)}
          >
            {busy === 'check' ? lang('PxgAdminVpnBusy') : lang('PxgAdminVpnCheckNow')}
          </Button>
          <Button
            size="smaller"
            fluid={false}
            color="translucent"
            disabled={Boolean(busy)}
            onClick={() => command('refresh', 'admin.vpn.command', { command: 'refresh' }, checked)}
          >
            {busy === 'refresh' ? lang('PxgAdminVpnBusy') : lang('PxgAdminVpnRefresh')}
          </Button>
          <Button
            size="smaller"
            fluid={false}
            color="translucent"
            disabled={Boolean(busy)}
            onClick={() => setIsReplacing(!isReplacing)}
          >
            {lang('PxgAdminVpnReplace')}
          </Button>
          {sub?.origin === 'admin' && (
            <Button
              size="smaller"
              fluid={false}
              color="translucent"
              disabled={Boolean(busy)}
              onClick={() => command('rollback', 'admin.vpn.command', { command: 'rollback' }, checked)}
            >
              {busy === 'rollback' ? lang('PxgAdminVpnBusy') : lang('PxgAdminVpnRollback')}
            </Button>
          )}
        </div>
      ) : (
        status.isReachable && <p className={styles.secondary}>{lang('PxgAdminVpnNoControl')}</p>
      )}
      {result && <p className={styles.vpnResult}>{result}</p>}

      {isReplacing && canControl && (
        <div className={styles.vpnReplace}>
          <p className={styles.secondary}>{lang('PxgAdminVpnReplaceHint')}</p>
          <TextArea
            label={lang('PxgAdminVpnSubscription')}
            value={subscription}
            maxLength={60000}
            onChange={(e) => setSubscription(e.target.value)}
          />
          <Button
            size="smaller"
            fluid={false}
            disabled={Boolean(busy) || !subscription.trim()}
            onClick={() => command('replace', 'admin.vpn.setSubscription', { subscription }, (r) => (
              t(lang, 'PxgAdminVpnApplied', { nodes: r.nodes, working: r.working, active: r.active ?? '—' })
            ))}
          >
            {busy === 'replace' ? lang('PxgAdminVpnBusy') : lang('PxgAdminVpnApply')}
          </Button>
        </div>
      )}

      {sub && (
        <>
          <h3 className={styles.sectionTitle}>{lang('PxgAdminVpnSubscription')}</h3>
          <p>
            {lang(sub.origin === 'admin' ? 'PxgAdminVpnOriginAdmin' : sub.origin === 'file' ? 'PxgAdminVpnOriginFile'
              : 'PxgAdminVpnOriginEnv')}
            {` · ${t(lang, 'PxgAdminVpnNodesInSubscription', { count: sub.nodes })}`}
            {sub.refreshedAt ? ` · ${t(lang, 'PxgAdminVpnRefreshed', { date: formatDateTime(sub.refreshedAt) })}` : ''}
          </p>
          {(sub.expireAt || subUsed !== undefined) && (
            <p>
              {sub.expireAt ? t(lang, 'PxgAdminVpnExpires', { date: formatDateTime(sub.expireAt) }) : ''}
              {sub.expireAt && subUsed !== undefined ? ' · ' : ''}
              {subUsed !== undefined && (sub.totalBytes
                ? t(lang, 'PxgAdminVpnTraffic', {
                  used: formatFileSize(lang, subUsed), total: formatFileSize(lang, sub.totalBytes),
                })
                : t(lang, 'PxgAdminVpnTrafficUnlimited', { used: formatFileSize(lang, subUsed) }))}
            </p>
          )}
          {sub.error && <p className={styles.red}>{t(lang, 'PxgAdminVpnSubscriptionError', { error: sub.error })}</p>}
        </>
      )}

      <h3 className={styles.sectionTitle}>{lang('PxgAdminVpnNodesTitle')}</h3>
      {!status.nodes.length ? <p className={styles.empty}>{lang('PxgAdminVpnUnreachable')}</p> : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <thead>
            <tr>
              <th>{lang('PxgAdminVpnColNode')}</th>
              <th>{lang('PxgAdminVpnColPing')}</th>
              <th>{lang('PxgAdminVpnColSpeed')}</th>
              <th>{lang('PxgAdminVpnColStatus')}</th>
              {canControl && <th aria-label={lang('PxgAdminVpnColStatus')} />}
            </tr>
          </thead>
          <tbody>
            {status.nodes.map((node) => {
              const state = nodeState(lang, node);
              return (
                <tr key={node.tag} className={node.tag === status.active ? styles.vpnActiveRow : undefined}>
                  <td>
                    {node.tag}
                    {node.tag === status.active && (
                      <span className={styles.secondary}>{` · ${lang('PxgAdminVpnActive')}`}</span>
                    )}
                  </td>
                  <td className={styles.nowrap}>
                    {node.rttMs ? t(lang, 'PxgAdminVpnMs', { value: node.rttMs }) : '—'}
                  </td>
                  <td className={styles.nowrap}>
                    {node.kbps ? t(lang, 'PxgAdminVpnKbps', { value: node.kbps }) : '—'}
                  </td>
                  <td>
                    <span className={buildClassName(styles.badge, styles[state.tone])}>{state.text}</span>
                    {node.reason && !node.usable && <div className={styles.details}>{node.reason}</div>}
                  </td>
                  {canControl && (
                    <td className={styles.actions}>
                      <Button
                        size="tiny"
                        fluid={false}
                        color="translucent"
                        disabled={Boolean(busy)}
                        onClick={() => command(`exclude:${node.tag}`, 'admin.vpn.exclude', {
                          tag: node.tag, minutes: node.excludedUntil ? 0 : EXCLUDE_MINUTES,
                        }, checked)}
                      >
                        {node.excludedUntil ? lang('PxgAdminVpnInclude') : lang('PxgAdminVpnExclude')}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {Boolean(status.switches.length) && (
        <>
          <h3 className={styles.sectionTitle}>{lang('PxgAdminVpnSwitches')}</h3>
          <table className={buildClassName(styles.table, styles.stacked)}>
            <thead>
              <tr>
                <th>{lang('PxgAdminColTime')}</th>
                <th>{lang('PxgAdminVpnSwitch')}</th>
                <th>{lang('PxgAdminColDetails')}</th>
              </tr>
            </thead>
            <tbody>
              {status.switches.map((item) => (
                <tr key={item.at}>
                  <td className={styles.nowrap}>{formatDateTime(item.at)}</td>
                  <td>{[item.from, item.to].filter(Boolean).join(' → ')}</td>
                  <td className={styles.details}>{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
});
