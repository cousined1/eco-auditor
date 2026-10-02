// The CSV import template and the column reference on Data Intake (audit K4,
// F-C-06). Built in code from the factor catalog the importer reads
// (emission-factors.json), so the page cannot list a category, source or unit
// the importer refuses. tests/csv-template.test.ts runs this template through
// the importer (server-csv-import.cjs) and keeps UNIT_GROUPS equal to the
// conversions units.cjs applies.
import catalog from '../../emission-factors.json';

export interface CsvColumn {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

/** Every column the importer reads, in template order; the last two are not in the template. */
export const CSV_COLUMNS: readonly CsvColumn[] = [
  { name: 'scope', required: true, description: 'Scope 1, Scope 2 or Scope 3. It must be the scope of the category.' },
  { name: 'category', required: true, description: 'A category key from the list of allowed values.' },
  { name: 'source', required: true, description: 'A source key listed under that category. A Scope 3 spend row may name the supplier instead.' },
  { name: 'amount', required: true, description: 'The quantity as a plain number: 1200, 1,200 or 1200.5. No currency signs, no scientific notation.' },
  { name: 'unit', required: true, description: 'A unit listed for that source, or a unit converted into one of them (see Units).' },
  {
    name: 'date',
    required: false,
    description:
      'When the activity happened (for a bill, the last day of its period), as YYYY-MM-DD or M/D/YYYY. It decides the reporting year: a row without a date is counted in the year you import it, and the check before import says so.',
  },
  { name: 'facility_name', required: false, description: 'One of your facilities, spelled as in the app. A name that does not exist is imported without a facility, with a warning.' },
  { name: 'notes', required: false, description: 'Free text of up to 1,000 characters, such as an invoice number.' },
  { name: 'method', required: false, description: 'How the number was obtained. Defaults to calculation (spend_based for USD rows).' },
  { name: 'confidence', required: false, description: 'Your data-quality score from 0 to 100. Defaults to the category’s score.' },
];

const TEMPLATE_COLUMNS = CSV_COLUMNS.slice(0, 8).map((column) => column.name);

/**
 * Three example rows. Their notes start with "Example row", which the importer
 * flags, so a template uploaded unchanged is caught before anything is stored.
 */
export const TEMPLATE_EXAMPLE_ROWS: readonly (readonly string[])[] = [
  ['Scope 1', 'stationary_combustion', 'natural_gas', '1200', 'therms', '2025-01-31', '', 'Example row: January gas bill. Replace with your own data'],
  ['Scope 2', 'purchased_electricity', 'CAMX', '48000', 'kWh', '2025-01-31', '', 'Example row: January electricity bill'],
  ['Scope 1', 'mobile_combustion', 'diesel', '350', 'gallons', '2025-01-31', '', 'Example row: fleet fuel card'],
];

function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The template file's text: the header and the example rows, CRLF line endings (RFC 4180). */
export function buildCsvTemplate(): string {
  return [TEMPLATE_COLUMNS, ...TEMPLATE_EXAMPLE_ROWS].map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n';
}

export const TEMPLATE_FILENAME = 'ecoauditor-import-template.csv';

/** Saves the template as a file; nothing is fetched. */
export function downloadCsvTemplate(): void {
  const url = URL.createObjectURL(new Blob([buildCsvTemplate()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = TEMPLATE_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface CatalogSourceRef {
  readonly key: string;
  readonly label: string;
  readonly units: readonly string[];
}

export interface CatalogCategoryRef {
  readonly key: string;
  readonly label: string;
  readonly scope: number;
  readonly sources: readonly CatalogSourceRef[];
  /** The catalog's note on where a source belongs (sourceHint), or null. */
  readonly hint: string | null;
}

interface CatalogCategory {
  key: string;
  label: string;
  scope: number;
  sources: { key: string; label: string; units: Record<string, number> }[];
  /** Lists another category's sources (renewable_electricity: purchased_electricity's subregions). */
  sourcesFrom?: string;
  sourceHint?: string;
}

const CATEGORIES = catalog.categories as CatalogCategory[];

/** Every category the importer accepts, with its sources and their units, in catalog order. */
export const CATALOG_REFERENCE: readonly CatalogCategoryRef[] = CATEGORIES.map((category) => ({
  key: category.key,
  label: category.label,
  scope: category.scope,
  sources: (category.sourcesFrom ? CATEGORIES.find((other) => other.key === category.sourcesFrom)?.sources ?? [] : category.sources)
    .map((source) => ({ key: source.key, label: source.label, units: Object.keys(source.units) })),
  hint: category.sourceHint ?? null,
}));

/**
 * The kinds of unit the importer converts between (units.cjs unitGroups()). A
 * unit becomes one of the same kind the source is priced in: kWh of gas becomes
 * MMBtu, but therms never become kWh of electricity.
 */
export const UNIT_GROUPS: readonly { readonly kind: string; readonly units: readonly string[] }[] = [
  { kind: 'Electricity', units: ['kWh', 'MWh'] },
  { kind: 'Fuel and heat energy', units: ['kWh', 'MWh', 'GJ', 'MMBtu', 'Dth', 'therm'] },
  { kind: 'Gas volume', units: ['scf', 'ccf', 'MCF', 'm3'] },
  { kind: 'Liquid volume', units: ['m3', 'gallons', 'liters'] },
  { kind: 'Mass', units: ['g', 'kg', 'lb', 'short tons', 'metric tons'] },
  { kind: 'Distance', units: ['miles', 'km'] },
  { kind: 'Passenger distance', units: ['passenger-miles', 'passenger-km'] },
];
