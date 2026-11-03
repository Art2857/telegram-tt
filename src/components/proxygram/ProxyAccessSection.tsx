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
import Checkbox from '../ui/Checkbox';
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

type ArchiveScope = {
  archived: boolean;
  reason: 'shared' | 'enabled' | 'disabled' | 'policy';
  /** The owner's exception; the server sends null when the policy decides */
  enabled?: boolean;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * PLAN.md 7.9: the chat profile lists whom the owner shares this chat or its topics with, to change or revoke, and
 * whether the server archives the chat (5.5: channels and large groups are not archived unless shared)
 */
const ProxyAccessSection = ({ chatId, className }: OwnProps) => {
  const lang = useLang();
  const t = lang as unknown as Translate;
  const accountId = usePxgState(() => getOwnAccountId());
  const connection = usePxgState((state) => state.connection);
  const [shares, setShares] = useState<Share[]>();
  const [archive, setArchive] = useState<ArchiveScope>();
  const [revoking, setRevoking] = useState<Share>();
  const peerId = Number(chatId);

  const isAvailable = Boolean(accountId) && connection === 'online' && !isProxyPeerId(chatId);

  const load = useLastCallback(() => {
    if (!isAvailable) return;
    pxgRpc.call<Share[]>('shares.outgoing')
      .then((list) => setShares(list.filter((share) => (
        share.accountId === accountId && share.peerId === peerId && share.scope !== 'folder'
      ))))
      .catch(() => undefined);
    // the worker has not seen the chat yet: there is nothing to switch
    pxgRpc.call<ArchiveScope>('archive.chat.get', { accountId, peerId })
      .then(setArchive)
      .catch(() => setArchive(undefined));
  });

  useEffect(() => {
    setShares(undefined);
    setArchive(undefined);
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

  const handleShare = useLastCallback(() => {
    setPxgState({
      shareChatId: chatId, shareFolder: undefined, shareTopic: undefined, shareEditId: undefined,
    });
  });

  const setArchiveEnabled = useLastCallback((enabled?: boolean) => {
    // The server goes back to the policy only on an explicit JSON `null`
    // eslint-disable-next-line no-null/no-null
    pxgRpc.call<ArchiveScope>('archive.chat.set', { accountId, peerId, enabled: enabled ?? null })
      .then(setArchive)
      .catch(() => undefined);
  });

  if (!isAvailable || !shares) return undefined;

  return (
    <Island className={buildClassName(styles.root, className)}>
      <IslandTitle>{lang('PxgProxyAccessTitle')}</IslandTitle>
      {archive && (
        <div className={styles.archive}>
          <Checkbox
            label={lang('PxgArchiveChat')}
            subLabel={describeArchive(t, archive)}
            checked={archive.archived}
            disabled={archive.reason === 'shared'}
            onCheck={setArchiveEnabled}
          />
          {typeof archive.enabled === 'boolean' && archive.reason !== 'shared' && (
            <Button size="tiny" isText fluid={false} onClick={() => setArchiveEnabled()}>
              {lang('PxgArchiveChatReset')}
            </Button>
          )}
        </div>
      )}
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
      <Button className={styles.add} isText fluid={false} iconName="add" onClick={handleShare}>
        {lang('PxgProxyAccessAdd')}
      </Button>
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

function describeArchive(t: Translate, archive: ArchiveScope) {
  if (archive.reason === 'shared') return t('PxgArchiveChatShared');
  if (archive.reason === 'enabled') return t('PxgArchiveChatEnabled');
  if (archive.reason === 'disabled') return t('PxgArchiveChatDisabled');
  return t(archive.archived ? 'PxgArchiveChatPolicyOn' : 'PxgArchiveChatPolicyOff');
}

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
