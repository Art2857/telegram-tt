import { memo, useState } from '../../../lib/teact/teact';

import type {
  AccessRequestRow, EffectiveChatRow, Lang, OutgoingChatRow, OutgoingGroup, OutgoingView, ShareRow, TabProps, Translate,
} from './settingsTypes';

import buildClassName from '../../../util/buildClassName';
import { pxgRpc } from '../../../proxygram/server/rpc';
import { setPxgState } from '../../../proxygram/server/store';
import { displayName, formatDateTime } from '../helpers';
import {
  byExpiry, describeShare, describeSource, describeTarget, groupBy, Loading, openShareEditor, REQUEST_STATUS_KEYS,
  usePxgData,
} from './settingsShared';

import Button from '../../ui/Button';
import Modal from '../../ui/Modal';

import styles from '../admin/AdminPanel.module.scss';

const OUTGOING_VIEWS: { view: OutgoingView; key: string }[] = [
  { view: 'guest', key: 'PxgSharesByGuest' },
  { view: 'chat', key: 'PxgSharesByChat' },
  { view: 'requests', key: 'PxgRequestsIncoming' },
  { view: 'expiring', key: 'PxgSharesExpiring' },
];

/**
 * Центр доступов (docs/spec/03-permissions.md §10): по гостям — с проверкой, что видит гость; по чатам — кто видит и
 * через какой доступ; отдельно — доступы со сроком. Правка, пауза и отзыв — прямо в строке
 */
export const OutgoingTab = memo(({
  lang, t, ask, run,
}: TabProps) => {
  const { data, error, reload } = usePxgData<ShareRow[]>('shares.outgoing', {}, ['shares.changed', 'access.changed']);
  const { data: chats, error: chatsError } = usePxgData<OutgoingChatRow[]>(
    'shares.outgoingChats', {}, ['shares.changed', 'access.changed'],
  );
  const [view, setView] = useState<OutgoingView>('guest');
  const [inspected, setInspected] = useState<{ userId: string; name: string }>();
  if (!data) return <Loading error={error} lang={lang} onRetry={reload} />;
  const shareById = new Map(data.map((share) => [share.id, share]));

  const revoke = (items: ShareRow[], text: string) => ask(text, lang('PxgShareRevoke'), async () => {
    await pxgRpc.call('shares.revokeMany', { shareIds: items.map((share) => share.id) });
    reload();
  });
  const togglePause = (share: ShareRow) => run(async () => {
    await pxgRpc.call('shares.update', { shareId: share.id, status: share.status === 'paused' ? 'active' : 'paused' });
    reload();
  });
  const renderActions = (share: ShareRow) => (
    <>
      <Button size="tiny" color="translucent" isText onClick={() => openShareEditor(share)}>
        {lang('PxgShareEdit')}
      </Button>
      {share.status !== 'source_lost' && (
        <Button size="tiny" color="translucent" isText onClick={() => void togglePause(share)}>
          {lang(share.status === 'paused' ? 'PxgShareResume' : 'PxgSharePause')}
        </Button>
      )}
    </>
  );

  function renderViews() {
    return (
      <div className={styles.filters}>
        {OUTGOING_VIEWS.map((item) => (
          <Button
            key={item.view}
            size="smaller"
            pill
            fluid={false}
            color={view === item.view ? 'primary' : 'translucent'}
            onClick={() => setView(item.view)}
          >
            {t(item.key)}
          </Button>
        ))}
      </div>
    );
  }

  if (view === 'requests') {
    return (
      <>
        {renderViews()}
        <IncomingRequests lang={lang} t={t} run={run} />
      </>
    );
  }

  if (view === 'chat') {
    const sorted = chats ? [...chats].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')) : undefined;
    return (
      <>
        {renderViews()}
        {!sorted ? <Loading error={chatsError} lang={lang} /> : sorted.length === 0 ? (
          <p className={styles.empty}>{lang('PxgSharesNoChats')}</p>
        ) : (
          <table className={buildClassName(styles.table, styles.stacked)}>
            <tbody>
              {sorted.map((chat) => chat.viewers.map((viewer, index) => (
                <tr key={`${chat.accountId}:${chat.peerId}:${viewer.userId}`}>
                  <td>{index === 0 && <div className={styles.name}>{chat.title ?? '—'}</div>}</td>
                  <td>
                    {viewer.name}
                    {viewer.shareIds.map((id) => shareById.get(id)).filter(Boolean).map((share) => (
                      <div key={share.id} className={styles.secondary}>
                        {`${describeSource(t, share)} · ${describeShare(t, share)}`}
                      </div>
                    ))}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  const groups: OutgoingGroup[] = view === 'guest'
    ? groupBy(data, (share) => share.grantee?.id ?? '')
      .map(([key, items]) => ({ key, title: displayName(items[0].grantee), items }))
    : [{ key: 'expiring', items: data.filter((share) => share.expiresAt).sort(byExpiry) }];
  const rowTitle = (share: ShareRow) => (view === 'guest' ? describeTarget(t, share)
    : `${displayName(share.grantee)} · ${describeTarget(t, share)}`);

  return (
    <>
      {renderViews()}
      {inspected && (
        <EffectiveModal
          lang={lang}
          t={t}
          person={inspected}
          shareById={shareById}
          onClose={() => setInspected(undefined)}
        />
      )}
      {!groups[0]?.items.length ? (
        <p className={styles.empty}>
          {lang(view === 'expiring' ? 'PxgSharesNoExpiring' : 'PxgSharesEmpty')}
        </p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {groups.map((group) => group.items.map((share, index) => (
              <tr key={share.id}>
                {group.title !== undefined && (
                  <td>
                    {index === 0 && <div className={styles.name}>{group.title}</div>}
                    {index === 0 && view === 'guest' && share.grantee && (
                      <Button
                        size="tiny"
                        color="translucent"
                        isText
                        fluid
                        onClick={() => setInspected({ userId: share.grantee!.id, name: group.title ?? '' })}
                      >
                        {lang('PxgSharesWhatGuestSees')}
                      </Button>
                    )}
                    {index === 0 && group.items.length > 1 && (
                      <>
                        <div className={styles.secondary}>
                          {t(view === 'guest' ? 'PxgSettingsChats' : 'PxgSettingsGuests', {
                            count: group.items.length,
                          })}
                        </div>
                        <Button
                          size="tiny"
                          color="danger"
                          isText
                          fluid
                          onClick={() => revoke(group.items, t(
                            view === 'guest' ? 'PxgRevokeAllOfGuestConfirm' : 'PxgRevokeAllOfChatConfirm',
                            { title: group.title ?? '', count: group.items.length },
                          ))}
                        >
                          {lang('PxgRevokeAll')}
                        </Button>
                      </>
                    )}
                  </td>
                )}
                <td>
                  {rowTitle(share)}
                  <div className={styles.secondary}>{describeShare(t, share)}</div>
                </td>
                <td className={styles.actions}>
                  {renderActions(share)}
                  <Button
                    size="tiny"
                    color="danger"
                    isText
                    onClick={() => revoke([share], t('PxgSettingsRevokeConfirm', {
                      name: displayName(share.grantee), title: describeTarget(t, share),
                    }))}
                  >
                    {lang('PxgShareRevoke')}
                  </Button>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      )}
    </>
  );
});

/**
 * «Запросы ко мне» (docs/RELEASE.md): кто просит, какой чат, откуда и где человек уже встречается. «Одобрить»
 * открывает окно выдачи с выбранным человеком — выдача и есть ответ; «Отклонить» — без выдачи
 */
function IncomingRequests({ lang, t, run }: Pick<TabProps, 'lang' | 't' | 'run'>) {
  const { data, error, reload } = usePxgData<AccessRequestRow[]>('requests.incoming', {}, ['requests.changed']);
  if (!data) return <Loading error={error} lang={lang} onRetry={reload} />;
  if (data.length === 0) return <p className={styles.empty}>{lang('PxgRequestsEmpty')}</p>;

  const approve = (request: AccessRequestRow) => setPxgState({
    shareChatId: String(request.peerId),
    shareFolder: undefined,
    shareTopic: undefined,
    shareEditId: undefined,
    shareRequest: {
      id: request.id,
      grantee: {
        id: request.requester.id,
        tgUserId: request.requester.tgUserId,
        username: request.requester.username,
        name: request.requester.name,
      },
    },
  });
  const reject = (request: AccessRequestRow) => run(async () => {
    await pxgRpc.call('requests.reject', { id: request.id });
    reload();
  });

  return (
    <table className={buildClassName(styles.table, styles.stacked)}>
      <tbody>
        {data.map((request) => (
          <tr key={request.id}>
            <td>
              <div className={styles.name}>{request.requester.name}</div>
              <div className={styles.secondary}>{formatDateTime(request.createdAt)}</div>
            </td>
            <td>
              {request.peerTitle ?? request.query ?? '—'}
              {request.originTitle && (
                <div className={styles.secondary}>{t('PxgRequestsFromGroup', { title: request.originTitle })}</div>
              )}
              {request.context && (
                <div className={styles.secondary}>
                  {[
                    request.context.hasChat ? t('PxgRequestsHasChat') : t('PxgRequestsNoChat'),
                    t('PxgRequestsCommonGroups', { count: request.context.commonGroups }),
                  ].join(' · ')}
                </div>
              )}
              {request.query && !request.accountId && (
                <div className={styles.secondary}>{lang('PxgRequestsNotFound')}</div>
              )}
              {request.status !== 'pending' && (
                <div className={styles.secondary}>{t(REQUEST_STATUS_KEYS[request.status])}</div>
              )}
            </td>
            <td className={styles.actions}>
              {request.status === 'pending' && (
                <>
                  {Boolean(request.accountId) && (
                    <Button size="tiny" color="translucent" isText onClick={() => approve(request)}>
                      {lang('PxgRequestsApprove')}
                    </Button>
                  )}
                  <Button size="tiny" color="danger" isText onClick={() => void reject(request)}>
                    {lang('PxgRequestsReject')}
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** «Что видит гость»: итоговые чаты человека в моих аккаунтах с правами и доступами, которые их дали */
function EffectiveModal({
  lang, t, person, shareById, onClose,
}: {
  lang: Lang;
  t: Translate;
  person: { userId: string; name: string };
  shareById: Map<string, ShareRow>;
  onClose: NoneToVoidFunction;
}) {
  const { data, error } = usePxgData<EffectiveChatRow[]>('shares.effective', { granteeUserId: person.userId }, []);
  return (
    <Modal isOpen title={t('PxgSharesEffectiveTitle', { name: person.name })} hasCloseButton onClose={onClose}>
      {!data ? <Loading error={error} lang={lang} /> : data.length === 0 ? (
        <p className={styles.empty}>{lang('PxgSharesEffectiveEmpty')}</p>
      ) : (
        <table className={buildClassName(styles.table, styles.stacked)}>
          <tbody>
            {data.map((chat) => (
              <tr key={`${chat.accountId}:${chat.peerId}`}>
                <td>
                  <div className={styles.name}>{chat.title ?? '—'}</div>
                  <div className={styles.secondary}>
                    {chat.sources.map(({ shareId }) => shareById.get(shareId)).filter(Boolean)
                      .map((share) => describeSource(t, share)).join(' · ')}
                  </div>
                  <div className={styles.secondary}>
                    {/* Reading comes with any access, so the list names only what goes beyond it */}
                    {Object.entries(chat.permissions).filter(([key, isAllowed]) => isAllowed && key !== 'read')
                      .map(([key]) => t(`PxgPerm${key[0].toUpperCase()}${key.slice(1)}`)).join(', ')}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
