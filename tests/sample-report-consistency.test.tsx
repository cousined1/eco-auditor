// F-E-01 / F-C-04 regression: the public sample report is the one artefact a
// prospect (or their auditor) can recompute, so it has to survive that.
//
// The hand-written fixture published 12,847 tCO2e for ledger rows that sum to
// about 1,170, put Scope 2 at 20x the authoritative figure and inverted the
// scope mix. These tests recompute every published number from the published
// CSV rows, so a hand edit, a stale regeneration or a changed factor library
// fails here instead of on a buyer's spreadsheet.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ConsentProvider } from '../src/lib/consent-context';
import SampleReport from '../src/pages/SampleReport';

const require = createRequire(import.meta.url);
const { buildSampleReport, renderFiles, LEDGER, ENGINE_TOLERANCE } = require('../scripts/generate-sample-report.cjs');
const { validateFixture } = require('../src/lib/reports/report-generator.cjs');
const fixture = require('../src/lib/reports/sample-report-fixture.json');

const PUBLIC_DIR = resolve('public/sample-report');
const FIXTURE_PATH = resolve('src/lib/reports/sample-report-fixture.json');
const REGENERATE = 'run `node scripts/generate-sample-report.cjs` and commit the result';

const read = (name: string) => readFileSync(resolve(PUBLIC_DIR, name), 'utf8');

// Minimal RFC 4180 reader: the register has quoted cells with commas in them.
function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const [header = [], ...body] = records;
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}

// The text the PDF actually prints (createSimplePdf escapes parentheses).
function pdfLines(pdf: Buffer): string[] {
  return [...pdf.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => (m[1] ?? '').replace(/\\([()\\])/g, '$1'));
}

const ledger = parseCsv(read('pacific-freight-activity-data.csv'));
const register = parseCsv(read('pacific-freight-factor-register.csv'));
const evidence = parseCsv(read('pacific-freight-evidence-index.csv'));

// Integer kilograms avoid float drift when adding published 0.001 t figures.
const kg = (tonnes: number | string) => Math.round(Number(tonnes) * 1000);
const scopeKg = (scope: string) => ledger.filter((r) => r.scope === scope).reduce((sum, r) => sum + kg(r.tCO2e ?? '0'), 0);

describe('sample report: every published number is recomputable from the published ledger (F-E-01)', () => {
  it('prices each row as activity x factor / 1,000 on one kgCO2e basis', () => {
    expect(ledger).toHaveLength(11);
    for (const row of ledger) {
      expect(row.emission_factor_unit, row.entry_id).toMatch(/^kgCO2e\/.+/);
      const exactKg = Number(row.activity_value) * Number(row.emission_factor);
      // Rounded to the nearest kilogram: never more than 0.5 kg away ...
      expect(Math.abs(kg(row.tCO2e ?? '0') - exactKg), row.entry_id).toBeLessThanOrEqual(0.5 + 1e-6);
      // ... and inside the 0.5 % band the audit's acceptance check uses.
      expect(kg(row.tCO2e ?? '0') / exactKg, row.entry_id).toBeGreaterThan(0.995);
      expect(kg(row.tCO2e ?? '0') / exactKg, row.entry_id).toBeLessThan(1.005);
    }
  });

  it('publishes scope totals, the grand total and percentages that are the sums and shares of those rows', () => {
    const totals = { 'Scope 1': scopeKg('Scope 1'), 'Scope 2': scopeKg('Scope 2'), 'Scope 3': scopeKg('Scope 3') };
    const totalKg = totals['Scope 1'] + totals['Scope 2'] + totals['Scope 3'];
    const { metrics } = fixture;
    expect(kg(metrics.scope1.value)).toBe(totals['Scope 1']);
    expect(kg(metrics.scope2.value)).toBe(totals['Scope 2']);
    expect(kg(metrics.scope3.value)).toBe(totals['Scope 3']);
    expect(kg(metrics.total)).toBe(totalKg);
    for (const [key, scope] of [['scope1', 'Scope 1'], ['scope2', 'Scope 2'], ['scope3', 'Scope 3']] as const) {
      expect(Math.abs(metrics[key].pct - (totals[scope] / totalKg) * 100), key).toBeLessThan(0.1);
    }
    expect(Math.round((metrics.scope1.pct + metrics.scope2.pct + metrics.scope3.pct) * 10)).toBe(1000);
  });

  it('derives the data-quality shares from the same rows', () => {
    const totalKg = ledger.reduce((sum, r) => sum + kg(r.tCO2e ?? '0'), 0);
    const bands = ['electricity', 'fuel', 'activity', 'spend'];
    const shares = bands.map((band) => {
      const ids = LEDGER.filter((spec: { band: string }) => spec.band === band).map((spec: { id: string }) => spec.id);
      const bandKg = ledger.filter((r) => ids.includes(r.entry_id)).reduce((sum, r) => sum + kg(r.tCO2e ?? '0'), 0);
      return (bandKg / totalKg) * 100;
    });
    expect(fixture.quality).toHaveLength(bands.length);
    fixture.quality.forEach((q: { score: number }, i: number) => {
      expect(Math.abs(q.score - (shares[i] ?? 0)), fixture.quality[i].label).toBeLessThan(0.1);
    });
    expect(Math.round(fixture.quality.reduce((sum: number, q: { score: number }) => sum + q.score, 0) * 10)).toBe(1000);
  });

  it('prints the same totals in the PDF', () => {
    const lines = pdfLines(readFileSync(resolve(PUBLIC_DIR, 'pacific-freight-fy2026.pdf')));
    const value = (label: string) => {
      const line = lines.find((l) => l.startsWith(label + ':'));
      expect(line, label).toBeDefined();
      return kg(/: ([\d.]+) tCO2e/.exec(line ?? '')?.[1] ?? 'NaN');
    };
    expect(value('Scope 1')).toBe(scopeKg('Scope 1'));
    expect(value('Scope 2')).toBe(scopeKg('Scope 2'));
    expect(value('Scope 3')).toBe(scopeKg('Scope 3'));
    expect(value('Total')).toBe(scopeKg('Scope 1') + scopeKg('Scope 2') + scopeKg('Scope 3'));
  });

  it('cites, for every ledger row, a factor the register lists with the same value and unit', () => {
    for (const row of ledger) {
      const factor = register.find((f) => f.factor_id === row.emission_factor_source);
      expect(factor, row.entry_id + ' cites ' + row.emission_factor_source).toBeDefined();
      expect(Number(factor?.factor_value), row.entry_id).toBe(Number(row.emission_factor));
      expect(row.emission_factor_unit, row.entry_id).toBe('kgCO2e/' + factor?.activity_unit);
      expect(factor?.dataset_version, row.entry_id).not.toBe('');
    }
    expect(evidence.map((e) => e.entry_id)).toEqual(ledger.map((r) => r.entry_id));
    expect(() => validateFixture(fixture)).not.toThrow();
  });

  it('keeps every published factor within 0.5 % of the value in the source it cites', () => {
    // CO2e at AR5 from the per-gas figures printed in EPA GHG Emission Factors
    // Hub 2025 and eGRID2023 Rev 2 (typed independently of the generator).
    const source: Record<string, number> = {
      'epa-efh-2025:natural-gas': 5.31145, // Table 1: 53.06 kg CO2 + 1.0 g CH4 + 0.10 g N2O per mmBtu, per therm
      'epa-efh-2025:diesel': 10.21, // Table 2: kg CO2 per gallon
      'ipcc-ar5-gwp100:r-410a': 1924, // Table 12
      'epa-efh-2025:propane': 5.74081, // Table 1: 5.72 kg CO2 + 0.27 g CH4 + 0.05 g N2O per gallon
      'epa-egrid-2023:camx': 0.195045, // eGRID2023 Rev 2 Table 1: 430.0 lb CO2e/MWh
      'epa-efh-2025:truck-medium-heavy': 1.308286, // Table 8, per vehicle-mile
      'epa-efh-2025:air-short-haul': 0.208928, // Table 10, per passenger-mile
      'epa-warm-2023:mixed-msw-landfilled': 580, // Table 9: 0.58 t CO2e per short ton
      'epa-efh-2025:passenger-car': 0.29857, // Table 10, per vehicle-mile
    };
    for (const [id, expected] of Object.entries(source)) {
      const factor = register.find((f) => f.factor_id === id);
      expect(factor, id).toBeDefined();
      expect(Math.abs(Number(factor?.factor_value) / expected - 1), id).toBeLessThanOrEqual(0.005);
    }
    // The one factor without a published value must say so in the register.
    const provisional = register.filter((f) => f.status === 'provisional');
    expect(provisional.map((f) => f.factor_id)).toEqual(['internal-estimate:purchased-goods-spend']);
    expect(fixture.metrics.provisionalEntries).toBe(ledger.filter((r) => provisional.some((f) => f.factor_id === r.emission_factor_source)).length);
  });
});

describe('sample report: the published files are what the generator produces (F-E-01)', () => {
  const built = buildSampleReport();

  it('has a fixture that matches a fresh build (no hand edits, no stale factor library)', () => {
    expect(readFileSync(FIXTURE_PATH, 'utf8'), REGENERATE).toBe(JSON.stringify(built.fixture, null, 2) + '\n');
  });

  it.each(Object.entries(renderFiles(built)) as [string, string | Buffer][])('has a %s that matches a fresh build', (name, contents) => {
    expect(readFileSync(resolve(PUBLIC_DIR, name)).equals(Buffer.from(contents)), name + ': ' + REGENERATE).toBe(true);
  });

  it('publishes the engine factor for every row, and the engine agrees with the source it cites (F-E-06)', () => {
    // Until catalog 2026-09-30 four Scope 3 rows published the source value
    // instead, because the engine's internal estimates were 8-35 % off.
    for (const row of built.priced) {
      const id = row.spec.id;
      expect(row.basis, id).toBe('engine');
      expect(Math.abs(row.publishedFactor / row.engineKgPerUnit - 1), id).toBeLessThan(1e-4);
      if (row.deviation !== null) expect(Math.abs(row.deviation), id).toBeLessThanOrEqual(ENGINE_TOLERANCE);
    }
  });
});

describe('sample report page (F-E-01, F-C-04)', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ConsentProvider>
        <SampleReport />
      </ConsentProvider>
    </MemoryRouter>,
  );
  const cardBody = (title: string) => html.split(title)[1]?.split('</ul>')[0] ?? '';
  const digits = fixture.metrics.displayDecimals as number;
  const shown = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  it('shows the totals computed from the ledger rows, not typed ones', () => {
    // Each figure is the only content of its element, so match ">value<".
    for (const scope of ['Scope 1', 'Scope 2', 'Scope 3']) {
      expect(html, scope).toContain('>' + shown(scopeKg(scope) / 1000) + '<');
    }
    const total = (scopeKg('Scope 1') + scopeKg('Scope 2') + scopeKg('Scope 3')) / 1000;
    expect(html).toContain('>' + shown(total) + '<');
    // The exact sum is printed too, so a reader can compare it with their own.
    expect(html).toContain('Exactly ' + total.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
  });

  it('shows scope values that add up to the shown total', () => {
    const sum = ['Scope 1', 'Scope 2', 'Scope 3'].reduce((acc, scope) => acc + Number(shown(scopeKg(scope) / 1000).replace(/,/g, '')), 0);
    const total = Number(shown((scopeKg('Scope 1') + scopeKg('Scope 2') + scopeKg('Scope 3')) / 1000).replace(/,/g, ''));
    expect(Math.abs(sum - total)).toBeLessThan(1e-9);
  });

  it('describes the fictional company as the freight company it is', () => {
    expect(html).toContain(fixture.company.name);
    expect(html).toContain('freight and logistics company');
    expect(html).not.toContain('manufacturing company');
  });

  it('does not list per-entry factor, dataset, confidence or timestamp as available in the app (F-C-04)', () => {
    // EmissionList shows scope, category, source, CO2e and facility only; the
    // per-entry factor, dataset, confidence and timestamp are not on any screen.
    const inApp = cardBody('In the app — available today').toLowerCase();
    expect(inApp.length).toBeGreaterThan(0);
    for (const claim of ['emission factor', 'dataset', 'confidence', 'timestamp']) {
      expect(inApp, claim).not.toContain(claim);
    }
    // Whatever the page promises beyond that sits under a heading that says so.
    expect(html).toContain('Roadmap');
  });

  it('does not describe the PDF as more than the product prints', () => {
    // buildReportText prints totals, scope subtotals, a confidence score, one methodology line and the provisional count.
    const pdf = cardBody('Generated PDF — available today').toLowerCase();
    expect(pdf).toContain('confidence');
    for (const claim of ['dataset', 'timestamp', 'per entry', 'ledger']) {
      expect(pdf, claim).not.toContain(claim);
    }
  });

  // K7 leftover: the card said the confidence score is "weighted by emissions", which holds only for a
  // period that holds an entry priced with the 2026-09-30 catalog or later. A period made only of older
  // entries keeps the plain average (emissions-engine.cjs aggregateConfidence). The card says both, and
  // the two figures below are the engine's own for the same rows, so the rule it describes is real.
  it('says when the confidence score is weighted by emissions and when it is the plain average', () => {
    const engine = require('../emissions-engine.cjs');
    const { CATALOG, CATALOG_VERSION } = require('../emission-factors.cjs');
    const spend = { scope: 'Scope 3', category: 'purchased_goods', source: 'purchased_goods', amount: 10_000_000, unit: 'USD', confidence: 65 };
    const meters = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, scope: 'Scope 2', category: 'purchased_electricity', source: 'US_AVERAGE', amount: 100, unit: 'kWh' }));
    const pinned = [spend, ...meters].map((row) => ({ ...row, catalog_version: CATALOG_VERSION }));
    expect(engine.summarizeEntries(pinned).confidence_score, 'entries priced by the current catalog').toBe(65);
    expect(engine.summarizeEntries([spend, ...meters]).confidence_score, 'older entries only').toBe(94);

    const card = cardBody('Generated PDF — available today').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    expect(card).toContain('weighted by emissions when the period holds entries priced with the');
    // The catalog that introduced the rule (CATALOG_VERSION is its tag with a hash; `version` is the date the card names).
    expect(CATALOG.confidenceWeighting).toBe('emissions');
    expect(card).toContain(`${CATALOG.version} factor catalog or later`);
    expect(card).toContain('the plain average of the entry scores otherwise');
    expect(card, 'the old unconditional claim').not.toContain('entry scores weighted by their emissions');
  });
});
