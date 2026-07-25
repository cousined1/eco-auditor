// Client-side lookup over emission-factors.json — the same file the server
// engine reads through emission-factors.cjs. Keep the two in step: the catalog
// is the shared data, and tests/factor-parity.test.ts asserts both paths return
// the same number for the same activity.
import catalog from '../../../emission-factors.json';

export type Scope = 'Scope 1' | 'Scope 2' | 'Scope 3';

export interface FactorSource {
  readonly key: string;
  readonly label: string;
  readonly factorSource: string;
  readonly verified?: boolean;
  readonly aliases?: readonly string[];
  readonly units: Readonly<Record<string, number>>;
  readonly note?: string;
}

export interface FactorCategory {
  readonly key: string;
  readonly scope: number;
  readonly label: string;
  readonly showInCalculator: boolean;
  readonly sourceListLabel?: string;
  readonly sources: readonly FactorSource[];
}

const CATEGORIES = catalog.categories as readonly FactorCategory[];

// Mirrors normalizeKey() in emission-factors.cjs so a value typed in the form,
// imported from CSV, or already persisted as a display label all collapse to
// the same lookup key.
function normalizeKey(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

const CATEGORY_BY_KEY = new Map<string, FactorCategory>();
const SOURCE_BY_KEY = new Map<string, Map<string, FactorSource>>();

for (const category of CATEGORIES) {
  CATEGORY_BY_KEY.set(normalizeKey(category.key), category);
  const sources = new Map<string, FactorSource>();
  for (const source of category.sources) {
    sources.set(normalizeKey(source.key), source);
    for (const alias of source.aliases ?? []) sources.set(normalizeKey(alias), source);
  }
  SOURCE_BY_KEY.set(normalizeKey(category.key), sources);
}

function getCategory(categoryKey: string): FactorCategory | null {
  return CATEGORY_BY_KEY.get(normalizeKey(categoryKey)) ?? null;
}

export function getSource(categoryKey: string, sourceKey: string): FactorSource | null {
  const sources = SOURCE_BY_KEY.get(normalizeKey(categoryKey));
  if (!sources) return null;
  // Same category-key fallback the server uses, so a Scope 3 row naming an
  // arbitrary vendor still prices against the category's spend-based factor.
  return sources.get(normalizeKey(sourceKey)) ?? sources.get(normalizeKey(categoryKey)) ?? null;
}

/** Categories offered in the calculator for a scope, in catalog order. */
export function categoriesForScope(scope: Scope): FactorCategory[] {
  const n = Number(scope.replace('Scope ', ''));
  return CATEGORIES.filter((c) => c.scope === n && c.showInCalculator);
}

export function sourcesForCategory(categoryKey: string): readonly FactorSource[] {
  return getCategory(categoryKey)?.sources ?? [];
}

/**
 * Units this source is actually defined for. The form must offer only these —
 * previously it offered all eight units for every source and then ignored the
 * choice, so "1000 therms of natural gas" was priced with the per-MMBtu factor.
 */
export function unitsForSource(categoryKey: string, sourceKey: string): string[] {
  const source = getSource(categoryKey, sourceKey);
  return source ? Object.keys(source.units) : [];
}

/** kg CO2e per unit, or null when the category/source/unit triple is unsupported. */
export function factorFor(categoryKey: string, sourceKey: string, unit: string): number | null {
  const source = getSource(categoryKey, sourceKey);
  if (!source) return null;
  const wanted = normalizeKey(unit);
  for (const [name, factor] of Object.entries(source.units)) {
    if (normalizeKey(name) === wanted) return factor;
  }
  return null;
}

/**
 * kg CO2e for an activity, or null if the unit does not belong to the source.
 * Null means "cannot compute" — never treat it as zero.
 */
export function calculateEmissions(
  categoryKey: string,
  sourceKey: string,
  amount: number,
  unit: string,
): number | null {
  const factor = factorFor(categoryKey, sourceKey, unit);
  if (factor === null || !Number.isFinite(amount)) return null;
  return amount * factor;
}

/** Display label for a stored category value; falls back to the raw string. */
export function labelForCategory(categoryKey: string): string {
  return getCategory(categoryKey)?.label ?? categoryKey;
}

/** Display label for a stored source value; falls back to the raw string. */
export function labelForSource(categoryKey: string, sourceKey: string): string {
  const sources = SOURCE_BY_KEY.get(normalizeKey(categoryKey));
  return sources?.get(normalizeKey(sourceKey))?.label ?? sourceKey;
}
