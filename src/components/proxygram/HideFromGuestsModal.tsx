import { memo, useEffect, useMemo, useState } from '../../lib/teact/teact';

import type { HiddenMessageDto } from '../../proxygram/server/types';

import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { describePxgError } from './helpers';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Modal from '../ui/Modal';

import styles from './HideFromGuestsModal.module.scss';

type ChatShare = {
  grantee: { id: string; username: string | null; firstName: string | null };
};

type Person = { id: string; name: string };

/**
 * docs/RELEASE.md, "Hide from guests": the owner hides a message of a shared chat from all guests, including those
 * who get the chat later, or from the people marked here. The hiding belongs to the person, not to an access
 */
const HideFromGuestsModal = () => {
  const lang = useLang();
  const target = usePxgState((state) => state.hideMessages);
  const [shares, setShares] = useState<ChatShare[]>();
  const [current, setCurrent] = useState<HiddenMessageDto[]>();
  const [isAll, setIsAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setShares(undefined);
    setCurrent(undefined);
    setError(undefined);
    if (!target) return undefined;
    let isActive = true;
    const { accountId, peerId, msgIds } = target;
    Promise.all([
      pxgRpc.call<ChatShare[]>('shares.forChat', { accountId, peerId }),
      pxgRpc.call<HiddenMessageDto[]>('archive.hidden', {
        accountId, peerId, minMsgId: Math.min(...msgIds), maxMsgId: Math.max(...msgIds),
      }),
    ]).then(([chatShares, hidden]) => {
      if (!isActive) return;
      const entries = hidden.filter((entry) => msgIds.includes(entry.msgId));
      setShares(chatShares);
      setCurrent(entries);
      // An album is hidden as a whole: its first part tells the state
      setIsAll(Boolean(entries[0]?.all));
      setSelectedIds(entries[0]?.users.map(({ id }) => id) ?? []);
    }).catch((err: unknown) => {
      if (isActive) setError(describePxgError(lang, err));
    });
    return () => {
      isActive = false;
    };
  }, [target, lang]);

  // People with access now, and those it stays hidden from after their access ended
  const people = useMemo(() => {
    const byId = new Map<string, Person>();
    shares?.forEach(({ grantee }) => {
      const name = grantee.firstName || (grantee.username ? `@${grantee.username}` : '');
      byId.set(grantee.id, { id: grantee.id, name });
    });
    current?.forEach((entry) => entry.users.forEach((user) => {
      if (!byId.has(user.id)) byId.set(user.id, user);
    }));
    return [...byId.values()];
  }, [shares, current]);

  const isHidden = Boolean(current?.some((entry) => entry.all || entry.users.length));

  const close = useLastCallback(() => setPxgState({ hideMessages: undefined }));

  const save = useLastCallback(async (all: boolean, userIds: string[]) => {
    if (!target) return;
    setIsSaving(true);
    setError(undefined);
    try {
      const { accountId, peerId, msgIds } = target;
      await pxgRpc.call('archive.setHidden', { accountId, peerId, msgIds, all, userIds });
      close();
    } catch (err) {
      setError(describePxgError(lang, err));
    } finally {
      setIsSaving(false);
    }
  });

  const togglePerson = useLastCallback((id: string, isChecked: boolean) => {
    setSelectedIds((ids) => (isChecked ? [...ids, id] : ids.filter((selected) => selected !== id)));
  });

  const isLoaded = Boolean(shares && current);
  const canSave = isLoaded && !isSaving && (isAll || selectedIds.length > 0);

  return (
    <Modal isOpen={Boolean(target)} title={lang('PxgHideFromGuests')} hasCloseButton onClose={close}>
      <div className={styles.root}>
        <p className={styles.about}>{lang('PxgHideFromGuestsAbout')}</p>
        {!isLoaded && !error && <p className={styles.secondary}>{lang('Loading')}</p>}
        {isLoaded && (
          <>
            <Checkbox
              label={lang('PxgHideAllGuests')}
              subLabel={lang('PxgHideAllGuestsHint')}
              checked={isAll}
              onCheck={setIsAll}
            />
            {!isAll && people.map((person) => (
              <Checkbox
                key={person.id}
                label={person.name || lang('PxgHideUnnamed')}
                checked={selectedIds.includes(person.id)}
                onCheck={(isChecked) => togglePerson(person.id, isChecked)}
              />
            ))}
            {!isAll && !people.length && <p className={styles.secondary}>{lang('PxgHideNobody')}</p>}
          </>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.buttons}>
          <Button disabled={!canSave} onClick={() => void save(isAll, isAll ? [] : selectedIds)}>
            {lang('PxgHideSave')}
          </Button>
          {isHidden && (
            <Button color="translucent" disabled={isSaving} onClick={() => void save(false, [])}>
              {lang('PxgHideShowAll')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default memo(HideFromGuestsModal);
