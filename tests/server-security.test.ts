import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildSecurityHeaders,
  canUseDevAuth,
  getAuthorizedCompanyIds,
  resolveAuthorizedCompanyId,
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

  it('extracts company ids from common InsForge user metadata shapes', () => {
    const ids = getAuthorizedCompanyIds({
      company_id: 'company-a',
      company_ids: ['company-b'],
      user_metadata: { companyIds: ['company-c'] },
      app_metadata: { company_ids: ['company-d'] },
    });

    expect(ids).toEqual(['company-a', 'company-b', 'company-c', 'company-d']);
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
});
