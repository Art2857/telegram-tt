import { memo, useEffect, useMemo, useRef, useState } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ReachablePage } from '../../proxygram/server/types';

import { getMainUsername } from '../../global/helpers';
import { selectChat, selectUser } from '../../global/selectors';
import { resolveProxyPeer } from '../../api/proxy';
import { loadPersonalContact } from '../../api/proxy/contacts';
import { requestMemberAccess } from '../../proxygram/accessRequests';
import { setPxgState, usePxgState } from '../../proxygram/server/store';
import { usePxgData } from './settings/settingsShared';

import useSelector from '../../hooks/data/useSelector';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from '../common/Avatar';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

import styles from './ProxyMemberProfile.module.scss';

type OwnProps = { chatId: string; memberId: string; isMember?: boolean };

const MemberProfile = ({ chatId, memberId, isMember }: OwnProps) => {
  const { openChat, startProxyChat } = getActions();
  const lang = useLang();
  const source = useSelector((global) => selectChat(global, chatId)?.pxgProxy);
  const member = useSelector((global) => selectUser(global, memberId));
  const hasPrivateAccess = useSelector((global) => Boolean(selectChat(global, memberId)?.pxgProxy));
  const isOnline = usePxgState((state) => state.connection === 'online');
  const identity = usePxgState((state) => state.session?.user.id);
  const tgUserId = resolveProxyPeer(memberId)?.peerId;
  const { data: reach, error: reachError } = usePxgData<ReachablePage>(
    'members.reachable', { accountId: source?.accountId, tgUserId }, ['access.changed'],
  );
  const reachable = source && reach?.people.find(
    (person) => person.accountId === source.accountId && person.tgUserId === tgUserId,
  );
  const canOpenChat = hasPrivateAccess || Boolean(reachable?.hasChat);
  const canWrite = isOnline && !canOpenChat && Boolean(reachable?.canStartChats);
  const isCheckingAccess = isOnline && !hasPrivateAccess && !reach && !reachError;
  const hasSource = Boolean(source);
  const [note, setNote] = useState<string>();
  const [isRequesting, setIsRequesting] = useState(false);
  const [isRequested, setIsRequested] = useState(false);
  const requestRef = useRef(false);
  const visiblePeer = useMemo(() => member && ({ ...member, phoneNumber: '' }), [member]);

  useEffect(() => {
    if (!hasSource) setPxgState({ memberProfile: undefined });
  }, [hasSource]);

  useEffect(() => {
    if (!hasSource || !tgUserId || !identity || !isOnline) return undefined;
    let isActive = true;
    void loadPersonalContact(tgUserId).then((result) => {
      if (isActive) setNote(result.note || undefined);
    }).catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [tgUserId, identity, isOnline, hasSource]);

  const close = useLastCallback(() => setPxgState({ memberProfile: undefined }));

  const handleOpenChat = useLastCallback(() => {
    close();
    openChat({ id: memberId });
  });

  const handleWrite = useLastCallback(() => {
    if (!canWrite || !reachable) return;
    close();
    startProxyChat({ accountId: reachable.accountId, person: reachable });
  });

  const handleRequest = useLastCallback(async () => {
    if (!isOnline || requestRef.current || isRequested) return;
    requestRef.current = true;
    setIsRequesting(true);
    try {
      if (await requestMemberAccess(chatId, memberId)) setIsRequested(true);
    } finally {
      requestRef.current = false;
      setIsRequesting(false);
    }
  });

  if (!source || !visiblePeer) return undefined;

  const username = getMainUsername(visiblePeer);
  const name = [visiblePeer.firstName, visiblePeer.lastName].filter(Boolean).join(' ') || lang('HiddenName');
  return (
    <Modal isOpen title={lang('PxgMemberProfile')} hasCloseButton onClose={close}>
      <div className={styles.content}>
        <Avatar peer={visiblePeer} size="giant" />
        <div className={styles.name} dir="auto">{name}</div>
        {username && <p dir="ltr" className={styles.hint}>{`@${username}`}</p>}
        {!canOpenChat && !canWrite && (
          <p className={styles.hint}>{lang(isCheckingAccess ? 'PxgAdminLoading' : 'PxgMemberPrivateUnavailable')}</p>
        )}
        {note && (
          <div className={styles.note} dir="auto">
            <p className={styles.hint}>{lang('PxgContactPrivateNote')}</p>
            {note}
          </div>
        )}
        <div className={styles.actions}>
          <Button isText onClick={() => setPxgState({ memberProfile: undefined, personalContactUserId: memberId })}>
            {lang('PxgContactEdit')}
          </Button>
          {canOpenChat ? (
            <Button onClick={handleOpenChat}>{lang('PxgMemberOpenChat')}</Button>
          ) : canWrite ? (
            <Button noFastClick onClick={handleWrite}>{lang('PxgReachableWrite')}</Button>
          ) : isMember && !isCheckingAccess && (
            <Button disabled={!isOnline || isRequested || isRequesting} onClick={handleRequest}>
              {lang(isRequested ? 'PxgRequestSent' : 'PxgRequestAccess')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

const ProxyMemberProfile = () => {
  const profile = usePxgState((state) => state.memberProfile);
  return profile ? <MemberProfile key={`${profile.chatId}:${profile.memberId}`} {...profile} /> : undefined;
};

export default memo(ProxyMemberProfile);
