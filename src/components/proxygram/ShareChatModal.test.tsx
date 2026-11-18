/** @jsxImportSource ../../lib/teact */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeactDOM from '../../lib/teact/teact-dom';

import ShareChatModal from './ShareChatModal';

const { callRpc, callTelegram } = vi.hoisted(() => ({ callRpc: vi.fn(), callTelegram: vi.fn() }));

vi.mock('../../api/gramjs', () => ({ callApi: callTelegram }));
vi.mock('../../global', () => ({
  getActions: () => ({ showNotification: vi.fn() }),
  getGlobal: () => ({ currentUserId: '100' }),
}));
vi.mock('../../global/selectors', () => ({
  selectChat: () => ({ type: 'chatTypeSuperGroup', title: 'QA group' }),
  selectChatFullInfo: () => undefined,
  selectUser: () => undefined,
}));
vi.mock('../../global/helpers', () => ({ isChatChannel: () => false }));
vi.mock('../../hooks/data/useSelector', () => ({ default: () => undefined }));
vi.mock('../../hooks/useLang', () => {
  const lang = (key: string, vars?: { count?: number }) => (vars?.count === undefined ? key : `${key} ${vars.count}`);
  return { default: () => lang };
});
vi.mock('../../proxygram/server/rpc', () => ({
  pxgRpc: { call: callRpc, on: () => () => {} },
}));
vi.mock('../../proxygram/server/store', () => {
  const state = { accounts: [{ id: 'qa-account', tgUserId: 100, status: 'active' }], connection: 'online' };
  return { setPxgState: vi.fn(), usePxgState: (select: (value: typeof state) => unknown) => select(state) };
});
vi.mock('../../util/folderManager', () => ({ getOrderedIds: () => [] }));
vi.mock('../common/Avatar', () => ({ default: () => undefined }));
vi.mock('../common/helpers/renderText', () => ({ default: (text: string) => text }));
vi.mock('../ui/ConfirmDialog', () => ({ default: () => undefined }));
vi.mock('../ui/ListItem', () => ({ default: () => undefined }));
vi.mock('../ui/Modal', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

const CANDIDATE = { tgUserId: 200, username: 'new_guest', firstName: 'QA' };
const EMPTY_LOOKUP = { registered: false, knownToBot: false, user: undefined, candidate: undefined };

describe('Share Chat', () => {
  let root: HTMLElement;
  let lookup: Record<string, unknown>;
  let sourceTotal: number;
  let outgoing: Record<string, unknown>[];

  beforeEach(() => {
    lookup = EMPTY_LOOKUP;
    sourceTotal = 0;
    outgoing = [];
    callTelegram.mockReset();
    callRpc.mockReset().mockImplementation((method: string, params?: { offset?: number }) => {
      if (method === 'users.lookup') return Promise.resolve(lookup);
      if (method === 'shares.outgoing') return Promise.resolve(outgoing);
      if (method === 'members.source') {
        const offset = params?.offset || 0;
        const people = Array.from({ length: Math.min(50, sourceTotal - offset) }, (_, index) => ({
          tgUserId: 500 + index + offset,
          firstName: `Member ${index + offset + 1}`,
          sources: [],
        }));
        return Promise.resolve({ people, total: sourceTotal });
      }
      return Promise.resolve([]);
    });
    root = document.createElement('main');
    document.body.append(root);
    TeactDOM.render(<ShareChatModal chatId="-1000000000000" />, root);
  });

  afterEach(() => {
    TeactDOM.render(undefined, root);
    root.remove();
  });

  function button(key: string) {
    return Array.from(root.querySelectorAll('button')).find((element) => element.textContent?.trim() === key);
  }

  async function findGuest() {
    const input = root.querySelector<HTMLInputElement>('input[aria-label="PxgShareUsername"]')!;
    input.value = '@new_guest';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(button('PxgShareFind')?.disabled).toBe(false));
    button('PxgShareFind')!.click();
    await vi.waitFor(() => expect(button('PxgShareGrant')).toBeDefined());
  }

  it('выдаёт доступ человеку, которого нашёл Telegram и который ещё не входил', async () => {
    callTelegram.mockResolvedValue({
      chat: { id: '200', type: 'chatTypePrivate' },
      user: {
        id: '200', type: 'userTypeRegular', usernames: [{ username: 'new_guest', isActive: true }], firstName: 'QA',
      },
    });

    await findGuest();
    expect(callTelegram).toHaveBeenCalledWith('getChatByUsername', 'new_guest');
    button('PxgShareGrant')!.click();

    expect(callRpc).toHaveBeenCalledWith('shares.create', expect.objectContaining({ grantee: CANDIDATE }));
  });

  it('выдаёт чат и охват одним запросом для гостя, известного боту', async () => {
    lookup = { ...EMPTY_LOOKUP, knownToBot: true, candidate: CANDIDATE };

    await findGuest();
    const coverage = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    coverage.click();
    await vi.waitFor(() => expect(root.textContent).toContain('PxgShareMembersAll'));
    button('PxgShareGrant')!.click();

    expect(callRpc).toHaveBeenCalledWith('shares.createWithMembers', expect.objectContaining({
      scope: 'chat', grantee: CANDIDATE, coverageMemberIds: [],
    }));
    expect(callRpc).not.toHaveBeenCalledWith('shares.create', expect.anything());
  });

  it('снятие последней галочки оставляет пустой выбор', async () => {
    lookup = { ...EMPTY_LOOKUP, candidate: CANDIDATE };
    sourceTotal = 1;
    await findGuest();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('input[type="radio"][value="selected"]')).toBeTruthy());
    root.querySelector<HTMLInputElement>('input[type="radio"][value="selected"]')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Member 1'));
    const member = Array.from(root.querySelectorAll('label')).find((label) => label.textContent?.includes('Member 1'));
    const checkbox = member?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).toBeDefined();
    checkbox!.click();
    await vi.waitFor(() => expect(checkbox!.checked).toBe(true));
    checkbox!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('PxgShareMembersEmptySelection'));
    button('PxgShareGrant')!.click();
    expect(callRpc).toHaveBeenCalledWith('shares.createWithMembers', expect.objectContaining({
      memberMode: 'selected', coverageMemberIds: [], excludeMemberIds: [],
    }));
  });

  it('сохраняет исключения с разных страниц списка', async () => {
    lookup = { ...EMPTY_LOOKUP, candidate: CANDIDATE };
    sourceTotal = 51;
    await findGuest();
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('input[type="radio"][value="except"]')).toBeTruthy());
    root.querySelector<HTMLInputElement>('input[type="radio"][value="except"]')!.click();
    await vi.waitFor(() => expect(button('Next')).toBeDefined());
    const choose = (name: string) => {
      const label = Array.from(root.querySelectorAll('label')).find((item) => item.textContent?.trim() === name);
      label?.querySelector<HTMLInputElement>('input')?.click();
    };
    choose('Member 1');
    button('Next')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Member 51'));
    choose('Member 51');
    await vi.waitFor(() => expect(root.textContent).toContain('PxgShareMembersExcluded 2'));
    button('PxgShareGrant')!.click();
    expect(callRpc).toHaveBeenCalledWith('shares.createWithMembers', expect.objectContaining({
      memberMode: 'all', coverageMemberIds: [], excludeMemberIds: [500, 550],
    }));
  });

  it('выдаёт доступ существующему гостю по ID Proxygram', async () => {
    lookup = {
      ...EMPTY_LOOKUP,
      registered: true,
      user: { id: 'existing-guest', tgUserId: 200, username: 'new_guest', firstName: 'QA', isPending: false },
    };

    await findGuest();
    button('PxgShareGrant')!.click();

    expect(callRpc).toHaveBeenCalledWith('shares.create', expect.objectContaining({ granteeUserId: 'existing-guest' }));
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it('сохраняет ограничение истории при недоступном охвате', async () => {
    lookup = { ...EMPTY_LOOKUP, knownToBot: true, candidate: CANDIDATE };
    await findGuest();

    button('PxgHistoryLastN')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const coverage = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await vi.waitFor(() => expect(coverage.disabled).toBe(true));
    expect(root.textContent).toContain('PxgErrShareMembersHistory');
    button('PxgShareGrant')!.click();

    expect(callRpc).toHaveBeenCalledWith('shares.create', expect.objectContaining({ historyMode: 'last_n' }));
  });

  it('показывает охват внутри одной выдачи и выключает его при правке этой выдачи', async () => {
    outgoing = [{
      id: 'group-share',
      accountId: 'qa-account',
      scope: 'chat',
      peerId: -1000000000000,
      preset: 'full',
      permissions: {},
      historyMode: 'all',
      status: 'active',
      limits: {},
      excludePeerIds: [],
      grantee: { ...CANDIDATE, id: 'existing-guest' },
      memberCoverage: {
        id: 'group-members', memberMode: 'selected', memberIds: [500], excludeMemberIds: [], includeBots: false,
        preset: 'assistant', permissions: {}, status: 'active',
      },
    }];
    await vi.waitFor(() => expect(root.textContent).toContain('PxgShareIncludesMembers'));
    expect([...root.querySelectorAll('button')].filter((node) => node.textContent === 'PxgShareEdit')).toHaveLength(1);
    button('PxgShareEdit')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('PxgShareSeparateMemberRights'));
    const selected = root.querySelector<HTMLInputElement>('input[type="radio"][value="selected"]');
    expect(selected?.checked).toBe(true);
    root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('input[type="radio"][value="selected"]')).toBeNull());
    button('PxgShareSave')!.click();
    expect(callRpc).toHaveBeenCalledWith('shares.update', expect.objectContaining({
      shareId: 'group-share', permissions: undefined,
    }));
    expect(callRpc.mock.calls.find(([method]) => method === 'shares.update')?.[1]?.memberCoverage).toBeNull();
  });

  it('поиск уже приглашённого человека открывает правку вместо повторной выдачи', async () => {
    const person = { ...CANDIDATE, id: 'existing-guest', isPending: false };
    lookup = { ...EMPTY_LOOKUP, registered: true, user: person };
    outgoing = [{
      id: 'active-share', accountId: 'qa-account', scope: 'chat', peerId: -1000000000000, grantee: person,
      preset: 'assistant', permissions: {}, historyMode: 'all', status: 'active', limits: {}, excludePeerIds: [],
    }];
    await vi.waitFor(() => expect(button('PxgShareEdit')).toBeDefined());
    const input = root.querySelector<HTMLInputElement>('input[aria-label="PxgShareUsername"]')!;
    input.value = '@new_guest';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(button('PxgShareFind')?.disabled).toBe(false));
    button('PxgShareFind')!.click();
    await vi.waitFor(() => expect(button('PxgShareSave')).toBeDefined());
    expect(button('PxgShareGrant')).toBeUndefined();
    button('PxgShareSave')!.click();
    expect(callRpc).toHaveBeenCalledWith('shares.update', expect.objectContaining({ shareId: 'active-share' }));
  });
});
