/**
 * Carbon calculator regression guards.
 *
 * EmissionForm.tsx, EmissionList.tsx and EmissionsDashboard.tsx had no
 * component coverage -- every mention of them in tests/ was an explanatory
 * comment.
 *
 * CALC-01 (P2) The form computed and displayed a CO2e preview without a
 * `source &&` guard, while isFormValid on the next line did require one.
 * getSource deliberately falls back from the source key to the CATEGORY key so
 * a Scope 3 CSV row naming an arbitrary vendor still prices -- but for the four
 * Scope 3 categories whose key is also one of their own source keys that
 * fallback also fires for an EMPTY source. Choosing Scope 3 > waste, leaving
 * Source on "Select source", typing an amount and picking a unit showed a
 * confident "Estimated: 105.0 kg CO2e" that the submit guard then refused to
 * save: a compliance number for a source the customer never chose, with no
 * explanation for the dead button.
 *
 * CALC-02 (P2) labelForSource falls back to the raw string, so a blank source
 * rendered a blank Source cell and confirmed `Delete emission entry ""?` on an
 * irreversible delete. A CSV Scope 3 row with an empty source cell does import
 * successfully, so this is reachable data, not a hypothetical.
 *
 * CALC-03 (P3) A successful save was silent for assistive tech while the
 * failure path announced via role="alert".
 *
 * CALC-04 (P3) The donut rounded to whole percent and the scope card directly
 * beneath it to one decimal, both over the same denominator, so they disagreed
 * for any scope below 0.5%.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  unitsForSource,
  calculateEmissions,
  labelForSource,
  categoriesForScope,
} from '../src/lib/emission-factors/factors';

const read = (...parts: string[]) => readFileSync(resolve(__dirname, '..', ...parts), 'utf8');

const CATEGORIES = (['Scope 1', 'Scope 2', 'Scope 3'] as const).flatMap((s) => categoriesForScope(s));

describe('the form never uses the category fallback as a default (CALC-01)', () => {
  it('the library still prices an empty source, deliberately, for CSV imports', () => {
    // This is NOT changed. getSource's category fallback is what lets an
    // imported Scope 3 row naming an arbitrary vendor — or nothing at all —
    // price. Removing it would reject rows the product accepts today. The bug
    // was the calculator FORM inheriting it as a default, so the fix belongs
    // in the form, not here.
    const priced = CATEGORIES.filter((cat) => {
      const units = unitsForSource(cat.key, '');
      return units.length > 0 && calculateEmissions(cat.key, '', 100, units[0]) !== null;
    }).map((cat) => cat.key);
    expect(priced.length, 'the import path stopped pricing blank sources').toBeGreaterThan(0);
  });

  it('the form guards unitsForSource and calculateEmissions with source &&', () => {
    const src = read('src', 'components', 'carbon-calculator', 'EmissionForm.tsx');
    expect(src, 'unit list is still offered with no source selected').toContain(
      'const units = source ? unitsForSource(category, source) : [];',
    );
    expect(src, 'a preview is still computed with no source selected').toContain(
      'source && isAmountValid && unit',
    );
  });

  it('the submit guard already required a source, so the preview now agrees with it', () => {
    const src = read('src', 'components', 'carbon-calculator', 'EmissionForm.tsx');
    // The two must use the same precondition: a preview the submit button
    // refuses to accept is the defect.
    expect(src).toContain('Boolean(category && source && unit && isAmountValid && preview !== null)');
  });

  it('still prices a real source, so the fix did not disable the estimator', () => {
    const units = unitsForSource('waste', 'landfill');
    expect(units.length).toBeGreaterThan(0);
    expect(calculateEmissions('waste', 'landfill', 100, units[0])).not.toBeNull();
  });

  it('still prices a Scope 3 vendor name the catalog does not know', () => {
    expect(calculateEmissions('waste', 'acme_supplies_inc', 100, 'USD')).not.toBeNull();
  });
});

describe('an empty source is named rather than rendered blank (CALC-02)', () => {
  it('names the row instead of returning an empty string', () => {
    expect(labelForSource('waste', '')).not.toBe('');
    expect(labelForSource('waste', '')).toBe('Unspecified source');
  });

  it('still labels a known source and an unknown raw key', () => {
    expect(labelForSource('waste', 'landfill')).toBe('Landfill');
    expect(labelForSource('stationary_combustion', 'natural_gas')).toBe('Natural Gas');
    expect(labelForSource('waste', 'some_vendor_we_do_not_know')).toBe('some_vendor_we_do_not_know');
  });

  it('names every catalog source, including under an empty-ish key', () => {
    for (const cat of CATEGORIES) {
      expect(labelForSource(cat.key, ''), `${cat.key} renders a blank Source cell`).not.toBe('');
    }
  });

  it('the delete confirmation cannot read as an empty name', () => {
    const src = read('src', 'components', 'carbon-calculator', 'EmissionList.tsx');
    expect(src).toContain('labelForSource');
    // The confirm must use the label, not the raw stored value.
    expect(src).toMatch(/Delete emission entry "\$\{label\}"\?/);
  });
});

describe('a successful save is announced (CALC-03)', () => {
  it('renders a live region for success as well as failure', () => {
    const src = read('src', 'components', 'carbon-calculator', 'EmissionForm.tsx');
    expect(src, 'failure is announced but success is not').toContain('role="alert"');
    expect(src, 'success is silent for assistive tech').toContain('role="status"');
  });
});

describe('the donut and the scope card round the same share the same way (CALC-04)', () => {
  it('both readouts use one decimal', () => {
    const src = read('src', 'components', 'carbon-calculator', 'EmissionsDashboard.tsx');
    const percentReadouts = src.match(/\)\s*\*\s*100\)\.toFixed\((\d)\)/g) || [];
    expect(percentReadouts.length, 'expected both share readouts').toBeGreaterThanOrEqual(2);
    const precisions = new Set(percentReadouts.map((m) => m.match(/toFixed\((\d)\)/)![1]));
    expect(
      [...precisions],
      'the donut and the scope card disagree on precision for the same denominator',
    ).toHaveLength(1);
  });
});