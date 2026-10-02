#!/usr/bin/env node
'use strict';

// DRY RUN ONLY. Shows what restating stored emission entries onto the current
// factor catalog would change, per company and year, before an owner decides
// whether to do it (docs/runbooks/factor-restatement.md). It never writes:
// there is no --apply mode, the database session is READ ONLY, and the report
// goes to stdout.
//
//   node scripts/restate-legacy-rows.cjs --input rows.json [--company 42] [--json]
//   DATABASE_URL=... node scripts/restate-legacy-rows.cjs --database [--company 42] [--json]
//
// rows.json: an array of emission_entries rows, or an object holding one under
// `rows`, `entries` or `emission_entries` (e.g. an account export).
//
// A row is "legacy" when its catalog_version does not name the current catalog:
// no pin at all (CSV imports, calculator rows saved before the entry API) or a
// pin to the frozen 2026-07-24 catalog. Summaries price it with that catalog
// forever (emissions-engine.cjs, catalogFor), so this report is the only place
// its restated value appears. For each legacy row it shows the value it counts
// today and the value the same activity gets from the current catalog, and the
// pin a restatement would write (factor_value, factor_source, catalog_version,
// co2e_kg). Rows whose activity was never stored (a CO2e total typed in) have
// nothing to restate; rows whose source the current catalog no longer has
// (generic coal, a renewable contract with no subregion...) are listed as
// needing an owner's mapping and keep their current value in the "new" totals.

const fs = require('node:fs');
const { calculateEntry, summarizeEntries } = require('../emissions-engine.cjs');
const { CATALOG, CATALOG_VERSION, catalogFor } = require('../emission-factors.cjs');

const CO2E_UNITS = new Set(['kg_co2e', 'kgco2e', 't_co2e', 'tco2e', 'tonnes_co2e', 'tonne_co2e']);
const normalizeKey = (value) => String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
const round = (value, decimals = 6) => Math.round((Number(value) + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
const yearOf = (row) => String(row.activity_date || row.created_at || '').slice(0, 4) || 'undated';

function parseArgs(argv) {
  const args = { input: null, database: false, company: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--database') args.database = true;
    else if (arg === '--company') args.company = argv[++i];
    else if (arg === '--json') args.json = true;
    else throw new Error(`Unknown argument ${arg}. This script is a dry run: there is no --apply.`);
  }
  if (!args.input === !args.database) throw new Error('Give exactly one of --input <file> or --database.');
  return args;
}

function readRowsFromFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(data) ? data : data.rows || data.entries || data.emission_entries;
  if (!Array.isArray(rows)) throw new Error(`${file} holds no array of rows.`);
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

async function readRowsFromDatabase(company) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const params = company ? [company] : [];
    const { rows } = await client.query(
      'SELECT id, company_id, facility_id, scope, category, source, amount, unit, method, confidence, factor_value, ' +
        'catalog_version, activity_date, created_at FROM public.emission_entries' +
        (company ? ' WHERE company_id = $1' : '') + ' ORDER BY company_id, id',
      params,
    );
    await client.query('ROLLBACK');
    return rows.map((row) => ({
      ...row,
      amount: Number(row.amount),
      confidence: row.confidence == null ? undefined : Number(row.confidence),
      factor_value: row.factor_value == null ? null : Number(row.factor_value),
      activity_date: row.activity_date instanceof Date ? row.activity_date.toISOString().slice(0, 10) : row.activity_date,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));
  } finally {
    await client.end();
  }
}

// What one row counts today, and what restating it would make it count.
function restateRow(row) {
  const legacy = catalogFor(row.catalog_version).version !== CATALOG.version;
  let before;
  try {
    before = calculateEntry(row);
  } catch (err) {
    return { row, legacy, status: 'excluded', reason: String(err.message || err), before: null, after: null };
  }
  if (!legacy) return { row, legacy, status: 'current', before, after: before };
  if (CO2E_UNITS.has(normalizeKey(row.unit))) {
    return { row, legacy, status: 'no-activity', reason: 'a CO2e total typed in: no activity to re-price', before, after: before };
  }
  const repriced = { ...row, factor_value: null, catalog_version: CATALOG_VERSION };
  try {
    const after = calculateEntry(repriced);
    const source = catalogFor(CATALOG_VERSION).getSource(row.category, row.source);
    const unit = source && Object.keys(source.units).find((name) => normalizeKey(name) === normalizeKey(row.unit));
    return {
      row,
      legacy,
      status: 'restatable',
      before,
      after,
      pin: {
        factor_value: source && unit ? source.units[unit] : null,
        factor_source: source ? source.factorSource : null,
        catalog_version: CATALOG_VERSION,
        co2e_kg: round(after.co2e_tonnes * 1000, 3),
      },
    };
  } catch (err) {
    return { row, legacy, status: 'needs-mapping', reason: String(err.message || err), before, after: before };
  }
}

function totals(summary) {
  return {
    scope1: summary.by_scope.scope1,
    scope2_location: summary.by_scope.scope2,
    scope2_market: summary.scope2_market_tCO2e,
    scope3: summary.by_scope.scope3,
    total: summary.total_emissions_tCO2e,
    biogenic_co2: summary.biogenic_co2_t,
    non_kyoto: summary.non_kyoto_tCO2e,
    confidence: summary.confidence_score,
  };
}

function buildReport(rows) {
  const results = rows.map(restateRow);
  const groups = new Map();
  for (const result of results) {
    const key = `${result.row.company_id}|${yearOf(result.row)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  const periods = [...groups.entries()].map(([key, group]) => {
    const [companyId, year] = key.split('|');
    const priced = group.filter((r) => r.status !== 'excluded');
    const asStored = priced.map((r) => r.row);
    const asRestated = priced.map((r) => (r.status === 'restatable' ? { ...r.row, factor_value: null, catalog_version: CATALOG_VERSION } : r.row));
    const count = (status) => group.filter((r) => r.status === status).length;
    return {
      company_id: companyId,
      year,
      rows: group.length,
      restatable: count('restatable'),
      needs_mapping: count('needs-mapping'),
      no_activity: count('no-activity'),
      already_current: count('current'),
      excluded: count('excluded'),
      old: totals(summarizeEntries(asStored)),
      new: totals(summarizeEntries(asRestated)),
    };
  });
  const changes = results
    .filter((r) => r.status === 'restatable' || r.status === 'needs-mapping' || r.status === 'no-activity')
    .map((r) => ({
      id: r.row.id,
      company_id: r.row.company_id,
      year: yearOf(r.row),
      activity: `${r.row.category}/${r.row.source} ${r.row.amount} ${r.row.unit}`,
      status: r.status,
      old: { reporting_bucket: r.before.reporting_bucket, tco2e: r.before.co2e_tonnes },
      new: { reporting_bucket: r.after.reporting_bucket, tco2e: r.after.co2e_tonnes, biogenic_co2_t: r.after.biogenic_co2_tonnes, scope2_market_t: r.after.scope2_market_tonnes },
      delta_tco2e: round(r.after.co2e_tonnes - r.before.co2e_tonnes),
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.pin ? { proposed_pin: r.pin } : {}),
    }));
  return { dry_run: true, current_catalog: CATALOG_VERSION, periods, rows: changes };
}

function printReport(report) {
  const t = (value) => (value === undefined || value === null ? '-' : Number(value).toFixed(3));
  console.log(`DRY RUN (nothing written). Restating legacy rows onto catalog ${report.current_catalog}.`);
  for (const p of report.periods) {
    console.log(`\ncompany ${p.company_id}, ${p.year}: ${p.rows} rows, ${p.restatable} restatable, ${p.needs_mapping} need a mapping, ${p.no_activity} without activity, ${p.already_current} already current, ${p.excluded} excluded`);
    for (const key of ['scope1', 'scope2_location', 'scope2_market', 'scope3', 'total', 'biogenic_co2', 'non_kyoto', 'confidence']) {
      console.log(`  ${key.padEnd(16)} old ${t(p.old[key]).padStart(12)}  new ${t(p.new[key]).padStart(12)}`);
    }
  }
  console.log('\nrow changes (id, company, year, activity: old -> new tCO2e [bucket]):');
  for (const r of report.rows) {
    const note = r.status === 'restatable' ? '' : `  ${r.status}: ${r.reason}`;
    console.log(`  ${r.id} c${r.company_id} ${r.year} ${r.activity}: ${t(r.old.tco2e)} [${r.old.reporting_bucket}] -> ${t(r.new.tco2e)} [${r.new.reporting_bucket}]${note}`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  let rows = args.input ? readRowsFromFile(args.input) : await readRowsFromDatabase(args.company);
  if (args.company) rows = rows.filter((row) => String(row.company_id) === String(args.company));
  const report = buildReport(rows);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report;
}

module.exports = { buildReport, restateRow };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err.message || err));
    process.exit(1);
  });
}
