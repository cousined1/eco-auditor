// K3 / F-B-05: the browser's period helpers (src/lib/reportingPeriod.ts) and
// the server's (src/lib/reports/report-snapshot.cjs) must agree on which
// periods exist and on the default year, or the picker would offer periods the
// server refuses and the Dashboard and a report would open on different years.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  MAX_PERIOD_DAYS,
  MAX_REPORT_YEAR,
  MIN_REPORT_YEAR,
  currentReportingYear,
  reportingYearOptions,
  toPeriodParam,
  type ReportPeriodChoice,
} from '../src/lib/reportingPeriod';

const require = createRequire(import.meta.url);
const server = require('../src/lib/reports/report-snapshot.cjs') as {
  MAX_PERIOD_DAYS: number;
  MIN_REPORT_YEAR: number;
  MAX_REPORT_YEAR: number;
  defaultReportingYear: (now?: Date) => string;
  parseReportPeriod: (raw: unknown) => { ok: boolean; period?: { value: string } };
};

const CHOICES: ReportPeriodChoice[] = [
  { kind: 'year', year: 2025 },
  { kind: 'year', year: 1990 },
  { kind: 'year', year: 1989 },
  { kind: 'year', year: 2101 },
  { kind: 'range', start: '2025-04-01', end: '2026-03-31' },
  { kind: 'range', start: '2025-01-01', end: '2025-12-31' },
  { kind: 'range', start: '2025-01-01', end: '2026-01-06' }, // 371 days
  { kind: 'range', start: '2025-01-01', end: '2026-01-07' }, // 372 days
  { kind: 'range', start: '2026-03-01', end: '2025-03-01' },
  { kind: 'range', start: '2025-02-30', end: '2025-03-31' },
  { kind: 'range', start: '', end: '2025-03-31' },
  { kind: 'range', start: '1989-12-31', end: '1990-06-30' },
];

describe('reporting period: browser and server agree', () => {
  it('share the limits', () => {
    expect(MAX_PERIOD_DAYS).toBe(server.MAX_PERIOD_DAYS);
    expect(MIN_REPORT_YEAR).toBe(server.MIN_REPORT_YEAR);
    expect(MAX_REPORT_YEAR).toBe(server.MAX_REPORT_YEAR);
  });

  it.each(CHOICES.map((choice) => [JSON.stringify(choice), choice] as const))('accept or refuse %s alike', (_name, choice) => {
    const browser = toPeriodParam(choice);
    const onServer = server.parseReportPeriod(
      choice.kind === 'year' ? String(choice.year) : `${choice.start}/${choice.end}`,
    );
    expect(browser.ok).toBe(onServer.ok);
  });

  it('open on the same year: the Dashboard default is the report default', () => {
    for (const now of [new Date(2026, 8, 30), new Date(2027, 0, 1), new Date(2026, 11, 31, 23, 59)]) {
      expect(String(currentReportingYear(now))).toBe(server.defaultReportingYear(now));
    }
  });

  it('offer the default year first, then the years before it, and never "All time"', () => {
    expect(reportingYearOptions(new Date(2026, 8, 30))).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
    expect(server.parseReportPeriod('All time').ok).toBe(false);
  });
});
