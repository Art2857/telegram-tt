import { memo, useEffect, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { ReachablePage, ReachablePerson,
} from '../../../proxygram/server/types';
import type { TabProps } from './settingsTypes';
import { REACHABLE_MEMBERS_PAGE_SIZE } from '../../../proxygram/server/types';

import buildClassName from '../../../util/buildClassName';
import { getProxyPeerId } from '../../../api/proxy';
import { setPxgState } from '../../../proxygram/server/store';
import { Loading, usePxgData } from './settingsShared';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';

import styles from '../admin/AdminPanel.module.scss';

export const ReachableTab = memo(({ lang, t }: TabProps) => {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const { data: page, error, reload } = usePxgData<ReachablePage>(
    'members.reachable', { query: query.trim() || undefined, offset }, ['access.changed'],
  );
  const total = page?.total;
  useEffect(() => {
    if (total === undefined || offset < total || offset === 0) return;
    setOffset(Math.floor(Math.max(0, total - 1) / REACHABLE_MEMBERS_PAGE_SIZE) * REACHABLE_MEMBERS_PAGE_SIZE);
  }, [total, offset]);

  const openPerson = (person: ReachablePerson) => {
    setPxgState({ isSettingsOpen: false });
    getActions().openChat({ id: getProxyPeerId(person.accountId, person.tgUserId) });
  };

  const writePerson = (person: ReachablePerson) => {
    setPxgState({ isSettingsOpen: false });
    getActions().startProxyChat({ accountId: person.accountId, person });
  };

  return (
    <>
      <p className={styles.secondary}>{t('PxgReachableHint')}</p>
      <InputText
        label={t('PxgReachableSearch')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOffset(0);
        }}
      />
      {!page ? (
        <Loading error={error} lang={lang} onRetry={reload} />
      ) : !page.people.length ? (
        <p className={styles.empty}>{t('PxgReachableEmpty')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {page.people.map((person) => (
              <tr key={`${person.accountId}:${person.tgUserId}`}>
                <td>
                  <div className={styles.name}>
                    {[person.firstName, person.lastName].filter(Boolean).join(' ')
                      || person.username || String(person.tgUserId)}
                  </div>
                  {person.username && <div className={styles.secondary}>{`@${person.username}`}</div>}
                  <div className={styles.secondary}>
                    {person.sources
                      .map((source) => source.title || t('PxgSettingsChat', { id: source.peerId }))
                      .join(' · ')}
                  </div>
                </td>
                <td>
                  {person.hasChat ? (
                    <Button size="tiny" isText fluid={false} noFastClick onClick={() => openPerson(person)}>
                      {t('PxgReachableOpen')}
                    </Button>
                  ) : person.canStartChats ? (
                    <Button size="tiny" isText fluid={false} noFastClick onClick={() => writePerson(person)}>
                      {t('PxgReachableWrite')}
                    </Button>
                  ) : (
                    <span className={styles.secondary}>{t('PxgReachableNoChat')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {page && page.total > REACHABLE_MEMBERS_PAGE_SIZE && (
        <div className={styles.pagination}>
          <Button
            size="smaller"
            fluid={false}
            noFastClick
            disabled={!offset}
            onClick={() => setOffset(offset - REACHABLE_MEMBERS_PAGE_SIZE)}
          >
            {lang('Back')}
          </Button>
          <span className={styles.secondary}>
            {lang('PxgMembersPage', {
              page: offset / REACHABLE_MEMBERS_PAGE_SIZE + 1,
              total: Math.ceil(page.total / REACHABLE_MEMBERS_PAGE_SIZE),
            })}
          </span>
          <Button
            size="smaller"
            fluid={false}
            noFastClick
            disabled={offset + REACHABLE_MEMBERS_PAGE_SIZE >= page.total}
            onClick={() => setOffset(offset + REACHABLE_MEMBERS_PAGE_SIZE)}
          >
            {lang('Next')}
          </Button>
        </div>
      )}
    </>
  );
});
