import { memo, useEffect, useMemo, useState } from '../../lib/teact/teact';

import { copyTextToClipboard } from '../../util/clipboard';
import { pxgRpc } from '../../proxygram/server/rpc';
import { setPxgState, usePxgState } from '../../proxygram/server/store';

import useLang from '../../hooks/useLang';

import Button from '../ui/Button';
import Modal from '../ui/Modal';
import TabList from '../ui/TabList';

import styles from './DevMessageModal.module.scss';

type MessageDebug = {
  message: unknown;
  versions: unknown;
  author: unknown;
  jobs: unknown;
  file: unknown;
};

const TABS = [
  { title: 'PxgDevRawJson', pick: ({ message }: MessageDebug) => message },
  { title: 'PxgDevVersions', pick: ({ versions }: MessageDebug) => versions },
  { title: 'PxgDevAttribution', pick: ({ author, jobs }: MessageDebug) => ({ author, jobs }) },
  { title: 'PxgDevFile', pick: ({ file }: MessageDebug) => file },
] as const;

/** PLAN.md 14.1: what the archive knows about a message, for a server administrator */
const DevMessageModal = () => {
  const lang = useLang();
  const target = usePxgState((state) => state.debugMessage);
  const [debug, setDebug] = useState<MessageDebug>();
  const [error, setError] = useState<string>();
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    setDebug(undefined);
    setError(undefined);
    if (!target) return undefined;
    let isActive = true;
    pxgRpc.call<MessageDebug>('admin.messageDebug', target)
      .then((result) => isActive && setDebug(result))
      .catch((err: Error) => isActive && setError(err.message));
    return () => {
      isActive = false;
    };
  }, [target]);

  const json = useMemo(() => (
    debug ? JSON.stringify(TABS[activeTab].pick(debug), undefined, 2) : ''
  ), [activeTab, debug]);
  const tabs = useMemo(() => TABS.map(({ title }) => ({ title: lang(title) })), [lang]);

  return (
    <Modal
      isOpen={Boolean(target)}
      title={lang('PxgDevPanel')}
      hasCloseButton
      onClose={() => setPxgState({ debugMessage: undefined })}
    >
      {error && <p className={styles.error}>{error}</p>}
      {debug && (
        <>
          <TabList tabs={tabs} activeTab={activeTab} onSwitchTab={setActiveTab} />
          <pre className={styles.json}>{json}</pre>
          <Button size="smaller" isText onClick={() => copyTextToClipboard(json)}>{lang('PxgDevCopy')}</Button>
        </>
      )}
    </Modal>
  );
};

export default memo(DevMessageModal);
