// @vitest-environment node
/**
 * F-A-07 / F-B-12 (lead notifier wired into server.cjs) and F-B-21 (server half:
 * the stored lead source), against a REAL spawned server.
 *
 * No Docker and no Postgres: the server runs with tests/helpers/fake-pg-preload.cjs,
 * which stands in for `pg` and records each lead INSERT, and with a local HTTP
 * sink playing the webhook. The unit-level rules (escaping, timeout, redirects,
 * flood cap, no PII in logs) live in tests/server-notify.test.ts.
 *
 * What only a spawned server can prove:
 *   - a stored lead reaches the webhook, from both /api/leads and the chat flow;
 *   - a dead, slow, erroring or redirecting webhook never fails or delays the lead;
 *   - the chatbot no longer claims a booking or a "personalized" deck;
 *   - the source stored with a lead comes from the allowlist;
 *   - with no webhook configured the server says so once at boot and still works.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort, postJson, startServer, waitFor, type Spawned } from './helpers/spawn-server';

type SinkMode = 'ok' | 'error' | 'hang' | 'redirect';

interface Sink {
  url: string;
  requests: Array<{ method?: string; path?: string; contentType?: string; body: string }>;
  mode: SinkMode;
  close: () => Promise<void>;
}

async function startSink(): Promise<Sink> {
  const port = await freePort();
  const sink: Sink = { url: `http://127.0.0.1:${port}/hook`, requests: [], mode: 'ok', close: async () => {} };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', () => {
      sink.requests.push({ method: req.method, path: req.url, contentType: String(req.headers['content-type'] ?? ''), body });
      if (req.url !== '/hook') { res.writeHead(200).end('elsewhere'); return; }
      if (sink.mode === 'hang') return; // never answer: only the server's own timeout ends this
      if (sink.mode === 'error') { res.writeHead(500).end('nope'); return; }
      if (sink.mode === 'redirect') { res.writeHead(302, { location: `http://127.0.0.1:${port}/elsewhere` }).end(); return; }
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  sink.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return sink;
}

// Column order of the INSERT in writeLead().
const COL = { type: 0, name: 1, email: 2, company: 3, message: 4, preferredDate: 5, preferredTime: 6, source: 7 };

describe('lead notification, webhook configured', () => {
  let sink: Sink;
  let app: Spawned;

  beforeAll(async () => {
    sink = await startSink();
    app = await startServer({ LEAD_NOTIFY_WEBHOOK_URL: sink.url }, { fakePg: 'ok' });
  }, 60_000);

  afterAll(async () => {
    app?.stop();
    await sink?.close();
  });

  const lead = (over: Record<string, unknown> = {}) => ({
    name: 'Ada Lovelace',
    email: 'ada@example.test',
    company: 'Analytical Engines',
    message: 'Interested in <!channel> pricing & a demo',
    type: 'sales',
    source: 'contact',
    ...over,
  });

  it('does not warn about a missing webhook at boot', () => {
    expect(app.logs.some((l) => /LEAD_NOTIFY_WEBHOOK_URL/.test(String(l.message)))).toBe(false);
  });

  it('a stored lead is posted once to the webhook as Slack-compatible JSON, and the source comes from the allowlist', async () => {
    sink.mode = 'ok';
    const before = sink.requests.length;
    const res = await postJson(`${app.base}/api/leads`, lead());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Lead captured successfully' });

    const request = await waitFor(() => sink.requests[before], 6000, 'the webhook POST');
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/hook');
    expect(request.contentType).toContain('application/json');
    const payload = JSON.parse(request.body) as Record<string, string>;
    expect(Object.keys(payload)).toEqual(['text']);
    expect(payload.text).toContain('Name: Ada Lovelace');
    expect(payload.text).toContain('Email: ada@example.test');
    expect(payload.text).toContain('Company: Analytical Engines');
    expect(payload.text).toContain('source: contact');
    // Visitor text cannot raise @channel or render a link.
    expect(payload.text).toContain('&lt;!channel&gt;');
    expect(payload.text).not.toMatch(/[<>]/);
    expect(sink.requests.length).toBe(before + 1);

    // F-B-21: the contact page's source survives to the stored row.
    const stored = app.dbLog().filter((row) => row.table === 'leads');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.params[COL.source]).toBe('contact');
    expect(stored[0]?.params[COL.email]).toBe('ada@example.test');
  }, 30_000);

  it('a source outside the allowlist is stored as api', async () => {
    const before = app.dbLog().length;
    const res = await postJson(`${app.base}/api/leads`, lead({ email: 'grace@example.test', name: 'Grace Hopper', source: 'newsletter<script>' }));
    expect(res.status).toBe(200);
    const stored = await waitFor(() => app.dbLog()[before], 3000, 'the stored lead');
    expect(stored.params[COL.source]).toBe('api');
  }, 30_000);

  it('a webhook that answers 500 never fails the lead, and the warning carries no lead data', async () => {
    sink.mode = 'error';
    const res = await postJson(`${app.base}/api/leads`, lead({ email: 'linus@example.test', name: 'Linus Torvalds', message: 'kernel question' }));
    expect(res.status).toBe(200);

    const warning = await waitFor(
      () => app.logs.find((l) => l.level === 'warn' && /rejected by the webhook/.test(String(l.message))),
      6000,
      'the rejection warning',
    );
    expect(warning.status).toBe(500);
    const everything = app.rawLog();
    for (const secret of ['linus@example.test', 'Linus Torvalds', 'kernel question', '/hook', sink.url]) {
      expect(everything).not.toContain(secret);
    }
  }, 30_000);

  it('a webhook that redirects is refused: the Location is never fetched', async () => {
    sink.mode = 'redirect';
    const res = await postJson(`${app.base}/api/leads`, lead({ email: 'ken@example.test', name: 'Ken Thompson' }));
    expect(res.status).toBe(200);

    await waitFor(
      () => app.logs.find((l) => l.level === 'warn' && /redirect/.test(String(l.message))),
      6000,
      'the redirect warning',
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(sink.requests.some((r) => r.path === '/elsewhere')).toBe(false);
  }, 30_000);

  it('a webhook that never answers does not delay the lead request and is abandoned after the timeout', async () => {
    sink.mode = 'hang';
    const started = Date.now();
    const res = await postJson(`${app.base}/api/leads`, lead({ email: 'dennis@example.test', name: 'Dennis Ritchie' }));
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);

    const warning = await waitFor(
      () => app.logs.find((l) => l.level === 'warn' && l.message === 'Lead notification failed' && l.reason === 'timeout'),
      8000,
      'the timeout warning',
    );
    expect(warning.reason).toBe('timeout');
    expect(app.rawLog()).not.toContain('dennis@example.test');
  }, 30_000);

  it('the chat demo flow says the request is saved, never that a demo is booked, and notifies the team', async () => {
    sink.mode = 'ok';
    const before = sink.requests.length;
    let state: Record<string, unknown> = {};
    const say = async (message: string) => {
      const res = await postJson(`${app.base}/api/chat`, { message, state });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { response: string; state: Record<string, unknown> };
      state = body.state;
      return body;
    };

    const start = await say('Book a Demo');
    expect(start.response).toMatch(/can't book a time myself/i);
    expect(start.state).toEqual({ flow: 'demo', step: 'name' });
    await say('Ada Lovelace');
    await say('ada.chat@example.test');
    await say('Analytical Engines');
    const datePrompt = await say('2026-10-20');
    expect(datePrompt.response).toMatch(/time of day/i);
    const done = await say('Morning');

    expect(done.state).toEqual({});
    expect(done.response).toMatch(/saved/i);
    expect(done.response).toMatch(/follow up by email/i);
    expect(done.response).toMatch(/can't book a time myself/i);
    expect(done.response).not.toMatch(/booked|personali[sz]ed|within 24 hours|deck/i);
    expect(done.response).toContain('ada.chat@example.test');

    const request = await waitFor(() => sink.requests[before], 6000, 'the chat lead webhook POST');
    const text = (JSON.parse(request.body) as { text: string }).text;
    expect(text).toContain('demo_request');
    expect(text).toContain('source: chatbot');
    expect(text).toContain('Preferred time: Morning');

    const stored = app.dbLog().filter((row) => row.params[COL.type] === 'demo_request');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.params[COL.source]).toBe('chatbot');
  }, 30_000);

  it('the chat contact flow confirms a saved message, without a 24-hour promise', async () => {
    let state: Record<string, unknown> = {};
    const say = async (message: string) => {
      const res = await postJson(`${app.base}/api/chat`, { message, state });
      const body = (await res.json()) as { response: string; state: Record<string, unknown> };
      state = body.state;
      return body;
    };

    await say('Contact Sales');
    await say('Katherine Johnson');
    await say('katherine@example.test');
    const done = await say('Please call about pricing');

    expect(done.response).toMatch(/saved/i);
    expect(done.response).toMatch(/follow up by email/i);
    expect(done.response).not.toMatch(/within 24 hours|sent/i);
  }, 30_000);
});

describe('lead notification, webhook not configured', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer({}, { fakePg: 'ok' });
  }, 60_000);

  afterAll(() => app?.stop());

  it('warns exactly once at boot that nobody will be notified', () => {
    const warnings = app.logs.filter((l) => l.level === 'warn' && /LEAD_NOTIFY_WEBHOOK_URL is not set/.test(String(l.message)));
    expect(warnings).toHaveLength(1);
  });

  it('still stores the lead and answers 200', async () => {
    const res = await postJson(`${app.base}/api/leads`, { name: 'Ada', email: 'ada@example.test', source: 'demo' });
    expect(res.status).toBe(200);
    const stored = await waitFor(() => app.dbLog()[0], 3000, 'the stored lead');
    expect(stored.params[COL.source]).toBe('demo');
  }, 30_000);
});
