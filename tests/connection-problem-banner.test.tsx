// I-1: when the session refresh keeps failing for a transient reason, the app shell
// says so, with a way to retry and a way to sign in again, instead of leaving every
// screen on its own unexplained error. The banner itself never ends the session.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RefreshResult = { data: { accessToken?: string } | null; error: { statusCode?: number } | null };

// The SDK, as api.ts sees it: a token that is always expired, and a refresh the test scripts.
const sdk = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../src/lib/insforge', () => ({
  insforge: {
    getHttpClient: () => ({ getHeaders: () => ({ Authorization: 'Bearer expired-token' }) }),
    auth: { refreshSession: () => sdk.refresh() },
  },
}));

type Api = typeof import('../src/lib/api');

let api: Api;
let container: HTMLDivElement;
let root: Root;
let sessionOver: ReturnType<typeof vi.fn>;

const banner = () => container.querySelector<HTMLElement>('[role="alert"]');
const button = (name: string) => [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name);
const down = async (): Promise<RefreshResult> => ({ data: null, error: { statusCode: 503 } });

// Three requests whose 401s cannot be refreshed because the connection is down.
async function breakTheConnection() {
  sdk.refresh.mockImplementation(down);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
  for (let i = 0; i < 3; i += 1) await act(async () => void (await api.apiFetch('/api/emissions/summary')));
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The streak is module state: each test gets a fresh copy of api.ts, and the
  // component that reads it.
  vi.resetModules();
  sdk.refresh.mockReset();
  api = await import('../src/lib/api');
  const { default: ConnectionProblemBanner } = await import('../src/components/ConnectionProblemBanner');
  sessionOver = vi.fn();
  api.onSessionExpired(sessionOver);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ConnectionProblemBanner />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ConnectionProblemBanner', () => {
  it('shows nothing while the session refresh works', async () => {
    expect(container.textContent).toBe('');

    sdk.refresh.mockResolvedValue({ data: { accessToken: 'fresh' }, error: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await act(async () => void (await api.apiFetch('/api/emissions/summary')));

    expect(container.textContent).toBe('');
  });

  it('appears once the refresh has kept failing, announced, offering Retry and Sign in again', async () => {
    await breakTheConnection();

    expect(banner()).not.toBeNull();
    expect(banner()?.textContent).toContain('Connection problem');
    expect(button('Retry')).toBeTruthy();
    expect(button('Sign in again')).toBeTruthy();
    // Non-destructive: it is only a message until the user chooses.
    expect(sessionOver).not.toHaveBeenCalled();
  });

  it('Retry tries the refresh again, and the banner goes away when it works', async () => {
    await breakTheConnection();
    const callsBefore = sdk.refresh.mock.calls.length;

    sdk.refresh.mockResolvedValue({ data: { accessToken: 'fresh' }, error: null });
    await act(async () => button('Retry')?.click());

    expect(sdk.refresh.mock.calls.length).toBe(callsBefore + 1);
    expect(banner()).toBeNull();
    expect(sessionOver).not.toHaveBeenCalled();
  });

  it('Retry leaves the banner up while the connection is still down, and can be pressed again', async () => {
    await breakTheConnection();

    await act(async () => button('Retry')?.click());

    expect(banner()).not.toBeNull();
    expect(button('Retry')?.hasAttribute('disabled')).toBe(false);
    expect(sessionOver).not.toHaveBeenCalled();
  });

  it('Retry is disabled while it is running, so a double click sends one refresh', async () => {
    await breakTheConnection();
    const callsBefore = sdk.refresh.mock.calls.length;
    let finish: (result: RefreshResult) => void = () => {};
    sdk.refresh.mockImplementation(() => new Promise<RefreshResult>((resolve) => (finish = resolve)));

    await act(async () => {
      button('Retry')?.click();
    });
    expect(button('Retry')?.hasAttribute('disabled')).toBe(true);
    await act(async () => button('Retry')?.click());
    await act(async () => finish({ data: { accessToken: 'fresh' }, error: null }));

    expect(sdk.refresh.mock.calls.length).toBe(callsBefore + 1);
    expect(banner()).toBeNull();
  });

  it('Sign in again ends the session through the app handler', async () => {
    await breakTheConnection();

    await act(async () => button('Sign in again')?.click());

    expect(sessionOver).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });
});
