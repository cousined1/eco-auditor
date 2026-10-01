'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LINES_PER_PAGE, TEXT_WIDTH, cleanText, createSimplePdf, textWidth, toWinAnsi } = require('./pdf-document.cjs');
const { MAX_SNAPSHOT_ENTRY_LINES } = require('./report-limits.cjs');

// ─── Report text ─────────────────────────────────────────────────────────────
// buildReportText renders a report snapshot (src/lib/reports/report-snapshot.cjs)
// to lines of text. It also accepts the engine's summary shape the sample
// report passes (total_emissions_tCO2e, by_scope, confidence_score, entries,
// methodology), with the period label as the second argument; sections it has
// no data for are left out, except the disclosures the GHG Protocol Corporate
// Standard (ch. 9) requires, which say "not specified" / "not set" instead of
// guessing. Nothing here reads the clock: "Generated" is the snapshot's time.

const REPORT_METHODOLOGY =
  'Each entry is activity data multiplied by an emission factor; entries are grouped into Scopes 1-3 as defined by the GHG Protocol Corporate Standard and summed in metric tonnes CO2e.';

const GWP_LABELS = { 'ipcc-ar5-gwp100': 'IPCC AR5, 100-year global warming potentials' };

// companies.consolidation_approach values as a report prints them. Anything else
// (null, 'unspecified') prints "not specified", never the raw value.
const CONSOLIDATION_LABELS = {
  operational_control: 'Operational control',
  financial_control: 'Financial control',
  equity_share: 'Equity share',
};

const MAX_LISTED_EXCLUSIONS = 20;

// How the snapshot's confidence_score was aggregated (report-snapshot.cjs
// confidenceMethod, after emissions-engine.cjs aggregateConfidence).
const CONFIDENCE_BASIS = {
  emissions_weighted: "per-entry confidence scores weighted by each entry's emissions",
  unweighted: 'unweighted average of the per-entry confidence scores',
};

// At most three decimals: kilogram precision, the unit the ledger stores.
function formatTonnes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.round((n + Number.EPSILON) * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

function formatFactor(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toPrecision(6))) : 'n/a';
}

function entriesOf(count) {
  return count + (count === 1 ? ' entry' : ' entries');
}

// Word-wraps to the page's text width, measured with the Helvetica metrics the
// PDF uses; continuation lines are indented two more spaces.
function wrapLine(text, indent) {
  const pad = ' '.repeat(indent || 0);
  const words = cleanText(text).split(/ +/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = pad + word;
    } else if (textWidth(current + ' ' + word) > TEXT_WIDTH) {
      lines.push(current);
      current = pad + '  ' + word;
    } else {
      current += ' ' + word;
    }
  }
  if (current) lines.push(current);
  // A single word wider than the page (a long id or URL) is cut where it overflows.
  return lines.flatMap(function (line) {
    const pieces = [];
    let piece = '';
    for (const ch of line) {
      if (piece && textWidth(piece + ch) > TEXT_WIDTH) {
        pieces.push(piece);
        piece = '';
      }
      piece += ch;
    }
    pieces.push(piece);
    return pieces;
  });
}

function describePeriod(report, legacyPeriod) {
  const period = report.period;
  if (period && typeof period === 'object' && period.label) {
    return period.type === 'calendar_year'
      ? period.label + ' (' + period.start + ' to ' + period.end + ')'
      : period.label + ' (custom date range)';
  }
  const label = cleanText(legacyPeriod);
  return label || 'not specified';
}

function describeGenerated(value) {
  const text = cleanText(value);
  if (!text) return 'not recorded';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : text;
}

function buildReportText(report, period, options) {
  const r = report || {};
  const opts = options || {};
  const isSnapshot = Boolean(r.schema_version);
  // Schema 2 carries the engine's memo lines, market-based Scope 2, excluded
  // rows, confidence method and one catalog identity per row. A schema 1
  // snapshot renders exactly as it did (tests/report-catalog-seam.test.ts).
  const v2 = Number(r.schema_version) >= 2;
  const byScope = r.by_scope || {};
  const memos = r.memos || {};
  const out = [];
  const add = function (text, indent) {
    for (const line of wrapLine(text, indent)) out.push(line);
  };
  const blank = function () { out.push(''); };

  add('Eco-Auditor Emissions Report');
  if (r.company && cleanText(r.company.name)) add('Company: ' + r.company.name);
  if (opts.reportId != null) add('Report ID: ' + opts.reportId);
  add('Reporting period: ' + describePeriod(r, period));
  add('Generated: ' + describeGenerated(r.generated_at));
  if (isSnapshot) {
    add('The figures were calculated once, when this report was generated, and are stored with it. Later changes to the data do not change this report.');
  }

  blank();
  add('SUMMARY (metric tonnes of CO2 equivalent, tCO2e)');
  add('Total: ' + formatTonnes(r.total_emissions_tCO2e) + ' tCO2e');
  add('Scope 1: ' + formatTonnes(byScope.scope1) + ' tCO2e');
  if (v2 && r.scope2_market_tCO2e != null) {
    add('Scope 2: ' + formatTonnes(byScope.scope2) + ' tCO2e (location-based)');
    add('Scope 2, market-based: ' + formatTonnes(r.scope2_market_tCO2e) + ' tCO2e (reported beside the total, not added to it)');
  } else {
    add('Scope 2: ' + formatTonnes(byScope.scope2) + ' tCO2e');
  }
  add('Scope 3: ' + formatTonnes(byScope.scope3) + ' tCO2e');
  const covered = Array.isArray(r.scopes_covered)
    ? r.scopes_covered
    : ['scope1', 'scope2', 'scope3'].filter(function (key) { return Number(byScope[key]) > 0; }).map(function (key) { return 'Scope ' + key.slice(-1); });
  add('Scopes covered: ' + (covered.length ? covered.join(', ') : 'none') + (covered.indexOf('Scope 3') === -1 ? '. Scope 3: not reported.' : ''));
  if (isSnapshot) {
    add('Entries included: ' + r.entry_count + (r.excluded_count ? '. Entries excluded: ' + r.excluded_count + ' (see Exclusions and limitations).' : ''));
  }
  // A schema 1 snapshot predates weighting. A summary that does not say how
  // its score was aggregated (the sample report) gets no qualifier.
  const basis = CONFIDENCE_BASIS[r.confidence_method] || (isSnapshot ? CONFIDENCE_BASIS.unweighted : '');
  add('Confidence: ' + (Number.isFinite(Number(r.confidence_score)) ? r.confidence_score + '%' : 'not recorded') +
    (basis ? ' (' + basis + ')' : ''));

  blank();
  add('ORGANISATIONAL BOUNDARY');
  add('Consolidation approach: ' + (CONSOLIDATION_LABELS[r.consolidation_approach] || 'not specified'));
  if (isSnapshot) add('Boundary: the facilities and entries recorded in Eco-Auditor for this company (see Facility breakdown).');

  blank();
  add('GREENHOUSE GASES');
  add('Reported as a CO2e aggregate; per-gas breakdown not available.');
  if (v2) {
    // The engine's memo lines, then the older treatments for rows priced with a
    // catalog that lacks the rule (report-snapshot.cjs MEMO_SOURCES).
    const separate = r.memo_entries || {};
    const earlier = ' priced with an earlier factor catalog';
    if (separate.biogenic_co2) {
      add('Biogenic CO2 from biomass combustion (' + entriesOf(separate.biogenic_co2) + '): ' + formatTonnes(r.biogenic_co2_t) +
        ' t CO2, reported separately, outside the scopes. Only the CH4 and N2O from burning it count in Scope 1.');
    }
    if (memos.biomass) {
      add('Biogenic CO2 (wood or wood-residual combustion, ' + entriesOf(memos.biomass) + earlier + '): included in Scope 1 in full, not reported separately.');
    }
    if (!separate.biogenic_co2 && !memos.biomass) add('Biogenic CO2: none recorded in this period (no biomass combustion entries).');
    if (separate.non_kyoto) {
      add('HCFC-22 and other gases the Kyoto Protocol does not cover (' + entriesOf(separate.non_kyoto) + '): ' + formatTonnes(r.non_kyoto_tCO2e) +
        ' tCO2e, reported separately, not included in Scope 1.');
    }
    if (memos.non_kyoto) {
      add('HCFC-22 (R-22, ' + entriesOf(memos.non_kyoto) + earlier + '): not covered by the Kyoto Protocol, but included in Scope 1 here rather than reported separately.');
    }
  } else {
    if (memos.biomass) {
      add('Biogenic CO2 (wood or wood-residual combustion, ' + entriesOf(memos.biomass) + '): included in Scope 1 in full, not reported separately.');
    } else {
      add(isSnapshot ? 'Biogenic CO2: none recorded in this period (no biomass combustion entries).' : 'Biogenic CO2: not reported separately.');
    }
    if (memos.non_kyoto) {
      add('HCFC-22 (R-22, ' + entriesOf(memos.non_kyoto) + '): not covered by the Kyoto Protocol, but included in Scope 1 here rather than reported separately.');
    }
  }

  blank();
  add('BASE YEAR');
  add('Base year: ' + (cleanText(r.base_year) || 'not set'));

  if (Array.isArray(r.by_facility)) {
    blank();
    add('FACILITY BREAKDOWN (tCO2e)');
    for (const f of r.by_facility) {
      add(f.name + ': Scope 1 ' + formatTonnes(f.scope1) + ', Scope 2 ' + formatTonnes(f.scope2) + ', Scope 3 ' + formatTonnes(f.scope3) +
        '; total ' + formatTonnes(f.total) + ' (' + entriesOf(f.entries) + ')', 2);
    }
  }
  if (Array.isArray(r.by_category)) {
    blank();
    add('EMISSIONS BY CATEGORY (tCO2e)');
    for (const c of r.by_category) add(c.scope + ' - ' + c.label + ': ' + formatTonnes(c.tco2e) + ' (' + entriesOf(c.entries) + ')', 2);
  }

  blank();
  add('METHODOLOGY');
  add('Methodology: ' + (cleanText(r.methodology) || REPORT_METHODOLOGY));
  // Schema 2: each catalog identity is printed once. Factor lines follow the
  // catalog that priced them; the report's own catalog heads the list.
  const catalogs = v2 && Array.isArray(r.catalogs) ? r.catalogs : [];
  const own = r.catalog ? catalogs.find(function (c) { return c.version === r.catalog.version; }) : null;
  if (r.catalog) {
    add('Global warming potentials: ' + (GWP_LABELS[r.catalog.gwp_basis] || cleanText(r.catalog.gwp_basis) || 'not recorded'));
    add('Emission factor catalog: version ' + cleanText(r.catalog.version) + ', SHA-256 ' + String(r.catalog.sha256 || '').slice(0, 16) +
      (v2 ? ' (' + (own ? entriesOf(own.entries) : 'no entries in this period') + ')' : ''));
  }
  if (Array.isArray(r.datasets) && r.datasets.length) {
    add('Factor datasets used: ' + r.datasets.map(function (d) { return d.label; }).join('; '));
  }
  const addFactor = function (f, version) {
    const value = f.precalculated
      ? 'entered as CO2e, calculated in the app with a factor from'
      : formatFactor(f.kg_co2e_per_unit) + ' kg CO2e per unit -';
    add(f.category_label + ' / ' + f.source_label + ' (' + cleanText(f.unit) + '): ' + value + ' ' + f.dataset + version +
      (f.provisional ? ' [provisional]' : '') + ' (' + entriesOf(f.entries) + ')', 2);
  };
  if (Array.isArray(r.factors) && r.factors.length && !v2) {
    add('Factors applied (category / source (activity unit): factor - dataset):');
    for (const f of r.factors) {
      addFactor(f, r.catalog && f.catalog_version !== r.catalog.version ? ', catalog ' + cleanText(f.catalog_version) : '');
    }
  } else if (Array.isArray(r.factors) && r.factors.length) {
    const priced = function (version) { return r.factors.filter(function (f) { return f.catalog_version === version; }); };
    const current = r.catalog ? priced(r.catalog.version) : [];
    if (current.length) {
      add('Factors applied (category / source (activity unit): factor - dataset):');
      for (const f of current) addFactor(f, '');
    }
    for (const c of catalogs) {
      if (r.catalog && c.version === r.catalog.version) continue;
      add('Entries priced with an earlier factor catalog keep the factors and scope rules they were calculated with: version ' +
        cleanText(c.version) + ', SHA-256 ' + String(c.sha256 || 'not recorded').slice(0, 16) + ' (' + entriesOf(c.entries) + '). Factors applied:');
      for (const f of priced(c.version)) addFactor(f, '');
    }
  }
  // REL-001: provisional (verified:false) factors do reach customer
  // inventories, so the report must say so instead of implying every factor is
  // citation-tracked. Calculated entries carry provenance: { verified: false }
  // from the engine when the applied catalog factor is provisional.
  // A snapshot stores at most MAX_SNAPSHOT_ENTRY_LINES entry lines, so it is
  // counted from its factor lines, which cover every entry.
  const entries = Array.isArray(r.entries) ? r.entries : [];
  const applied = isSnapshot ? r.entry_count : entries.length;
  const provisional = isSnapshot
    ? r.factors.reduce(function (n, f) { return n + (f.provisional ? f.entries : 0); }, 0)
    : entries.filter(function (entry) {
      return entry && entry.provenance && entry.provenance.verified === false;
    }).length;
  if (provisional > 0) {
    add(provisional + ' of ' + applied + ' factors applied are provisional (industry-typical values pending citation verification)');
  }

  blank();
  add('EXCLUSIONS AND LIMITATIONS');
  if (covered.indexOf('Scope 3') === -1) {
    add('- Scope 3: not reported.');
  } else if (Array.isArray(r.scope3_categories)) {
    add('- Scope 3: only these categories are included: ' + r.scope3_categories.join(', ') + '. Other Scope 3 categories are not reported.');
  } else {
    add('- Scope 3: only the categories recorded in Eco-Auditor are included. Other Scope 3 categories are not reported.');
  }
  const marketBased = v2 && r.scope2_market_tCO2e != null;
  if (marketBased) {
    add('- Scope 2: the location-based total uses eGRID subregion factors. The market-based total counts electricity bought under a renewable contract at zero and all other electricity at its grid factor, because no residual-mix factor is applied.');
  }
  if (v2 && memos.zero_rated_electricity) {
    const n = memos.zero_rated_electricity;
    add('- Scope 2: ' + entriesOf(n) + ' of renewable or zero-carbon electricity, priced with an earlier factor catalog, ' + (n === 1 ? 'is' : 'are') +
      ' counted at zero in the location-based total, which is a market-based treatment.' +
      (marketBased ? '' : ' Other purchased electricity uses eGRID grid-average (location-based) factors. A market-based Scope 2 total is not reported.'));
  } else if (memos.zero_rated_electricity) {
    add('- Scope 2: renewable or zero-carbon electricity contracts (' + entriesOf(memos.zero_rated_electricity) + ') are counted at zero, which is a market-based treatment. Other purchased electricity uses eGRID grid-average (location-based) factors. No separate location-based or market-based Scope 2 total is reported.');
  } else if (covered.indexOf('Scope 2') !== -1 && !marketBased) {
    add('- Scope 2: purchased electricity uses eGRID grid-average (location-based) factors. A market-based Scope 2 total is not reported.');
  }
  const grouped = v2 && r.excluded_rows ? r.excluded_rows : null;
  if (grouped && grouped.count) {
    // The engine's grouping: "N entries excluded: <reason>", with their ids.
    add('- ' + entriesOf(grouped.count) + ' could not be calculated and ' + (grouped.count === 1 ? 'is' : 'are') + ' excluded from every total:');
    let listed = 0;
    for (const g of grouped.reasons || []) {
      listed += g.count;
      const ids = (g.entry_ids || []).map(String);
      const more = g.count > ids.length && ids.length ? ' and ' + (g.count - ids.length) + ' more' : '';
      add(entriesOf(g.count) + ' excluded: ' + g.reason + (ids.length ? ' (' + (ids.length === 1 && !more ? 'entry ' : 'entries ') + ids.join(', ') + more + ')' : ''), 4);
    }
    if (grouped.count > listed) add(entriesOf(grouped.count - listed) + ' excluded for other reasons (listed in the stored report data).', 4);
  }
  const excluded = Array.isArray(r.excluded_entries) ? r.excluded_entries : [];
  const excludedCount = isSnapshot ? r.excluded_count : excluded.length;
  if (excludedCount && !grouped) {
    add('- ' + entriesOf(excludedCount) + ' could not be calculated and ' + (excludedCount === 1 ? 'is' : 'are') + ' excluded from every total:');
    for (const e of excluded.slice(0, MAX_LISTED_EXCLUSIONS)) {
      add('Entry ' + (e.entry_id == null ? '(no id)' : e.entry_id) + (e.date ? ' (' + e.date + ')' : '') + ': ' + e.reason, 4);
    }
    if (excludedCount > MAX_LISTED_EXCLUSIONS) add('... and ' + (excludedCount - MAX_LISTED_EXCLUSIONS) + ' more (listed in the stored report data).', 4);
  }
  if (r.entry_lines_omitted || r.excluded_lines_omitted) {
    const n = r.entry_count;
    add('- Entry-level lines omitted above ' + MAX_SNAPSHOT_ENTRY_LINES.toLocaleString('en-US') + ' entries; see the data export. ' +
      'Every total and breakdown in this report covers all ' + n.toLocaleString('en-US') + (n === 1 ? ' entry.' : ' entries.'));
  }
  if (isSnapshot) {
    add('- Entries are assigned to the reporting period by their activity date, or by the date they were recorded when no activity date was given.');
  }
  add('- Per-entry confidence scores are preset values (by category, or as stored with the entry); they are not an assessment of the underlying documents.');
  add('- This report has not been reviewed or assured by an independent third party, and it is not a regulatory filing.');

  if (isSnapshot) {
    blank();
    add('SIGN-OFF');
    add('Status when generated: draft, not signed off. A sign-off is recorded in Eco-Auditor against this report and does not change this document.');
  }
  return out.join('\n');
}

/** A stored report's PDF: the snapshot's text, its metadata, and a page footer. */
function renderReportPdf(snapshot, options) {
  const report = snapshot || {};
  const opts = options || {};
  const company = report.company && cleanText(report.company.name);
  const period = report.period && report.period.label;
  return createSimplePdf(buildReportText(report, null, opts), {
    title: ['Emissions report', company, period].filter(Boolean).join(' - '),
    author: company,
    subject: 'Greenhouse gas emissions report' + (opts.reportId != null ? ', report ID ' + opts.reportId : ''),
    creationDate: report.generated_at,
    footer: [company, period, opts.reportId != null ? 'Report ' + opts.reportId : ''].filter(Boolean).join(' \u00b7 '),
  });
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') {
    throw new Error('Fixture must be an object');
  }
  const required = ['reportId', 'revision', 'boundary', 'baseYear', 'metrics', 'activityData', 'factorRegister', 'evidenceIndex'];
  for (const key of required) {
    if (!(key in fixture)) {
      throw new Error('Fixture missing required field: ' + key);
    }
  }
  const metrics = fixture.metrics;
  const activityData = fixture.activityData;
  const factorRegister = fixture.factorRegister;
  const evidenceIndex = fixture.evidenceIndex;

  if (!Array.isArray(activityData) || activityData.length !== 11) {
    throw new Error('activityData must be an array of 11 rows, got ' + (Array.isArray(activityData) ? activityData.length : 'non-array'));
  }
  if (!Array.isArray(factorRegister) || factorRegister.length !== 5) {
    throw new Error('factorRegister must be an array of 5 factors, got ' + (Array.isArray(factorRegister) ? factorRegister.length : 'non-array'));
  }
  if (!Array.isArray(evidenceIndex) || evidenceIndex.length !== 11) {
    throw new Error('evidenceIndex must be an array of 11 entries, got ' + (Array.isArray(evidenceIndex) ? evidenceIndex.length : 'non-array'));
  }

  const s1 = metrics.scope1 && metrics.scope1.value;
  const s2 = metrics.scope2 && metrics.scope2.value;
  const s3 = metrics.scope3 && metrics.scope3.value;
  const total = metrics.total;
  if (typeof s1 !== 'number' || typeof s2 !== 'number' || typeof s3 !== 'number' || typeof total !== 'number') {
    throw new Error('metrics.scope{1,2,3}.value and metrics.total must be numbers');
  }
  // Exact float equality on decimal tonnes is a trap: 91.8 + 44.1 + 300.3
  // evaluates to 436.20000000000005, so a perfectly consistent one-decimal
  // fixture would throw and break the build. Compare with a tolerance well
  // below the reporting precision instead.
  if (Math.abs(s1 + s2 + s3 - total) > 0.005) {
    throw new Error('Scope sums (' + s1 + '+' + s2 + '+' + s3 + '=' + (s1 + s2 + s3) + ') do not match total (' + total + ')');
  }

  const activityIds = new Set(activityData.map(function (r) { return r.entry_id; }));
  const evidenceIds = new Set(evidenceIndex.map(function (r) { return r.entry_id; }));
  for (const id of activityIds) {
    if (!evidenceIds.has(id)) {
      throw new Error('Activity entry ' + id + ' missing from evidenceIndex');
    }
  }
  for (const id of evidenceIds) {
    if (!activityIds.has(id)) {
      throw new Error('Evidence entry ' + id + ' missing from activityData');
    }
  }

  return true;
}

function csvEscape(value) {
  let s = String(value == null ? '' : value);
  // API-011: neutralize spreadsheet formula injection — a cell beginning with
  // =, +, -, @, tab, or CR would execute as a formula/link when opened in a
  // spreadsheet app. Prefix with a single quote (standard mitigation).
  if (/^[=+@\t\r-]/.test(s)) {
    s = "'" + s;
  }
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map(function (row) {
    return columns.map(function (col) { return csvEscape(row[col]); }).join(',');
  }).join('\n');
  return header + '\n' + body + '\n';
}

function generateSampleReportFiles(fixture, targetDir) {
  validateFixture(fixture);
  const dir = targetDir || path.join(__dirname, '..', '..', '..', 'public', 'sample-report');
  fs.mkdirSync(dir, { recursive: true });

  const activityColumns = ['entry_id', 'scope', 'category', 'activity', 'activity_value', 'activity_unit', 'emission_factor', 'emission_factor_unit', 'emission_factor_source', 'tCO2e', 'data_quality_level', 'source_document', 'reviewer', 'review_timestamp'];
  fs.writeFileSync(path.join(dir, 'pacific-freight-activity-data.csv'), toCsv(fixture.activityData, activityColumns));

  const factorColumns = ['factor_id', 'source_organization', 'dataset_name', 'dataset_version', 'publication_date', 'imported_at', 'effective_from', 'effective_to', 'geography', 'activity_unit', 'output_unit', 'factor_value', 'factor_gas', 'gwp_basis', 'checksum', 'status'];
  fs.writeFileSync(path.join(dir, 'pacific-freight-factor-register.csv'), toCsv(fixture.factorRegister, factorColumns));

  const evidenceColumns = ['entry_id', 'source_type', 'source_reference', 'document_id', 'uploader', 'upload_date', 'data_quality_level', 'override_reason', 'override_reviewer', 'notes'];
  fs.writeFileSync(path.join(dir, 'pacific-freight-evidence-index.csv'), toCsv(fixture.evidenceIndex, evidenceColumns));

  const summary = {
    total_emissions_tCO2e: fixture.metrics.total,
    by_scope: {
      scope1: fixture.metrics.scope1.value,
      scope2: fixture.metrics.scope2.value,
      scope3: fixture.metrics.scope3.value,
    },
    confidence_score: 59,
    methodology: 'GHG Protocol - Operational Control',
  };
  const fiscalYear = (fixture.company && fixture.company.fiscalYear) || fixture.baseYear + 1;
  const text = buildReportText(summary, 'FY ' + fiscalYear);
  const pdf = createSimplePdf(text);
  fs.writeFileSync(path.join(dir, 'pacific-freight-fy2026.pdf'), pdf);

  return {
    activityData: path.join(dir, 'pacific-freight-activity-data.csv'),
    factorRegister: path.join(dir, 'pacific-freight-factor-register.csv'),
    evidenceIndex: path.join(dir, 'pacific-freight-evidence-index.csv'),
    pdf: path.join(dir, 'pacific-freight-fy2026.pdf'),
  };
}

module.exports = {
  REPORT_METHODOLOGY,
  LINES_PER_PAGE,
  TEXT_WIDTH,
  textWidth,
  buildReportText,
  createSimplePdf,
  renderReportPdf,
  toWinAnsi,
  validateFixture,
  generateSampleReportFiles,
  toCsv,
};