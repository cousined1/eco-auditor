/**
 * Regression tests for the functional audit of 2026-08-22.
 *
 * Every test here FAILS against the pre-audit code and passes after the fix.
 * Each one names the defect it pins so the link survives future refactors.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { startSocialSignIn } from '../src/lib/socialAuth';

const require = createRequire(import.meta.url);
const { calculateEntry, summarizeEntries, buildTrend, toDashboardSummary } =
  require('../emissions-engine.cjs');
const { trialEligiblePriceIds } = require('../server-billing.cjs');
const { validateFixture } = require('../src/lib/reports/report-generator.cjs');
const fixture = require('../src/lib/reports/sample-report-fixture.json');

// ── D-03: scope was taken from untrusted input, never checked against the
// catalog. A Scope 3 activity could be booked as Scope 1 -- misfiling report
// totals and slipping past the Scope 3 paywall, which gates on the label.
describe('D-03 declared scope must match the catalog scope', () => {
  it('rejects a Scope 3 category declared as Scope 1', () => {
    expect(() =>
      calculateEntry({ scope: '1', category: 'purchased_goods', source: 'purchased_goods', amount: 500000, unit: 'USD' })
    ).toThrow(/Scope 3/);
  });

  it('rejects a Scope 1 category declared as Scope 2', () => {
    expect(() =>
      calculateEntry({ scope: '2', category: 'stationary_combustion', source: 'natural_gas', amount: 100, unit: 'therms' })
    ).toThrow(/Scope 1/);
  });

  it('still accepts a correctly declared row', () => {
    const row = calculateEntry({ scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' });
    expect(row.scope).toBe('scope1');
    expect(row.co2e_tonnes).toBeCloseTo(5.306, 3);
  });

  it('leaves the CO2e passthrough (calculator-written rows) alone', () => {
    const row = calculateEntry({ scope: '3', category: 'business_travel', source: 'x', amount: 2500, unit: 'kg CO2e' });
    expect(row.co2e_tonnes).toBeCloseTo(2.5, 6);
  });
});

// ── D-04: getMonth()/getFullYear() are LOCAL-time accessors applied to UTC
// timestamps, so on any server west of UTC a row dated the 1st of a month
// landed in the previous month, and Jan-1 rows in the previous year.
describe('D-04 buildTrend buckets by UTC, not server local time', () => {
  const entries = [
    { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms', created_at: '2026-11-01T00:30:00.000Z' },
    { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 2000, unit: 'therms', created_at: '2026-01-01T05:00:00.000Z' },
  ];

  it('puts a 2026-11-01T00:30Z row in November, not October', () => {
    const monthly = buildTrend(entries, { period: 'monthly', year: 2026 });
    expect(monthly[10].month).toBe('Nov');
    expect(monthly[10].scope1).toBeCloseTo(5.306, 3);
    expect(monthly[9].scope1).toBe(0); // Oct must stay empty
  });

  it('keeps a 2026-01-01T05:00Z row in 2026 January', () => {
    const monthly = buildTrend(entries, { period: 'monthly', year: 2026 });
    expect(monthly[0].scope1).toBeCloseTo(10.612, 3);
    const prior = buildTrend(entries, { period: 'monthly', year: 2025 });
    expect(prior[11].scope1).toBe(0); // must NOT leak into Dec 2025
  });
});

// ── D-13/14/15: confidence scoring.
describe('D-13..15 confidence scoring', () => {
  it('reports 0, not 100, for an empty inventory', () => {
    expect(summarizeEntries([]).confidence_score).toBe(0);
  });

  it('honors an explicit confidence of 0 instead of substituting the default', () => {
    const row = calculateEntry({ scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 10, unit: 'therms', confidence: 0 });
    expect(row.confidence).toBe(0);
  });

  it('gives catalog categories their own confidence rather than the 70 fallback', () => {
    const row = calculateEntry({ scope: '2', category: 'purchased_heat_steam', source: 'steam', amount: 100, unit: 'MMBtu' });
    expect(row.confidence).toBe(90);
  });
});

// ── D-16: a 0 -> positive move rendered as "0% change" (no change) instead of
// being marked as new and not comparable.
describe('D-16 trend treats 0 -> positive as new, not flat', () => {
  it('returns null rather than 0 when the prior period was zero', () => {
    const current = summarizeEntries([
      { scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 1000, unit: 'therms' },
    ]);
    // hasPrior is driven by priorSummary.by_scope, so scope2 > 0 makes the
    // prior period comparable while scope1 was genuinely zero.
    const prior = { by_scope: { scope1: 0, scope2: 10, scope3: 0 } };
    const dash = toDashboardSummary(current, prior);
    expect(dash.trend_vs_prior_period).not.toBeNull();
    expect(dash.trend_vs_prior_period.scope1).toBeNull();
    // and a real prior value still produces a percentage
    expect(typeof dash.trend_vs_prior_period.scope2).toBe('number');
  });
});

// ── D-11: exact float equality on decimal tonnes. 91.8+44.1+300.3 is
// 436.20000000000005, so a consistent one-decimal fixture would throw.
describe('D-11 validateFixture compares scope sums with a tolerance', () => {
  it('accepts a fixture whose decimals do not sum exactly in binary float', () => {
    const decimalFixture = {
      ...fixture,
      metrics: {
        ...fixture.metrics,
        scope1: { ...fixture.metrics.scope1, value: 91.8 },
        scope2: { ...fixture.metrics.scope2, value: 44.1 },
        scope3: { ...fixture.metrics.scope3, value: 300.3 },
        total: 436.2,
      },
    };
    expect(91.8 + 44.1 + 300.3).not.toBe(436.2); // the trap this pins
    expect(() => validateFixture(decimalFixture)).not.toThrow();
  });

  it('still rejects sums that genuinely disagree', () => {
    const wrong = {
      ...fixture,
      metrics: { ...fixture.metrics, total: fixture.metrics.total + 50 },
    };
    expect(() => validateFixture(wrong)).toThrow(/do not match total/);
  });
});

// ── D-10: trial eligibility was duplicated in server.cjs and had drifted from
// the shared helper, which included the annual price ids. Annual plans bill the
// full year up front and must not be trial-eligible.
describe('D-10 trial eligibility has one source of truth', () => {
  const env = {
    STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_monthly',
    STRIPE_PRICE_STARTER_ANNUAL: 'price_starter_annual',
    STRIPE_PRICE_GROWTH_MONTHLY: 'price_growth_monthly',
    STRIPE_PRICE_GROWTH_ANNUAL: 'price_growth_annual',
    STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  };

  it('excludes annual price ids', () => {
    const ids = trialEligiblePriceIds(env);
    expect(ids.has('price_starter_annual')).toBe(false);
    expect(ids.has('price_growth_annual')).toBe(false);
  });

  it('includes exactly the monthly Starter and Growth ids', () => {
    expect(trialEligiblePriceIds(env)).toEqual(
      new Set(['price_starter_monthly', 'price_growth_monthly'])
    );
  });
});

// --- F-01: startSocialSignIn resolved instead of catching SDK throws, so a
// network failure during "Continue with Google" escaped every caller's error
// handling and left the provider button pending with no feedback.
describe('F-01 startSocialSignIn converts thrown SDK faults into failed results', () => {
  it('resolves {ok:false} when signInWithOAuth throws', async () => {
    const result = await startSocialSignIn({
      provider: 'google',
      redirectTo: 'https://ecoauditor.io/auth/callback',
      auth: {
        signInWithOAuth: async () => {
          throw new Error('Network request failed');
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Network request failed');
  });

  it('resolves {ok:false} with a fallback message for non-Error throws', async () => {
    const result = await startSocialSignIn({
      provider: 'apple',
      redirectTo: 'https://ecoauditor.io/auth/callback',
      auth: {
        signInWithOAuth: async () => {
          throw undefined;
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unable to start apple sign in/);
  });

  it('still resolves {ok:true} on success', async () => {
    const result = await startSocialSignIn({
      provider: 'azure',
      redirectTo: 'https://ecoauditor.io/auth/callback',
      auth: { signInWithOAuth: async () => ({ data: {}, error: null }) },
    });
    expect(result.ok).toBe(true);
  });
});

// --- F-02: /api/calculate and /api/ingest/csv returned HTTP 400 with the raw
// driver message for ANY thrown error, so a database outage was reported as
// bad client input and leaked SQL/connection details to the browser.
describe('F-02 classifyApiFailure separates infra outages from input validation', () => {
  const { classifyApiFailure } = require('../server-security.cjs');

  it('maps data-store failures to a generic 503', () => {
    const failure = classifyApiFailure(new Error('Emission data store unavailable'));
    expect(failure.status).toBe(503);
    expect(failure.message).not.toMatch(/Emission/);
    expect(failure.message).toMatch(/temporarily unavailable/i);
  });

  it('maps Postgres connection faults to a generic 503', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const failure = classifyApiFailure(err);
    expect(failure.status).toBe(503);
    expect(failure.message).not.toContain('10.0.0.1');
  });

  it('keeps engine validation errors as 400s with their user-facing message', () => {
    const failure = classifyApiFailure(new Error('Row 3: Unknown category "foo"'));
    expect(failure.status).toBe(400);
    expect(failure.message).toContain('Row 3');
  });

  it('treats non-Error values as 400 messages without crashing', () => {
    const failure = classifyApiFailure('CSV file is empty');
    expect(failure.status).toBe(400);
    expect(failure.message).toBe('CSV file is empty');
  });
});
