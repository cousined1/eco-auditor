// @vitest-environment node
/**
 * The CSP and its reporting, against a REAL spawned server (no Docker, no
 * database; see tests/helpers/spawn-server.ts):
 *
 *   F-F-07  the policy lets GTM and GA4 reach the hosts Google documents for them,
 *           names no Google Fonts host (F-F-06), and reports violations to a
 *           first-party endpoint that is small, limited and logs no visitor data
 *   F-G-11  a production boot without CONSENT_IP_PEPPER logs ONE structured warning
 *           and still starts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, waitFor, type LogLine, type Spawned } from './helpers/spawn-server';

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name = '', ...values] = directive.split(/\s+/);
        return [name, values];
      }),
  );
}

const reports = (app: Spawned): LogLine[] => app.logs.filter((line) => line.message === 'CSP violation report');

async function postReport(app: Spawned, contentType: string, body: string): Promise<Response> {
  return fetch(`${app.base}/api/csp-report`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'user-agent': 'csp-test-agent/1.0' },
    body,
  });
}

const legacyReport = {
  'csp-report': {
    'document-uri': 'https://ecoauditor.io/app/intake?token=SECRET-TOKEN&email=ada@example.com#frag',
    'blocked-uri': 'https://region1.analytics.example/g/collect?tid=G-SECRETID&cid=cid-marker-x1y2z3',
    'effective-directive': 'connect-src',
    'violated-directive': "connect-src 'self'",
    'original-policy': "default-src 'self'; connect-src 'self'",
    referrer: 'https://www.example.org/?q=secret-referrer',
    'script-sample': 'secret-sample-marker',
    'source-file': 'https://ecoauditor.io/assets/index-abc.js?v=secret-source',
    disposition: 'enforce',
    'status-code': 200,
  },
};

describe('the Content-Security-Policy (F-F-07, F-F-06)', () => {
  let app: Spawned;
  let csp: string;
  let policy: Record<string, string[]>;

  beforeAll(async () => {
    app = await startServer();
    const res = await fetch(`${app.base}/api/health`);
    csp = res.headers.get('content-security-policy') ?? '';
    policy = directives(csp);
  }, 60_000);

  afterAll(() => app?.stop());

  it('lets GTM and GA4 reach the hosts Google documents, so analytics is not blocked after consent', () => {
    // developers.google.com/tag-platform/security/guides/csp, "Google Analytics without Ads features"
    expect(policy['connect-src']).toEqual(expect.arrayContaining([
      "'self'",
      'https://www.googletagmanager.com',
      'https://*.google-analytics.com',
      'https://*.google.com',
    ]));
    expect(policy['script-src']).toContain('https://www.googletagmanager.com');
    // Images: every https source is already allowed, which covers the GA pixel fallback.
    expect(policy['img-src']).toContain('https:');
  });

  it('keeps the first-party and InsForge connections it already had', () => {
    expect(policy['connect-src']).toEqual(expect.arrayContaining(['https://*.insforge.app', 'https://*.insforge.co']));
  });

  it('names no Google Fonts host: the fonts are self-hosted', () => {
    expect(csp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(policy['font-src']).toEqual(["'self'", 'data:']);
    expect(policy['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('reports violations to the first-party endpoint, by report-to with report-uri as the fallback', async () => {
    expect(policy['report-uri']).toEqual(['/api/csp-report']);
    expect(policy['report-to']).toEqual(['csp-endpoint']);
    for (const path of ['/api/health', '/', '/no-such-page']) {
      const res = await fetch(`${app.base}${path}`);
      expect(res.headers.get('reporting-endpoints'), `Reporting-Endpoints is missing on ${path}`).toBe('csp-endpoint="/api/csp-report"');
      expect(res.headers.get('content-security-policy')).toContain('report-to csp-endpoint');
    }
  });

  it('every report-to group named by the policy is defined by Reporting-Endpoints', async () => {
    const res = await fetch(`${app.base}/api/health`);
    const defined = [...(res.headers.get('reporting-endpoints') ?? '').matchAll(/([a-z-]+)="/g)].map((match) => match[1]);
    expect(defined).toContain(policy['report-to']?.[0]);
  });
});

describe('POST /api/csp-report (F-F-07)', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer();
  }, 60_000);

  afterAll(() => app?.stop());

  it('answers 204 with no body for a legacy report-uri report, and logs one structured line', async () => {
    const res = await postReport(app, 'application/csp-report', JSON.stringify(legacyReport));

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const [line] = await waitFor(() => (reports(app).length >= 1 ? reports(app) : undefined));
    expect(line).toMatchObject({
      level: 'warn',
      directive: 'connect-src',
      blocked: 'https://region1.analytics.example',
      page: '/app/intake',
      disposition: 'enforce',
      status: 200,
    });
  });

  it('logs no URL path or query, script sample, source file, referrer or user agent', async () => {
    await postReport(app, 'application/csp-report', JSON.stringify(legacyReport));
    await waitFor(() => (reports(app).length >= 2 ? true : undefined));
    const log = app.rawLog();

    for (const leak of ['SECRET-TOKEN', 'ada@example.com', 'G-SECRETID', 'cid-marker-x1y2z3', 'secret-referrer', 'secret-sample-marker', 'secret-source', 'csp-test-agent', '#frag']) {
      expect(log, `the log holds "${leak}"`).not.toContain(leak);
    }
    // What a log line may hold is exactly this, and nothing that names a visitor.
    const fields = Object.keys(reports(app)[0] ?? {}).filter((key) => !['level', 'timestamp', 'message', 'requestId'].includes(key));
    expect(fields.sort()).toEqual(['blocked', 'directive', 'disposition', 'page', 'status']);
  });

  it('accepts a report-to batch (application/reports+json) and logs at most 5 of it', async () => {
    const before = reports(app).length;
    const batch = Array.from({ length: 8 }, (_, index) => ({
      type: 'csp-violation',
      age: index,
      url: 'https://ecoauditor.io/pricing/',
      user_agent: 'csp-test-agent/1.0',
      body: {
        documentURL: 'https://ecoauditor.io/pricing/?utm=secret-utm',
        blockedURL: index % 2 ? 'inline' : 'https://www.googletagmanager.com/gtm.js?id=GTM-X',
        effectiveDirective: 'script-src-elem',
        disposition: 'report',
        statusCode: 200,
      },
    }));

    const res = await postReport(app, 'application/reports+json', JSON.stringify(batch));

    expect(res.status).toBe(204);
    await waitFor(() => (reports(app).length - before >= 5 ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reports(app).length - before).toBe(5);
    expect(reports(app).at(-1)).toMatchObject({ directive: 'script-src-elem', page: '/pricing/', disposition: 'report' });
    expect(app.rawLog()).not.toContain('secret-utm');
    expect(reports(app).map((line) => line.blocked)).toEqual(expect.arrayContaining(['inline', 'https://www.googletagmanager.com']));
  });

  it('ignores anything that is not a CSP report, with the same 204 and nothing logged', async () => {
    const before = reports(app).length;
    for (const [type, body] of [
      ['text/plain', 'not a report'],
      ['application/json', '{}'],
      ['application/reports+json', JSON.stringify([{ type: 'deprecation', body: { id: 'x' } }])],
      ['application/csp-report', '{"csp-report": "a string"}'],
    ] as const) {
      const res = await postReport(app, type, body);
      expect(res.status, `${type} ${body}`).toBe(204);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reports(app).length).toBe(before);
  });

  it('refuses a body over 8 KB with a JSON 413', async () => {
    const res = await postReport(app, 'application/csp-report', JSON.stringify({ 'csp-report': { 'script-sample': 'x'.repeat(9_000) } }));

    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Request body too large' });
  });

  it('answers malformed JSON with a JSON 400 and does not echo it', async () => {
    const res = await postReport(app, 'application/csp-report', '{"csp-report": secret-not-json');

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('secret-not-json');
  });

  it('is POST only', async () => {
    const res = await fetch(`${app.base}/api/csp-report`);
    expect(res.status).toBe(404);
  });
});

// Each of these exhausts a limiter, so each gets its own server.
describe('POST /api/csp-report limits: one address (F-F-07)', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer();
  }, 60_000);

  afterAll(() => app?.stop());

  it('allows 30 reports a minute per address, then 429s, and never spends the /api budget of chat, consent and leads', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      statuses.push((await postReport(app, 'application/csp-report', JSON.stringify(legacyReport))).status);
    }

    expect(statuses.filter((status) => status === 204)).toHaveLength(30);
    expect(statuses.slice(30).every((status) => status === 429)).toBe(true);

    // 130 requests went through the server; if they had been metered by the shared
    // /api limiter (120 a minute) this would be the request that is refused.
    expect((await fetch(`${app.base}/api/version`)).status).toBe(200);
  }, 60_000);
});

describe('POST /api/csp-report limits: many addresses (F-F-07)', () => {
  let app: Spawned;

  beforeAll(async () => {
    app = await startServer();
  }, 60_000);

  afterAll(() => app?.stop());

  it('writes at most 300 report lines a minute however many addresses send them, and still answers 204', async () => {
    // A direct caller cannot choose its rate-limit key, but behind the platform
    // proxy the rightmost X-Forwarded-For entry is the client, so varying it stands
    // in for many visitors. 40 addresses x 10 reports = 400, each under its own limit.
    const statuses: number[] = [];
    for (let address = 1; address <= 40; address += 1) {
      for (let i = 0; i < 10; i += 1) {
        const res = await fetch(`${app.base}/api/csp-report`, {
          method: 'POST',
          headers: { 'content-type': 'application/csp-report', 'x-forwarded-for': `203.0.113.${address}` },
          body: JSON.stringify(legacyReport),
        });
        statuses.push(res.status);
      }
    }

    expect(statuses.every((status) => status === 204)).toBe(true);
    await waitFor(() => (reports(app).length >= 300 ? true : undefined), 20_000, '300 logged reports');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reports(app).length).toBe(300);
  }, 120_000);
});

describe('CONSENT_IP_PEPPER at boot (F-G-11)', () => {
  const pepperWarnings = (app: Spawned) =>
    app.logs.filter((line) => line.level === 'warn' && String(line.message).includes('CONSENT_IP_PEPPER'));

  it('production without it still boots, and logs exactly one structured warning naming the variable and the action', async () => {
    const app = await startServer({ NODE_ENV: 'production', CONSENT_IP_PEPPER: '' });
    try {
      expect((await fetch(`${app.base}/api/health`)).status).toBe(200);
      await waitFor(() => (pepperWarnings(app).length >= 1 ? true : undefined), 6000, 'the boot warning');
      const warnings = pepperWarnings(app);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        level: 'warn',
        variable: 'CONSENT_IP_PEPPER',
        action: expect.stringContaining('Railway'),
      });
      expect(String(warnings[0]?.message)).toMatch(/random per-process pepper/);
      // One line at boot, not one per request.
      await fetch(`${app.base}/api/version`);
      expect(pepperWarnings(app)).toHaveLength(1);
      expect(app.child.exitCode).toBeNull();
    } finally {
      app.stop();
    }
  }, 60_000);

  it('production with it set logs no such warning', async () => {
    const app = await startServer({ NODE_ENV: 'production', CONSENT_IP_PEPPER: 'a-real-looking-pepper-value' });
    try {
      expect((await fetch(`${app.base}/api/health`)).status).toBe(200);
      // The boot lines are flowing (the listening line comes after any boot warning)...
      await waitFor(() => app.logs.find((line) => line.message === 'Eco-Auditor listening'), 6000, 'the listening line');
      // ...and none of them is the pepper warning.
      expect(pepperWarnings(app)).toHaveLength(0);
      expect(app.rawLog()).not.toContain('a-real-looking-pepper-value');
    } finally {
      app.stop();
    }
  }, 60_000);
});
