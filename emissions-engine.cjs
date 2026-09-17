// Emission factors now live in emission-factors.json and are resolved through
// emission-factors.cjs, shared with the client calculator. This file previously
// carried its own SCOPE1_FACTORS / MOBILE_FACTORS / EGRID_FACTORS / SCOPE3_FACTORS
// tables that disagreed with the client's for the same activity.
//
// Scope 2 no longer applies a transmission-and-distribution gross-up. Under the
// GHG Protocol Scope 2 Guidance, T&D losses are the end user's Scope 3 Category 3,
// not Scope 2; location-based Scope 2 is consumption x grid factor. The old
// 4.75% gross-up also existed only on this side, so it was a second reason the
// two paths disagreed. Scope 3 Cat 3 accounting for T&D is not built yet.
const { factorFor, getSource, getCategory } = require('./emission-factors.cjs');

const CONFIDENCE_BY_CATEGORY = {
  stationary_combustion: 90,
  mobile_combustion: 88,
  purchased_electricity: 97,
  purchased_goods: 65,
  capital_goods: 65,
  fuel_transport: 72,
  transport_inbound: 72,
  transport_outbound: 72,
  waste: 75,
  business_travel: 72,
  employee_commuting: 75,
  leased_assets: 70,
  // These catalog categories were missing, so their rows silently fell to the
  // `|| 70` default and dragged the reported confidence_score around for
  // reasons no one could trace back to a source.
  process_emissions: 80,
  fugitive_emissions: 85,
  purchased_heat_steam: 90,
  transportation: 72,
  precalculated: 85,
};

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

function normalizeScope(scope) {
  const text = normalizeKey(scope);
  if (text === '1' || text === 'scope_1' || text === 'scope1') return 'scope1';
  if (text === '2' || text === 'scope_2' || text === 'scope2') return 'scope2';
  if (text === '3' || text === 'scope_3' || text === 'scope3') return 'scope3';
  throw new Error('Invalid scope. Use Scope 1, Scope 2, or Scope 3.');
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function factorForEntry(entry) {
  const scope = normalizeScope(entry.scope);
  const category = normalizeKey(entry.category);
  const unit = normalizeKey(entry.unit);

  const catalogCategory = getCategory(category);
  if (catalogCategory && Number(catalogCategory.scope) !== Number(scope.replace('scope', ''))) {
    throw new Error(
      `Category "${entry.category}" is Scope ${catalogCategory.scope}, not ${entry.scope}.`
    );
  }

  // Passthrough for entries already expressed in CO2e. The in-app calculator
  // persists pre-computed kg CO2e (amount = calculatedKg, unit = 'kg CO2e'),
  // so re-applying an activity factor would either throw (Scope 1/3) or inflate
  // the number ~217x (Scope 2). Convert to tonnes instead. See audit C3.
  // SC-03 (audit run 20260917-a520): resolve the catalog source even on the
  // CO2e-passthrough branches. The in-app calculator persists rows as
  // `unit: 'kg CO2e'`, so without this lookup a provisional factor
  // (verified:false) lost its provenance flag on re-derivation and the
  // report's provisional-factor disclosure undercounted.
  if (unit === 'kg_co2e' || unit === 'kgco2e') {
    const known = getSource(category, entry.source);
    return { factor: 0.001, category: category || 'precalculated', verified: known ? known.verified : true };
  }
  if (unit === 't_co2e' || unit === 'tco2e' || unit === 'tonnes_co2e' || unit === 'tonne_co2e') {
    const known = getSource(category, entry.source);
    return { factor: 1, category: category || 'precalculated', verified: known ? known.verified : true };
  }

  // The catalog is kg CO2e per unit; this engine reports tonnes.
  const kgPerUnit = factorFor(category, entry.source, entry.unit);
  const known = getSource(category, entry.source);
  const toTonnes = (kg) => kg / 1000;

  if (scope === 'scope1') {
    if (category === 'mobile_combustion') {
      if (kgPerUnit == null) {
        if (!known) throw new Error(`Unsupported mobile combustion source: ${entry.source}`);
        throw new Error(`Unsupported mobile combustion unit: ${entry.source} ${entry.unit}`);
      }
      return { factor: toTonnes(kgPerUnit), category: 'mobile_combustion', verified: known.verified };
    }
    if (kgPerUnit == null) {
      throw new Error(`Unsupported Scope 1 source/unit: ${entry.source} ${entry.unit}`);
    }
    // Process and fugitive rows used to be rejected on import even though the
    // in-app form accepted them; they resolve now, so keep their own category
    // rather than flattening everything to stationary_combustion.
    return { factor: toTonnes(kgPerUnit), category: category || 'stationary_combustion', verified: known.verified };
  }

  if (scope === 'scope2') {
    if (kgPerUnit == null) {
      // Was: `?? EGRID_FACTORS.CAMX` — an unrecognised region silently got
      // California's grid factor, one of the cleanest in the country, so a
      // Texas or Midwest row was understated with no warning. Fail the row;
      // the CSV route already surfaces per-row errors to the user.
      if (!known && category === 'purchased_electricity') {
        throw new Error(`Unsupported eGRID subregion: ${entry.source}`);
      }
      throw new Error(`Unsupported Scope 2 source/unit: ${entry.source} ${entry.unit}`);
    }
    return { factor: toTonnes(kgPerUnit), category: category || 'purchased_electricity', verified: known.verified };
  }

  if (kgPerUnit == null) {
    // Spend-based factors are per USD. A row that gives a mass or distance for
    // one of them used to be priced as if it were dollars; now it fails.
    throw new Error(`Unsupported Scope 3 category/source: ${entry.category}/${entry.source} ${entry.unit}`);
  }
  return { factor: toTonnes(kgPerUnit), category, verified: known.verified };
}

function calculateEntry(entry) {
  // REL-002: Number(null), Number(''), and Number('   ') are all 0, so a
  // missing or blank amount used to compute a valid-looking 0 tCO2e row.
  // Reject the row instead; an explicit 0 stays valid data.
  const rawAmount = entry.amount;
  if (
    rawAmount === null ||
    rawAmount === undefined ||
    (typeof rawAmount === 'string' && rawAmount.trim() === '')
  ) {
    throw new Error('Amount is required — null, blank, and whitespace-only amounts are rejected.');
  }
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Amount must be a non-negative number.');
  }

  const scope = normalizeScope(entry.scope);
  const factor = factorForEntry(entry);
  const co2e = round(amount * factor.factor);
  const category = factor.category;

  const result = {
    ...entry,
    scope,
    normalized_category: category,
    co2e_tonnes: co2e,
    factor: factor.factor,
    // `Number(x) || default` treats an explicit confidence of 0 as "unset" and
    // silently replaces it with the category default — the one value a user
    // sets deliberately to mean "do not trust this row".
    confidence: Number.isFinite(Number(entry.confidence)) && entry.confidence !== null && entry.confidence !== ''
      ? Number(entry.confidence)
      : (CONFIDENCE_BY_CATEGORY[category] || 70),
  };
  // REL-001: factors self-flagged verified:false are industry-typical values
  // pending citation verification. Attach provenance so reports and API
  // consumers can surface them instead of presenting every factor as
  // citation-tracked. Absent provenance means the applied factor is trusted.
  if (factor.verified === false) {
    result.provenance = { verified: false };
  }
  return result;
}

function summarizeEntries(entries, options = {}) {
  // H21: isolate per-row calculation failures so one unsupported entry does
  // not 500 summary, trend, and reports for the whole company. Bad rows are
  // skipped from totals and surfaced in `errors` for operator logging.
  const byScope = { scope1: 0, scope2: 0, scope3: 0 };
  const byCategory = {};
  let confidenceTotal = 0;
  const calculated = [];
  const errors = [];

  for (const entry of entries) {
    try {
      calculated.push(calculateEntry(entry));
    } catch (err) {
      errors.push({ error: String(err.message || err) });
    }
  }

  for (const row of calculated) {
    byScope[row.scope] = round(byScope[row.scope] + row.co2e_tonnes);
    byCategory[row.normalized_category] = round((byCategory[row.normalized_category] || 0) + row.co2e_tonnes);
    confidenceTotal += row.confidence;
  }

  const total = round(byScope.scope1 + byScope.scope2 + byScope.scope3);
  // An empty inventory used to report confidence 100 — "no data, total
  // confidence" — which flows straight into the dashboard's confidence_score.
  const confidence = calculated.length ? Math.round(confidenceTotal / calculated.length) : 0;

  const result = {
    company_id: options.companyId || options.company_id || null,
    period: String(options.period || new Date().getFullYear()),
    total_emissions_tCO2e: total,
    by_scope: byScope,
    by_category: byCategory,
    confidence_score: confidence,
    methodology: 'EPA GHG Protocol + IPCC AR5',
    entries: calculated,
  };
  if (errors.length) result.errors = errors;
  return result;
}

// H5: build a monthly or quarterly emissions trend for a single year.
// Previously the trend endpoint used only Jan-Sep and aggregated every year
// together (date.getMonth() === index with no year filter), so multi-year
// data collapsed into one year and Q4 was missing.
function buildTrend(entries, options = {}) {
  const period = String(options.period || 'monthly');
  const year = Number(options.year) || new Date().getFullYear();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const monthly = monthNames.map(function (month, index) {
    const monthEntries = entries.filter(function (entry) {
      const date = entry.created_at ? new Date(entry.created_at) : null;
      // getMonth()/getFullYear() are LOCAL-time accessors on a UTC timestamp.
      // The CSV route stores date-only values as UTC midnight, so on any
      // server west of UTC every row dated the 1st of a month was bucketed
      // into the previous month, and Jan-1 rows into the previous year —
      // making the same data produce different charts per deploy region.
      return date && date.getUTCMonth() === index && date.getUTCFullYear() === year;
    });
    const summary = summarizeEntries(monthEntries, { companyId: options.companyId });
    return {
      month: month,
      scope1: summary.by_scope.scope1,
      scope2: summary.by_scope.scope2,
      scope3: summary.by_scope.scope3,
    };
  });

  if (period === 'quarterly') {
    return [
      { quarter: 'Q1', rows: monthly.slice(0, 3) },
      { quarter: 'Q2', rows: monthly.slice(3, 6) },
      { quarter: 'Q3', rows: monthly.slice(6, 9) },
      { quarter: 'Q4', rows: monthly.slice(9, 12) },
    ].map(function (bucket) {
      return {
        quarter: bucket.quarter,
        scope1: round(bucket.rows.reduce((sum, row) => sum + row.scope1, 0)),
        scope2: round(bucket.rows.reduce((sum, row) => sum + row.scope2, 0)),
        scope3: round(bucket.rows.reduce((sum, row) => sum + row.scope3, 0)),
      };
    });
  }

  return monthly;
}

function toDashboardSummary(summary, priorSummary) {
  const total = summary.total_emissions_tCO2e || 0;
  const pct = (value) => total > 0 ? round((value / total) * 100, 3) : 0;

  const priorByScope = priorSummary?.by_scope;
  const hasPrior =
    priorByScope &&
    (priorByScope.scope1 > 0 ||
      priorByScope.scope2 > 0 ||
      priorByScope.scope3 > 0);

  function trend(current, previous) {
    const prev = Number(previous) || 0;
    // Returning 0 for a 0 -> positive move rendered as "no change" while
    // emissions actually went from nothing to something. null means
    // "new, not comparable" — the UI already renders no chip for null.
    if (prev === 0) return current > 0 ? null : 0;
    return round(((current - prev) / prev) * 100, 3);
  }

  return {
    total_co2e_tonnes: total,
    scope1_co2e_tonnes: summary.by_scope.scope1,
    scope2_co2e_tonnes: summary.by_scope.scope2,
    scope3_co2e_tonnes: summary.by_scope.scope3,
    scope1_pct: pct(summary.by_scope.scope1),
    scope2_pct: pct(summary.by_scope.scope2),
    scope3_pct: pct(summary.by_scope.scope3),
    confidence_score: summary.confidence_score,
    trend_vs_prior_period: hasPrior
      ? {
          scope1: trend(summary.by_scope.scope1, priorByScope.scope1),
          scope2: trend(summary.by_scope.scope2, priorByScope.scope2),
          scope3: trend(summary.by_scope.scope3, priorByScope.scope3),
        }
      : null,
  };
}

function parseEmissionCsv(csv) {
  const lines = splitCsvRecords(String(csv || '').trim());
  if (lines.length < 2) return [];
  const headers = lines[0].map(normalizeKey);
  const required = ['scope', 'category', 'source', 'amount', 'unit'];
  for (const key of required) {
    if (!headers.includes(key)) throw new Error(`CSV is missing required column: ${key}`);
  }

  return lines.slice(1).map((values, index) => {
    const row = {};
    headers.forEach((header, i) => { row[header] = values[i] || ''; });
    // REL-002: a blank cell made Number('') === 0 pass, importing a silent
    // zero. Blank and non-numeric amounts both fail the row.
    const amount = Number(row.amount);
    if (String(row.amount).trim() === '' || !Number.isFinite(amount)) {
      throw new Error(`CSV row ${index + 2} has an invalid amount.`);
    }
    return {
      scope: row.scope,
      category: row.category,
      source: row.source,
      amount,
      unit: row.unit,
      method: row.method || 'calculation',
      confidence: row.confidence ? Number(row.confidence) : undefined,
      facility_name: row.facility_name || undefined,
      date: row.date || undefined,
      notes: row.notes || undefined,
    };
  });
}

function splitCsvRecords(line) {
  const records = [];
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(current.trim());
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      out.push(current.trim());
      if (out.some(Boolean)) records.push(out.splice(0));
      else out.length = 0;
      current = '';
      if (ch === '\r' && line[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  out.push(current.trim());
  if (out.some(Boolean)) records.push(out);
  return records;
}

function getComplianceStatus(company = {}) {
  const revenue = Number(company.revenue || 0);
  const employees = Number(company.employees || 0);
  const region = String(company.region || company.state || '').toUpperCase();
  const sb253Applicable = revenue >= 1_000_000_000 && (region === 'CA' || region === 'CALIFORNIA');
  const csrdApplicable = (region === 'EU' || region === 'EUROPE') && employees >= 500;

  return {
    company_id: company.id || null,
    frameworks: {
      sb253: {
        name: 'California SB 253',
        applicable: sb253Applicable,
        status: sb253Applicable ? 'in_scope' : 'not_applicable',
        next_deadline: '2026-01-01 Scope 1 and Scope 2 reporting',
      },
      csrd: {
        name: 'EU CSRD',
        applicable: csrdApplicable,
        status: csrdApplicable ? 'in_scope' : 'not_applicable',
        next_deadline: '2025-01-01 CSRD reporting readiness',
      },
    },
  };
}

function buildFacilityEmissions(facilities, entries) {
  return facilities.map((facility) => {
    const summary = summarizeEntries(
      entries.filter((entry) => String(entry.facility_id) === String(facility.id)),
      { companyId: facility.company_id || null }
    );
    const total = summary.total_emissions_tCO2e || 0;
    return {
      ...facility,
      scope1_tCO2e: summary.by_scope.scope1,
      scope2_tCO2e: summary.by_scope.scope2,
      scope3_tCO2e: summary.by_scope.scope3,
      total_tCO2e: total,
      scope1_pct: total ? round((summary.by_scope.scope1 / total) * 100, 2) : 0,
      scope2_pct: total ? round((summary.by_scope.scope2 / total) * 100, 2) : 0,
      scope3_pct: total ? round((summary.by_scope.scope3 / total) * 100, 2) : 0,
    };
  });
}

module.exports = {
  // The factor tables that used to be exported from here now live in
  // emission-factors.json; require('./emission-factors.cjs') for lookups.
  calculateEntry,
  summarizeEntries,
  buildTrend,
  toDashboardSummary,
  parseEmissionCsv,
  getComplianceStatus,
  buildFacilityEmissions,
  // Exported so the server's Scope 3 plan gate normalises labels exactly the
  // way the engine does — a second, drifting copy let "Scope/3" past the gate.
  normalizeScope,
};
