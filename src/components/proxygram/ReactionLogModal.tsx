import { memo, useEffect, useMemo, useState } from '../../lib/teact/teact';

import type { ReactionLogEntryDto } from '../../proxygram/server/types';

import { formatDateTime } from '../../util/localization/dateFormat';
import { buildProxyCatalogMediaId } from '../../api/proxy/mediaIds';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';

import CustomEmoji from '../common/CustomEmoji';
import Modal from '../ui/Modal';

import styles from './ReactionLogModal.module.scss';

const EMOJI_SIZE = 20;

/** PLAN.md 13: an account has one reaction slot, so the log tells who set the current one and who set them before */
const ReactionLogModal = () => {
  const lang = useLang();
  const target = usePxgState((state) => state.reactionLogMessage);
  const [entries, setEntries] = useState<ReactionLogEntryDto[]>();

  useEffect(() => {
    setEntries(undefined);
    if (!target) return undefined;
    let isActive = true;
    const { isProxy, ...params } = target;
    pxgRpc.call<ReactionLogEntryDto[]>(isProxy ? 'messages.reactionLog' : 'archive.reactionLog', params)
      .then((result) => isActive && setEntries(result))
      .catch(() => isActive && setEntries([]));
    return () => {
      isActive = false;
    };
  }, [target]);

  // Entries go from new to old: the first mention of a reaction by someone tells if it still stands
  const currentIndexes = useMemo(() => {
    const seen = new Set<string>();
    const current = new Set<number>();
    entries?.forEach((entry, index) => {
      const key = `${entry.guestName || entry.peerName}:${JSON.stringify(entry.reaction)}`;
      if (!seen.has(key) && !entry.isRemoved) current.add(index);
      seen.add(key);
    });
    return current;
  }, [entries]);

  return (
    <Modal
      isOpen={Boolean(target)}
      title={lang('PxgReactionLog')}
      hasCloseButton
      onClose={() => setPxgState({ reactionLogMessage: undefined })}
    >
      {entries?.length === 0 && <p className={styles.empty}>{lang('PxgReactionLogEmpty')}</p>}
      <ul className={styles.list}>
        {entries?.map((entry, index) => (
          <li key={`${entry.at}:${index}`} className={styles.entry}>
            <span className={styles.emoji}>{renderReaction(entry, target?.accountId, target?.isProxy)}</span>
            <span className={styles.who}>
              {entry.guestName
                ? lang('PxgReactionLogGuest', { name: entry.guestName })
                : entry.peerName || lang('PxgReactionLogUnknown')}
              {entry.isRemoved && <span className={styles.removed}>{` · ${lang('PxgReactionLogRemoved')}`}</span>}
              {currentIndexes.has(index) && <span className={styles.current}>{` · ${lang('PxgReactionLogNow')}`}</span>}
            </span>
            <span className={styles.date}>
              {formatDateTime(lang, new Date(entry.at), { date: 'short', time: 'short' })}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
};

function renderReaction({ reaction }: ReactionLogEntryDto, accountId?: string, isProxy?: boolean) {
  if (!reaction) return '—';
  if ('emoji' in reaction) return reaction.emoji;
  const userId = getPxgState().session?.user.id;
  const documentId = isProxy && userId && accountId
    ? buildProxyCatalogMediaId(userId, accountId, reaction.documentId) : reaction.documentId;
  return <CustomEmoji documentId={documentId} size={EMOJI_SIZE} />;
}

export default memo(ReactionLogModal);
