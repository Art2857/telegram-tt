import { memo, useEffect, useState } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { ApiUser } from '../../api/types';
import type { PersonalContactDto } from '../../proxygram/server/types';

import { resolveProxyPeer } from '../../api/proxy';
import { loadPersonalContact, savePersonalContact } from '../../api/proxy/contacts';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store';
import { describePxgError } from './helpers';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';
import TextArea from '../ui/TextArea';

import styles from './PersonalContactModal.module.scss';

type OwnProps = { userId: string };
type StateProps = { user?: ApiUser };

const PersonalContactEditor = ({ userId, user }: OwnProps & StateProps) => {
  const lang = useLang();
  const peer = resolveProxyPeer(userId);
  const identity = getPxgState().session?.user.id;
  const [originalName] = useState(user?.pxgOriginalName || user?.firstName || String(peer?.peerId || ''));
  const [initial, setInitial] = useState<PersonalContactDto>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [note, setNote] = useState('');
  const [shouldResetName, setShouldResetName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!peer || peer.peerId <= 0) return undefined;
    let isActive = true;
    setError(undefined);
    void loadPersonalContact(peer.peerId).then((contact) => {
      if (!isActive) return;
      setInitial(contact);
      setFirstName(contact.name?.firstName ?? originalName);
      setLastName(contact.name?.lastName ?? '');
      setNote(contact.note);
    }, (err) => {
      if (isActive) setError(err);
    });
    return () => {
      isActive = false;
    };
  }, [peer, originalName, retry]);

  const close = useLastCallback(() => {
    if (isSaving) return;
    setPxgState({ personalContactUserId: undefined });
  });

  const hasNameChange = Boolean(initial && (shouldResetName ? initial.name
    : firstName.trim() !== (initial.name?.firstName ?? originalName)
      || lastName.trim() !== (initial.name?.lastName ?? '')));
  const hasNoteChange = Boolean(initial && note !== initial.note);
  const isValidName = shouldResetName || Boolean(firstName.trim() || lastName.trim());

  const save = useLastCallback(async () => {
    if (!peer || !initial || isSaving || !isValidName || (!hasNameChange && !hasNoteChange)) return;
    setIsSaving(true);
    setError(undefined);
    try {
      let name: PersonalContactDto['name'] | undefined;
      if (hasNameChange) {
        // В протоколе null означает сброс, undefined — оставить поле без изменения
        // eslint-disable-next-line no-null/no-null
        name = shouldResetName ? null : { firstName: firstName.trim(), lastName: lastName.trim() };
      }
      await savePersonalContact(peer.peerId, {
        name,
        note: hasNoteChange ? note : undefined,
      });
      if (getPxgState().session?.user.id === identity
        && getPxgState().personalContactUserId === userId) setPxgState({ personalContactUserId: undefined });
    } catch (err) {
      setError(err);
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <Modal isOpen title={lang('PxgContactEdit')} hasCloseButton onClose={close}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className={styles.hint}>{lang('PxgContactPrivateHint')}</p>
        <p className={styles.original}>{lang('PxgContactOriginal', { name: originalName })}</p>
        {initial && (
          <>
            <InputText
              id="pxg-contact-first-name"
              label={lang('UserInfoFirstNamePlaceholder')}
              value={firstName}
              maxLength={64}
              disabled={isSaving}
              onChange={(e) => {
                setFirstName(e.currentTarget.value);
                setShouldResetName(false);
              }}
            />
            <InputText
              id="pxg-contact-last-name"
              label={lang('UserInfoLastNamePlaceholder')}
              value={lastName}
              maxLength={64}
              disabled={isSaving}
              onChange={(e) => {
                setLastName(e.currentTarget.value);
                setShouldResetName(false);
              }}
            />
            <TextArea
              id="pxg-contact-note"
              className={styles.note}
              label={lang('PxgContactPrivateNote')}
              value={note}
              maxLength={4096}
              noReplaceNewlines
              disabled={isSaving}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          </>
        )}
        {Boolean(error) && <p role="alert" className={styles.error}>{describePxgError(lang, error)}</p>}
        {!initial && !error && <p role="status" className={styles.hint}>{lang('Loading')}</p>}
        <div className={styles.actions}>
          {!initial && Boolean(error) && (
            <Button size="smaller" onClick={() => setRetry(retry + 1)}>{lang('Retry')}</Button>
          )}
          {initial?.name && (
            <Button
              isText
              color="translucent"
              size="smaller"
              disabled={isSaving || shouldResetName}
              onClick={() => {
                setFirstName(originalName);
                setLastName('');
                setShouldResetName(true);
              }}
            >
              {lang('PxgContactResetName')}
            </Button>
          )}
          <Button isText color="translucent" size="smaller" disabled={isSaving} onClick={close}>
            {lang('Cancel')}
          </Button>
          <Button
            type="submit"
            size="smaller"
            disabled={!initial || isSaving || !isValidName || (!hasNameChange && !hasNoteChange)}
            isLoading={isSaving}
          >
            {lang('Save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ConnectedEditor = memo(withGlobal<OwnProps>((global, { userId }): Complete<StateProps> => ({
  user: global.users.byId[userId],
}))(PersonalContactEditor));

const PersonalContactModal = () => {
  const userId = usePxgState((state) => state.personalContactUserId);
  return userId ? <ConnectedEditor key={userId} userId={userId} /> : undefined;
};

export default memo(PersonalContactModal);
