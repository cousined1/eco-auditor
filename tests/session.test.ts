import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The real SDK client would send the refresh to a live backend; this fake
// stands in for its in-memory session and explicit refreshSession().
const sdk = vi.hoisted(() => ({ token: 'expired-token', refreshSession: vi.fn() }));

vi.mock('../src/lib/insforge', () => ({
  insforge: {
    getHttpClient: () => ({ getHeaders: () => ({ Authorization: `Bearer ${sdk.token}` }) }),
    auth: { refreshSession: sdk.refreshSession },
  },
  isInsForgeConfigured: true,
}));

import * as session from '../src/lib/session';
import { onSessionExpired } from '../src/lib/api';

const { isSessionValid } = session;

function stubServer() {
  const server = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return new Response('{}', { status: authorization === 'Bearer fresh-token' ? 200 : 401 });
  });
  vi.stubGlobal('fetch', server);
  return server;
}

const expired = vi.fn();
let unregister: () => void = () => {};

beforeEach(() => {
  sdk.token = 'expired-token';
  sdk.refreshSession.mockReset();
  expired.mockReset();
  unregister = onSessionExpired(expired);
});

afterEach(() => {
  unregister();
  vi.unstubAllGlobals();
});

describe('isSessionValid', () => {
  it('refreshes an expired access token instead of reporting the session invalid', async () => {
    sdk.refreshSession.mockImplementation(async () => {
      sdk.token = 'fresh-token';
      return { data: { accessToken: 'fresh-token' }, error: null };
    });
    const server = stubServer();

    expect(await isSessionValid()).toBe(true);
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
    expect(server).toHaveBeenCalledWith('/api/trial-status', expect.objectContaining({
      signal: expect.any(AbortSignal), // RT-06: bounded fetch
    }));
    expect(expired).not.toHaveBeenCalled();
  });

  it('is false, and reports the session as over, when the refresh is refused', async () => {
    sdk.refreshSession.mockResolvedValue({ data: null, error: { statusCode: 401 } });
    stubServer();

    expect(await isSessionValid()).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('is true on a network error (no false logout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await isSessionValid()).toBe(true);
    expect(expired).not.toHaveBeenCalled();
  });
});

describe('no global fetch patch', () => {
  it('session.ts no longer exports a window.fetch interceptor', () => {
    expect(Object.keys(session)).toEqual(['isSessionValid']);
  });

  it('no source file reassigns window.fetch (a global patch hides which calls are guarded)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && /\bwindow\.fetch\s*=(?!=)/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    };
    walk(resolve('src'));
    expect(offenders).toEqual([]);
  });
});
