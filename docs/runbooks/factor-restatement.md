# Factor catalog 2026-09-30: deploy order and restating older entries

Audit K7 (F-E-02, F-E-06, F-E-09, F-E-10, F-E-15, F-E-17). Drafted 2026-09-30. Nothing here has been run
against production. **Every SQL block below is a draft: DO NOT RUN without review.**

## What changed, and what did not

`emission-factors.json` is now catalog **2026-09-30**: corrected Scope 1 factors (fuel oil No. 4 and No. 6,
lignite, coal split by rank, LNG and CNG instead of "natural gas vehicle", CH4 and N2O added to fuels
burned on site, rail per short ton-mile, steam and hot water per mmBtu), 13 former internal estimates
replaced by EPA GHG Emission Factors Hub 2025 and UK DESNZ 2026 rows, and GHG Protocol classification as
data: biogenic CO2 from wood and R-22 (non-Kyoto) reported beside Scope 1, a renewable contract priced at
the site's grid factor location-based and at zero market-based, own-fleet distance in Scope 1.

`emission-factors.v1.json` is catalog **2026-07-24**, byte for byte what priced every row stored before
this change. It is frozen: `tests/catalog-version.test.ts` pins its SHA-256.

**How a row is priced** (`emission-factors.cjs` `catalogFor`, `emissions-engine.cjs`):

| Row | Factor | Classification |
|---|---|---|
| CSV import or calculator row with no `catalog_version` | frozen 2026-07-24 catalog | 2026-07-24 rules (wood and R-22 in Scope 1, RENEWABLE at 0 in Scope 2) |
| K2 entry-API row pinned to `2026-07-24+9841b57be1f6` | its stored `factor_value` | 2026-07-24 rules |
| Row pinned to `2026-09-30+...` (new entries, and CSV imports once K4 pins them) | its stored `factor_value` | 2026-09-30 rules |
| `/api/calculate` preview | current catalog | 2026-09-30 rules |

So deploying this changes **no stored row's figure**: every existing total, scope split, confidence score,
trend and facility figure stays identical (`tests/legacy-row-invariance.test.ts`). New entries get the
corrected catalog. A period's confidence score becomes emissions-weighted once it holds an entry priced
with the 2026-09-30 catalog; a period of older entries only keeps the simple average it has always shown.

## Deploy order (each step before the next)

1. **K3 report snapshots**: `migrations/20260930110000_report-snapshots.sql` (`npm run db:migrate`), then
   the K3 server code. Issued reports are then stored bytes, so nothing here can change a report someone
   already holds or signed off.
2. **K2 entry API with per-row pinning**: `migrations/20260930100000_entry-provenance-and-idempotency.sql`,
   then the K2 code (already the base of this change).
3. **K4 CSV import pinning** (same release as this catalog, or before it): CSV rows must be priced with
   `catalog_version: CATALOG_VERSION` and store `factor_value`, `factor_source` and `catalog_version`.
   Until K4 ships, CSV imports are priced and classified with the frozen 2026-07-24 catalog (consistent,
   no restatement, but without the corrections).
4. **This catalog (K7), together with its second step** (the report and PDF lines in `src/lib/reports/*`:
   location- and market-based Scope 2, the biogenic and non-Kyoto memo lines, the excluded-rows line, the
   weighted-or-unweighted confidence label, one catalog identity per report). Never deploy the catalog
   without the second step: a report would total wood CO2 and R-22 out of Scope 1 without printing the
   memo lines. Both are in this change, so one image carries them; do not cherry-pick. No migration.
   The runtime image must contain `emission-factors.v1.json` (the Dockerfile COPY line does;
   `tests/dockerfile-runtime-deps.test.ts` checks the require graph).

After deploying, check read-only that nothing moved: for two or three tenants, compare
`GET /api/emissions/summary?period=<year>` for last year and this year before and after the deploy.
The totals, scopes and `confidence_score` must be identical; the new fields
(`scope2_market_co2e_tonnes`, `biogenic_co2_tonnes`, `non_kyoto_co2e_tonnes`) show market-based equal to
location-based and zero memo lines for older data.

## Owner decisions

1. **Restate older entries or not.** Options: never (older entries keep 2026-07-24 figures forever),
   all tenants at a date you announce, or opt-in per tenant (a customer asks). Restating changes past
   totals on the dashboard; it never changes an issued report (K3 snapshots).
2. **Keep the frozen catalog forever.** Recommended while any row resolves against it (every unpinned
   row does). It can be retired only after every row is pinned (explicitly to 2026-07-24 or restated).
3. **Which internal estimates to replace next.** 18 of 92 factors are still internal estimates, all
   flagged provisional: spend-based Scope 3 (9), purchased-goods mass factors (5), process emissions (3)
   and remote commuting (1). Car pool is also provisional (EPA's passenger-car factor divided by an
   assumed 2 occupants). Spend factors need a NAICS mapping and a dollar-year rule (USEEIO v1.3 is in
   2022 USD), which is a product decision.

## Restating a tenant (only after decision 1)

### 1. Snapshot first

- Make sure every report the tenant relies on exists as a K3 snapshot (generate one per period that
  matters): those keep the old figures whatever happens to the rows.
- Back up the rows (DO NOT RUN without review):

```sql
-- DO NOT RUN without review. Draft, K7 2026-09-30.
CREATE TABLE IF NOT EXISTS public.emission_entries_restatement_backup
  (LIKE public.emission_entries INCLUDING DEFAULTS);
ALTER TABLE public.emission_entries_restatement_backup
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz DEFAULT now();
INSERT INTO public.emission_entries_restatement_backup
  SELECT e.*, now() FROM public.emission_entries e WHERE e.company_id = :company_id;
```

### 2. Dry run (read-only)

```
DATABASE_URL=... node scripts/restate-legacy-rows.cjs --database --company <id>          # readable report
DATABASE_URL=... node scripts/restate-legacy-rows.cjs --database --company <id> --json > restate-<id>.json
```

The session is `BEGIN READ ONLY`; the script has no `--apply`. For each year it prints old and new
Scope 1, Scope 2 location- and market-based, Scope 3, total, biogenic and non-Kyoto lines and the
confidence score, then every row with its old and new tCO2e and reporting line. Keep the JSON: it is
the restatement note for the tenant (old versus new, per row) and the input for step 4.

### 3. Rows that need a person, not a script

`status: "needs-mapping"` rows cannot be re-priced automatically because the new catalog asks for
information the row does not hold. Each needs a decision with the customer:

| Old source | Why | What to ask |
|---|---|---|
| `purchased_electricity/RENEWABLE` | location-based needs the site's grid | the site's eGRID subregion; re-enter as `renewable_electricity/<subregion>` |
| `stationary_combustion/coal` | no rank | anthracite, bituminous, sub-bituminous, lignite or mixed commercial/industrial |
| `mobile_combustion/natural_gas_vehicle` | no fuel basis | LNG gallons, or CNG in scf |
| `transportation/*` (own fleet distance) | own fleet is Scope 1, third-party freight is Scope 3 | whose vehicles; own fleet -> `mobile_combustion/fleet_*` in vehicle-miles |
| `transportation/rail` in miles | the factor is per short ton-mile | tonnage carried |
| `purchased_heat_steam/steam` or `hot_water` in lb | per mmBtu only | the supplier's enthalpy (Btu per lb) |
| `employee_commuting/public_transit` | no mode | bus, commuter rail or transit rail |

`status: "no-activity"` rows (a CO2e total typed in) keep their value: there is nothing to re-price.

### 4. Apply, one transaction per tenant (DO NOT RUN without review)

Write one UPDATE per `restatable` row from the dry-run JSON (`rows[].proposed_pin`). The guard on
`catalog_version` makes a statement touch nothing if the row changed since the dry run; every statement
must report exactly one row, otherwise ROLLBACK.

```sql
-- DO NOT RUN without review. Draft, K7 2026-09-30. One transaction per tenant.
BEGIN;
-- Repeat per restatable row, with the values from restate-<id>.json:
UPDATE public.emission_entries
   SET factor_value    = :proposed_factor_value,
       factor_source   = :proposed_factor_source,
       catalog_version = :proposed_catalog_version,      -- '2026-09-30+...'
       co2e_kg         = :proposed_co2e_kg,
       activity_amount = COALESCE(activity_amount, amount),
       activity_unit   = COALESCE(activity_unit, unit)
 WHERE id = :id
   AND company_id = :company_id
   AND catalog_version IS NOT DISTINCT FROM :catalog_version_seen_in_dry_run;
-- expect: UPDATE 1 for every statement
COMMIT;
```

Then re-run the dry run: the tenant should show 0 restatable rows, and each year's "old" figures should
equal the "new" figures of the first run. Tell the customer which years changed and by how much (the
JSON is the record).

### Undo (DO NOT RUN without review)

```sql
-- DO NOT RUN without review. Restores the rows as backed up in step 1.
BEGIN;
UPDATE public.emission_entries e
   SET factor_value = b.factor_value, factor_source = b.factor_source, catalog_version = b.catalog_version,
       co2e_kg = b.co2e_kg, activity_amount = b.activity_amount, activity_unit = b.activity_unit
  FROM public.emission_entries_restatement_backup b
 WHERE b.id = e.id AND b.company_id = e.company_id AND e.company_id = :company_id
   AND b.backed_up_at = :backed_up_at;
COMMIT;
```

## Releasing the next catalog version

See the note in `emission-factors.versions.json`: freeze the current file as `emission-factors.v2.json`,
require() it in `emission-factors.cjs`, give `emission-factors.json` a new `version`, and record both
hashes. Rows pinned to 2026-09-30 then keep resolving against the frozen copy.
