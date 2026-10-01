import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CONSENT_DECIDED_MAX_AGE_MS,
  CONSENT_DECIDED_MAX_FUTURE_MS,
  billingFailureStatus,
  buildSecurityHeaders,
  canUseDevAuth,
  classifyApiFailure,
  getAuthorizedCompanyIds,
  resolveAuthorizedCompanyId,
  sanitizeChatState,
  sanitizeConsentDecidedAt,
  sanitizeLeadPayload,
  summarizeCspReports,
} = require('../server-security.cjs');

describe('server security policy', () => {
  it('adds CSP and HSTS headers for production responses', () => {
    const headers = buildSecurityHeaders({ hsts: true });

    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
  });

  it('never enables dev auth in production', () => {
    expect(canUseDevAuth({ NODE_ENV: 'production', ALLOW_DEV_AUTH: 'true' })).toBe(false);
    expect(canUseDevAuth({ NODE_ENV: 'development', ALLOW_DEV_AUTH: 'true' })).toBe(true);
    expect(canUseDevAuth({ NODE_ENV: 'test' })).toBe(false);
  });

  // This test previously asserted that company ids were harvested from
  // user_metadata / app_metadata / company_ids — i.e. it locked in the
  // vulnerability. On Supabase-compatible backends user_metadata is writable by
  // the account holder, so honouring it let an attacker set
  // user_metadata.company_id = "<victim>" and read or write another tenant's
  // data through /api/companies/:id/*. The contract is now inverted: only the
  // server-resolved company_id (set by requireCompanyAccess from a
  // `WHERE user_id = $1` lookup) is authoritative.
  // See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-4).
  it('ignores client-writable metadata and trusts only the server-resolved company id', () => {
    const ids = getAuthorizedCompanyIds({
      company_id: 'company-a',
      company_ids: ['company-b'],
      user_metadata: { companyIds: ['company-c'] },
      app_metadata: { company_ids: ['company-d'] },
    });

    expect(ids).toEqual(['company-a']);
  });

  it('refuses a company id injected through user_metadata', () => {
    const result = resolveAuthorizedCompanyId(
      { company_id: 'company-a', user_metadata: { company_id: 'victim-company' } },
      'victim-company'
    );

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('rejects cross-tenant company access', () => {
    const result = resolveAuthorizedCompanyId({ company_id: 'company-a' }, 'company-b');

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('defaults to the authenticated company when no company is requested', () => {
    const result = resolveAuthorizedCompanyId({ company_id: 'company-a' }, undefined);

    expect(result).toEqual({ ok: true, companyId: 'company-a' });
  });

  it('bounds and normalizes public lead payloads', () => {
    const lead = sanitizeLeadPayload({
      name: '  Ada  ',
      email: 'ADA@EXAMPLE.COM ',
      company: 'Example',
      type: 'demo',
      message: 'x'.repeat(2000),
    });

    expect(lead.ok).toBe(true);
    if (lead.ok) {
      expect(lead.value.name).toBe('Ada');
      expect(lead.value.email).toBe('ada@example.com');
      expect(lead.value.message?.length).toBeLessThanOrEqual(1000);
    }
  });

  // F-B-21: every website lead used to be stored as source 'api', so the
  // contact page, the demo page and direct API callers were indistinguishable.
  describe('lead source (F-B-21)', () => {
    const base = { name: 'Ada', email: 'ada@example.com' };
    const sourceOf = (source: unknown) => {
      const lead = sanitizeLeadPayload({ ...base, source });
      expect(lead.ok).toBe(true);
      return lead.value.source;
    };

    it.each(['contact', 'demo', 'chat', 'api'])('keeps the allowlisted source %s', (source) => {
      expect(sourceOf(source)).toBe(source);
    });

    it('normalizes case and surrounding whitespace before checking the allowlist', () => {
      expect(sourceOf('  Contact ')).toBe('contact');
      expect(sourceOf('DEMO')).toBe('demo');
    });

    it.each([
      ['an unknown label', 'newsletter'],
      ['the chatbot label, which only the server may set', 'chatbot'],
      ['markup', '<script>alert(1)</script>'],
      ['a value over the column limit', 'contact'.padEnd(60, 'x')],
      ['an array that stringifies to an allowed label', ['contact']],
      ['an object', { source: 'contact' }],
      ['a number', 7],
      ['null', null],
    ])('stores %s as api', (_label, source) => {
      expect(sourceOf(source)).toBe('api');
    });

    it('defaults to api when the client sends no source', () => {
      const lead = sanitizeLeadPayload(base);
      expect(lead.ok).toBe(true);
      expect(lead.value.source).toBe('api');
    });
  });

  it('allowlists and bounds client-controlled chat state', () => {
    expect(sanitizeChatState({
      flow: 'demo',
      step: 'email',
      name: 'x'.repeat(200),
      email: 'ada@example.com',
      injected: 'ignored',
    })).toEqual({
      flow: 'demo',
      step: 'email',
      name: 'x'.repeat(120),
      email: 'ada@example.com',
    });
    expect(sanitizeChatState({ flow: 'admin', step: 'complete' })).toEqual({});
    expect(sanitizeChatState('not-an-object')).toEqual({});
  });
});

// F-F-07: what a CSP violation report may leave in the log. The route itself is
// covered against a real server in tests/server-csp-report.test.ts; these are the
// summarizer's rules, case by case.
describe('summarizeCspReports (F-F-07)', () => {
  const legacy = (fields: Record<string, unknown>) => ({ 'csp-report': fields });

  it('keeps the directive, the blocked host, the page path, the disposition and the status, and nothing else', () => {
    const [summary] = summarizeCspReports(legacy({
      'document-uri': 'https://ecoauditor.io/app/intake?token=abc#x',
      'blocked-uri': 'https://region1.google-analytics.com/g/collect?v=2&tid=G-XXXX',
      'effective-directive': 'connect-src',
      'violated-directive': "connect-src 'self'",
      'script-sample': 'secret',
      referrer: 'https://example.org/?q=1',
      disposition: 'enforce',
      'status-code': 200,
    }));

    expect(summary).toEqual({
      directive: 'connect-src',
      blocked: 'https://region1.google-analytics.com',
      page: '/app/intake',
      disposition: 'enforce',
      status: 200,
    });
  });

  it.each([
    ['inline', 'inline'],
    ['eval', 'eval'],
    ['data:image/png;base64,AAAA', 'data:'],
    ['blob:https://ecoauditor.io/1234-5678', 'blob:'],
    ['chrome-extension://abcdefghijklmnop/content.js', 'chrome-extension:'],
    ['https://cdn.example.com:8443/a/b.js?x=1', 'https://cdn.example.com:8443'],
    ['not a url at all!', 'unknown'],
    ['', 'unknown'],
  ])('reduces the blocked URL %j to %j', (blocked, expected) => {
    expect(summarizeCspReports(legacy({ 'blocked-uri': blocked }))[0]?.blocked).toBe(expected);
  });

  it('uses the violated directive when there is no effective one, and only its name', () => {
    expect(summarizeCspReports(legacy({ 'violated-directive': "img-src 'self' https://x.example" }))[0]?.directive).toBe('img-src');
  });

  it('refuses a directive, disposition or status that could carry anything else into a log line', () => {
    const [summary] = summarizeCspReports(legacy({
      'effective-directive': 'script-src' + String.fromCharCode(10) + '{"level":"error"}',
      disposition: 'enforce' + String.fromCharCode(10) + 'extra',
      'status-code': '200; drop table',
      'document-uri': 'javascript:alert(1)',
    }));

    // Only the first word of a directive survives, and a non-web document URL has no page.
    expect(summary).toEqual({ directive: 'script-src', blocked: 'unknown', page: 'unknown', disposition: 'unknown', status: null });
  });

  it('reads a report-to batch, ignores other report types, and logs at most 5', () => {
    const violation = (index: number) => ({
      type: 'csp-violation',
      url: 'https://ecoauditor.io/pricing/',
      body: { effectiveDirective: 'script-src-elem', blockedURL: `https://h${index}.example/x`, documentURL: 'https://ecoauditor.io/pricing/?a=b', disposition: 'report', statusCode: 200 },
    });
    const batch = [{ type: 'deprecation', body: { id: 'x' } }, null, 'text', ...Array.from({ length: 9 }, (_, index) => violation(index))];

    const summaries = summarizeCspReports(batch);

    expect(summaries).toHaveLength(5);
    expect(summaries[0]).toEqual({ directive: 'script-src-elem', blocked: 'https://h0.example', page: '/pricing/', disposition: 'report', status: 200 });
  });

  it.each([[undefined], [null], ['a string'], [42], [{}], [[]], [{ 'csp-report': 'not an object' }]])('returns nothing for %j', (body) => {
    expect(summarizeCspReports(body)).toEqual([]);
  });

  // D-W2A-6: the report body is attacker-supplied up to the route's 8 KB cap. What
  // reaches the log is escaped (no line or header injection), and is also bounded:
  // a page path or host longer than a real one is cut, never stretched to the cap.
  it('logs at most about 200 characters of the page path, from its start', () => {
    const tail = '/' + 'p'.repeat(7000);
    const [legacyReport] = summarizeCspReports(legacy({ 'document-uri': 'https://ecoauditor.io/app/intake' + tail }));
    const [batched] = summarizeCspReports([{ type: 'csp-violation', body: { documentURL: 'https://ecoauditor.io/app/intake' + tail } }]);

    for (const summary of [legacyReport, batched]) {
      expect(summary?.page.length).toBeLessThanOrEqual(200);
      expect(summary?.page.startsWith('/app/intake/ppp')).toBe(true);
    }
  });

  it('keeps an ordinary page path whole', () => {
    expect(summarizeCspReports(legacy({ 'document-uri': 'https://ecoauditor.io/blog/scope-3-emissions-for-smbs/' }))[0]?.page).toBe('/blog/scope-3-emissions-for-smbs/');
  });

  it('logs at most the length of a real host for what was blocked', () => {
    const [summary] = summarizeCspReports(legacy({ 'blocked-uri': 'https://' + 'h'.repeat(6000) + '.example/script.js?x=1' }));

    expect(summary?.blocked.length).toBeLessThanOrEqual(270);
    expect(summary?.blocked.startsWith('https://hhh')).toBe(true);
  });

  it('keeps a real host, with its port, whole', () => {
    expect(summarizeCspReports(legacy({ 'blocked-uri': 'https://region1.google-analytics.com:443/g/collect' }))[0]?.blocked).toBe('https://region1.google-analytics.com');
    expect(summarizeCspReports(legacy({ 'blocked-uri': 'https://cdn.example.com:8443/a.js' }))[0]?.blocked).toBe('https://cdn.example.com:8443');
  });
});

// k10 follow-up: a consent record keeps the time the visitor chose, as their browser
// reported it, next to the time the server received it. The browser's clock is not
// trusted: the time is taken only when it is well formed and plausible, else the
// record falls back to the receipt time (null here, read as "use created_at").
describe('sanitizeConsentDecidedAt (k10 follow-up)', () => {
  const RECEIVED = Date.parse('2026-09-30T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(RECEIVED + offsetMs).toISOString();

  it('exports the bounds it applies: 5 minutes ahead, 30 days back', () => {
    expect(CONSENT_DECIDED_MAX_FUTURE_MS).toBe(5 * 60 * 1000);
    expect(CONSENT_DECIDED_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ['a choice a moment ago', -2_000],
    ['a record that waited in the outbox for two days', -2 * 24 * 60 * 60 * 1000],
    ['the receipt time itself', 0],
    ['a browser clock a little fast', 3 * 60 * 1000],
    ['exactly 5 minutes ahead', 5 * 60 * 1000],
    ['exactly 30 days ago', -30 * 24 * 60 * 60 * 1000],
  ])('takes %s', (_name, offset) => {
    expect(sanitizeConsentDecidedAt(at(offset), RECEIVED)).toBe(at(offset));
  });

  it.each([
    ['one millisecond past 5 minutes ahead', 5 * 60 * 1000 + 1],
    ['an hour ahead', 60 * 60 * 1000],
    ['a year ahead', 365 * 24 * 60 * 60 * 1000],
    ['one millisecond older than 30 days', -(30 * 24 * 60 * 60 * 1000 + 1)],
    ['a year old', -365 * 24 * 60 * 60 * 1000],
  ])('ignores %s', (_name, offset) => {
    expect(sanitizeConsentDecidedAt(at(offset), RECEIVED)).toBeNull();
  });

  it('accepts the UTC time with or without milliseconds and returns it in one form', () => {
    expect(sanitizeConsentDecidedAt('2026-09-30T11:59:00Z', RECEIVED)).toBe('2026-09-30T11:59:00.000Z');
    expect(sanitizeConsentDecidedAt('2026-09-30T11:59:00.5Z', RECEIVED)).toBe('2026-09-30T11:59:00.500Z');
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['yesterday'],
    [1790000000000],
    [true],
    [{}],
    [['2026-09-30T11:59:00Z']],
    ['2026-09-30'], // a date is not a moment
    ['2026-09-30T11:59:00'], // no zone: read in the server's own
    ['2026-09-30T13:59:00+02:00'], // an offset, where only UTC is sent
    ['Sep 30 2026 11:59:00 GMT'],
    ['2026-02-30T11:59:00.000Z'], // Date.parse rolls this over to 2 March
    ['2026-09-30T24:00:00.000Z'], // and this to the next day
    ['2026-13-01T11:59:00.000Z'],
    ['2026-09-30T11:59:00.000Z; DROP TABLE public.consent_records'],
    ['2026-09-30T11:59:00.000Z' + ' '.repeat(40)],
  ])('ignores %j', (value) => {
    expect(sanitizeConsentDecidedAt(value, RECEIVED)).toBeNull();
  });
});

// REL-018: the classifier's doc-block says anything carrying a driver-level
// `code` is infrastructure. Unlisted SQLSTATEs used to fall through to the 400
// branch and echo the raw driver message (e.g. "permission denied for table
// csv_import_events"), leaking SQL/schema detail and mislabeling an outage as
// bad input.
describe('classifyApiFailure (REL-018)', () => {
  it('treats an unlisted SQLSTATE as infra: generic 503, no driver text', () => {
    const err = Object.assign(new Error('permission denied for table csv_import_events'), { code: '42501' });
    const failure = classifyApiFailure(err);
    expect(failure.status).toBe(503);
    expect(failure.message).toMatch(/temporarily unavailable/i);
    expect(failure.message).not.toContain('permission denied');
    expect(failure.message).not.toContain('csv_import_events');
  });

  it('keeps the listed connection codes on the same generic 503', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const failure = classifyApiFailure(err);
    expect(failure.status).toBe(503);
    expect(failure.message).toBe('Data store temporarily unavailable. Please retry.');
  });

  it('still returns engine validation errors as 400s with their message', () => {
    const failure = classifyApiFailure(new Error('Row 3: Unknown category "foo"'));
    expect(failure.status).toBe(400);
    expect(failure.message).toContain('Row 3');
  });
});

// D-S6 (VERIFY-FINAL-SEC): the Stripe-backed routes answered classifyApiFailure's rule, which reads every
// error that has a `code` as a data-store fault, so a Stripe error such as resource_missing came back as a
// 503 ("retry later"). The routes' behaviour with the database down is in tests/data-layer-outage.test.ts.
describe('billingFailureStatus (D-S6)', () => {
  const stripeError = (type: string, code?: string) => Object.assign(new Error('No such checkout.session: cs_test_x'), { type, code });
  const pgError = (code: string) => Object.assign(new Error('connection failure'), { code });

  it.each([
    ['a Stripe error with a code (StripeInvalidRequestError, resource_missing)', 500, stripeError('StripeInvalidRequestError', 'resource_missing')],
    ['a declined card (StripeCardError, card_declined)', 500, stripeError('StripeCardError', 'card_declined')],
    ['a Stripe error whose code is undefined, as the SDK builds it (StripeConnectionError)', 500, stripeError('StripeConnectionError')],
    ['a pg error with a connection SQLSTATE (08001)', 503, pgError('08001')],
    ['a pg error with an unlisted SQLSTATE (42501)', 503, pgError('42501')],
    ['a socket error (ECONNRESET)', 503, pgError('ECONNRESET')],
    ['an Error whose message says Data store unavailable', 503, new Error('Data store unavailable: no database is configured')],
    ['a plain Error', 500, new Error('boom')],
    ['a thrown string', 500, 'boom'],
    ['undefined', 500, undefined],
  ])('%s answers %i', (_name, status, err) => {
    expect(billingFailureStatus(err)).toBe(status);
  });

  it('holds for the errors the installed Stripe SDK builds, which is what the routes catch', () => {
    const { errors } = require('stripe');
    const raw = { message: 'No such checkout.session: cs_test_x', type: 'invalid_request_error', code: 'resource_missing' };
    for (const make of [
      () => new errors.StripeInvalidRequestError(raw),
      () => new errors.StripeCardError({ ...raw, type: 'card_error', code: 'card_declined' }),
      () => new errors.StripeRateLimitError({ ...raw, type: 'rate_limit_error', code: 'rate_limit' }),
      () => new errors.StripeConnectionError({ message: 'An error occurred with our connection to Stripe.', type: 'api_connection_error' }),
    ]) {
      const err = make();
      expect({ type: err.type, status: billingFailureStatus(err) }).toEqual({ type: err.type, status: 500 });
    }
  });
});
