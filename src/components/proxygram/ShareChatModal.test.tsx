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
vi.mock('../../hooks/useLang', () => ({ default: () => (key: string) => key }));
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

  beforeEach(() => {
    lookup = EMPTY_LOOKUP;
    callTelegram.mockReset();
    callRpc.mockReset().mockImplementation((method: string) => {
      if (method === 'users.lookup') return Promise.resolve(lookup);
      if (method === 'members.source') return Promise.resolve({ people: [] });
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
});
