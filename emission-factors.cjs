// Server-side lookup over emission-factors.json — the single source of truth
// shared with the client calculator (src/lib/emission-factors/factors.ts).
//
// Before this existed, the client and the engine each carried their own table
// and disagreed for the same activity (gasoline 8.887 vs 8.78, electricity
// 0.417 vs 0.2168), so a number depended on whether it was typed into the form
// or imported from CSV. tests/factor-parity.test.ts now asserts both paths
// agree; if you add a factor, add it to the JSON, not here.
const CATALOG = require('./emission-factors.json');

// Matches normalizeKey() in emissions-engine.cjs so CSV values, client labels,
// and JSON keys all collapse to the same form.
function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

// category key -> { scope, label, sources: Map(normalized source key -> source) }
const CATEGORY_INDEX = new Map();

for (const category of CATALOG.categories) {
  const sources = new Map();
  for (const source of category.sources) {
    const units = new Map();
    for (const [unit, factor] of Object.entries(source.units)) {
      units.set(normalizeKey(unit), { unit, factor });
    }
    const entry = { ...source, unitIndex: units };
    sources.set(normalizeKey(source.key), entry);
    for (const alias of source.aliases || []) sources.set(normalizeKey(alias), entry);
  }
  CATEGORY_INDEX.set(normalizeKey(category.key), { ...category, sourceIndex: sources });
}

function getCategory(categoryKey) {
  return CATEGORY_INDEX.get(normalizeKey(categoryKey)) || null;
}

// Resolves a source within a category, falling back to the source whose key
// equals the category key. That fallback is what lets a Scope 3 CSV row name an
// arbitrary vendor and still price against the category's spend-based factor.
function getSource(categoryKey, sourceKey) {
  const category = getCategory(categoryKey);
  if (!category) return null;
  return (
    category.sourceIndex.get(normalizeKey(sourceKey)) ||
    category.sourceIndex.get(normalizeKey(categoryKey)) ||
    null
  );
}

// Returns kg CO2e per unit, or null when the category/source/unit triple is not
// supported. Callers must treat null as an error — never as zero, and never by
// silently substituting another unit's factor.
function factorFor(categoryKey, sourceKey, unit) {
  const source = getSource(categoryKey, sourceKey);
  if (!source) return null;
  const match = source.unitIndex.get(normalizeKey(unit));
  return match ? match.factor : null;
}

// Only what other modules actually consume. normalizeKey stays internal — the
// client adapter has its own copy. getCategory is exported so the engine can
// check a row's declared scope against the catalog's scope for that category
// (see factorForEntry): scope used to be taken from untrusted input, which both
// misfiled totals and let a Scope 3 activity be relabeled past the paywall.
module.exports = {
  CATALOG,
  getCategory,
  getSource,
  factorFor,
};
