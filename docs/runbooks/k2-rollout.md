# K2 rollout: server-owned writes for emission entries and facilities

Audit AUDIT-RUN-20260929 cluster K2 (F-D-01, F-E-05, F-E-12, F-B-08, F-X1-01; review R1 section 4c).

## Why

The calculator and onboarding wrote `emission_entries` and `facilities` straight through the InsForge records API as the
browser role `authenticated`. Row-level security there checks ownership only, so none of the Express checks ran:
a Starter, expired or cancelled account could add Scope 3 rows and unlimited facilities, the browser's own CO2e was stored
as sent (amount 1 with co2e_kg 999,999 was accepted), every manual row got confidence 85 and no activity date, and the
dashboard stayed stale for up to 5 minutes.

The fix has two halves that must ship in this order:

- **Enabling path (steps 1 to 3):** the server write API (`GET/POST /api/entries`, `PATCH/DELETE /api/entries/:id`, the
  locked `POST /api/companies/:id/facilities`) and the SPA moved onto it. After step 3 the app no longer writes either table
  through the records API.
- **Enforcement (step 4):** revoke the browser role's INSERT/UPDATE/DELETE on both tables. Until then, a hand-made
  records-API call (browser console, an old cached bundle) can still write past every limit.

Shipping step 4 before step 3 is live everywhere breaks entry saving, entry deletion and facility creation for every customer.

## Step 0: prove the production state (owner, read-only, 5 minutes)

In the InsForge SQL editor. Nothing here writes.

```sql
SELECT has_table_privilege('authenticated','public.emission_entries','INSERT'),
       has_table_privilege('authenticated','public.facilities','INSERT'),
       has_table_privilege('authenticated','public.emission_entries','DELETE');

SELECT tablename, policyname, cmd, roles, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('emission_entries','facilities');
```

Expected today: `true | true | true`, and policies that carry the ownership predicate only. That confirms K2 on production
without a single write. Keep the output with the change record.

## Step 1: additive migration (safe before any code)

`migrations/20260930100000_entry-provenance-and-idempotency.sql` adds nullable columns (`activity_amount`,
`activity_unit`, `factor_value`, `factor_source`, `catalog_version`, `idempotency_key`, `imported_at`), a partial unique
index on `(company_id, idempotency_key)`, and the trigger `emission_entries_guard_browser_writes`: a write as `anon` or
`authenticated` (the records API) cannot set these columns, and cannot change them or the calculation of a row the server
priced. The engine trusts a stored `factor_value`, so without the trigger a console call could zero a server-priced row
until step 4. No backfill, no revoke, RLS unchanged. The code that runs today never reads these columns and the old SPA
never sends them, so it is safe to apply first and safe to leave if later steps are rolled back.

1. `npm run db:migrate`
2. Verify (queries at the end of the migration file): 7 columns, 1 index, 1 trigger.
3. `npm run db:migrate:check` must report the schema up to date before step 2.

## Steps 2 and 3: deploy the server and the SPA (one deploy)

The SPA is built into `static/` by the same Docker image that runs `server.cjs`, so the server API and the SPA that uses it
ship together. `server-entries.cjs` and `server-entry-routes.cjs` must be in the runtime `COPY` line of the Dockerfile
(`tests/dockerfile-runtime-deps.test.ts` fails otherwise).

Verify on production with the owner's own synthetic account (verified email, Starter trial). Normal product use only:

| Check | Expected |
|---|---|
| Add a Scope 2 electricity entry dated last year | Saved; the entry list shows its activity date, activity, factor and dataset (eGRID2023) |
| Dashboard right after | The entry counts in last year's total, immediately (not after 5 minutes) |
| Choose Scope 3 in the calculator | Upgrade prompt, form disabled |
| Add a second facility (the Settings facility card, once K5 ships it; onboarding adds only the first) | Refused with the Starter facility limit |
| Settings, Export my data | Entries carry `activity_date`, `activity_amount`, `factor_value`, `factor_source`, `co2e_kg`; `reports` and `csvImports` arrays present |

Clean up afterwards with Settings, "Delete my audit data". Never backdate billing columns on production.

**Old bundles.** A browser tab opened before the deploy keeps running the old SPA, which still writes through the records API,
until it reloads. Wait before step 4 until no such writes appear. Old-bundle calculator rows are recognisable (no provenance,
CO2e stored in `amount`):

```sql
SELECT count(*) FROM public.emission_entries
 WHERE created_at > '<deploy time, UTC>' AND activity_amount IS NULL AND unit = 'kg CO2e';
```

Run it daily; when it stays at 0 for several days of normal use, go to step 4. Rows written by old bundles stay as they are
(legacy rows, summarised from the catalog as before).

Two more checks for hand-made records-API writes, run with it (read-only):

```sql
-- Pins no server wrote. Expected: no rows (the step 1 trigger blocks them). List BOTH catalog identities your servers
-- write, not only the image's own: a legacy row (no pin) whose date, facility or notes are edited is written with the
-- FROZEN identity (server-entries.cjs validateEntryEdit), and those rows are legitimate. This prints both for an image
-- (run it in each image still serving; the values change with every catalog change, K7):
--   node -p "const f=require('./emission-factors.cjs');[f.CATALOG_VERSION,f.LEGACY_CATALOG_VERSION].join(',')"
SELECT catalog_version, count(*) FROM public.emission_entries
 WHERE factor_value IS NOT NULL
   AND (catalog_version IS NULL OR catalog_version NOT IN ('<image identity>', '<frozen identity>'))
 GROUP BY catalog_version;

-- Companies holding more facilities than their plan allows (caps from plan-limits.json: Starter 1, Growth 5, Pro none;
-- a trial counts as Starter). A downgraded company keeps its facilities, so a hit is a company to look at, not proof.
SELECT c.id AS company_id, COALESCE(c.subscription_plan, 'starter') AS plan, count(*) AS facilities
  FROM public.facilities f JOIN public.companies c ON c.id = f.company_id
 GROUP BY c.id, c.subscription_plan
HAVING count(*) > CASE COALESCE(c.subscription_plan, 'starter') WHEN 'starter' THEN 1 WHEN 'growth' THEN 5 ELSE 2147483647 END;
```

A row in the first result means the trigger is missing (check its verify query) or the platform bypassed it; a row in the
second, created after the deploy, is a facility added past the cap through the records API, which only step 4 closes.

Rollback of steps 2 and 3: redeploy the previous image. The step 1 columns stay; the old code ignores them.

## Step 4: enforcement (the deferred REVOKE)

`docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql` revokes INSERT, UPDATE and DELETE on
`emission_entries` and `facilities` from `anon` and `authenticated` and drops the six `*_owner_insert/_update/_delete`
policies. SELECT stays (owner decision 1 below). It is deliberately not in `migrations/`.

1. Copy the file into `migrations/` under a NEW timestamp, later than every migration applied by then.
2. `npm run db:migrate`
3. Run the verify queries in the file: `f|f|f|f|f|f|t|t`, and only `emission_entries_owner_select` and
   `facilities_owner_select` left.
4. Repeat the step 2/3 checks: the app must still save, edit and delete entries and add facilities (the server has its own
   database role).
5. Re-run the verify queries after every later migration and InsForge platform update. If INSERT ever comes back, the
   platform re-applied its managed grants and the hole is open again.

Rollback: InsForge migrations are forward-only. A rollback is a NEW migration with the re-grant and policies quoted at the
end of the draft file. It reopens F-D-01; use it only if the server write API itself has to be rolled back.

## Step 5: regression checks

- `npx vitest run tests/entries-write-api.test.ts` (Docker; explicit path). Among others it applies the step 4 draft to a
  throwaway database and checks that the browser role can no longer write either table, can still read, and that the API
  still writes.
- On the local e2e stack, re-run the review R1 probe phases gate-a, gate-b and expired (`evidence\w2-r1\r1-probe.mjs` in the
  audit folder): records-API insert and delete now 403 (Postgres 42501), Express 201/402 as before.
- The non-Docker guards: `tests/sdk-write-guard.test.ts` (no SDK write to either table anywhere in `src/`),
  `tests/entry-routes-guards.test.ts` (every server statement on either table is scoped by `company_id`; only outages
  answer 503), `tests/entry-validation.test.ts`, `tests/facility-cap-lock.test.ts`, `tests/entries-route-nodb.test.ts`,
  `tests/calculator-entries-flow.test.tsx`.

## Owner decisions (each reversible)

1. **Reads after the trial ends.** In the app the calculator's entry list (`GET /api/entries`) is plan-gated like the
   dashboard, so it pauses at trial end. The data stays available: Settings, "Export my data" is not plan-gated, and the
   records API keeps SELECT for the owner. Public copy may say the app is paused and the data can be exported; it must not
   say the data is removed or locked (src/content/claims.ts, `no-card-trial`). To hide the data from the records API too,
   add `REVOKE SELECT ON public.emission_entries FROM anon, authenticated` in step 4: the SPA no longer reads entries through
   it (it still reads `companies` and `facilities` there, so keep SELECT on those).
2. **Expired accounts may delete their entries.** `DELETE /api/entries/:id` has no `requirePlan`, like export and
   "Delete my audit data", because deleting your own data is a data-subject right. To reverse, add `requirePlan('starter')`
   to that route in `server.cjs`.
3. **The activity date is required and has no default** (1990-01-01 to today, plus one day for time zones east of UTC). A
   default of "today" would book last year's bills into this year again, which is the F-E-05 defect.
4. **Idempotency keys live on the entry row.** A retried save returns the stored row (200, `replayed: true`); the same key
   with a different entry is 422. Deleting the entry frees its key.
5. **Manual entries now store the activity in `amount`/`unit`** (as CSV rows do), with `activity_amount`/`activity_unit`
   saying so explicitly. Calculator rows saved before stay in the old shape (kg CO2e in `amount`); nothing is backfilled.

## What this does not cover (next items)

- CSV rows are not pinned yet: the import path does not write `factor_value`, `factor_source`, `catalog_version` or
  `imported_at`. Until it does (K4), a factor correction (K7) would restate CSV history. Pin CSV rows before any factor change.
- The summary cache is per process: with more than one replica, other replicas serve old totals until the 5-minute TTL
  (F-G-10). Production runs one replica today.
- No edit history: an edit replaces the row's values (F-B-17 asks for a history row).
