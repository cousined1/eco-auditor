import {
  CATALOG_REFERENCE,
  CSV_COLUMNS,
  TEMPLATE_EXAMPLE_ROWS,
  UNIT_GROUPS,
  buildCsvTemplate,
  downloadCsvTemplate,
} from '@/lib/csvTemplate';

/**
 * The CSV format on Data Intake (audit F-C-06): the columns, a downloadable
 * template, the units and every allowed category, source and unit, generated
 * from the factor catalog the importer reads. A first import used to fail one
 * missing column at a time with no list of what the importer accepts.
 */
export default function CsvFormatPanel() {
  const required = CSV_COLUMNS.filter((column) => column.required).map((column) => column.name);
  const optional = CSV_COLUMNS.filter((column) => !column.required).map((column) => column.name);
  const example = buildCsvTemplate().trim();

  return (
    <section aria-labelledby="csv-format-heading" className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 id="csv-format-heading" className="text-sm font-semibold text-surface-800 dark:text-surface-200">
            CSV format
          </h2>
          <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
            One row per activity: a bill, a fuel delivery, a trip. Required columns: {required.join(', ')}. Optional:{' '}
            {optional.join(', ')}. The date column decides the reporting year. Every file is checked before anything is
            imported, and nothing is imported while it has errors.
          </p>
        </div>
        <button type="button" onClick={downloadCsvTemplate} className="btn-secondary shrink-0">
          Download template
        </button>
      </div>

      <details className="mt-3 text-sm text-surface-700 dark:text-surface-300">
        <summary className="cursor-pointer font-medium text-surface-800 dark:text-surface-200">
          Columns, units and allowed values
        </summary>

        <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-surface-500">Columns</h3>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-xs">
            <caption className="sr-only">CSV columns</caption>
            <thead>
              <tr className="border-b border-surface-200 text-left text-surface-500 dark:border-surface-700">
                <th scope="col" className="py-1.5 pr-3 font-medium">Column</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Required</th>
                <th scope="col" className="py-1.5 font-medium">What to put in it</th>
              </tr>
            </thead>
            <tbody>
              {CSV_COLUMNS.map((column) => (
                <tr key={column.name} className="border-b border-surface-100 align-top last:border-0 dark:border-surface-800">
                  <td className="py-1.5 pr-3 font-mono">{column.name}</td>
                  <td className="py-1.5 pr-3">{column.required ? 'Yes' : 'No'}</td>
                  <td className="py-1.5">{column.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-surface-500">
          Example ({TEMPLATE_EXAMPLE_ROWS.length} rows, as in the template)
        </h3>
        <pre className="mt-1 overflow-x-auto rounded bg-surface-50 p-2 text-2xs dark:bg-surface-800">{example}</pre>
        <p className="mt-1 text-xs text-surface-500">
          Replace the example rows with your own: a file that still contains them is flagged before import.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-surface-500">Units</h3>
        <p className="mt-1 text-xs">
          Use a unit listed for the source below, or one of the same kind, which is converted before the emission factor
          is applied (the row keeps the amount you entered). A unit is only ever converted into the same kind: therms
          never become kWh of electricity. “tons” are read as US short tons; write “tonnes” for metric tons. Natural-gas
          volumes are priced with EPA’s per-cubic-foot factor, which assumes 1,026 Btu per standard cubic foot (EPA GHG
          Emission Factors Hub 2025, Table 1); if your bill states therms, import therms.
        </p>
        <ul className="mt-1 space-y-0.5 text-xs">
          {UNIT_GROUPS.map((group) => (
            <li key={group.kind}>
              <span className="font-medium">{group.kind}:</span> {group.units.join(', ')}
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-surface-500">Allowed values</h3>
        <p className="mt-1 text-xs">
          Use the key in the category and source columns. Scope 3 categories need a plan that includes Scope 3.
        </p>
        <div className="mt-1 space-y-1">
          {CATALOG_REFERENCE.map((category) => (
            <details key={category.key} className="rounded border border-surface-100 px-2 py-1 dark:border-surface-800">
              <summary className="cursor-pointer text-xs">
                <span className="font-mono">{category.key}</span> · {category.label} · Scope {category.scope}
              </summary>
              {category.hint && <p className="mt-1 text-2xs text-surface-500">{category.hint}</p>}
              <ul className="mt-1 space-y-0.5 pb-1 text-2xs">
                {category.sources.map((source) => (
                  <li key={source.key}>
                    <span className="font-mono">{source.key}</span> ({source.label}): {source.units.join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </details>
    </section>
  );
}
