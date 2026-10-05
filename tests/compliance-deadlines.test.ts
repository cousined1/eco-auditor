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
const { allDeadlines, statusFor, daysUntil } = require('../compliance-deadlines.cjs');
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