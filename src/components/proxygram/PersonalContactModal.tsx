import { memo, useEffect, useRef, useState } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import type { ApiUser } from '../../api/types';
import type { PersonalContactDto } from '../../proxygram/server/types';
import { PxgError } from '../../proxygram/server/types';

import { resolveProxyPeer } from '../../api/proxy';
import { loadPersonalContact, savePersonalContact } from '../../api/proxy/contacts';
import { uploadPersonalContactPhoto } from '../../proxygram/contactPhotos';
import { pxgRpc } from '../../proxygram/server/rpc';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store';
import { describePxgError } from './helpers';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';
import TextArea from '../ui/TextArea';
import PersonalContactPhotoEditor from './PersonalContactPhotoEditor';

import styles from './PersonalContactModal.module.scss';

type OwnProps = { userId: string };
type StateProps = { user?: ApiUser };

const PersonalContactEditor = ({ userId, user }: OwnProps & StateProps) => {
  const lang = useLang();
  const tgUserId = resolveProxyPeer(userId)?.peerId;
  const identity = getPxgState().session?.user.id;
  const connection = usePxgState((state) => state.connection);
  const [originalName] = useState(user?.pxgOriginalName || user?.firstName || String(tgUserId || ''));
  const [initial, setInitial] = useState<PersonalContactDto>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [note, setNote] = useState('');
  const [shouldResetName, setShouldResetName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [photoFile, setPhotoFile] = useState<File>();
  const [shouldRemovePhoto, setShouldRemovePhoto] = useState(false);
  const stagedPhotoRef = useRef<{ file: File; id: string }>();
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!tgUserId || tgUserId <= 0 || initial || connection !== 'online') return undefined;
    let isActive = true;
    setError(undefined);
    void loadPersonalContact(tgUserId).then((contact) => {
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
  }, [tgUserId, originalName, retry, initial, connection]);

  const close = useLastCallback(() => {
    if (isSavingRef.current) return;
    setPxgState({ personalContactUserId: undefined });
  });

  const changePhoto = useLastCallback((file?: File, shouldRemove?: boolean) => {
    if (isSavingRef.current) return;
    const staged = stagedPhotoRef.current;
    stagedPhotoRef.current = undefined;
    if (staged) void pxgRpc.call('contacts.photo.discard', { id: staged.id }).catch(() => undefined);
    setPhotoFile(file);
    setShouldRemovePhoto(Boolean(shouldRemove));
  });

  useEffect(() => () => {
    const staged = stagedPhotoRef.current;
    if (staged && getPxgState().session?.user.id === identity) {
      void pxgRpc.call('contacts.photo.discard', { id: staged.id }).catch(() => undefined);
    }
  }, [identity]);

  const hasNameChange = Boolean(initial && (shouldResetName ? initial.name
    : firstName.trim() !== (initial.name?.firstName ?? originalName)
      || lastName.trim() !== (initial.name?.lastName ?? '')));
  const hasNoteChange = Boolean(initial && note !== initial.note);
  const hasPhotoChange = Boolean(photoFile || shouldRemovePhoto);
  const isValidName = shouldResetName || Boolean(firstName.trim() || lastName.trim());

  const save = useLastCallback(async () => {
    if (!tgUserId || !initial || isSavingRef.current || !isValidName || getPxgState().connection !== 'online'
      || (!hasNameChange && !hasNoteChange && !hasPhotoChange)) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setError(undefined);
    try {
      let name: PersonalContactDto['name'] | undefined;
      if (hasNameChange) {
        // В протоколе null означает сброс, undefined — оставить поле без изменения
        // eslint-disable-next-line no-null/no-null
        name = shouldResetName ? null : { firstName: firstName.trim(), lastName: lastName.trim() };
      }
      let photoId: string | null | undefined;
      if (shouldRemovePhoto) {
        // eslint-disable-next-line no-null/no-null
        photoId = null;
      } else if (photoFile) {
        if (stagedPhotoRef.current?.file !== photoFile) {
          const uploaded = await uploadPersonalContactPhoto(tgUserId, photoFile);
          stagedPhotoRef.current = { file: photoFile, id: uploaded.id };
        }
        photoId = stagedPhotoRef.current.id;
      }
      if (getPxgState().connection !== 'online') throw new PxgError('disconnected');
      await savePersonalContact(tgUserId, {
        name,
        note: hasNoteChange ? note : undefined,
        photoId,
      });
      stagedPhotoRef.current = undefined;
      if (getPxgState().session?.user.id === identity
        && getPxgState().personalContactUserId === userId) setPxgState({ personalContactUserId: undefined });
    } catch (err) {
      if (err instanceof PxgError && err.reason === 'upload_mismatch') stagedPhotoRef.current = undefined;
      setError(err);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  });

  return (
    <Modal
      isOpen
      title={lang('PxgContactEdit')}
      dialogClassName={styles.dialog}
      contentClassName={styles.content}
      hasCloseButton
      onClose={close}
    >
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className={styles.fields}>
          <p className={styles.hint}>{lang('PxgContactPrivateHint')}</p>
          <p className={styles.original}>{lang('PxgContactOriginal', { name: originalName })}</p>
          {initial && (
            <>
              <PersonalContactPhotoEditor
                user={user}
                file={photoFile}
                shouldRemove={shouldRemovePhoto}
                disabled={isSaving}
                onChange={changePhoto}
              />
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
          {!initial && !error && connection === 'online'
            && <p role="status" className={styles.hint}>{lang('Loading')}</p>}
          {connection !== 'online' && (
            <p role="status" className={styles.hint}>{lang('PxgContactWaitConnection')}</p>
          )}
        </div>
        <div className={styles.actions}>
          {!initial && Boolean(error) && (
            <Button size="smaller" disabled={connection !== 'online'} onClick={() => setRetry(retry + 1)}>
              {lang('Retry')}
            </Button>
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
            disabled={!initial || isSaving || connection !== 'online' || !isValidName
              || (!hasNameChange && !hasNoteChange && !hasPhotoChange)}
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
