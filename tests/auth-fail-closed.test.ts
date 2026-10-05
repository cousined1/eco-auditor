/**
 * Auth must fail closed.
 *
 * Verified at runtime on 2026-10-05 by probing every protected endpoint
 * unauthenticated against a booted server: /api/account/export,
 * /api/emissions/summary, /api/emissions/trend, /api/companies/:id/facilities,
 * /api/facilities/:id/emissions, /api/companies/:id/compliance, /api/checkout,
 * /api/ingest/csv, /api/account/delete-data and
 * /api/companies/:id/reports/generate all refused (503 locally, because
 * InsForge is unconfigured), and none returned 2xx.
 *
 * That probe is not reproducible in CI without a database, so the invariant is
 * pinned structurally here: req.user may only be assigned after a validated
 * session, and no branch may reach next() without either a verified token or
 * an explicit dev secret match.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');
// canUseDevAuth lives in the shared security module, not in server.cjs.
const securitySource = readFileSync(
  resolve(__dirname, '..', 'server-security.cjs'),
  'utf8',
);

function fnBody(signature: string, nextMarker: string): string {
  const start = serverSource.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  return serverSource.slice(start, serverSource.indexOf(nextMarker, start));
}

const apiAuthGuard = fnBody('function apiAuthGuard(', 'async function requireCompanyAccess');
const authGuard = fnBody('async function authGuard(', 'function apiAuthGuard');

describe('apiAuthGuard fails closed', () => {
  it('refuses when the auth backend is not configured', () => {
    expect(apiAuthGuard).toMatch(/if \(!INSFORGE_BASE_URL\)/);
    expect(apiAuthGuard).toContain("res.status(503)");
  });

  it('never reaches next() on the unconfigured path', () => {
    // The 503 branch returns; the only next() on this path is inside the
    // explicit dev-auth branch, which is guarded by canUseDevAuth.
    const unconfigured = apiAuthGuard.slice(0, apiAuthGuard.indexOf('const devSecret'));
    expect(unconfigured).not.toContain('next()');
  });

  it('gates dev auth behind ALLOW_DEV_AUTH plus an exact secret match', () => {
    expect(apiAuthGuard).toContain('canUseDevAuth(process.env)');
    expect(apiAuthGuard).toMatch(/if \(!devSecret \|\| req\.headers\.authorization !== expected\)/);
    expect(apiAuthGuard).toContain("res.status(401)");
    // canUseDevAuth must require NODE_ENV !== production explicitly, so a
    // stray ALLOW_DEV_AUTH in a production env cannot open the dev path.
    expect(securitySource).toContain("env.NODE_ENV !== 'production' && env.ALLOW_DEV_AUTH === 'true'");
  });

  it('assigns req.user only after a validated session', () => {
    expect(authGuard).toMatch(/if \(!userRes\.ok\)[\s\S]*?return res\.status\(401\)/);
    expect(authGuard).toMatch(/if \(!user \|\| !user\.id\)[\s\S]*?return res\.status\(401\)/);
    const assignAt = authGuard.indexOf('req.user = user');
    const first401 = authGuard.indexOf('res.status(401)');
    expect(first401, 'a 401 path exists').toBeGreaterThan(-1);
    expect(assignAt, 'req.user assigned before any validation').toBeGreaterThan(first401);
  });

  it('turns a verification failure into a 5xx rather than an open door', () => {
    expect(authGuard).toContain("res.status(500)");
    expect(authGuard).not.toMatch(/catch[\s\S]*?next\(\)/);
  });

  it('guards the data-bearing company endpoints', () => {
    for (const route of [
      "app.get('/api/account/export'",
      "app.post('/api/companies/:id/facilities'",
      "app.post('/api/ingest/csv'",
      "app.post('/api/account/delete-data'",
      "app.post('/api/companies/:id/reports/generate'",
      "app.get('/api/emissions/summary'",
      "app.get('/api/emissions/trend'",
      "app.get('/api/facilities/:id/emissions'",
      "app.get('/api/companies/:id/compliance'",
    ]) {
      const start = serverSource.indexOf(route);
      expect(start, `${route} not found`).toBeGreaterThan(-1);
      const head = serverSource.slice(start, start + 300);
      expect(head, `${route} is not behind apiAuthGuard`).toMatch(/apiAuthGuard|authGuard/);
    }
  });

  it('does not expose a GET /api/companies/:id/reports route unauthenticated', () => {
    // Only POST .../reports/generate exists; the 404 seen at runtime is the
    // catch-all JSON handler, not a data leak.
    expect(serverSource).not.toMatch(/app\.get\('\/api\/companies\/:id\/reports'/);
    expect(serverSource).toContain("app.use('/api', function (_req, res)");
  });
});