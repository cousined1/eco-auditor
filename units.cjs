// Unit conversion applied to an activity BEFORE its emission factor is looked
// up, and the strict parser for amounts written as text (audit K4, F-E-13).
//
// The catalog (emission-factors.json) has factors for a few units per source and
// matched them exactly, so "therm" for a gas bill, "ccf", refrigerant in "lb",
// waste in "tons", "km" and diesel in "L" were refused although each is an exact
// multiple of a unit the source has. This module never changes a factor: it
// turns the quantity into one of the source's own catalog units, and the caller
// stores both (activity_amount/activity_unit keep what was given; amount/unit
// hold the converted quantity the pinned factor applies to).
//
// A unit converts only into a catalog unit of the same kind, the catalog unit's
// first family below: kWh on a gas bill becomes MMBtu (energy to energy), but
// therms never become kWh of electricity, gallons never become cubic feet of
// gas and miles never become passenger-miles.
//
// Natural-gas VOLUMES (scf, ccf, MCF, m3) are converted to the catalog's volume
// unit (MCF), never through a heat content. The catalog's per-MCF factor
// (54.44 kg CO2) already carries EPA's default higher heating value of 1,026 Btu
// per scf (EPA GHG Emission Factors Hub 2025, Table 1: 0.001026 mmBtu/scf and
// 53.06 kg CO2/mmBtu; 53.06 x 1.026 = 54.44), so no second heat-content
// assumption is added here. A bill that states therms carries the utility's
// measured heat content: import therms when the bill has them. Cubic metres are
// taken at the same reference conditions as those cubic feet.
'use strict';

const { getSource } = require('./emission-factors.cjs');

// ─── Conversion constants ───────────────────────────────────────────────────
// NIST Special Publication 811 (2008 ed.), Guide for the Use of the
// International System of Units, Appendix B.8 (factors for units listed
// alphabetically):
const BTU_J = 1055.05585262; // British thermal unit (IT) = 1.055 056 E+03 J (exact: 1055.05585262 J)
const KWH_J = 3.6e6; //         kilowatt hour = 3.6 E+06 J (exact)
const FT3_M3 = 0.028316846592; // cubic foot = 2.831 685 E-02 m3 (exact: 0.3048 m cubed)
const GALLON_L = 3.785411784; // gallon (U.S.) = 3.785 412 E-03 m3 (exact: 231 in3)
const LB_KG = 0.45359237; //    pound (avoirdupois) = 4.535 924 E-01 kg (exact)
const SHORT_TON_LB = 2000; //   ton, short (2000 lb) = 9.071 847 E+02 kg
const MILE_KM = 1.609344; //    mile (international) = 1.609 344 E+03 m (exact)
// U.S. EIA, "Units and calculators explained: British thermal units (Btu)":
// 1 therm = 100,000 Btu; 1 dekatherm (Dth) = 10 therms = 1 MMBtu; Ccf = 100
// cubic feet, Mcf = 1,000 cubic feet. The catalog prices a therm the same way
// (natural_gas 5.306 kg/therm = 53.06 kg/MMBtu / 10); NIST B.8's therm (U.S.),
// 1.054 804 E+08 J, is within 0.03 % of it.
const THERM_BTU = 1e5;
const MMBTU_BTU = 1e6;

// Above 1e15 a JSON number stops holding integers exactly (server-entries.cjs).
const AMOUNT_MAX = 1e15;

// label: how the unit is shown. names: every accepted spelling, normalised as
// normalizeKey does. families: the unit's size in the base unit of each family
// it belongs to (electricity kWh, energy Btu, gas_volume ft3, liquid_volume L,
// mass kg, distance km, passenger_distance passenger-km); the FIRST family is
// the unit's own kind, the one a catalog unit accepts conversions into.
const UNITS = [
  { label: 'kWh', names: ['kwh', 'kilowatt_hour', 'kilowatt_hours'], families: { electricity: 1, energy: KWH_J / BTU_J } },
  { label: 'MWh', names: ['mwh', 'megawatt_hour', 'megawatt_hours'], families: { electricity: 1000, energy: (1000 * KWH_J) / BTU_J } },
  { label: 'GJ', names: ['gj', 'gigajoule', 'gigajoules'], families: { energy: 1e9 / BTU_J } },
  { label: 'MMBtu', names: ['mmbtu', 'mmbtus', 'million_btu'], families: { energy: MMBTU_BTU } },
  { label: 'Dth', names: ['dth', 'dekatherm', 'dekatherms', 'decatherm', 'decatherms'], families: { energy: MMBTU_BTU } },
  { label: 'therm', names: ['therm', 'therms', 'thm'], families: { energy: THERM_BTU } },
  { label: 'scf', names: ['scf', 'cf', 'ft3', 'cubic_foot', 'cubic_feet'], families: { gas_volume: 1 } },
  { label: 'ccf', names: ['ccf', 'hcf'], families: { gas_volume: 100 } },
  { label: 'MCF', names: ['mcf', 'mscf'], families: { gas_volume: 1000 } },
  // A gas volume for a gas priced per MCF, a liquid volume for a fuel priced per gallon or litre.
  { label: 'm3', names: ['m3', 'm³', 'cubic_meter', 'cubic_meters', 'cubic_metre', 'cubic_metres'], families: { gas_volume: 1 / FT3_M3, liquid_volume: 1000 } },
  { label: 'gallons', names: ['gal', 'gals', 'gallon', 'gallons', 'us_gal', 'us_gallon', 'us_gallons'], families: { liquid_volume: GALLON_L } },
  { label: 'liters', names: ['l', 'liter', 'liters', 'litre', 'litres'], families: { liquid_volume: 1 } },
  { label: 'g', names: ['g', 'gram', 'grams'], families: { mass: 0.001 } },
  { label: 'kg', names: ['kg', 'kgs', 'kilogram', 'kilograms'], families: { mass: 1 } },
  { label: 'lb', names: ['lb', 'lbs', 'pound', 'pounds'], families: { mass: LB_KG } },
  { label: 'short tons', names: ['short_ton', 'short_tons', 'us_ton', 'us_tons', 'ton', 'tons'], families: { mass: SHORT_TON_LB * LB_KG } },
  { label: 'metric tons', names: ['metric_ton', 'metric_tons', 'tonne', 'tonnes', 't'], families: { mass: 1000 } },
  { label: 'miles', names: ['mi', 'mile', 'miles'], families: { distance: MILE_KM } },
  { label: 'km', names: ['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres'], families: { distance: 1 } },
  { label: 'passenger-miles', names: ['passenger_mile', 'passenger_miles', 'pmi'], families: { passenger_distance: MILE_KM } },
  { label: 'passenger-km', names: ['passenger_km', 'passenger_kms', 'pkm', 'passenger_kilometer', 'passenger_kilometers', 'passenger_kilometre', 'passenger_kilometres'], families: { passenger_distance: 1 } },
];

// "tons" is read as US short tons, the US meaning; a metric-ton file says tonnes.
const AMBIGUOUS = { ton: 'short tons', tons: 'short tons' };

const FAMILY_LABELS = {
  electricity: 'Electricity',
  energy: 'Fuel and heat energy',
  gas_volume: 'Gas volume',
  liquid_volume: 'Liquid volume',
  mass: 'Mass',
  distance: 'Distance',
  passenger_distance: 'Passenger distance',
};

function normalizeKey(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/[\s/-]+/g, '_');
}

const UNIT_BY_NAME = new Map();
for (const unit of UNITS) {
  for (const name of unit.names) UNIT_BY_NAME.set(name, unit);
}

function kindOf(unit) {
  return Object.keys(unit.families)[0];
}

/**
 * How a quantity in `typed` becomes a quantity in one of `catalogUnits` (the
 * unit names a catalog source has factors for, in catalog order):
 *   { unit, ratio: 1, converted: false }    the same unit, in any accepted spelling
 *   { unit, ratio, converted: true, from }  a conversion: amount x ratio, in `unit`
 *   null                                    no unit of the same kind
 * `warning` is set when the spelling was ambiguous ("tons").
 */
function resolveUnit(catalogUnits, typed) {
  const key = normalizeKey(typed);
  if (!key) return null;
  const warning = AMBIGUOUS[key]
    ? '"' + String(typed).trim() + '" is read as US ' + AMBIGUOUS[key] + ' (2,000 lb); write "tonnes" for metric tons'
    : null;
  const withWarning = (result) => (warning ? { ...result, warning } : result);

  const exact = catalogUnits.find((name) => normalizeKey(name) === key);
  if (exact) return withWarning({ unit: exact, ratio: 1, converted: false });
  const from = UNIT_BY_NAME.get(key);
  if (!from) return null;
  const same = catalogUnits.find((name) => UNIT_BY_NAME.get(normalizeKey(name)) === from);
  if (same) return withWarning({ unit: same, ratio: 1, converted: false });
  for (const name of catalogUnits) {
    const to = UNIT_BY_NAME.get(normalizeKey(name));
    if (!to) continue;
    const kind = kindOf(to);
    if (from.families[kind] === undefined) continue;
    return withWarning({ unit: name, ratio: from.families[kind] / to.families[kind], converted: true, from: from.label });
  }
  return null;
}

/** amount x ratio, rounded to 12 significant digits so 1234.5 x 0.1 stores 123.45. */
function convertAmount(amount, ratio) {
  return Number((Number(amount) * ratio).toPrecision(12));
}

/**
 * Every unit a source accepts: its catalog units, then the units that convert
 * into them. For error messages and the CSV format panel.
 */
function acceptedUnits(catalogUnits) {
  const accepted = [...catalogUnits];
  const covered = new Set(catalogUnits.map((name) => UNIT_BY_NAME.get(normalizeKey(name))).filter(Boolean));
  const kinds = new Set([...covered].map(kindOf));
  for (const unit of UNITS) {
    if (covered.has(unit)) continue;
    if (Object.keys(unit.families).some((family) => kinds.has(family))) accepted.push(unit.label);
  }
  return accepted;
}

/** "one of: MMBtu, therms (or a unit converted into them: kWh, ccf ...)" for a source's units. */
function unitHint(catalogUnits) {
  const converted = acceptedUnits(catalogUnits).slice(catalogUnits.length);
  return 'one of: ' + catalogUnits.join(', ') +
    (converted.length ? ' (or a unit converted into them: ' + converted.join(', ') + ')' : '');
}

/** The unit kinds and their units, as the CSV format panel lists them (src/lib/csvTemplate.ts). */
function unitGroups() {
  return Object.keys(FAMILY_LABELS).map((family) => ({
    kind: FAMILY_LABELS[family],
    units: UNITS.filter((unit) => unit.families[family] !== undefined).map((unit) => unit.label),
  }));
}

// Digits with an optional decimal part, optionally grouped in threes by commas
// ("1,200.50"), or a bare fraction (".5"). Nothing else: Number() also accepts
// "0x1F" (31), "1e999" (Infinity) and " " (0), which is how a hex string once
// imported as 31.
const PLAIN_DECIMAL = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$|^\.\d+$/;
const SCIENTIFIC = /^[\d.,]*\d[eE][+-]?\d+$/;

/**
 * A non-negative amount written as text. Returns { value } or { error }, where
 * the error completes a sentence that starts with the field's name
 * ('amount "1e999" uses scientific notation ...').
 */
function parseStrictDecimal(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { error: 'is blank' };
  const unsigned = text.replace(/^[+-]/, '');
  if (text.startsWith('-') && PLAIN_DECIMAL.test(unsigned)) return { error: '"' + text + '" is negative' };
  if (SCIENTIFIC.test(unsigned)) {
    return { error: '"' + text + '" uses scientific notation: write the number in full' };
  }
  if (!PLAIN_DECIMAL.test(unsigned)) {
    return { error: '"' + text + '" is not a plain number: use digits, an optional decimal point and optional thousands commas (1,200.5)' };
  }
  const value = Number(unsigned.replace(/,/g, ''));
  if (!Number.isFinite(value) || value >= AMOUNT_MAX) return { error: '"' + text + '" is too large' };
  return { value };
}

/**
 * A calculator entry the engine can price (POST /api/calculate): an amount
 * written as text is parsed strictly, and a unit its source has no factor for is
 * converted when it can be, exactly as a CSV row is. Anything else is left for
 * the engine to report. Throws when an amount is not a plain number.
 */
function prepareCalculatorEntry(entry, index) {
  if (!entry || typeof entry !== 'object') return entry;
  let prepared = entry;
  if (typeof entry.amount === 'string') {
    const parsed = parseStrictDecimal(entry.amount);
    if (parsed.error) throw new Error('Entry ' + (index + 1) + ': amount ' + parsed.error + '.');
    prepared = { ...prepared, amount: parsed.value };
  }
  const source = getSource(prepared.category, prepared.source);
  const resolved = source && resolveUnit(Object.keys(source.units), prepared.unit);
  if (!resolved) return prepared;
  if (!resolved.converted) return { ...prepared, unit: resolved.unit };
  return {
    ...prepared,
    amount: convertAmount(prepared.amount, resolved.ratio),
    unit: resolved.unit,
    activity_amount: prepared.amount,
    activity_unit: prepared.unit,
  };
}

module.exports = {
  AMOUNT_MAX,
  acceptedUnits,
  convertAmount,
  parseStrictDecimal,
  prepareCalculatorEntry,
  resolveUnit,
  unitGroups,
  unitHint,
};
