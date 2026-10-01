// F-E-14 — the Methodology page may list only coverage the factor catalog and
// the engine actually have. Its examples are checked against
// emission-factors.json and its confidence table against
// CONFIDENCE_BY_CATEGORY in emissions-engine.cjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCOPES, CONFIDENCE_ROWS, LEGACY_MANUAL_ENTRY_CONFIDENCE } from '../src/content/methodology';
import { getSource } from '../src/lib/emission-factors/factors';
import faq from '../src/content/faq.json';
import catalog from '../emission-factors.json';

const read = (rel: string) => readFileSync(resolve(rel), 'utf8');

type Category = { key: string; scope: number; sources: { key: string; factorSource: string }[] };
const categories = catalog.categories as unknown as Category[];

/** CONFIDENCE_BY_CATEGORY, parsed from the engine source (it is not exported). */
function engineConfidence(): Record<string, number> {
  const block = /const CONFIDENCE_BY_CATEGORY = \{([\s\S]*?)\n\};/.exec(read('emissions-engine.cjs'))?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^\s*([a-z_]+):\s*(\d+),/gm)].map((m) => [m[1] ?? '', Number(m[2])]));
}

describe('scope examples map to the factor catalog', () => {
  for (const section of SCOPES) {
    it(`${section.title}: every example has a source in emission-factors.json, in the right scope`, () => {
      const scopeNumber = Number(section.id.replace('scope', ''));
      expect(section.examples.length).toBeGreaterThan(0);
      for (const example of section.examples) {
        const source = getSource(example.category, example.source ?? example.category);
        expect(source, `${example.label}: no catalog source for ${example.category}/${example.source ?? example.category}`).not.toBeNull();
        const category = categories.find((c) => c.key === example.category);
        expect(category?.scope, `${example.label}: category scope`).toBe(scopeNumber);
      }
    });
  }

  it('lists no coverage the engine lacks (chilled water, net metering, business rail)', () => {
    const labels = SCOPES.flatMap((s) => s.examples.map((e) => e.label)).join(' | ');
    expect(labels).not.toMatch(/chilled|cooling|net metering|solar|rail/i);
  });

  // F-E-02: a renewable contract was a subregion priced at 0, which zeroed the
  // location-based total. The current catalog prices it at the site's grid
  // factor and zero only market-based; the page must say what the catalog does.
  it('says a renewable contract counts at the grid factor location-based and at zero market-based, as the catalog does', () => {
    expect(getSource('purchased_electricity', 'RENEWABLE'), 'a zero-factor subregion is back in the current catalog').toBeNull();
    const renewable = (catalog.categories as unknown as { key: string; sourcesFrom?: string; marketBasedShare?: number }[])
      .find((c) => c.key === 'renewable_electricity');
    expect(renewable?.sourcesFrom).toBe('purchased_electricity');
    expect(renewable?.marketBasedShare).toBe(0);
    expect(getSource('renewable_electricity', 'CAMX')?.units).toEqual(getSource('purchased_electricity', 'CAMX')?.units);
    expect(SCOPES[1]?.method).toMatch(/renewable contract[^.]*grid factor in the location-based total and at zero in a separate market-based total/i);
    // Rows saved before the new catalog still carry the old treatment.
    expect(SCOPES[1]?.method).toMatch(/before the 2026-09-30 factor catalog keep their earlier treatment/);
  });

  it('says biogenic CO2 and non-Kyoto refrigerants are reported outside Scope 1, as the catalog does', () => {
    const scope1 = categories.flatMap((c) => c.sources.map((s) => ({ ...s, category: c.key }))) as Array<{ key: string; category: string; reportingBucket?: string; biogenicCO2?: unknown }>;
    expect(scope1.find((s) => s.key === 'wood')?.biogenicCO2).toBeDefined();
    expect(scope1.find((s) => s.key === 'refrigerant_r22')?.reportingBucket).toBe('memo:non-kyoto');
    expect(SCOPES[0]?.method).toMatch(/biogenic CO₂ from burning wood/);
    expect(SCOPES[0]?.method).toMatch(/R-22 and other HCFCs/);
  });

  it('says process-emission factors are internal estimates, and the catalog agrees', () => {
    const process = categories.find((c) => c.key === 'process_emissions');
    expect(process?.sources.length).toBeGreaterThan(0);
    for (const source of process?.sources ?? []) {
      expect(source.factorSource, source.key).toBe('internal-estimate');
    }
    expect(SCOPES[0]?.method).toContain('internal estimates');
  });
});

describe('confidence table equals the engine table', () => {
  const engine = engineConfidence();
  const rows = new Map<string, number>();
  for (const row of CONFIDENCE_ROWS) {
    for (const category of row.categories) rows.set(category, row.confidence);
  }

  it('finds the engine table it compares against', () => {
    expect(Object.keys(engine).length).toBeGreaterThan(10);
  });

  it('covers every engine category, exactly once, with the engine value', () => {
    const listed = CONFIDENCE_ROWS.flatMap((r) => r.categories);
    expect(new Set(listed).size, 'a category appears in two rows').toBe(listed.length);
    expect(Object.fromEntries(rows)).toEqual(engine);
  });

  it('is ordered from most to least confident', () => {
    const values = CONFIDENCE_ROWS.map((r) => r.confidence);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});

// F-E-05: the browser used to store confidence 85 on every calculator entry.
// The server entry API now scores calculator entries by category like CSV rows
// (tests/entry-validation.test.ts checks the stored value); only older rows
// keep the fixed 85, and the copy must say it that way round.
describe('manual-entry confidence disclosure', () => {
  it('the calculator no longer sends a confidence of its own', () => {
    const calculator = read('src/components/carbon-calculator/index.tsx');
    expect(calculator).not.toMatch(/confidence:\s*\d/);
    expect(calculator).toContain('createEntry(');
  });

  it('the data-quality FAQ answer scores calculator entries by category and names 85% as the older rows\' value', () => {
    const answer = faq.methodology.find((item) => item.q === 'How does Eco-Auditor handle data quality?')?.a ?? '';
    expect(answer).not.toMatch(/default to \d+%/);
    expect(answer).toMatch(/imported or typed into the calculator, receives a confidence score based on its activity category/);
    expect(answer).toContain(`saved before category scoring was applied to them keep the fixed ${LEGACY_MANUAL_ENTRY_CONFIDENCE}%`);
  });

  it('the methodology page says the same', () => {
    const page = read('src/pages/MethodologyPublic.tsx');
    expect(page).not.toMatch(/calculator default to/);
    expect(page).toContain('Entries typed into the calculator are scored by their category the same way');
  });
});
