// @vitest-environment node
/**
 * F-A-07 / F-B-12 — lead notifier (server-notify.cjs).
 *
 * Unit level: fetch, the clock and the logger are injected, so nothing here
 * touches the network. The spawned-server behaviour (a stored lead reaches a
 * webhook, a dead webhook never fails the lead request) is covered by
 * tests/server-lead-notify.test.ts.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createLeadNotifier,
  createLeadNotifierFromEnv,
  formatLeadMessage,
  parseWebhookUrl,
} = require('../server-notify.cjs');

type LogCall = { level: string; message: string; context?: Record<string, unknown> };

function makeLog() {
  const calls: LogCall[] = [];
  const log = (level: string, message: string, context?: Record<string, unknown>) => {
    calls.push({ level, message, ...(context ? { context } : {}) });
  };
  return { calls, log };
}

const LEAD = {
  type: 'demo_request',
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  company: 'Analytical Engines',
  message: 'We would like a demo.',
  preferredDate: '2026-10-20',
  preferredTime: 'Morning',
  source: 'chatbot',
};
const SECRET_PATH = 'services/T0SECRET/B0SECRET/TOKENSECRET';
const URL_OK = `https://hooks.example.test/${SECRET_PATH}`;

function response(status: number) {
  return { status, ok: status >= 200 && status < 300, body: null };
}

describe('parseWebhookUrl', () => {
  it.each([
    [undefined, 'unset'],
    ['', 'unset'],
    ['   ', 'unset'],
    ['not a url', 'invalid_url'],
    ['http://hooks.example.test/x', 'not_https'],
    ['ftp://hooks.example.test/x', 'not_https'],
    ['http://localhost.evil.test/x', 'not_https'],
    ['https://user:pass@hooks.example.test/x', 'credentials_in_url'],
  ])('rejects %j as %s', (raw, reason) => {
    expect(parseWebhookUrl(raw)).toEqual({ ok: false, reason });
  });

  it.each([
    URL_OK,
    'http://localhost:8080/hook',
    'http://127.0.0.1:9999/hook',
    'http://[::1]:9999/hook',
  ])('accepts %s', (raw) => {
    const parsed = parseWebhookUrl(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.url).toBe(new URL(raw).href);
  });
});

// I-2: plain http to loopback exists so the tests can run a local sink. In
// production it would send every lead's name and address, unencrypted, to a
// listener on the same host: there is no legitimate deployment for it, so it is
// refused there, and everything that is not loopback needs https anywhere.
describe('parseWebhookUrl and NODE_ENV (I-2)', () => {
  const LOOPBACK = ['http://localhost:8080/hook', 'http://127.0.0.1:9999/hook', 'http://[::1]:9999/hook'];

  it.each(LOOPBACK)('refuses plain http to loopback (%s) when NODE_ENV is production', (raw) => {
    expect(parseWebhookUrl(raw, { NODE_ENV: 'production' })).toEqual({ ok: false, reason: 'not_https' });
  });

  it.each(['Production', 'PRODUCTION', ' production ', 'production\n'])('reads NODE_ENV %j as production: a spelling that is not exact must not open the door', (NODE_ENV) => {
    expect(parseWebhookUrl('http://127.0.0.1:9999/hook', { NODE_ENV })).toEqual({ ok: false, reason: 'not_https' });
  });

  it.each([undefined, '', 'development', 'test', 'staging'])('still takes loopback http for the local sink when NODE_ENV is %j', (NODE_ENV) => {
    expect(parseWebhookUrl('http://127.0.0.1:9999/hook', { NODE_ENV }).ok).toBe(true);
  });

  it('still takes loopback http when there is no environment to consult (a call with one argument)', () => {
    expect(parseWebhookUrl('http://127.0.0.1:9999/hook').ok).toBe(process.env.NODE_ENV !== 'production');
  });

  it.each([
    ['http://hooks.example.test/x'],
    ['http://localhost.evil.test/x'],
    ['http://127.0.0.1.nip.io/x'],
    ['http://0.0.0.0:9999/x'],
    ['http://[::ffff:127.0.0.1]:9999/x'],
    ['http://localhost.:9999/x'],
  ])('needs https for %s in every environment', (raw) => {
    for (const NODE_ENV of ['production', 'development', 'test', undefined]) {
      expect(parseWebhookUrl(raw, { NODE_ENV }), `${raw} with NODE_ENV=${NODE_ENV}`).toEqual({ ok: false, reason: 'not_https' });
    }
  });

  it('accepts https in production, which is how a real webhook is reached', () => {
    expect(parseWebhookUrl(URL_OK, { NODE_ENV: 'production' })).toEqual({ ok: true, url: new URL(URL_OK).href });
  });

  it('disables the notifier in production for a loopback http URL, with one warning that names no URL', async () => {
    const { calls, log } = makeLog();
    const fetchImpl = vi.fn(async () => response(200));
    const notifier = createLeadNotifierFromEnv({ NODE_ENV: 'production', LEAD_NOTIFY_WEBHOOK_URL: `http://127.0.0.1:9999/${SECRET_PATH}` }, { log, fetchImpl });

    expect(notifier.enabled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.context).toEqual({ reason: 'not_https' });
    expect(JSON.stringify(calls)).not.toContain('TOKENSECRET');
    await expect(notifier.notify(LEAD)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enables it outside production for the same URL (the local sink of the spawned-server tests)', () => {
    const { calls, log } = makeLog();
    const notifier = createLeadNotifierFromEnv({ NODE_ENV: 'development', LEAD_NOTIFY_WEBHOOK_URL: 'http://127.0.0.1:9999/hook' }, { log });

    expect(notifier.enabled).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('formatLeadMessage', () => {
  it('gives the team what it needs to reply', () => {
    const text = formatLeadMessage(LEAD);
    expect(text).toContain('demo_request');
    expect(text).toContain('source: chatbot');
    expect(text).toContain('Name: Ada Lovelace');
    expect(text).toContain('Email: ada@example.test');
    expect(text).toContain('Company: Analytical Engines');
    expect(text).toContain('Preferred date: 2026-10-20');
    expect(text).toContain('Preferred time: Morning');
    expect(text).toContain('Message: We would like a demo.');
  });

  it('escapes Slack control sequences so visitor text cannot ping a channel or build a masked link', () => {
    const text = formatLeadMessage({
      ...LEAD,
      name: '<!channel> <@U123ABC>',
      message: 'see <https://evil.example|our pricing> & <!here>',
    });
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain('&lt;!channel&gt; &lt;@U123ABC&gt;');
    expect(text).toContain('&lt;https://evil.example|our pricing&gt; &amp; &lt;!here&gt;');
  });

  it('keeps each field on one line so a message cannot forge another field', () => {
    const text = formatLeadMessage({
      ...LEAD,
      message: 'hello\nEmail: forged@evil.example\r\nCompany: Fake Inc' + String.fromCharCode(0x2028) + 'Name: Someone Else',
    });
    const emailLines = text.split('\n').filter((line) => line.startsWith('Email:'));
    expect(emailLines).toEqual(['Email: ada@example.test']);
    expect(text.split('\n').filter((line) => line.startsWith('Company:'))).toEqual(['Company: Analytical Engines']);
    expect(text.split('\n').filter((line) => line.startsWith('Name:'))).toEqual(['Name: Ada Lovelace']);
  });

  it('bounds every field and omits empty optional ones', () => {
    const text = formatLeadMessage({ type: 'sales', name: 'N', email: 'e@example.test', message: 'x'.repeat(5000) });
    const message = text.split('\n').find((line) => line.startsWith('Message:')) ?? '';
    expect(message.length).toBeLessThanOrEqual('Message: '.length + 1000);
    expect(text).not.toContain('Company:');
    expect(text).not.toContain('Preferred');
  });
});

describe('createLeadNotifier — delivery', () => {
  it('POSTs a Slack-compatible JSON body to the configured URL and never follows redirects', async () => {
    const fetchImpl = vi.fn(async () => response(200));
    const notifier = createLeadNotifier({ url: URL_OK, fetchImpl });

    await expect(notifier.notify(LEAD)).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(init.body as string);
    expect(Object.keys(payload)).toEqual(['text']);
    expect(payload.text).toContain('Ada Lovelace');
  });

  it('treats a redirect as a failure and does not fetch the Location', async () => {
    const { calls, log } = makeLog();
    const fetchImpl = vi.fn(async () => response(302));
    const notifier = createLeadNotifier({ url: URL_OK, fetchImpl, log });

    await expect(notifier.notify(LEAD)).resolves.toBe(false);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('warn');
    expect(calls[0]?.context).toEqual({ status: 302 });
  });

  it('logs a non-2xx answer as a warning carrying only the status', async () => {
    const { calls, log } = makeLog();
    const notifier = createLeadNotifier({ url: URL_OK, fetchImpl: vi.fn(async () => response(500)), log });

    await expect(notifier.notify(LEAD)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.context).toEqual({ status: 500 });
  });

  it('aborts after the timeout and reports it without throwing', async () => {
    const { calls, log } = makeLog();
    // A webhook that never answers: only the abort signal ends the request.
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('This operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const notifier = createLeadNotifier({ url: URL_OK, fetchImpl, log, timeoutMs: 25 });

    const started = Date.now();
    await expect(notifier.notify(LEAD)).resolves.toBe(false);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.context).toEqual({ reason: 'timeout' });
  });

  it('defaults to a 3 second timeout', async () => {
    vi.useFakeTimers();
    try {
      const { calls, log } = makeLog();
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      );
      const notifier = createLeadNotifier({ url: URL_OK, fetchImpl, log });
      const pending = notifier.notify(LEAD);

      await vi.advanceTimersByTimeAsync(2999);
      expect(calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2);
      await expect(pending).resolves.toBe(false);
      expect(calls[0]?.context).toEqual({ reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never rejects or throws, even when fetch throws synchronously', async () => {
    const { calls, log } = makeLog();
    const fetchImpl = vi.fn(() => {
      throw new TypeError('boom');
    });
    const notifier = createLeadNotifier({ url: URL_OK, fetchImpl, log });

    await expect(notifier.notify(LEAD)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('createLeadNotifier — no PII or secrets in logs', () => {
  it('logs neither lead data nor the webhook URL on any failure path', async () => {
    const { calls, log } = makeLog();
    const failures = [
      vi.fn(async () => response(500)),
      vi.fn(async () => response(301)),
      vi.fn(async () => {
        // Node's fetch puts the target in the message of its network errors.
        throw Object.assign(new TypeError(`fetch failed ${URL_OK} ada@example.test`), {
          cause: { code: 'ECONNREFUSED', message: URL_OK },
        });
      }),
    ];
    for (const fetchImpl of failures) {
      await createLeadNotifier({ url: URL_OK, fetchImpl, log }).notify(LEAD);
    }

    expect(calls).toHaveLength(3);
    const everything = JSON.stringify(calls);
    for (const secret of ['Ada', 'Lovelace', 'ada@example.test', 'Analytical', 'demo', 'TOKENSECRET', 'hooks.example.test']) {
      expect(everything).not.toContain(secret);
    }
    expect(calls[2]?.context).toEqual({ reason: 'network_error', errorName: 'TypeError', code: 'ECONNREFUSED' });
  });
});

describe('createLeadNotifier — flood protection', () => {
  it('stops sending past the window cap, warns once, and recovers when the window rolls over', async () => {
    const { calls, log } = makeLog();
    const fetchImpl = vi.fn(async () => response(200));
    let clock = 1_000_000;
    const notifier = createLeadNotifier({
      url: URL_OK,
      fetchImpl,
      log,
      now: () => clock,
      maxPerWindow: 2,
      windowMs: 60_000,
    });

    await expect(notifier.notify(LEAD)).resolves.toBe(true);
    await expect(notifier.notify(LEAD)).resolves.toBe(true);
    await expect(notifier.notify(LEAD)).resolves.toBe(false);
    await expect(notifier.notify(LEAD)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => /throttled/i.test(call.message))).toHaveLength(1);

    clock += 60_001;
    await expect(notifier.notify(LEAD)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('createLeadNotifierFromEnv', () => {
  it('logs exactly one startup warning when the variable is unset, and never calls fetch', async () => {
    const { calls, log } = makeLog();
    const fetchImpl = vi.fn(async () => response(200));
    const notifier = createLeadNotifierFromEnv({}, { log, fetchImpl });

    expect(notifier.enabled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('warn');
    expect(calls[0]?.message).toContain('LEAD_NOTIFY_WEBHOOK_URL');

    await expect(notifier.notify(LEAD)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('disables itself with a warning that never echoes the configured value', () => {
    const { calls, log } = makeLog();
    const notifier = createLeadNotifierFromEnv(
      { LEAD_NOTIFY_WEBHOOK_URL: `http://hooks.example.test/${SECRET_PATH}` },
      { log },
    );

    expect(notifier.enabled).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.context).toEqual({ reason: 'not_https' });
    expect(JSON.stringify(calls)).not.toContain('TOKENSECRET');
  });

  it('is enabled and silent for a valid https URL', async () => {
    const { calls, log } = makeLog();
    const fetchImpl = vi.fn(async () => response(200));
    const notifier = createLeadNotifierFromEnv({ LEAD_NOTIFY_WEBHOOK_URL: URL_OK }, { log, fetchImpl });

    expect(notifier.enabled).toBe(true);
    await expect(notifier.notify(LEAD)).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });
});
