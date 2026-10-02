// F-C-25: /auth/callback used to print whatever the SDK or the sign-in provider
// said ("No valid refresh token provided", or a provider's error_description,
// which is text taken from the URL). It now shows a sentence a person can act on
// and keeps the raw reason for the console.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthCallback from '../src/pages/AuthCallback';
import { settle } from './helpers/form-dom';

const sdk = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock('../src/lib/insforge', () => ({ insforge: { auth: { getCurrentUser: sdk.getCurrentUser } } }));

let container: HTMLDivElement;
let root: Root;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  sdk.getCurrentUser.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountAt(entry: string) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <AuthCallback />
      </MemoryRouter>,
    ),
  );
  await settle();
}

const text = () => container.textContent ?? '';
const logged = () => JSON.stringify(warn.mock.calls);

describe('sign-in callback failures', () => {
  it('a session error from the SDK is logged, not shown', async () => {
    sdk.getCurrentUser.mockResolvedValue({ data: null, error: { message: 'No valid refresh token provided' } });
    await mountAt('/auth/callback');

    expect(text()).toContain('Sign-in needs another try');
    expect(text()).toContain('We could not finish signing you in.');
    expect(text()).not.toContain('refresh token');
    expect(logged()).toContain('No valid refresh token provided');
    expect(container.querySelector('a[href="/login/"]')?.textContent).toBe('Back to login');
  });

  it('a network fault thrown mid-callback reads the same, not as a raw error', async () => {
    sdk.getCurrentUser.mockRejectedValue(new TypeError('Failed to fetch'));
    await mountAt('/auth/callback');

    expect(text()).toContain('We could not finish signing you in.');
    expect(text()).not.toContain('Failed to fetch');
  });

  it('a provider error_description is never rendered: it is text anyone can put in a link', async () => {
    const hostile = 'Your account is locked. Call 555-0100 to unlock it';
    await mountAt(`/auth/callback?error=server_error&error_description=${encodeURIComponent(hostile)}`);

    expect(text()).toContain('We could not finish signing you in.');
    expect(text()).not.toContain('555-0100');
    expect(text()).not.toContain('server_error');
    expect(logged()).toContain(hostile);
    // A provider error is decided from the URL alone: the SDK is never asked.
    expect(sdk.getCurrentUser).not.toHaveBeenCalled();
  });

  it('a visitor who denied access is told it was cancelled', async () => {
    await mountAt('/auth/callback?error=access_denied&error_description=The+user+denied+access');

    expect(text()).toContain('Sign-in was cancelled');
    expect(text()).not.toContain('denied access');
  });

  it('shows the spinner, not an error, while the session is being confirmed', async () => {
    sdk.getCurrentUser.mockReturnValue(new Promise(() => {}));
    await mountAt('/auth/callback');

    expect(text()).toContain('Finishing sign-in');
    expect(text()).not.toContain('needs another try');
  });
});
