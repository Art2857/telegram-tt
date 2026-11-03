import { memo, useEffect, useState } from '../../lib/teact/teact';
import { getGlobal } from '../../global';

import type { PresetKey } from '../../proxygram/server/types';

import { selectChat } from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { isProxyPeerId } from '../../api/proxy/ids';
import { getOwnAccountId } from '../../proxygram/server/ownAccount';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { displayName, formatDateTime } from './helpers';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Island, { IslandTitle } from '../gili/layout/Island';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

import styles from './ProxyAccessSection.module.scss';

type OwnProps = {
  chatId: string;
  className?: string;
};

type Share = {
  id: string;
  accountId: string;
  scope: 'chat' | 'topic' | 'folder';
  peerId: number | null;
  topicId: number | null;
  topicTitle: string | null;
  preset: PresetKey;
  permissions: Record<string, boolean>;
  label: string | null;
  expiresAt: string | null;
  status: 'active' | 'paused' | 'source_lost';
  grantee: { id: string; username: string | null; firstName: string | null };
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** PLAN.md 7.9: the chat profile lists whom the owner shares this chat or its topics with, to change or revoke */
const ProxyAccessSection = ({ chatId, className }: OwnProps) => {
  const lang = useLang();
  const t = lang as unknown as Translate;
  const accountId = usePxgState(() => getOwnAccountId());
  const connection = usePxgState((state) => state.connection);
  const [shares, setShares] = useState<Share[]>();
  const [revoking, setRevoking] = useState<Share>();
  const peerId = Number(chatId);

  const load = useLastCallback(() => {
    if (!accountId || connection !== 'online' || isProxyPeerId(chatId)) return;
    pxgRpc.call<Share[]>('shares.outgoing')
      .then((list) => setShares(list.filter((share) => (
        share.accountId === accountId && share.peerId === peerId && share.scope !== 'folder'
      ))))
      .catch(() => undefined);
  });

  useEffect(() => {
    setShares(undefined);
    load();
  }, [accountId, connection, chatId, load]);

  useEffect(() => pxgRpc.on((event) => {
    if (event.e === 'shares.changed' || event.e === 'access.changed') load();
  }), [load]);

  const handleEdit = useLastCallback((share: Share) => {
    setPxgState({
      shareChatId: chatId,
      shareFolder: undefined,
      shareTopic: share.scope === 'topic' && share.topicId
        ? { id: share.topicId, title: share.topicTitle ?? '' } : undefined,
      shareEditId: share.id,
    });
  });

  const handleRevoke = useLastCallback(async () => {
    const share = revoking;
    setRevoking(undefined);
    if (share) await pxgRpc.call('shares.revoke', { shareId: share.id }).catch(() => undefined);
    load();
  });

  if (!shares?.length) return undefined;

  return (
    <Island className={buildClassName(styles.root, className)}>
      <IslandTitle>{lang('PxgProxyAccessTitle')}</IslandTitle>
      {shares.map((share) => (
        <div key={share.id} className={styles.row}>
          <div className={styles.info}>
            <div className={styles.name}>
              {displayName(share.grantee)}
              {share.topicTitle && <span className={styles.topic}>{` › ${share.topicTitle}`}</span>}
            </div>
            <div className={styles.chips}>
              {describeChips(t, share).map((chip) => <span key={chip} className={styles.chip}>{chip}</span>)}
            </div>
          </div>
          <Button
            round
            size="smaller"
            color="translucent"
            iconName="edit"
            ariaLabel={lang('PxgShareEdit')}
            onClick={() => handleEdit(share)}
          />
          <Button
            round
            size="smaller"
            color="translucent"
            iconName="delete"
            ariaLabel={lang('PxgShareRevoke')}
            onClick={() => setRevoking(share)}
          />
        </div>
      ))}
      <ConfirmDialog
        isOpen={Boolean(revoking)}
        onClose={() => setRevoking(undefined)}
        text={revoking ? t('PxgSettingsRevokeConfirm', {
          name: displayName(revoking.grantee),
          title: [selectChat(getGlobal(), chatId)?.title, revoking.topicTitle].filter(Boolean).join(' › '),
        }) : undefined}
        confirmLabel={lang('PxgShareRevoke')}
        confirmIsDestructive
        confirmHandler={handleRevoke}
      />
    </Island>
  );
};

/** The preset, then what makes this access special: own permissions, pause, end date, the owner's label */
function describeChips(t: Translate, share: Share) {
  const chips = [t(`PxgPreset${share.preset[0].toUpperCase()}${share.preset.slice(1)}`)];
  if (Object.keys(share.permissions).length) chips.push(t('PxgShareChipCustom'));
  if (share.status === 'paused') chips.push(t('PxgShareStatusPaused'));
  if (share.status === 'source_lost') chips.push(t('PxgShareStatusLost'));
  if (share.expiresAt) chips.push(t('PxgShareExpires', { date: formatDateTime(share.expiresAt) }));
  if (share.label) chips.push(share.label);
  return chips;
}

export default memo(ProxyAccessSection);
