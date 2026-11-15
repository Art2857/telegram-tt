import { memo, useCallback, useEffect, useRef, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { Lang, Policy, TabProps } from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { usePxgState } from '../../../proxygram/server/store';
import { formatMegabytes, Loading, MB } from './settingsShared';

import useSelector from '../../../hooks/data/useSelector';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import Checkbox from '../../ui/Checkbox';
import InputText from '../../ui/InputText';
import ArchiveTools from './ArchiveTools';

import styles from '../admin/AdminPanel.module.scss';

export const HideDeletedOption = memo(({ lang }: { lang: Lang }) => {
  const { setSettingOption } = getActions();
  const isHidden = useSelector((global) => global.settings.byKey.pxgHideDeleted);

  return (
    <Checkbox
      label={lang('PxgSettingsHideDeleted')}
      checked={Boolean(isHidden)}
      onCheck={(pxgHideDeleted) => setSettingOption({ pxgHideDeleted, pxgHideDeletedChats: {} })}
    />
  );
});

export const ArchiveTab = memo(({
  lang, t, run, ask, accounts, accountsError, reloadAccounts,
}: TabProps) => {
  const [selectedId, setSelectedId] = useState<string>();
  const account = accounts?.find((item) => item.id === selectedId) ?? accounts?.[0];
  const [policy, setPolicy] = useState<Policy>();
  const [policyAccountId, setPolicyAccountId] = useState<string>();
  const connection = usePxgState((state) => state.connection);
  const [error, setError] = useState<unknown>();
  const [maxMegabytes, setMaxMegabytes] = useState('');
  const [keepDays, setKeepDays] = useState('');
  const [perChat, setPerChat] = useState('');
  const [maxMembers, setMaxMembers] = useState('');
  const [filesDays, setFilesDays] = useState('');
  const [deletedDays, setDeletedDays] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const requestRef = useRef(0);

  const accountId = account?.id;
  const load = useCallback(() => {
    if (!accountId) return;
    const request = ++requestRef.current;
    setError(undefined);
    setPolicy(undefined);
    setIsSaved(false);
    pxgRpc.call<Policy>('archive.policy.get', { accountId })
      .then((result) => {
        // ответ прежнего аккаунта не должен заполнить форму нового
        if (request !== requestRef.current) return;
        setPolicy(result);
        setPolicyAccountId(accountId);
        setFilesDays(String(result.media.keepDays));
        setDeletedDays(String(result.retention.deletedDays));
        setMaxMegabytes(String(Math.round(result.media.maxBytes / MB)));
        setKeepDays(String(result.media.onDemandKeepDays));
        setPerChat(String(result.import.perChat));
        setMaxMembers(String(result.chats.maxMembers));
      })
      .catch((err) => {
        if (request === requestRef.current) setError(err);
      });
  }, [accountId]);

  const reloadIfMissing = useLastCallback(() => {
    if (!policy || policyAccountId !== accountId) load();
  });
  const isCurrentAccount = useLastCallback((id: string) => id === accountId);
  useEffect(() => {
    if (connection !== 'online') return undefined;
    reloadIfMissing();
    return () => {
      // Уход с аккаунта или потеря связи отменяют применение старого ответа
      // eslint-disable-next-line react-hooks-static-deps/exhaustive-deps
      requestRef.current++;
    };
  }, [accountId, connection, reloadIfMissing, requestRef]);

  if (!accounts) return <Loading error={accountsError} lang={lang} onRetry={reloadAccounts} />;
  if (!account) return <p className={styles.empty}>{lang('PxgSettingsNoAccounts')}</p>;
  if (!policy || policyAccountId !== account.id) return <Loading error={error} lang={lang} onRetry={load} />;

  const toggleMedia = (key: 'includeVideo' | 'includeDocuments' | 'onDemand', value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, media: { ...policy.media, [key]: value } });
  };
  const toggleImport = (value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, import: { ...policy.import, enabled: value } });
  };
  const toggleChannels = (value: boolean) => {
    setIsSaved(false);
    setPolicy({ ...policy, chats: { ...policy.chats, channels: value } });
  };
  const save = () => run(async () => {
    const result = await pxgRpc.call<Policy>('archive.policy.set', {
      accountId: account.id,
      media: {
        maxBytes: Math.max(0, Number(maxMegabytes) || 0) * MB,
        includeVideo: policy.media.includeVideo,
        includeDocuments: policy.media.includeDocuments,
        onDemand: policy.media.onDemand,
        onDemandKeepDays: Math.max(1, Number(keepDays) || 1),
        keepDays: Number(filesDays) || 0,
      },
      retention: { deletedDays: Number(deletedDays) || 0 },
      import: {
        enabled: policy.import.enabled,
        perChat: Math.max(0, Number(perChat) || 0),
      },
      chats: {
        channels: policy.chats.channels,
        maxMembers: Math.max(0, Number(maxMembers) || 0),
      },
    });
    if (!isCurrentAccount(account.id)) return;
    setPolicy(result);
    setIsSaved(true);
  });
  const resetException = (peerId: number) => run(async () => {
    // The server goes back to the policy only on an explicit JSON `null`
    // eslint-disable-next-line no-null/no-null
    await pxgRpc.call('archive.chat.set', { accountId: account.id, peerId, enabled: null });
    if (isCurrentAccount(account.id)) load();
  });
  const onDigits = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSaved(false);
    setter(e.target.value.replace(/\D/g, ''));
  };

  return (
    <>
      {accounts && accounts.length > 1 && (
        <div className={styles.filters}>
          {accounts.map((item) => (
            <Button
              key={item.id}
              size="smaller"
              fluid={false}
              color={item.id === account.id ? 'primary' : 'translucent'}
              onClick={() => setSelectedId(item.id)}
            >
              {item.displayName ?? '—'}
            </Button>
          ))}
        </div>
      )}
      <p className={styles.secondary}>
        {t('PxgPolicyUsage', {
          count: account.messages,
          size: formatMegabytes(account.mediaBytes),
        })}
      </p>
      <details className={styles.form}>
        <summary className={styles.sectionTitle}>{lang('PxgArchiveLimitsTitle')}</summary>
        <p className={styles.secondary}>{lang('PxgArchiveLimitFiles')}</p>
        <p className={styles.secondary}>{lang('PxgArchiveLimitBefore')}</p>
        <p className={styles.secondary}>{lang('PxgArchiveLimitEdits')}</p>
      </details>
      <div className={styles.form}>
        <h3 className={styles.sectionTitle}>{lang('PxgPolicyChatsTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgPolicyChatsNote')}</p>
        <Checkbox
          label={lang('PxgPolicyChannels')}
          checked={policy.chats.channels}
          onCheck={toggleChannels}
        />
        <InputText
          label={lang('PxgPolicyMaxMembers')}
          inputMode="numeric"
          value={maxMembers}
          onChange={onDigits(setMaxMembers)}
        />
        {policy.exceptions.length > 0 && (
          <>
            <p className={styles.secondary}>{lang('PxgPolicyExceptions')}</p>
            <table className={buildClassName(styles.table, styles.stacked)}>
              <tbody>
                {policy.exceptions.map((exception) => (
                  <tr key={exception.peerId}>
                    <td className={styles.name}>{exception.title ?? exception.peerId}</td>
                    <td className={styles.secondary}>
                      {lang(exception.enabled ? 'PxgPolicyExceptionOn' : 'PxgPolicyExceptionOff')}
                    </td>
                    <td className={styles.actions}>
                      <Button size="smaller" isText fluid={false} onClick={() => void resetException(exception.peerId)}>
                        {lang('PxgPolicyExceptionReset')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h3 className={styles.sectionTitle}>{lang('PxgPolicyFilesTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgPolicyNote')}</p>
        <InputText
          label={lang('PxgPolicyMaxSize')}
          inputMode="numeric"
          value={maxMegabytes}
          onChange={onDigits(setMaxMegabytes)}
        />
        <Checkbox
          label={lang('PxgPolicyVideo')}
          checked={policy.media.includeVideo}
          onCheck={(value) => toggleMedia('includeVideo', value)}
        />
        <Checkbox
          label={lang('PxgPolicyDocuments')}
          checked={policy.media.includeDocuments}
          onCheck={(value) => toggleMedia('includeDocuments', value)}
        />
        <Checkbox
          label={lang('PxgPolicyOnDemand')}
          checked={policy.media.onDemand}
          onCheck={(value) => toggleMedia('onDemand', value)}
        />
        <InputText
          label={lang('PxgPolicyKeepDays')}
          inputMode="numeric"
          value={keepDays}
          onChange={onDigits(setKeepDays)}
        />
        <Checkbox
          label={lang('PxgPolicyImport')}
          checked={policy.import.enabled}
          onCheck={toggleImport}
        />
        <InputText
          label={lang('PxgPolicyPerChat')}
          inputMode="numeric"
          value={perChat}
          onChange={onDigits(setPerChat)}
        />
        <h3 className={styles.sectionTitle}>{lang('PxgPolicyRetentionTitle')}</h3>
        <p className={styles.secondary}>{lang('PxgPolicyRetentionNote')}</p>
        <InputText
          label={lang('PxgPolicyDeletedDays')}
          inputMode="numeric"
          value={deletedDays}
          onChange={onDigits(setDeletedDays)}
        />
        <InputText
          label={lang('PxgPolicyFilesDays')}
          inputMode="numeric"
          value={filesDays}
          onChange={onDigits(setFilesDays)}
        />
        <div className={styles.formButtons}>
          <Button fluid={false} onClick={() => void save()}>{lang('PxgShareSave')}</Button>
          {isSaved && <span className={styles.secondary}>{t('PxgSettingsSaved')}</span>}
        </div>
      </div>
      <ArchiveTools
        key={account.id}
        accountId={account.id}
        accountName={account.displayName ?? ''}
        ask={ask}
        onCleared={reloadAccounts}
      />
    </>
  );
});
