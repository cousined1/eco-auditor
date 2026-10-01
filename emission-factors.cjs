// Server-side lookup over emission-factors.json — the single source of truth
// shared with the client calculator (src/lib/emission-factors/factors.ts).
//
// Before this existed, the client and the engine each carried their own table
// and disagreed for the same activity (gasoline 8.887 vs 8.78, electricity
// 0.417 vs 0.2168), so a number depended on whether it was typed into the form
// or imported from CSV. tests/factor-parity.test.ts now asserts both paths
// agree; if you add a factor, add it to the JSON, not here.
//
// There are two catalogs, and a stored row is priced by the one it names.
// Summaries recompute every stored row, so correcting a factor or a scope rule
// in place would silently restate every customer's past totals, signed-off
// reports included (audit review R2). emission-factors.json prices new entries
// and previews; emission-factors.v1.json is the 2026-07-24 catalog, frozen byte
// for byte (tests/catalog-version.test.ts pins its SHA-256), and prices every row
// stored without a pin and every row pinned to it. Restating old rows onto the
// current catalog is an owner decision: scripts/restate-legacy-rows.cjs
// (dry run) and docs/runbooks/factor-restatement.md.
const crypto = require('crypto');
const CATALOG = require('./emission-factors.json');
const LEGACY_CATALOG = require('./emission-factors.v1.json');

// Matches normalizeKey() in emissions-engine.cjs so CSV values, client labels,
// and JSON keys all collapse to the same form.
function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

// What the entry API stores in emission_entries.catalog_version: the catalog's
// `version` plus a short hash of its content.
function versionTag(catalog) {
  return String(catalog.version || 'unversioned') + '+' +
    crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex').slice(0, 12);
}

// category key -> { ...category, sourceIndex: Map(normalized source key -> source) }
function buildIndex(catalog) {
  const byKey = new Map(catalog.categories.map((category) => [normalizeKey(category.key), category]));
  const index = new Map();
  for (const category of catalog.categories) {
    // A category may list another category's sources (renewable_electricity
    // prices each eGRID subregion like purchased_electricity, location-based).
    const listed = category.sourcesFrom ? byKey.get(normalizeKey(category.sourcesFrom)).sources : category.sources;
    const sources = new Map();
    for (const source of listed) {
      const units = new Map();
      for (const [unit, factor] of Object.entries(source.units)) {
        units.set(normalizeKey(unit), { unit, factor });
      }
      const entry = { ...source, unitIndex: units };
      sources.set(normalizeKey(source.key), entry);
      for (const alias of source.aliases || []) sources.set(normalizeKey(alias), entry);
    }
    index.set(normalizeKey(category.key), { ...category, sourceIndex: sources });
  }
  return index;
}

function lookupFor(catalog) {
  const index = buildIndex(catalog);

  function getCategory(categoryKey) {
    return index.get(normalizeKey(categoryKey)) || null;
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

  function categoryKeysForScope(scopeNumber) {
    return catalog.categories.filter((category) => Number(category.scope) === scopeNumber).map((category) => category.key);
  }

  return { catalog, version: catalog.version, tag: versionTag(catalog), getCategory, getSource, factorFor, categoryKeysForScope };
}

const CURRENT = lookupFor(CATALOG);
const LEGACY = lookupFor(LEGACY_CATALOG);
const BY_VERSION = new Map([[LEGACY.version, LEGACY], [CURRENT.version, CURRENT]]);

// The catalog a stored row resolves against, for its factor AND its
// classification. `catalogVersion` is emission_entries.catalog_version
// ('<version>+<hash>'). Only a version this file knows selects that catalog;
// a row with no pin (CSV imports, calculator rows saved before the entry API)
// and anything unrecognised resolve against the frozen legacy catalog, which is
// what priced them when they were written.
function catalogFor(catalogVersion) {
  if (catalogVersion === null || catalogVersion === undefined || catalogVersion === '') return LEGACY;
  return BY_VERSION.get(String(catalogVersion).split('+')[0]) || LEGACY;
}

// Only what other modules actually consume. getCategory/getSource/factorFor
// resolve against the CURRENT catalog: they validate new input (the entry API,
// the Scope 3 gate). The engine resolves a stored row through catalogFor.
module.exports = {
  CATALOG,
  CATALOG_VERSION: CURRENT.tag,
  LEGACY_CATALOG_VERSION: LEGACY.tag,
  catalogFor,
  getCategory: CURRENT.getCategory,
  getSource: CURRENT.getSource,
  factorFor: CURRENT.factorFor,
};
