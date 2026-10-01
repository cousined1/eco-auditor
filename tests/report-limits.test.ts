// VERIFY-W2A-DATA F5: storage bounds for generated reports
// (src/lib/reports/report-limits.cjs). The generate limit runs on server.cjs's
// own perRouteRateLimit, loaded here from the server source with a clock the
// test moves, so this exercises the real limiter keyed by company. The draft
// bound (SQL trigger) and the tenant check run in tests/report-snapshots-route.test.ts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const limits = require('../src/lib/reports/report-limits.cjs') as {
  GENERATE_LIMIT: number;
  GENERATE_WINDOW_MS: number;
  MAX_DRAFT_REPORTS: number;
  MAX_SNAPSHOT_ENTRY_LINES: number;
  createReportLimits: (perRouteRateLimit: unknown) => { allowGenerate: (res: unknown, companyId: string) => boolean };
};

const server = readFileSync(resolve('server.cjs'), 'utf8');
let now = 0;
const start = server.indexOf('function perRouteRateLimit(');
const perRouteRateLimit = vm.runInNewContext(`${server.slice(start, server.indexOf('\n}\n', start) + 2)}; perRouteRateLimit`, {
  Map,
  Math,
  String,
  Date: { now: () => now },
  resolveClientIp: () => '203.0.113.9', // every request from one address
});

function response() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) { res.headers[name] = value; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

describe('report storage bounds (VERIFY-W2A-DATA F5)', () => {
  it('are the values the verifier asked for, and the SQL trigger keeps the same number of drafts', () => {
    expect([limits.GENERATE_LIMIT, limits.GENERATE_WINDOW_MS, limits.MAX_DRAFT_REPORTS, limits.MAX_SNAPSHOT_ENTRY_LINES])
      .toEqual([20, 3_600_000, 25, 5000]);
    const sql = readFileSync(resolve('migrations/20260930110000_report-snapshots.sql'), 'utf8');
    expect(sql).toContain(`LIMIT ${limits.MAX_DRAFT_REPORTS});`);
  });

  it('allows 20 generates per company per hour, then answers 429 with Retry-After; each company counts alone', () => {
    now = 1_000_000;
    const { allowGenerate } = limits.createReportLimits(perRouteRateLimit);
    for (let i = 0; i < 20; i++) expect(allowGenerate(response(), '7'), `generate ${i + 1}`).toBe(true);

    now += 60_000;
    const refused = response();
    expect(allowGenerate(refused, '7')).toBe(false);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['Retry-After']).toBe('3540');
    expect(refused.body).toEqual({ error: 'Too many requests', retryAfter: 3540 });

    // Same client address, another company: keyed by company, not by IP.
    expect(allowGenerate(response(), '8')).toBe(true);
    now += 3_540_001;
    expect(allowGenerate(response(), '7')).toBe(true);
  });

  // VERIFY-FINAL-DATA D-4: it used to sit right after the tenant check, so a refused period (400) and
  // an empty one (422) spent the quota too (11 x 400, then only 9 valid generates before the 429).
  // Behaviour: tests/report-snapshots-route.test.ts (Docker).
  it('is counted in the generate route after the tenant check, the period check and the empty-period answer, right before the report id', () => {
    const route = server.slice(server.indexOf("app.post('/api/companies/:id/reports/generate'"));
    const order = [
      'requireCompanyAccess(req, res, req.params.id)',
      'parseReportPeriod(',
      "code: 'invalid_period'",
      "code: 'empty_period'",
      'reportLimits.allowGenerate(res, companyId)',
      "nextval(pg_get_serial_sequence('public.reports'",
    ].map((marker) => route.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(server.match(/allowGenerate\(/g)).toHaveLength(1);
  });
});
