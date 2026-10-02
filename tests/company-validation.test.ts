// @vitest-environment node
/**
 * K5 (F-B-03 = F-C-03): what a client may change on a company and a facility,
 * how the first-run state and the checklist are derived, and what the report
 * prints from the company's reporting basis. Pure functions, no database; the
 * routes built on them are driven against real Postgres in
 * tests/company-onboarding-route.test.ts.
 *
 * Before K5 there was no rename route at all, so none of this existed: the
 * server invented "<email-prefix> Organization" and nothing could change it.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const company = require('../server-company.cjs');
const { buildReportSnapshot, parseReportPeriod } = require('../src/lib/reports/report-snapshot.cjs');
const { buildReportText } = require('../src/lib/reports/report-generator.cjs');

const NOW = new Date('2026-09-30T12:00:00Z');

describe('the placeholder the server invents', () => {
  it('is "<email-prefix> Organization", or "My Organization" when a webhook made the company without an e-mail', () => {
    expect(company.defaultCompanyName('audit+b-1@example.com')).toBe('audit+b-1 Organization');
    expect(company.defaultCompanyName(undefined)).toBe('My Organization');
    expect(company.defaultCompanyName('')).toBe('My Organization');
    expect(company.defaultCompanyName('@example.com')).toBe('My Organization');
  });

  it('is recognised by the same function that makes it', () => {
    expect(company.isPlaceholderCompanyName('ada Organization', 'ada@example.com')).toBe(true);
    expect(company.isPlaceholderCompanyName('My Organization', 'ada@example.com')).toBe(true);
    expect(company.isPlaceholderCompanyName('Northstar Foods', 'ada@example.com')).toBe(false);
    // Someone else's placeholder is a name the customer chose, as far as this account can tell.
    expect(company.isPlaceholderCompanyName('bob Organization', 'ada@example.com')).toBe(false);
  });
});

describe('who is sent to onboarding', () => {
  const pending = { auto_provisioned: true, onboarding_completed_at: null, onboarding_skipped_at: null };

  it('an auto-provisioned company the customer has neither named nor skipped', () => {
    expect(company.needsOnboarding(pending)).toBe(true);
  });

  it('not a company that was created any other way (every row the previous code wrote)', () => {
    expect(company.needsOnboarding({ ...pending, auto_provisioned: false })).toBe(false);
    expect(company.needsOnboarding({})).toBe(false);
  });

  it('not once it is named, and not once "Finish later" was chosen', () => {
    expect(company.needsOnboarding({ ...pending, onboarding_completed_at: new Date() })).toBe(false);
    expect(company.needsOnboarding({ ...pending, onboarding_skipped_at: new Date() })).toBe(false);
  });
});

describe('the first-run checklist ticks from what is stored', () => {
  const base = { name: 'ada Organization', email: 'ada@example.com', facilityCount: 0, hasEntries: false, hasReport: false };

  it('starts with nothing done for a brand-new account', () => {
    expect(company.buildChecklist(base)).toEqual({
      company_named: false, facility_added: false, data_added: false, report_generated: false, complete: false,
    });
  });

  it('ticks each step from its own data, and is complete only when all four are', () => {
    expect(company.buildChecklist({ ...base, name: 'Northstar Foods' }).company_named).toBe(true);
    expect(company.buildChecklist({ ...base, facilityCount: 1 }).facility_added).toBe(true);
    expect(company.buildChecklist({ ...base, hasEntries: true }).data_added).toBe(true);
    expect(company.buildChecklist({ ...base, hasReport: true }).report_generated).toBe(true);
    expect(company.buildChecklist({ name: 'Northstar Foods', email: 'ada@example.com', facilityCount: 2, hasEntries: true, hasReport: true }))
      .toMatchObject({ complete: true });
  });

  it('un-ticks when the data is gone (it is derived, not remembered)', () => {
    expect(company.buildChecklist({ ...base, name: 'Northstar Foods', facilityCount: 1, hasEntries: true, hasReport: true }).complete).toBe(true);
    expect(company.buildChecklist({ ...base, name: 'Northstar Foods', facilityCount: 1, hasEntries: false, hasReport: true }).complete).toBe(false);
  });
});

describe('validateCompanyUpdate', () => {
  const ok = (body: unknown) => company.validateCompanyUpdate(body, NOW);

  it('accepts the four fields, trims the name and keeps only what was sent', () => {
    expect(ok({ name: '  Northstar Foods  ', industry: 'Manufacturing', consolidation_approach: 'financial_control', base_year: 2022 }))
      .toEqual({ ok: true, fields: { name: 'Northstar Foods', industry: 'Manufacturing', consolidation_approach: 'financial_control', base_year: 2022 } });
    expect(ok({ base_year: null })).toEqual({ ok: true, fields: { base_year: null } });
    expect(ok({ industry: '' })).toEqual({ ok: true, fields: { industry: null } });
    expect(ok({ consolidation_approach: 'unspecified' })).toEqual({ ok: true, fields: { consolidation_approach: 'unspecified' } });
  });

  it('refuses a name that is empty, blank, not text or longer than 200 characters', () => {
    for (const name of ['', '   ', 5, null, {}, 'x'.repeat(201)]) {
      expect(ok({ name }), JSON.stringify(name)).toMatchObject({ ok: false });
    }
    expect(ok({ name: 'x'.repeat(200) })).toMatchObject({ ok: true });
  });

  it('refuses an industry outside the list, and a consolidation approach outside the three (and "unspecified")', () => {
    expect(ok({ industry: 'Wizardry' })).toMatchObject({ ok: false });
    expect(ok({ industry: 'other' })).toMatchObject({ ok: false });
    for (const consolidation_approach of ['operational control', 'Operational_Control', 'control', '', null, 3]) {
      expect(ok({ consolidation_approach }), String(consolidation_approach)).toMatchObject({ ok: false });
    }
  });

  it('bounds the base year: 1990 to the current year, a whole number, sent as a number', () => {
    expect(ok({ base_year: 1990 })).toMatchObject({ ok: true });
    expect(ok({ base_year: 2026 })).toMatchObject({ ok: true });
    for (const base_year of [1989, 2027, 2022.5, '2022', NaN, Infinity, true]) {
      expect(ok({ base_year }), String(base_year)).toMatchObject({ ok: false });
    }
  });

  it('refuses every field it does not own: plan, billing, trial, ownership and onboarding state are not writable', () => {
    for (const field of ['subscription_plan', 'subscription_status', 'trial_ends_at', 'stripe_customer_id', 'user_id', 'id', 'auto_provisioned', 'onboarding_completed_at', 'onboarding_skipped_at']) {
      const refused = ok({ name: 'Northstar Foods', [field]: 'x' });
      expect(refused, field).toMatchObject({ ok: false });
      expect(refused.error, field).toContain(field);
    }
  });

  it('refuses an empty update and a body that is not an object', () => {
    for (const body of [{}, null, undefined, 'name', ['name'], 7]) expect(ok(body), JSON.stringify(body)).toMatchObject({ ok: false });
  });
});

describe('validateFacilityUpdate', () => {
  it('accepts a rename, a new type or a new city, with the creation limits', () => {
    expect(company.validateFacilityUpdate({ name: ' Plant A ', type: 'Factory', city: ' Fresno ' }))
      .toEqual({ ok: true, fields: { name: 'Plant A', type: 'factory', city: 'Fresno' } });
    expect(company.validateFacilityUpdate({ city: 'Sacramento' })).toEqual({ ok: true, fields: { city: 'Sacramento' } });
  });

  it('refuses an empty name or city, a type outside office/factory/warehouse, and anything else', () => {
    expect(company.validateFacilityUpdate({ name: '' })).toMatchObject({ ok: false });
    expect(company.validateFacilityUpdate({ name: 'x'.repeat(201) })).toMatchObject({ ok: false });
    expect(company.validateFacilityUpdate({ city: '  ' })).toMatchObject({ ok: false });
    expect(company.validateFacilityUpdate({ type: 'castle' })).toMatchObject({ ok: false });
    expect(company.validateFacilityUpdate({ company_id: 9 })).toMatchObject({ ok: false });
    expect(company.validateFacilityUpdate({})).toMatchObject({ ok: false });
  });

  it('says how many entries block a delete', () => {
    expect(company.facilityInUseMessage(1)).toBe('This facility has 1 emission entry. Change the facility on that entry, or delete it, before deleting the facility.');
    expect(company.facilityInUseMessage(12)).toBe('This facility has 12 emission entries. Change the facility on those entries, or delete them, before deleting the facility.');
  });
});

describe('the overview the SPA reads first', () => {
  const row = {
    id: '12', name: 'ada Organization', industry: 'other', consolidation_approach: 'unspecified', base_year: null,
    auto_provisioned: true, onboarding_completed_at: null, onboarding_skipped_at: null,
    created_at: new Date('2026-09-30T10:00:00Z'), updated_at: new Date('2026-09-30T10:00:00Z'),
    facility_count: 0, has_entries: false, has_report: false,
  };

  it('carries the profile, the onboarding state, the facilities, the plan cap and the checklist', () => {
    const overview = company.presentOverview({
      company: row,
      facilities: [{ id: '3', company_id: '12', name: 'Plant A', type: 'factory', city: 'Fresno' }],
      plan: 'starter',
      limit: 1,
      email: 'ada@example.com',
    });
    expect(overview).toMatchObject({
      success: true,
      company: { id: 12, name: 'ada Organization', consolidation_approach: 'unspecified', base_year: null },
      onboarding: { needs_onboarding: true, auto_provisioned: true, completed_at: null, skipped_at: null },
      facilities: [{ id: 3, company_id: 12, name: 'Plant A', type: 'factory', city: 'Fresno' }],
      plan: { id: 'starter', facility_limit: 1 },
      checklist: { company_named: false, complete: false },
    });
  });
});

describe('reports print the company\'s reporting basis (F-E-08)', () => {
  const period = parseReportPeriod('2025').period;
  const build = (companyRow: Record<string, unknown>) => buildReportSnapshot({
    company: { id: 7, name: 'Northstar Foods', ...companyRow },
    period,
    entries: [{ id: 1, scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-03-15', created_at: '2026-09-30T10:00:00Z' }],
    facilities: [],
    generatedAt: '2026-09-30T10:00:00.000Z',
    generatedBy: 'user-1',
  });
  const lines = (snapshot: unknown) => String(buildReportText(snapshot, '2025')).split('\n');

  it('says "not specified" and "not set" until the company has chosen', () => {
    for (const row of [{}, { consolidation_approach: 'unspecified', base_year: null }]) {
      const printed = lines(build(row));
      expect(printed).toContain('Consolidation approach: not specified');
      expect(printed).toContain('Base year: not set');
    }
  });

  it('prints the chosen approach (as a label) and the base year once they are set', () => {
    const snapshot = build({ consolidation_approach: 'operational_control', base_year: 2022 });
    expect(snapshot).toMatchObject({ consolidation_approach: 'operational_control', base_year: 2022 });
    const printed = lines(snapshot);
    expect(printed).toContain('Consolidation approach: Operational control');
    expect(printed).toContain('Base year: 2022');
    expect(lines(build({ consolidation_approach: 'financial_control' }))).toContain('Consolidation approach: Financial control');
    expect(lines(build({ consolidation_approach: 'equity_share' }))).toContain('Consolidation approach: Equity share');
  });

  it('never prints a raw or unknown value as if it were an approach', () => {
    expect(lines(build({ consolidation_approach: 'made_up', base_year: '2022' }))).toEqual(
      expect.arrayContaining(['Consolidation approach: not specified', 'Base year: not set']),
    );
  });
});
