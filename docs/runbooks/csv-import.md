# CSV import: check, import, history and undo

Audit AUDIT-RUN-20260929 cluster K4 (F-E-04 = F-B-06, F-C-06, F-E-13, F-R2-01, F-E-18, part of F-B-16).

## Why

The importer stored every valid row of a file and skipped the bad ones, so the fixed re-upload counted the good rows
twice and spent a second import. The same file uploaded twice was counted twice with no message (the audit's lane E
file, priced with the 2026-07-24 catalog: FY2026 Scope 1 39.306 t and Scope 2 19.504 t, counted again by a second
upload). Rows had no link to their upload,
so nothing could be taken back. `created_at` was overwritten with the row's date, so nobody could tell when a number
entered the system. Units outside the catalog's own spelling (therm, ccf, lb, km) were refused, and amounts were read
with `Number()`, which takes `0x1F` as 31.

## How it works now

| Step | Route | What it does |
|---|---|---|
| Check | `POST /api/ingest/csv?dry_run=1` | Validates the whole file, prices every row, lists every error and warning, the unit conversions and the tonnes as the Dashboard will show them once stored: the valid rows go through the Dashboard's own `summarizeEntries` and `toDashboardSummary` (all years of the file together). `tonnes` has the scopes and their `total`, and beside them `scope2_market`, `biogenic_co2` (wood and other biomass) and `non_kyoto` (R-22 and other non-Kyoto refrigerants). Stores nothing and spends no import. |
| Import | `POST /api/ingest/csv` | Stores all rows or none, as one import, in one transaction under a lock on the company row. The quota count, the duplicate check and the insert all happen under that lock. |
| History | `GET /api/ingest/imports` | The company's imports, newest first: file name, rows, warnings, status, rows still present, signed-off reports whose period holds its rows. |
| Undo | `POST /api/ingest/imports/:id/undo` | Deletes the import's rows and keeps the import listed as undone. Needs no paid plan: removing your own data stays possible after a trial ends. |

The Data Intake page runs the check when a file is chosen and shows the result per file; importing is a separate button.
Every call goes through `apiFetch` with a 15 s deadline. The history and the undo are on the "Uploaded Files" tab.

Answers from the import step:

| Status | `code` | Meaning |
|---|---|---|
| 200 | | Imported (`replayed: true` when the same Idempotency-Key and file were imported already: the stored import is returned) |
| 409 | `duplicate_file` | This company already has a committed import of the same file ("already imported on <date> (n rows)"). Nothing stored. Send `?on_duplicate=replace` to undo that import and store the file, or `?on_duplicate=import_anyway` to store it again |
| 422 | `invalid_file` | The file has errors (the first 100 listed, then "... and N more errors."). Nothing stored |
| 422 | `idempotency_key_reused` | The Idempotency-Key was used for a different file or a manual entry |
| 402 | `upgrade_required` | Monthly import limit reached, or Scope 3 rows on a plan without Scope 3 (the whole file is refused) |
| 400 | | Bad `on_duplicate` or Idempotency-Key |
| 503 | | Database unavailable. Nothing stored |

"The same file" is the SHA-256 of its text after removing a byte-order mark, turning CRLF and CR into LF and dropping
whitespace at the end of the file, so a copy saved on another machine still matches. Different files with rows that equal stored rows (same
scope, category, source, amount, unit, date and facility) are imported, with a warning naming the lines: two identical
deliveries can be real data, so they are never dropped.

Each imported row has `import_id`, `imported_at` (the import's own time), the factor it was priced with (`factor_value`
kg CO2e per `unit`, `factor_source`, `catalog_version`), `activity_amount`/`activity_unit` as the file gave them, and a
per-row `idempotency_key` of the form `csv:<Idempotency-Key>:<line>` when the upload sent a key. `created_at` is the
insert time. `updated_at` is set by a trigger on every later change.

### Which catalog prices an import

A new import is priced and pinned with the current catalog (`emission-factors.json`, version 2026-09-30), like a manual
entry. Rows stored before keep the catalog they name; rows without a `catalog_version` (every CSV row imported before
this release) are priced by the frozen 2026-07-24 catalog (`emission-factors.v1.json`), so no stored total moves.
What that means for a file:

- A source the current catalog does not have is an error on its line that lists the category's sources. Generic `coal`
  is now keyed by rank (`coal_anthracite`, `coal_bituminous`, `coal_subbituminous`, `lignite_coal`,
  `coal_mixed_commercial`, `coal_mixed_industrial`). `purchased_electricity` `RENEWABLE` is now the category
  `renewable_electricity` with the site's eGRID subregion as the source, and the error says so. A file imported before
  this release and uploaded again now is refused with that error. That is intended: a new import is priced by the
  current catalog, and the rows already stored are not touched.
- `refrigerant_r22` is reported beside the scopes (a non-Kyoto gas), in the check's figures as on the Dashboard. For
  `wood`, Scope 1 holds the CH4 and N2O only; its CO2 is biogenic and reported outside the scopes. A
  `renewable_electricity` row counts its grid factor location-based and 0 market-based.
- `landfill` is priced per short ton, so "tons" is not converted for it (the "tons" warning still shows).

### Units

`units.cjs` converts a unit the catalog has no factor for into one it has, before the factor lookup, and is shared by
the importer, `POST /api/entries` and `POST /api/calculate`. A conversion changes no factor. A converted row stores the converted
quantity in `amount`/`unit` and the file's quantity in `activity_amount`/`activity_unit` (1,000 ccf is stored as 100 MCF
and shown as "1,000 ccf (100 MCF)").

A unit converts only into a catalog unit of its own kind (constants from NIST SP 811 Appendix B.8 and EIA; comments in
`units.cjs`):

- Electricity: kWh, MWh. Fuel and heat energy: kWh, MWh, GJ, MMBtu, Dth, therm. kWh on a gas bill becomes MMBtu, but a
  therm never becomes kWh of electricity.
- Gas volume: scf, ccf, MCF, m3, converted to the source's volume unit (MCF for natural gas), never through a heat content.
  The catalog's 54.4953 kg/MCF is EPA's own per-scf factor, which assumes 1,026 Btu/scf (EPA GHG Emission Factors
  Hub 2025, Table 1: 0.05444 kg CO2, 0.00103 g CH4 and 0.00010 g N2O per scf; at AR5 GWP-100, 1,000 x (0.05444 +
  0.00103 x 28 / 1000 + 0.00010 x 265 / 1000) = 54.4953), so no second heat-content assumption is added.
- Mass: g, kg, lb, short tons, metric tons. "ton"/"tons" is read as US short tons (2,000 lb), with a warning.
- Liquid volume: gallons, liters, m3. Distance: miles, km. Passenger distance: passenger-miles, passenger-km (a mile never
  becomes a passenger-mile).

Amounts must be plain decimals: digits, one optional decimal point, optional thousands commas ("1,200.5"). Negative
numbers, hex, scientific notation, blanks and values of 10^15 or more are errors on their line.

### Reporting period

The activity date decides the period everywhere (Dashboard, trend, reports, the signed-off lookup):
`COALESCE(activity_date, created_at::date)`. A row without a date is counted in the year it was imported, and the check
says so before the import ("1 row (line 3) has no date: counted in 2026, ...").

## Deploy order

1. **Migration** `migrations/20260930120000_csv-import-batches.sql`: needs `npm run db:migrate` before the deploy. Additive
   only: nullable columns on `csv_import_events` (`file_sha256`, `status`, `warning_count`, `original_filename`,
   `undone_at`) and `emission_entries` (`import_id`, `updated_at`), two partial indexes, the `updated_at` trigger, and a
   trigger that keeps the browser roles (`anon`, `authenticated`) from setting or changing `import_id` until K2's deferred
   REVOKE lands. It needs K2's `20260930100000` and K3's `20260930110000` (they sort first). Verify with the queries at
   the end of the file.
2. **Deploy** the image. `server-csv-import.cjs`, `server-csv-import-routes.cjs`, `server-csv-import-store.cjs` and
   `units.cjs` are in the Dockerfile's runtime `COPY` line.
3. **Check on production** with the owner's own synthetic account only, through the app:

| Check | Expected |
|---|---|
| Download the template on Data Intake, choose it unchanged | 3 rows ready, warning that they are the template's example rows |
| Import a 2-row file | "Imported 2 rows"; the Dashboard shows them in the year of their dates |
| Choose the same file again | "this file was imported before", with Replace and Import anyway |
| A file with one bad unit | the error on its line, "nothing was imported"; no new line under Uploaded Files |
| Uploaded Files, Undo on the import | rows removed, import listed as undone; the imports left this month do not go back up |

## Operations

Imports of one company (read-only):

```sql
SELECT id, created_at, original_filename, row_count, warning_count, status, undone_at
  FROM public.csv_import_events WHERE company_id = <id> ORDER BY created_at DESC;
SELECT import_id, count(*) FROM public.emission_entries WHERE company_id = <id> GROUP BY import_id;
```

- **Undo** is the customer's action in the app; it is logged (`CSV import undone`, with user id, rows removed and any
  signed-off report ids) and the import row keeps `status = 'undone'` and `undone_at`. Support should not delete rows by
  hand: an import whose rows were deleted outside the app still shows as committed.
- **Signed-off reports** are not changed by an undo: K3 froze their PDF and snapshot. If an import's rows fall in the
  period of a final report, the app asks first: "This import falls in a period with a signed-off report. Undoing it will
  not change that report; generate a new report afterwards." The API answers 409 `signed_off_report` until the request
  carries `"confirm_signed_off": true`.
- **Quota**: one import per committed upload, counted from `csv_import_events` rows created this calendar month, whatever
  their status. Checks, refused files, 409s and replays write no row. An undo refunds nothing; a replace counts as an
  import.
- **Imports before this release** have `status` NULL ("legacy"): their rows are not linked, so they cannot be undone
  from the history. Their entries can still be deleted one by one in the calculator.

### Rows imported before this release

The old importer wrote the row's date into both `activity_date` and `created_at`; calculator rows have their insert
time in `created_at`. The period rule reads `activity_date` first and `created_at` only when it is empty, so every
existing row stays in the year it was in, and no backfill is needed (`tests/csv-import-route.test.ts`, "legacy rows keep
their FY totals"). Do not rewrite `created_at` on old rows: it would move undated rows between years. For old CSV rows,
`created_at` is the activity date, not the time they were stored; `imported_at` is NULL on them, and that is the honest
answer.

### What a warning means

| Warning | Action for the customer |
|---|---|
| has no date: counted in <year>, the year of the import | Add a date (for a bill, the end of its period) |
| dated after today | Check the date; the row is imported as given |
| names the facility "X", which does not exist | Create the facility first, or fix the name; otherwise imported without a facility |
| are the template's example rows | Replace or delete the example rows |
| "tons" is read as US short tons | Write "tonnes" for metric tons |
| one row of N tCO2e is unusually large | Check the amount and the unit (threshold 100,000 t per row) |
| columns X are not used and will be ignored | Rename the column if it was meant to be read |
| This file was already imported on <date> | Shown when importing anyway: every row will count twice |
| match an entry already stored | Two identical deliveries can be real; if not, do not import them again |
| read as Windows-1252 (Data Intake only) | Check accented names; save as "CSV UTF-8" if they look wrong |

A file that is not UTF-8 when it reaches the server (the page converts Windows-1252 before sending) is refused with the
line of the first unreadable character.
