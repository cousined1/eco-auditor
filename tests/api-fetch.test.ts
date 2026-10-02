// F-X1-03 / F-B-14: an expired access token must be refreshed, not turned
// into a sign-out. apiFetch is the one wrapper for authenticated server.cjs
// calls; these tests drive it with a fake SDK client whose refreshSession()
// swaps the in-memory token, as the real SDK does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, onSessionExpired, type ApiClient } from '../src/lib/api';

type RefreshResult = { data: { accessToken?: string } | null; error: { statusCode?: number } | null };

function fakeClient(refresh?: (session: { token: string }) => Promise<RefreshResult>) {
  const session = { token: 'expired-token' };
  const refreshSession = vi.fn(async (): Promise<RefreshResult> => {
    if (refresh) return refresh(session);
    await new Promise((resolve) => setTimeout(resolve, 5));
    session.token = 'fresh-token';
    return { data: { accessToken: 'fresh-token' }, error: null };
  });
  const client: ApiClient = {
    getHttpClient: () => ({ getHeaders: () => ({ Authorization: `Bearer ${session.token}` }) }),
    auth: { refreshSession },
  };
  return { client, session, refreshSession };
}

/** A server that accepts only the listed bearer tokens, like server.cjs's authGuard. */
function stubServer(acceptedTokens: string[] = ['fresh-token']) {
  const server = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
    const ok = acceptedTokens.some((token) => authorization === `Bearer ${token}`);
    return new Response(JSON.stringify(ok ? { ok: true } : { error: 'Invalid or expired token' }), { status: ok ? 200 : 401 });
  });
  vi.stubGlobal('fetch', server);
  return server;
}

function sentAuthorization(server: ReturnType<typeof stubServer>, call: number): string | undefined {
  return (server.mock.calls[call]?.[1]?.headers as Record<string, string> | undefined)?.Authorization;
}

const expired = vi.fn();
let unregister: () => void = () => {};

beforeEach(() => {
  expired.mockReset();
  unregister = onSessionExpired(expired);
});

afterEach(() => {
  unregister();
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends the SDK token, keeps the caller headers, and overrides any caller Authorization', async () => {
    const { client, session, refreshSession } = fakeClient();
    session.token = 'fresh-token';
    const server = stubServer();

    const res = await apiFetch('/api/ingest/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', authorization: 'Bearer spoofed' },
      body: 'scope,amount',
    }, client);

    expect(res.status).toBe(200);
    expect(server).toHaveBeenCalledWith('/api/ingest/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: 'Bearer fresh-token' },
      body: 'scope,amount',
    });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes once on a 401 and retries with the new token, keeping the user signed in', async () => {
    const { client, refreshSession } = fakeClient();
    const server = stubServer();

    const res = await apiFetch('/api/emissions/summary', {}, client);

    expect(res.status).toBe(200);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(server).toHaveBeenCalledTimes(2);
    expect(sentAuthorization(server, 0)).toBe('Bearer expired-token');
    expect(sentAuthorization(server, 1)).toBe('Bearer fresh-token');
    expect(expired).not.toHaveBeenCalled();
  });

  it('shares one refresh between concurrent 401s (the refresh rotates the CSRF token)', async () => {
    const { client, refreshSession } = fakeClient();
    stubServer();

    const [summary, trend] = await Promise.all([
      apiFetch('/api/emissions/summary', {}, client),
      apiFetch('/api/emissions/trend?period=monthly', {}, client),
    ]);

    expect([summary.status, trend.status]).toEqual([200, 200]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(expired).not.toHaveBeenCalled();
  });

  it('retries with a token refreshed by another request while this one was in flight', async () => {
    const { client, session, refreshSession } = fakeClient();
    const server = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === 'Bearer fresh-token') return new Response('{}', { status: 200 });
      session.token = 'fresh-token'; // someone else refreshed meanwhile
      return new Response('{}', { status: 401 });
    });
    vi.stubGlobal('fetch', server);

    const res = await apiFetch('/api/trial-status', {}, client);

    expect(res.status).toBe(200);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(server).toHaveBeenCalledTimes(2);
  });

  it('reports the session as over when the refresh is refused, without retrying', async () => {
    const { client } = fakeClient(async () => ({ data: null, error: { statusCode: 401 } }));
    const server = stubServer();

    const res = await apiFetch('/api/emissions/summary', {}, client);

    expect(res.status).toBe(401);
    expect(server).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('reports the session as over when even the fresh token is rejected', async () => {
    const { client, refreshSession } = fakeClient();
    stubServer([]);

    const res = await apiFetch('/api/emissions/summary', {}, client);

    expect(res.status).toBe(401);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it.each([0, 408, 429, 503])('does not sign anyone out when the refresh fails transiently (status %i)', async (statusCode) => {
    const { client } = fakeClient(async () => ({ data: null, error: { statusCode } }));
    const server = stubServer();

    const res = await apiFetch('/api/emissions/summary', {}, client);

    expect(res.status).toBe(401);
    expect(server).toHaveBeenCalledTimes(1);
    expect(expired).not.toHaveBeenCalled();
  });

  it('does not sign anyone out when the refresh call throws', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('network down');
    });
    stubServer();

    expect((await apiFetch('/api/emissions/summary', {}, client)).status).toBe(401);
    expect(expired).not.toHaveBeenCalled();
  });

  it('leaves other URLs alone: no token, no refresh (401s there are the caller’s business)', async () => {
    const { client, session, refreshSession } = fakeClient();
    session.token = 'fresh-token';
    const server = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', server);

    for (const url of ['https://api.example.test/api/x', '/api/auth/sessions/current', '/blog/post']) {
      const init = { headers: { Accept: 'application/json' } };
      await apiFetch(url, init, client);
      expect(server).toHaveBeenLastCalledWith(url, init);
    }
    expect(refreshSession).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
  });

  it('stops notifying once the handler is unregistered', async () => {
    unregister();
    const { client } = fakeClient(async () => ({ data: null, error: { statusCode: 401 } }));
    stubServer();

    await apiFetch('/api/emissions/summary', {}, client);

    expect(expired).not.toHaveBeenCalled();
  });
});

// I-1: a refresh that fails for a transient reason used to loop silently. The user
// stayed signed in and every screen showed its own error, but nothing ever said why.
// The streak is module state, so each test starts from a fresh copy of api.ts.
describe('a refresh that keeps failing (I-1)', () => {
  type Api = typeof import('../src/lib/api');
  let api: Api;
  let sessionOver: ReturnType<typeof vi.fn>;
  let stopListening: () => void;
  let problemChanges: ReturnType<typeof vi.fn>;
  const unavailable = async (): Promise<RefreshResult> => ({ data: null, error: { statusCode: 503 } });

  beforeEach(async () => {
    vi.resetModules();
    api = await import('../src/lib/api');
    sessionOver = vi.fn();
    api.onSessionExpired(sessionOver);
    problemChanges = vi.fn();
    stopListening = api.subscribeConnectionProblem(problemChanges);
  });

  afterEach(() => {
    stopListening();
    vi.useRealTimers();
  });

  async function failOnce(client: ApiClient) {
    const res = await api.apiFetch('/api/emissions/summary', {}, client);
    expect(res.status).toBe(401);
  }

  it('stays quiet for two transient failures and reports a connection problem on the third', async () => {
    const { client, refreshSession } = fakeClient(unavailable);
    stubServer([]);

    await failOnce(client);
    await failOnce(client);
    expect(api.getConnectionProblem()).toBe(false);
    expect(problemChanges).not.toHaveBeenCalled();

    await failOnce(client);
    expect(api.getConnectionProblem()).toBe(true);
    expect(problemChanges).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(3);
    // Non-destructive: nobody is signed out, and the callers still got their 401.
    expect(sessionOver).not.toHaveBeenCalled();

    // Further failures do not announce it again.
    await failOnce(client);
    expect(problemChanges).toHaveBeenCalledTimes(1);
  });

  it('reports it after two minutes of failing, even with fewer than three failures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    const { client } = fakeClient(unavailable);
    stubServer([]);

    await failOnce(client);
    vi.setSystemTime(new Date('2026-09-30T10:01:59Z'));
    await failOnce(client);
    expect(api.getConnectionProblem()).toBe(false);

    vi.setSystemTime(new Date('2026-09-30T10:02:00Z'));
    await failOnce(client);
    expect(api.getConnectionProblem()).toBe(true);
  });

  it('counts one shared refresh once, however many requests were waiting on it', async () => {
    const { client, refreshSession } = fakeClient(unavailable);
    stubServer([]);

    await Promise.all([1, 2, 3, 4].map(() => api.apiFetch('/api/emissions/summary', {}, client)));

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(api.getConnectionProblem()).toBe(false);
  });

  it('keeps a refused refresh terminal: the session ends, and no connection problem is raised for it', async () => {
    const { client } = fakeClient(async () => ({ data: null, error: { statusCode: 403 } }));
    stubServer([]);

    await failOnce(client);

    expect(sessionOver).toHaveBeenCalledTimes(1);
    expect(api.getConnectionProblem()).toBe(false);
  });

  it('forgets an earlier streak, and closes an open banner, when the refresh is then refused', async () => {
    let answer: () => Promise<RefreshResult> = unavailable;
    const { client } = fakeClient(() => answer());
    stubServer([]);
    for (let i = 0; i < 3; i += 1) await failOnce(client);
    expect(api.getConnectionProblem()).toBe(true);

    answer = async () => ({ data: null, error: { statusCode: 401 } });
    await failOnce(client);

    expect(sessionOver).toHaveBeenCalledTimes(1);
    expect(api.getConnectionProblem()).toBe(false);
  });

  it('ends the problem as soon as a refresh succeeds, and starts counting again from zero', async () => {
    let answer: () => Promise<RefreshResult> = unavailable;
    const { client, session } = fakeClient(async (current) => {
      const result = await answer();
      if (result.data?.accessToken) current.token = result.data.accessToken; // the SDK swaps its in-memory token
      return result;
    });
    stubServer(['fresh-token']);
    for (let i = 0; i < 3; i += 1) await failOnce(client);
    expect(api.getConnectionProblem()).toBe(true);

    answer = async () => ({ data: { accessToken: 'fresh-token' }, error: null });
    const res = await api.apiFetch('/api/emissions/summary', {}, client);

    expect(res.status).toBe(200);
    expect(session.token).toBe('fresh-token');
    expect(api.getConnectionProblem()).toBe(false);
    expect(problemChanges).toHaveBeenCalledTimes(2); // on, then off

    // A later blip is a first failure again, not the fourth.
    session.token = 'expired-token';
    answer = unavailable;
    await failOnce(client);
    expect(api.getConnectionProblem()).toBe(false);
  });

  it('ends the problem when the server accepts an authenticated request again', async () => {
    const { client, session } = fakeClient(unavailable);
    stubServer(['fresh-token']);
    for (let i = 0; i < 3; i += 1) await failOnce(client);
    expect(api.getConnectionProblem()).toBe(true);

    session.token = 'fresh-token'; // the SDK got a good token some other way
    expect((await api.apiFetch('/api/emissions/summary', {}, client)).status).toBe(200);

    expect(api.getConnectionProblem()).toBe(false);
  });

  it('does not let requests to other URLs, which never refresh, touch the streak', async () => {
    const { client } = fakeClient(unavailable);
    stubServer([]);
    for (let i = 0; i < 2; i += 1) await failOnce(client);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await api.apiFetch('/blog/post', {}, client);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await failOnce(client); // the third real failure, unaffected by the unrelated call

    expect(api.getConnectionProblem()).toBe(true);
  });

  describe('retryConnection (the banner\'s Retry)', () => {
    async function withProblem(refresh: (session: { token: string }) => Promise<RefreshResult>) {
      const made = fakeClient((session) => refresh(session));
      stubServer([]);
      for (let i = 0; i < 3; i += 1) await failOnce(made.client);
      expect(api.getConnectionProblem()).toBe(true);
      return made;
    }

    it('resolves true and closes the problem when the session can be refreshed again', async () => {
      let healthy = false;
      const { client } = await withProblem(async () => (healthy ? { data: { accessToken: 'fresh-token' }, error: null } : unavailable()));

      healthy = true;
      await expect(api.retryConnection(client)).resolves.toBe(true);

      expect(api.getConnectionProblem()).toBe(false);
      expect(sessionOver).not.toHaveBeenCalled();
    });

    it('resolves false and leaves the problem open while the connection is still down', async () => {
      const { client } = await withProblem(unavailable);

      await expect(api.retryConnection(client)).resolves.toBe(false);

      expect(api.getConnectionProblem()).toBe(true);
      expect(sessionOver).not.toHaveBeenCalled();
    });

    it('ends the session when the refresh is refused', async () => {
      let refuse = false;
      const { client } = await withProblem(async () => (refuse ? { data: null, error: { statusCode: 401 } } : unavailable()));

      refuse = true;
      await expect(api.retryConnection(client)).resolves.toBe(false);

      expect(sessionOver).toHaveBeenCalledTimes(1);
      expect(api.getConnectionProblem()).toBe(false);
    });
  });

  it('signInAgain ends the session through the same handler as an unrecoverable one', async () => {
    const { client } = fakeClient(unavailable);
    stubServer([]);
    for (let i = 0; i < 3; i += 1) await failOnce(client);

    api.signInAgain();

    expect(sessionOver).toHaveBeenCalledTimes(1);
    expect(api.getConnectionProblem()).toBe(false);
  });
});
