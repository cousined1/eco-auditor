/**
 * Sample-report provenance must match the real factor registry.
 *
 * The public sample report is this product's primary proof artifact, so it has
 * to be internally consistent with what the calculator actually uses. It was
 * not:
 *
 *  - It cited `ipcc-ar6-gwp100`, an id the registry had already removed, and
 *    labelled the GWP basis AR6. The registry standardised on
 *    `ipcc-ar5-gwp100` precisely because EPA GHG Emission Factors Hub 2025 and
 *    eGRID2023 both use AR5 GWPs, so an AR6 sample contradicted the product.
 *  - It carried `sha256:ab12`-style checksums: four hex digits in a sequential
 *    run, where a SHA-256 digest is 64. They looked like provenance and
 *    verified as nothing.
 *  - It listed `uk-defra-2024` as active. DEFRA is absent from the codebase.
 *  - It listed `exiobase-3-eeio-2021` as active with 2022/2021 dates that the
 *    registry comments describe as fabricated, when EXIOBASE is roadmap-only.
 *
 * Nothing cross-checked the sample against the registry, which is how the drift
 * survived. These tests do that.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMISSION_FACTOR_REGISTRY } from '../src/lib/emission-factors/registry';
import factorCatalog from '../emission-factors.json';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const fixture = JSON.parse(read('src/lib/reports/sample-report-fixture.json'));
const catalog = factorCatalog as unknown as { gwpBasis: string };

/** Minimal RFC4180 reader — enough for these flat, quote-free files. */
function parseCsv(text: string): Record<string, string>[] {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(',');
  return rows
    .filter((r) => r.trim().length > 0)
    .map((row) => Object.fromEntries(row.split(',').map((v, i) => [cols[i], v])));
}

const registerCsv = parseCsv(read('public/sample-report/pacific-freight-factor-register.csv'));
const activityCsv = parseCsv(read('public/sample-report/pacific-freight-activity-data.csv'));

const registryIds = new Set(EMISSION_FACTOR_REGISTRY.map((e) => e.id));

describe('sample report factor register agrees with the registry', () => {
  it('only cites factor ids that exist in the registry', () => {
    for (const row of fixture.factorRegister) {
      expect(registryIds.has(row.factor_id), `fixture cites unknown factor ${row.factor_id}`).toBe(true);
    }
    for (const row of activityCsv) {
      expect(registryIds.has(row.emission_factor_source), `activity CSV cites unknown factor ${row.emission_factor_source}`).toBe(true);
    }
    for (const entry of fixture.activityData) {
      expect(registryIds.has(entry.emission_factor_source), `fixture activity cites unknown factor ${entry.emission_factor_source}`).toBe(true);
    }
  });

  it('does not resurrect the removed ipcc-ar6-gwp100 id', () => {
    expect(registryIds.has('ipcc-ar6-gwp100')).toBe(false);
    expect(catalog.gwpBasis).toBe('ipcc-ar5-gwp100');
    const ar5 = fixture.factorRegister.find((r: { factor_id: string }) => r.factor_id === 'ipcc-ar5-gwp100');
    expect(ar5).toBeDefined();
  });

  it('keeps every GWP basis on the AR5 footing the calculator uses', () => {
    for (const row of fixture.factorRegister) {
      expect(row.gwp_basis, `${row.factor_id} claims ${row.gwp_basis}`).toBe('AR5');
    }
    for (const row of registerCsv) {
      expect(row.gwp_basis, `${row.factor_id} claims ${row.gwp_basis}`).toBe('AR5');
    }
  });

  it('never marks an unwired roadmap source as active', () => {
    const wired = new Set(
      EMISSION_FACTOR_REGISTRY.filter((e) => e.verified).map((e) => e.id),
    );
    for (const row of fixture.factorRegister) {
      if (!wired.has(row.factor_id)) {
        expect(row.status, `${row.factor_id} is not wired but is marked ${row.status}`).not.toBe('active');
      }
    }
    for (const row of registerCsv) {
      if (!wired.has(row.factor_id)) {
        expect(row.status, `${row.factor_id} is not wired but is marked ${row.status}`).not.toBe('active');
      }
    }
  });

  it('carries no fabricated checksums', () => {
    // A real SHA-256 digest is 64 hex characters. The placeholders were four.
    const looksLikeChecksum = (v: string) => /^sha256:[0-9a-f]{64}$/.test(v);
    for (const row of fixture.factorRegister) {
      expect(row.checksum, `${row.factor_id} has a non-digest checksum "${row.checksum}"`).toMatch(
        /^$|^not-published$/,
      );
      if (row.checksum) expect(looksLikeChecksum(row.checksum)).toBe(true);
    }
    for (const row of registerCsv) {
      expect(row.checksum).not.toMatch(/^sha256:[0-9a-f]{1,63}$/);
    }
  });

  it('keeps the downloadable CSV identical to the fixture that renders the page', () => {
    expect(registerCsv.map((r) => r.factor_id)).toEqual(fixture.factorRegister.map((r: { factor_id: string }) => r.factor_id));
    for (let i = 0; i < registerCsv.length; i++) {
      expect(registerCsv[i].status).toBe(fixture.factorRegister[i].status);
      expect(registerCsv[i].gwp_basis).toBe(fixture.factorRegister[i].gwp_basis);
      expect(Number(registerCsv[i].factor_value)).toBe(fixture.factorRegister[i].factor_value);
    }
  });

  it('keeps the downloadable activity CSV in step with the fixture', () => {
    expect(activityCsv.map((r) => r.entry_id)).toEqual(
      fixture.activityData.map((a: { entry_id: string }) => a.entry_id),
    );
  });

  it('makes every activity row equal activity × factor in tonnes', () => {
    for (const row of fixture.activityData) {
      const unit = String(row.emission_factor_unit);
      const raw = Number(row.activity_value) * Number(row.emission_factor);
      const expected = unit.startsWith('kg') ? raw / 1000 : raw;
      expect(Math.abs(expected - Number(row.tCO2e)), row.entry_id).toBeLessThanOrEqual(0.0005);
      const csv = activityCsv.find((r) => r.entry_id === row.entry_id);
      expect(csv, row.entry_id).toBeDefined();
      expect(Math.abs(Number(csv!.tCO2e) - Number(row.tCO2e)), row.entry_id).toBeLessThanOrEqual(0.0005);
    }
  });

  it('keeps scope totals within a rounding tolerance of the row sums', () => {
    const sums = { 'Scope 1': 0, 'Scope 2': 0, 'Scope 3': 0 };
    for (const row of fixture.activityData) sums[row.scope] += Number(row.tCO2e);
    expect(Math.abs(sums['Scope 1'] - fixture.metrics.scope1.value)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(sums['Scope 2'] - fixture.metrics.scope2.value)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(sums['Scope 3'] - fixture.metrics.scope3.value)).toBeLessThanOrEqual(0.005);
  });

  it('labels R-410A with the catalog AR5 GWP, not the AR4 blend value', () => {
    const row = fixture.activityData.find((r: { entry_id: string }) => r.entry_id === 'PFC-2026-S1-003');
    expect(row.emission_factor).toBe(1924);
    expect(row.emission_factor_source).toBe('ipcc-ar5-gwp100');
    expect(row.tCO2e).toBeCloseTo(23.088, 3);
    const register = fixture.factorRegister.find(
      (r: { factor_id: string; factor_value: number }) => r.factor_id === 'ipcc-ar5-gwp100',
    );
    expect(register.factor_value).toBe(1924);
    expect(register.gwp_basis).toBe('AR5');
    expect(register.factor_gas).not.toMatch(/CH4/);
  });
});