const TRANSMISSION_LOSS_RATE = 0.0475;

const SCOPE1_FACTORS = {
  natural_gas: { therms: 0.005302, mcf: 0.05302, gj: 50.68 },
  diesel: { gallons: 0.01021, liters: 0.002698 },
  propane: { gallons: 0.00579, liters: 0.001531 },
  coal: { short_tons: 2.07, metric_tons: 2.28 },
  fuel_oil_1: { gallons: 0.00975 },
  fuel_oil_2: { gallons: 0.01021 },
  fuel_oil_4: { gallons: 0.01069 },
  fuel_oil_6: { gallons: 0.01110 },
  kerosene: { gallons: 0.00968 },
  gasoline: { gallons: 0.00878 },
  lignite_coal: { short_tons: 1.41 },
  wood: { short_tons: 0.91 },
};

const MOBILE_FACTORS = {
  gasoline_passenger: 0.00878,
  gasoline_light_truck: 0.00878,
  diesel_heavy_truck: 0.01021,
  diesel_bus: 0.01021,
};

const EGRID_FACTORS = {
  CAMX: 0.207,
  RFCM: 0.487,
  RFCE: 0.327,
  NYUP: 0.197,
  NEWE: 0.197,
  SRMV: 0.373,
  SRSO: 0.385,
  SPNO: 0.416,
  ERCT: 0.341,
};

const SCOPE3_FACTORS = {
  purchased_goods: 0.000250,
  capital_goods: 0.000177,
  fuel_transport: 0.001060,
  transport_inbound: 0.000590,
  transport_outbound: 0.000450,
  waste: 0.001050,
  business_travel: 0.000260,
  employee_commuting: 0.000220,
  leased_assets: 0.000180,
};

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
  const sourceKey = normalizeKey(entry.source);
  const sourceRaw = String(entry.source || '').trim().toUpperCase();
  const unit = normalizeKey(entry.unit);

  // Passthrough for entries already expressed in CO2e. The in-app calculator
  // persists pre-computed kg CO2e (amount = calculatedKg, unit = 'kg CO2e'),
  // so re-applying an activity factor would either throw (Scope 1/3) or inflate
  // the number ~217x (Scope 2). Convert to tonnes instead. See audit C3.
  if (unit === 'kg_co2e' || unit === 'kgco2e') {
    return { factor: 0.001, category: category || 'precalculated' };
  }
  if (unit === 't_co2e' || unit === 'tco2e' || unit === 'tonnes_co2e' || unit === 'tonne_co2e') {
    return { factor: 1, category: category || 'precalculated' };
  }

  if (scope === 'scope1') {
    if (category === 'mobile_combustion') {
      const factor = MOBILE_FACTORS[sourceKey];
      if (factor == null) throw new Error(`Unsupported mobile combustion source: ${entry.source}`);
      return { factor, category: 'mobile_combustion' };
    }
    const sourceFactors = SCOPE1_FACTORS[sourceKey];
    if (!sourceFactors || sourceFactors[unit] == null) {
      throw new Error(`Unsupported Scope 1 source/unit: ${entry.source} ${entry.unit}`);
    }
    return { factor: sourceFactors[unit], category: 'stationary_combustion' };
  }

  if (scope === 'scope2') {
    const factor = EGRID_FACTORS[sourceRaw] ?? EGRID_FACTORS.CAMX;
    const amountMultiplier = unit === 'kwh' ? 0.001 : 1;
    return {
      factor: factor * (1 + TRANSMISSION_LOSS_RATE) * amountMultiplier,
      category: 'purchased_electricity',
    };
  }

  const factor = SCOPE3_FACTORS[sourceKey] ?? SCOPE3_FACTORS[category];
  if (factor == null) throw new Error(`Unsupported Scope 3 category/source: ${entry.category}/${entry.source}`);
  return { factor, category };
}

function calculateEntry(entry) {
  const amount = Number(entry.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Amount must be a non-negative number.');
  }

  const scope = normalizeScope(entry.scope);
  const factor = factorForEntry(entry);
  const co2e = round(amount * factor.factor);
  const category = factor.category;

  return {
    ...entry,
    scope,
    normalized_category: category,
    co2e_tonnes: co2e,
    factor: factor.factor,
    confidence: Number(entry.confidence) || CONFIDENCE_BY_CATEGORY[category] || 70,
  };
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
  const confidence = calculated.length ? Math.round(confidenceTotal / calculated.length) : 100;

  const result = {
    company_id: options.companyId || options.company_id || null,
    period: String(options.period || new Date().getFullYear()),
    total_emissions_tCO2e: total,
    by_scope: byScope,
    by_category: byCategory,
    confidence_score: confidence,
    methodology: 'EPA GHG Protocol + IPCC AR6',
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
      return date && date.getMonth() === index && date.getFullYear() === year;
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
    if (prev === 0) return 0;
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
  const lines = String(csv || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeKey);
  const required = ['scope', 'category', 'source', 'amount', 'unit'];
  for (const key of required) {
    if (!headers.includes(key)) throw new Error(`CSV is missing required column: ${key}`);
  }

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, i) => { row[header] = values[i] || ''; });
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) throw new Error(`CSV row ${index + 2} has an invalid amount.`);
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

function splitCsvLine(line) {
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
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
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
  SCOPE1_FACTORS,
  MOBILE_FACTORS,
  EGRID_FACTORS,
  SCOPE3_FACTORS,
  TRANSMISSION_LOSS_RATE,
  calculateEntry,
  summarizeEntries,
  buildTrend,
  toDashboardSummary,
  parseEmissionCsv,
  getComplianceStatus,
  buildFacilityEmissions,
};
