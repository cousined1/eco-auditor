// F-G-08 / F-F-08: browser errors reach the operator (src/lib/client-error-report.ts),
// from the ErrorBoundary and from window 'error' / 'unhandledrejection'.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Sent = { url: string; init: RequestInit; body: Record<string, string> };

let sent: Sent[];

beforeEach(() => {
  // A fresh module per test: the per-page cap and the dedupe set start empty.
  vi.resetModules();
  sent = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, string> });
    return Promise.resolve(new Response(null, { status: 204 }));
  }));
  window.history.pushState({}, '', '/app/reports?token=secret-token&email=ada@example.com#section');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

async function load() {
  return import('../src/lib/client-error-report');
}

describe('reportClientError', () => {
  it('posts the message, stack, source and page path, without cookies, and never the query string', async () => {
    const { reportClientError } = await load();
    const error = new TypeError('cannot read properties of undefined');
    reportClientError(error, 'error');

    expect(sent).toHaveLength(1);
    const [{ url, init, body }] = sent as [Sent];
    expect(url).toBe('/api/client-error');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.keepalive).toBe(true);
    expect(new Headers(init.headers).get('authorization')).toBeNull();
    expect(body).toEqual({ source: 'error', message: 'cannot read properties of undefined', route: '/app/reports', stack: error.stack });
    expect(JSON.stringify(body)).not.toMatch(/secret-token|ada@example|#section/);
  });

  it('sends each distinct error once, and at most five per page', async () => {
    const { reportClientError } = await load();
    reportClientError(new Error('same'), 'error');
    reportClientError(new Error('same'), 'error');
    for (let i = 0; i < 10; i += 1) reportClientError(new Error('distinct ' + i), 'error');
    expect(sent.map((s) => s.body.message)).toEqual(['same', 'distinct 0', 'distinct 1', 'distinct 2', 'distinct 3']);
  });

  it('describes a non-Error reason by its type, never by its content', async () => {
    const { reportClientError } = await load();
    reportClientError({ email: 'ada@example.com' }, 'unhandledrejection');
    expect(sent[0]?.body.message).toBe('Non-Error value: [object Object]');
  });

  it('never throws, even when fetch does', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch unavailable'); }));
    const { reportClientError } = await load();
    expect(() => reportClientError(new Error('x'), 'error')).not.toThrow();
  });
});

describe('installClientErrorReporting', () => {
  it('reports window errors and unhandled rejections, skips opaque cross-origin errors, and unhooks', async () => {
    const { installClientErrorReporting } = await load();
    const uninstall = installClientErrorReporting(window);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught in handler'), message: 'uncaught in handler' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new Error('promise nobody awaited');
    window.dispatchEvent(rejection);

    expect(sent.map((s) => [s.body.source, s.body.message])).toEqual([
      ['error', 'uncaught in handler'],
      ['unhandledrejection', 'promise nobody awaited'],
    ]);

    uninstall();
    // Message only (no error object), which the hook would still have reported;
    // with an error object and no listener left, the test runner itself would
    // treat the event as an uncaught exception.
    window.dispatchEvent(new ErrorEvent('error', { message: 'after uninstall' }));
    expect(sent).toHaveLength(2);
  });
});

describe('ErrorBoundary reports what it catches', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('posts a boundary report for a render crash', async () => {
    const { ErrorBoundary } = await import('../src/components/ErrorBoundary');
    function Throws(): never {
      throw new Error('render exploded');
    }
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain('Something went wrong');
    expect(sent.map((s) => [s.body.source, s.body.message])).toEqual([['boundary', 'render exploded']]);
  });
});
