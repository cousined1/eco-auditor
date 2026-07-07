import { describe, it, expect, vi, afterEach } from 'vitest';
import { installUnauthorizedInterceptor, isSessionValid } from '../src/lib/session';

const realWindowFetch = window.fetch;

afterEach(() => {
  window.fetch = realWindowFetch;
  vi.unstubAllGlobals();
});

describe('installUnauthorizedInterceptor', () => {
  it('fires onUnauthorized for a same-origin /api 401', async () => {
    window.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch;
    const onUnauth = vi.fn();
    const uninstall = installUnauthorizedInterceptor(onUnauth);
    await window.fetch('/api/emissions/summary');
    expect(onUnauth).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('ignores /api/auth 401s and non-401 responses', async () => {
    window.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch;
    const onUnauth = vi.fn();
    const uninstall = installUnauthorizedInterceptor(onUnauth);
    await window.fetch('/api/auth/sessions/current');
    expect(onUnauth).not.toHaveBeenCalled();
    uninstall();

    window.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
    const onUnauth2 = vi.fn();
    const uninstall2 = installUnauthorizedInterceptor(onUnauth2);
    await window.fetch('/api/emissions/summary');
    expect(onUnauth2).not.toHaveBeenCalled();
    uninstall2();
  });

  it('fires at most once across repeated 401s', async () => {
    window.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as typeof fetch;
    const onUnauth = vi.fn();
    const uninstall = installUnauthorizedInterceptor(onUnauth);
    await window.fetch('/api/a');
    await window.fetch('/api/b');
    expect(onUnauth).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('uninstall restores the original fetch', () => {
    const before = window.fetch;
    const uninstall = installUnauthorizedInterceptor(() => {});
    expect(window.fetch).not.toBe(before);
    uninstall();
    expect(window.fetch).toBe(before);
  });
});

describe('isSessionValid', () => {
  it('is false on 401, true on 200, and true on a network error (no false logout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    expect(await isSessionValid()).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await isSessionValid()).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await isSessionValid()).toBe(true);
  });
});
