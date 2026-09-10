import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildSecurityHeaders,
  canUseDevAuth,
  classifyApiFailure,
  getAuthorizedCompanyIds,
  resolveAuthorizedCompanyId,
  sanitizeChatState,
  sanitizeLeadPayload,
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
