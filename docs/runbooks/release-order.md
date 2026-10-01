# Release order: the audit-fix change set, in one checklist

Audit AUDIT-RUN-20260929 fix run FIX-RUN-20260930-q4d8 produced changes that depend on each other: five additive
database migrations, a new server image, production data fixes, configuration changes and one deliberately late
enforcement step. Each change has its own runbook; this page is the ONE ordered list that ties them together. Follow the
steps in order. Steps marked OWNER need an account only you hold (InsForge, Railway, Stripe, GitHub, Google Tag Manager).

Nothing in the run applied any of this. A step is done only when its check passes.

## The four rules behind the order

1. **Migrations first, code second, enforcement last.** Every migration in this set is additive (new nullable columns,
   new tables, create-if-missing triggers). The old code runs on the new schema; the new code does NOT run on the old
   schema (for example the signup insert names `companies.auto_provisioned`). So migrate before you deploy the image.
2. **The live blog rows are fixed before the server-rendered blog ships.** The old blog rows still carry the retracted
   claims in their body and their FAQ; the new server renders those rows as written
   ([blog-rows-update.md](blog-rows-update.md)). Shipping the renderer first publishes the old claims on crawlable pages.
3. **Credentials are rotated before anything records a baseline of the secret scan.** A baseline taken now would bless
   the leaked values in git history ([credential-rotation.md](credential-rotation.md)).
4. **The REVOKE of browser-role writes is applied strictly last**, as a NEW migration, after old browser bundles have
   aged out. Applying it earlier breaks saving for every customer ([k2-rollout.md](k2-rollout.md), step 4).

## Step 0: read-only checks on production (OWNER, about 15 minutes, nothing writes)

Keep the output with the change record.

1. **K2 grants** (InsForge SQL editor): the two queries in [k2-rollout.md](k2-rollout.md) step 0. Expected today:
   `true | true | true` and ownership-only policies. That proves the hole the later steps close.
2. **K16 billing columns** (InsForge SQL editor). The trial fix is only as strong as the lock on these columns
   (`migrations/20260902000000_lock-billing-columns.sql`); this run assumed it is applied and did not verify it.
   Every value must be `false`, and the last two queries must return what is written after them:

   ```sql
   SELECT has_column_privilege('authenticated','public.companies','trial_ends_at','UPDATE')        AS trial_update,
          has_column_privilege('authenticated','public.companies','trial_ends_at','INSERT')        AS trial_insert,
          has_column_privilege('authenticated','public.companies','subscription_status','UPDATE')  AS status_update,
          has_column_privilege('authenticated','public.companies','subscription_status','INSERT')  AS status_insert,
          has_column_privilege('authenticated','public.companies','subscription_plan','UPDATE')    AS plan_update,
          has_column_privilege('authenticated','public.companies','subscription_plan','INSERT')    AS plan_insert,
          has_column_privilege('authenticated','public.companies','stripe_customer_id','UPDATE')   AS stripe_update,
          has_column_privilege('authenticated','public.companies','stripe_customer_id','INSERT')   AS stripe_insert,
          has_table_privilege('authenticated','public.companies','DELETE')                         AS companies_delete,
          has_table_privilege('authenticated','public.reports','INSERT')                           AS reports_insert,
          has_table_privilege('authenticated','public.reports','UPDATE')                           AS reports_update;

   -- expected: 0 (no DELETE policy on companies)
   SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'companies' AND cmd = 'DELETE';
   -- expected: t, then 0 (public.users: row security on, no policy for the browser role)
   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass;
   SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND 'authenticated' = ANY (roles);
   ```

   If any privilege is `true`, stop: the trial clock and the plan can be changed from a browser console, and the K16 fix
   proves nothing until that column privilege is revoked.
3. **Signup setting** (K1, P0): `npx @insforge/cli config export --out <a folder outside the repository>` and confirm
   `require_email_verification = true` and `verify_email_method = "code"` (or do one real signup with your own address).
   Do NOT switch to link mode.
4. **Stripe webhook**: the endpoint path is `/api/webhook` (the Stripe dashboard must point at it; a wrong path in an
   old internal document was corrected).

## Step 1: rotate the credentials (OWNER)

Follow [credential-rotation.md](credential-rotation.md) steps 1 to 6 (Railway team tokens, Ollama key, the `ik_` keys,
what a stolen team token could read, redeploy and verify, close the ledger). The new `DATABASE_URL` and
`SITE_DEPLOY_TOKEN` from its step 4 table are what the blog runbook in step 2 needs, so rotate first.
Only after step 6 of that runbook: the secret-scan baseline (its step 7) and "Wait for CI" (its step 8, only once CI is
green on the main branch, or every deploy halts).

## Step 2: fix the live blog rows (OWNER)

[blog-rows-update.md](blog-rows-update.md): export the rows, run the SQL for the four seeded posts, republish the three
autoblog posts through `/api/publish`, verify the live API. Fix body AND FAQ (the FAQ still says `$49/month`).
Do this BEFORE step 5.

## Step 3: one staging migration (OWNER, recommended)

The migrations below use `DO` blocks and functions, so they assume the InsForge CLI runs a migration file as ONE script.
Its documentation does not say so. Apply the first migration to a staging project (or a scratch project) once and run its
verify queries before you touch production.

## Step 4: migrate production (OWNER or CI)

`npm run db:migrate`, then `npm run db:migrate:check` must report the schema up to date. In timestamp order, all additive:

| Migration | From | Adds |
|---|---|---|
| `20260930100000_entry-provenance-and-idempotency.sql` | K2 | provenance columns on `emission_entries`, a per-company idempotency index, and the trigger that stops the browser role from writing them |
| `20260930110000_report-snapshots.sql` | K3 | frozen report snapshots and PDFs, the freeze trigger, the trigger that keeps the newest 25 unsigned drafts per company |
| `20260930120000_csv-import-batches.sql` | K4 | import batches, `import_id`, `updated_at`, the guard that stops the browser role from setting `import_id` |
| `20260930121000_company-onboarding.sql` | K5 | company onboarding state, reporting basis, `entry_history` |
| `20260930140000_consent-decided-at.sql` | consent | nullable `decided_at` on consent records (the decision time the browser reports; `created_at` stays the receipt time). The new consent route names this column: if the image is deployed first, `/api/consent-audit` answers a retryable 503 (browsers keep up to 25 records queued, but visitors who never return would be lost) |

After migrating, run the verify query at the foot of each migration file. The old code keeps working on this schema, so
this step is safe to do before the deploy and safe to leave if the deploy is rolled back.

## Step 5: set the environment, then deploy the image (OWNER)

Railway variables (names only here; never paste values into a ticket):

- Set `CONSENT_IP_PEPPER` (consent IP hashes are stable only with it; a boot warning says so).
- Delete the stale `APP_VERSION` variable (production reported 1.0.0 for a build whose package.json says 2.0.0).
- Check `SITE_DEPLOY_TOKEN` is set (publishing needs it).
- Do NOT set `LEAD_NOTIFY_WEBHOOK_URL` yet: set it only after the Privacy Policy and the DPA list the team-messaging
  workspace as a recipient of lead notifications (that text is in this change set; it must be LIVE first, after counsel
  has read it). Until then leads are stored and the boot warning says nobody is alerted. How to read the stored leads,
  why the notifier can be silent, and what stays your decision: [leads.md](leads.md).
- Check `DATABASE_URL` is set. Postgres is the only data store now (the in-memory sample data and the lead and consent
  files are gone). In production, with the InsForge URL set (`INSFORGE_BASE_URL`, or `VITE_INSFORGE_BASE_URL`) and no
  `DATABASE_URL`, the server refuses to start: it logs `DATABASE_URL is required when InsForge authentication is configured`
  and exits with code 1, so a deploy that lost the variable fails at boot. Only with both variables missing does it start:
  every data route then answers 503, while `/health` and `/ready` answer 200 ("not configured" is not "down"). Step 6 is
  the real check.
- Delete `ALLOW_SAMPLE_DATA` if it is set (the server no longer reads it).
- These must be absent in production: `DEV_AUTH_SECRET`, `DEV_COMPANY_ID`, `ALLOW_DEV_AUTH`.
- Build-time `VITE_*` values (`VITE_GTM_ID`, `VITE_INSFORGE_BASE_URL`, `VITE_INSFORGE_ANON_KEY`, prices) stay as they are.

Deploy the Docker image. It must be built by the Dockerfile as it is (`vite build`, then `scripts/prerender.mjs`): the
server reads the prerendered `static/app-shell.html` and `static/sitemap-routes.json`; without them the blog and the app
shell answer plain-text errors. The runtime needs every `server*.cjs` module and both emission catalogs in the image
(`tests/dockerfile-runtime-deps.test.ts` checks this in CI).

Then check: `GET /health` answers 200 with the new commit sha; `GET /ready` answers 200 (its body is `{status}` only).

Then run the onboarding backfill once more. It is the `UPDATE public.companies AS c SET auto_provisioned = true ...`
statement under "Backfill" in `migrations/20260930121000_company-onboarding.sql`; run that one statement in the SQL editor
(not the whole file). The migration ran at step 4 and decided only the companies that existed then, so a company the OLD image
created between step 4 and this deploy keeps `auto_provisioned = false` and would never be sent through onboarding. It is
safe to run again: it only sets the flag to true, and only on rows that still have it false, no `onboarding_completed_at`, a
name in the placeholder shape and no facility, entry, report or CSV import. A row it already flagged, and any company a
customer has named or used, does not match.

## Step 6: verify the deploy (OWNER, your own synthetic account)

1. The K2 table in [k2-rollout.md](k2-rollout.md) steps 2 and 3 (entry saved with provenance, immediate dashboard,
   Scope 3 blocked on Starter, facility cap, export contents). Clean up with Settings, "Delete my audit data". A 503 on
   the dashboard or on saving means the server cannot reach the database (check `DATABASE_URL`); this step is also the
   proof that it can.
2. Reports: generate a report for the current year, download it twice (same bytes), sign it off; try to generate 21 in an
   hour only on a scratch company (limit 20 per company per hour).
3. CSV ([csv-import.md](csv-import.md)): a dry run, a commit, the same file again (409), undo.
4. A brand-new account lands in first-run onboarding; Settings shows Company and Facilities.
5. Consent: the banner appears first in tab order on a first visit; withdrawing analytics stops tags on the page.
6. Blog: `/blog/`, one post, `/sitemap.xml`, an unknown URL (branded 404 with `X-Robots-Tag`).
7. Trial: a fresh account shows the trial pill; an expired one sees the trial-ended sentence and the plan link.

Rollback of steps 4 to 6: redeploy the previous image; the additive schema stays.

## Step 7: wait for old browser bundles (OWNER)

A browser tab opened before the deploy keeps running the old SPA, which still writes through the records API until it
reloads. The gate is ONE query: the old-bundle query in [k2-rollout.md](k2-rollout.md) step 2/3 ("Old bundles": rows with
`activity_amount IS NULL AND unit = 'kg CO2e'`). Run it daily; when it stays at 0 for several days of normal use, go on.
The two read-only checks printed after it do not gate this step; review them separately. The first (pins no server wrote)
should return no rows: a row means the step 1 trigger is missing or was bypassed, so look into it. The second (more
facilities than the plan allows) returns companies to look at, not proof, so it need not be empty.

## Step 8: the REVOKE, as a NEW migration (OWNER)

[k2-rollout.md](k2-rollout.md) step 4: copy `docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql` into
`migrations/` under a NEW timestamp later than every migration applied so far, `npm run db:migrate`, run its verify queries
(`f|f|f|f|f|f|t|t`, only the two `*_owner_select` policies left). Until this step, a hand-made records-API write can still
insert Scope 3 rows past the plan and exceed the facility cap; it cannot change a server-priced row (the step 4 trigger).
Consider adding `REVOKE ALL ON public.entry_history FROM anon, authenticated;` to the same migration (belt and braces: row
security already gives that table no policy).

## Step 9: re-verify

Repeat step 6.1 (the app must still save, edit and delete entries and add facilities) and re-run the step 8 verify queries
after every later migration and platform update: if INSERT ever comes back, the platform re-applied its managed grants.

## Step 10: catalog restatement (an explicit OWNER decision, may be never)

The factor catalog 2026-09-30 prices NEW entries. Stored rows keep the frozen 2026-07-24 catalog, and issued reports are
stored bytes. Restating older rows is optional, dry-run only in this change set, and only after K3 snapshots exist
([factor-restatement.md](factor-restatement.md)). Never ship the catalog without its report lines (same image: do not
cherry-pick).

## Outside the deploy, in any order (OWNER)

- Google Tag Manager: set consent requirements on the container's tags (consent settings per tag); until then only Google
  tags that honour Consent Mode follow the Marketing toggle.
- Railway "Wait for CI" after CI is green ([credential-rotation.md](credential-rotation.md) step 8, [ci-gates.md](ci-gates.md)).
- Move the service's settings into the Railway dashboard before 2026-12-01 ([railway-settings.md](railway-settings.md)).
- External uptime checks and alerts ([monitoring.md](monitoring.md)).
- Publish a vulnerability-disclosure page, then restore the `Policy:` line in `public/.well-known/security.txt`.
- Update `.env.example` (agents could not read it) and turn on its parity test: the exact steps are in the obs-a report.

## Never

- Make the repository public to get branch protection.
- Switch signup to link mode.
- Apply the REVOKE before step 7 has been quiet for several days.
- Set `LEAD_NOTIFY_WEBHOOK_URL` before the recipient text is live.
- Run the restatement script's apply path (it does not exist in this change set) or edit `emission-factors.v1.json`.
