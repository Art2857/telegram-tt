/** @jsxImportSource ../../../lib/teact */
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import TeactDOM from '../../../lib/teact/teact-dom';

import ServerPicker from './ServerPicker';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../../proxygram/server/serverAddress', async (loadActual) => ({
  ...await loadActual<typeof import('../../../proxygram/server/serverAddress')>(),
  switchServer: navigate,
}));
vi.mock('../../../hooks/useLang', () => {
  const lang = (key: string) => key;
  return { default: () => lang };
});

describe('выбор сервера до входа', () => {
  let root: HTMLElement;
  const fetchHealth = vi.fn<typeof fetch>();

  beforeEach(() => {
    navigate.mockReset();
    fetchHealth.mockReset();
    vi.stubGlobal('fetch', fetchHealth);
    root = document.createElement('main');
    document.body.append(root);
    TeactDOM.render(<ServerPicker />, root);
  });

  afterEach(() => {
    TeactDOM.render(undefined, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  function button(label: string) {
    return Array.from(root.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  }

  async function chooseServer(value: string) {
    await vi.waitFor(() => expect(button('PxgServerChange')).toBeDefined());
    button('PxgServerChange')!.click();
    await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
    const input = root.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(button('PxgServerConnect')?.disabled).toBe(false));
    button('PxgServerConnect')!.click();
  }

  it('отменяет запрос и игнорирует поздний ответ при выборе другого сервера', async () => {
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    fetchHealth.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await chooseServer('https://first.example');
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(1));
    const signal = fetchHealth.mock.calls[0][1]!.signal!;
    button('Cancel')!.click();
    expect(signal.aborted).toBe(true);

    await chooseServer('https://second.example');
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2));
    first.resolve(Response.json({ ok: true }));
    await first.promise;
    expect(navigate).not.toHaveBeenCalled();
    second.resolve(Response.json({ ok: true }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('https://second.example'));
  });

  it('показывает ошибку недоступного сервера и позволяет начать новую проверку', async () => {
    fetchHealth.mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 }));

    await chooseServer('https://offline.example');
    await vi.waitFor(() => expect(root.textContent).toContain('PxgServerUnreachable'));
    expect(navigate).not.toHaveBeenCalled();
    expect(button('Cancel')?.disabled).toBe(false);
  });

  it('прерывает проверку, если в другом слоте уже вошли в аккаунт', async () => {
    const pending = Promise.withResolvers<Response>();
    fetchHealth.mockReturnValueOnce(pending.promise);

    await chooseServer('https://other.example');
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(1));
    TeactDOM.render(<ServerPicker isLocked />, root);
    await vi.waitFor(() => expect(fetchHealth.mock.calls[0][1]?.signal?.aborted).toBe(true));
    pending.resolve(Response.json({ ok: true }));
    await pending.promise;
    await vi.waitFor(() => expect(root.textContent).toContain('PxgServerLocked'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('не предлагает отменять переход после передачи адреса оболочке', async () => {
    const switching = Promise.withResolvers<void>();
    navigate.mockReturnValue(switching.promise);
    fetchHealth.mockResolvedValueOnce(Response.json({ ok: true }));

    await chooseServer('https://online.example');
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('https://online.example'));
    await vi.waitFor(() => expect(button('Cancel')?.disabled).toBe(true));
    switching.reject(new Error('Переход сорвался'));
    await vi.waitFor(() => expect(root.textContent).toContain('PxgServerSwitchFailed'));
    expect(button('Cancel')?.disabled).toBe(false);
  });
});
