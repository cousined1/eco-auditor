// F-X1-03 / F-B-14 end to end inside the real App, mounted the way main.tsx
// mounts it (BrowserRouter, which applies navigations inside startTransition).
// Acceptance from the audit: an expired access token is refreshed and the
// user stays put; only an unrecoverable session lands on
// /login?redirect=… with a "session expired" notice, also after in-app
// navigation.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const state = { token: 'expired-token', signedIn: true };
  const user = { id: 'u1', email: 'ada@example.test', profile: { name: 'Ada Example' }, metadata: null };
  return {
    state,
    insforge: {
      getHttpClient: () => ({ getHeaders: () => ({ Authorization: `Bearer ${state.token}` }) }),
      auth: {
        getCurrentUser: vi.fn(async () => ({ data: { user: state.signedIn ? user : null }, error: null })),
        signOut: vi.fn(async () => {
          state.signedIn = false;
          return { error: null };
        }),
        refreshSession: vi.fn(),
      },
    },
  };
});

vi.mock('../src/lib/insforge', () => ({ insforge: sdk.insforge, isInsForgeConfigured: true }));

import App from '../src/App';
import { ThemeProvider } from '../src/hooks/useTheme';
import { ConsentProvider } from '../src/lib/consent-context';

let mounted: { container: HTMLDivElement; root: Root } | null = null;

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`timed out waiting for ${what}`);
}

const here = () => window.location.pathname + window.location.search;

async function mountAppAt(path: string): Promise<HTMLDivElement> {
  window.history.replaceState(null, '', path);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted = { container, root };
  await act(async () => {
    root.render(
      <BrowserRouter>
        <ThemeProvider>
          <ConsentProvider>
            <App />
          </ConsentProvider>
        </ThemeProvider>
      </BrowserRouter>,
    );
  });
  await waitFor(() => container.querySelector('[aria-label="Sign out"]') !== null, 'the signed-in app shell');
  return container;
}

/** The app re-validates the session whenever the tab becomes visible again. */
async function returnToTab(): Promise<void> {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no matchMedia; the theme provider asks for the colour scheme.
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  sdk.state.token = 'expired-token';
  sdk.state.signedIn = true;
  sdk.insforge.auth.signOut.mockClear();
  sdk.insforge.auth.refreshSession.mockReset();
  // server.cjs: guarded routes accept only a live token.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('/api/trial-status')) return new Response('{}', { status: 200 });
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return new Response('{}', { status: authorization === 'Bearer fresh-token' ? 200 : 401 });
  }));
});

afterEach(async () => {
  if (mounted) {
    const { container, root } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
  vi.unstubAllGlobals();
});

describe('access-token expiry in the app', () => {
  it('refreshes the token and keeps the user where they are', async () => {
    sdk.insforge.auth.refreshSession.mockImplementation(async () => {
      sdk.state.token = 'fresh-token';
      return { data: { accessToken: 'fresh-token' }, error: null };
    });
    await mountAppAt('/app/assistant');

    await returnToTab();
    await waitFor(() => sdk.insforge.auth.refreshSession.mock.calls.length > 0, 'a refresh');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(here()).toBe('/app/assistant');
    expect(sdk.insforge.auth.signOut).not.toHaveBeenCalled();
  });

  it('signs out to /login with a "session expired" notice when the refresh is refused', async () => {
    sdk.insforge.auth.refreshSession.mockResolvedValue({ data: null, error: { statusCode: 401 } });
    const container = await mountAppAt('/app/assistant');

    await returnToTab();
    await waitFor(() => window.location.pathname === '/login', 'the sign-in page');

    expect(here()).toBe('/login?redirect=%2Fapp%2Fassistant');
    expect(sdk.insforge.auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => /session expired/i.test(container.textContent ?? ''), 'the session-expired notice');
  });

  it('still handles expiry after navigating inside the app', async () => {
    sdk.insforge.auth.refreshSession.mockResolvedValue({ data: null, error: { statusCode: 401 } });
    const container = await mountAppAt('/app/assistant');

    const ledgerLink = container.querySelector<HTMLAnchorElement>('aside a[href="/app/ledger"]');
    if (!ledgerLink) throw new Error('no Ledger link in the sidebar');
    await act(async () => {
      ledgerLink.click();
    });
    await waitFor(() => ledgerLink.getAttribute('aria-current') === 'page', 'the ledger route to render');

    await returnToTab();
    await waitFor(() => window.location.pathname === '/login', 'the sign-in page');

    expect(here()).toBe('/login?redirect=%2Fapp%2Fledger');
    await waitFor(() => /session expired/i.test(container.textContent ?? ''), 'the session-expired notice');
  });
});
