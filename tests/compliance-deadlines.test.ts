/**
 * Compliance deadline accuracy.
 *
 * Regression cover for a real customer-facing defect: three components carried
 * their own copy of the regulatory dates and disagreed. On 2026-10-05 the API
 * reported California SB 253 as "overdue" since 2026-01-01 while the actual
 * first-year deadline was still ahead — telling customers they were nine
 * months late when they had about five weeks left. For a compliance product
 * that is a trust-destroying error.
 *
 * These tests pin the dates and the date-derived status so the copies cannot
 * drift apart again.
 */

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { allDeadlines, statusFor, daysUntil, deadlineAppliesTo, deadlinesApplicableTo } = require('../compliance-deadlines.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getComplianceStatus } = require('../emissions-engine.cjs');

const AT = (iso: string) => Date.parse(iso);

describe('compliance deadline source of truth', () => {
  it('does not report the SB 253 first-year deadline as overdue while it is still ahead', () => {
    // 2026-10-05: the real window. SB 253 Scope 1/2 is due 2026-11-10.
    const now = AT('2026-10-05T12:00:00Z');
    const rows = allDeadlines(now);
    const sb253 = rows.find((r: { id: string }) => r.id === 'sb253_scope12');

    expect(sb253.due_date).toBe('2026-11-10');
    expect(sb253.status).not.toBe('overdue');
    expect(sb253.status).toBe('due_soon');
    expect(sb253.days_left).toBeGreaterThan(0);
    expect(sb253.days_left).toBeLessThanOrEqual(37);
  });

  it('never carries a next_deadline that is already in the past for an in-scope company', () => {
    // The defect: getComplianceStatus hardcoded "2026-01-01 Scope 1 and Scope 2
    // reporting" as `next_deadline`, which is a past date from 2026-01-02
    // onward. Assert it stays ahead of today across the year.
    for (const iso of [
      '2026-01-05T00:00:00Z',
      '2026-06-15T00:00:00Z',
      '2026-10-05T00:00:00Z',
      '2026-12-31T00:00:00Z',
    ]) {
      const status = getComplianceStatus(
        { revenue: 1_200_000_000, region: 'CA', employees: 600 },
        { now: AT(iso) },
      );
      const sb253 = status.frameworks.sb253;
      if (sb253.next_deadline === null) continue; // all deadlines passed
      expect(
        Date.parse(`${sb253.next_deadline}T23:59:59.999Z`),
        `next_deadline ${sb253.next_deadline} was already past at ${iso}`,
      ).toBeGreaterThanOrEqual(AT(iso));
    }
  });

  it('marks a deadline overdue only after the date has actually passed', () => {
    expect(statusFor('2026-11-10', AT('2026-11-09T23:00:00Z'))).toBe('due_soon');
    expect(statusFor('2026-11-10', AT('2026-11-10T00:00:00Z'))).toBe('due_soon');
    expect(statusFor('2026-11-10', AT('2026-11-11T12:00:00Z'))).toBe('overdue');
    expect(statusFor('2026-11-10', AT('2026-11-10T23:59:59Z'))).toBe('due_soon');
  });

  it('counts days to a regulatory calendar date without drifting across timezones', () => {
    // Deadlines are calendar dates, so "due today" must not become "due
    // tomorrow" (or yesterday) depending on the server's UTC offset.
    const target = '2026-11-10';
    expect(daysUntil(target, AT('2026-11-10T00:00:00Z'))).toBe(0);
    expect(daysUntil(target, AT('2026-11-10T23:59:59Z'))).toBe(0);
    expect(daysUntil(target, AT('2026-11-11T00:00:00Z'))).toBe(-1);
    expect(daysUntil(target, AT('2026-11-09T00:00:00Z'))).toBe(1);
  });

  it('records that the November SB 253 date is proposed, not settled law', () => {
    const row = allDeadlines().find((r: { id: string }) => r.id === 'sb253_scope12');
    expect(row.date_status).toBe('proposed');
    expect(row.previously_scheduled).toBe('2026-08-10');
    expect(row.note).toMatch(/proposed/i);
  });

  it('keeps the Scope 3 deadline in its own reporting year', () => {
    const now = AT('2026-10-05T12:00:00Z');
    const rows = allDeadlines(now);
    const scope3 = rows.find((r: { id: string }) => r.id === 'sb253_scope3');
    expect(scope3.due_date.startsWith('2027')).toBe(true);
    expect(scope3.days_left).toBeGreaterThan(0);
  });

  it('reports no compliance deadline for a framework that does not apply', () => {
    const status = getComplianceStatus({ revenue: 1000, region: 'TX', employees: 3 });
    expect(status.frameworks.sb253.applicable).toBe(false);
    expect(status.frameworks.sb253.next_deadline).toBeNull();
    expect(status.frameworks.sb253.next_deadline_label).toBeNull();
  });
});

/**
 * COMP-03 — CSRD wave 2 was reporting a deadline that stopped being legally
 * correct eighteen months earlier, and applicability contradicted the table.
 *
 * Date: Directive (EU) 2025/794 ("Stop-the-Clock", OJ L 2025/794 of 16.4.2025,
 * in force 17 April 2025) postponed wave 2 — originally 2026 for FY2025 — by two
 * years, making it 2028 for FY2027. Verified against the Directive text on
 * EUR-Lex: https://eur-lex.europa.eu/eli/dir/2025/794/oj/eng
 *
 * Threshold: getComplianceStatus hardcoded `employees >= 500` for CSRD while
 * this table's own wave 2 row said "250+ employees", so every EU company with
 * 251-500 staff was told it was out of scope with no deadline at all.
 *
 * Latent, not live: /api/companies/:id/compliance answers 501 for real tenants
 * because company revenue/employees/region are not modelled yet, and both sample
 * companies are region CA. This fires the moment an EU tenant is supported.
 */
describe('COMP-03 CSRD wave 2 reflects Directive (EU) 2025/794', () => {
  const now = AT('2026-10-05T12:00:00Z');

  it('no longer carries the superseded 2026 reporting date', () => {
    const wave2 = allDeadlines(now).find((r: { id: string }) => r.id === 'csrd_wave2');
    expect(wave2.due_date).not.toBe('2026-12-31');
    expect(wave2.due_date).toBe('2028-12-31');
    // Kept for audit: what it used to be, and why.
    expect(wave2.previously_scheduled).toBe('2026-12-31');
    expect(wave2.date_status).toBe('in_force');
  });

  it('leaves wave 1 on its unmodified 2025 date', () => {
    // The postponement deliberately did NOT touch wave 1.
    const wave1 = allDeadlines(now).find((r: { id: string }) => r.id === 'csrd_wave1');
    expect(wave1.due_date).toBe('2025-12-31');
    expect(wave1.status).toBe('overdue');
  });

  it('treats a 251-employee EU company as in scope with a 2028 deadline', () => {
    const csrd = getComplianceStatus({ region: 'EU', employees: 300, revenue: 0 }, { now }).frameworks.csrd;
    expect(csrd.applicable).toBe(true);
    expect(csrd.status).toBe('in_scope');
    expect(csrd.next_deadline).toBe('2028-12-31');
    expect(csrd.days_left).toBeGreaterThan(0);
  });

  it('still excludes an EU company below the wave 2 threshold', () => {
    const csrd = getComplianceStatus({ region: 'EU', employees: 200, revenue: 0 }, { now }).frameworks.csrd;
    expect(csrd.applicable).toBe(false);
    expect(csrd.next_deadline).toBeNull();
  });

  it('agrees with its own table at every boundary', () => {
    // The point of the fix: the status function and the deadline table are the
    // same reader now, so they cannot disagree at a threshold.
    for (const employees of [0, 249, 250, 251, 500, 501, 5000]) {
      const company = { region: 'EU', employees, revenue: 0 };
      const fromStatus = getComplianceStatus(company, { now }).frameworks.csrd.applicable;
      const fromTable = deadlinesApplicableTo(company, now).some((d: { framework: string }) => d.framework === 'EU CSRD');
      expect(fromStatus, `employees=${employees}`).toBe(fromTable);
    }
  });

  it('keeps scope 1/2 ahead of scope 3 for an in-scope SB 253 company', () => {
    const company = { region: 'CA', revenue: 1_200_000_000, employees: 420 };
    const rows = deadlinesApplicableTo(company, now);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['sb253_scope12', 'sb253_scope3']);

    const status = getComplianceStatus(company, { now }).frameworks.sb253;
    expect(status.next_deadline).toBe('2026-11-10');
    expect(status.next_deadline_status).not.toBe('overdue');
  });

  it('keeps in-scope status once every deadline for that framework has passed', () => {
    // Scope must not flip back to "not applicable" just because time ran out.
    const company = { region: 'EU', employees: 300, revenue: 0 };
    const farFuture = AT('2032-01-01T00:00:00Z');
    const csrd = getComplianceStatus(company, { now: farFuture }).frameworks.csrd;
    expect(csrd.applicable).toBe(true);
    expect(csrd.status).toBe('in_scope');
    expect(csrd.next_deadline).toBeNull();
    expect(csrd.in_scope_deadlines).toContain('2028-12-31');
  });

  it('matches region and headcount against the real shipped row, not a synthetic one', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DEADLINES } = require('../compliance-deadlines.cjs');
    const wave2 = DEADLINES.find((r: { id: string }) => r.id === 'csrd_wave2');

    // Both spellings the engine historically accepted must still match.
    expect(deadlineAppliesTo(wave2, { region: 'EU', employees: 900 })).toBe(true);
    expect(deadlineAppliesTo(wave2, { region: 'europe', employees: 900 })).toBe(true);
    // Satisfies headcount, wrong region.
    expect(deadlineAppliesTo(wave2, { region: 'US', employees: 900 })).toBe(false);
    // Right region, below the employee threshold.
    expect(deadlineAppliesTo(wave2, { region: 'EU', employees: 250 })).toBe(false);
    // state is the documented fallback when region is absent.
    expect(deadlineAppliesTo(wave2, { state: 'EU', employees: 900 })).toBe(true);
  });

  it('reports unknown for a row with no criteria rather than assuming it applies', () => {
    expect(deadlineAppliesTo({}, { region: 'EU' })).toBeNull();
  });
});