-- ============================================================================
-- DO NOT APPLY until the SPA build that writes through the server API is
-- deployed everywhere (docs/runbooks/k2-rollout.md, step 4).
--
-- This file is deliberately NOT in migrations/: `npm run db:migrate` must not
-- pick it up. Applied before the calculator and onboarding write through
-- POST/PATCH/DELETE /api/entries and POST /api/companies/:id/facilities, it
-- breaks entry saving, entry deletion and facility creation for every customer
-- (review R1, recipe check F-D-01). To apply it, copy it into migrations/ under
-- a NEW timestamp later than every migration applied by then, and follow the
-- runbook.
-- ============================================================================
--
-- K2 step 4 (enforcement). The browser SDK connects as `authenticated`, which
-- holds INSERT, UPDATE and DELETE on emission_entries and facilities (InsForge's
-- managed default), and the only policies on those writes check ownership. So
-- one records-API call from the browser console, or an old cached bundle, can
-- still add a Scope 3 row on a Starter plan, a second facility past the cap,
-- entries after the trial ends, or a row with any CO2e it likes (audit F-D-01,
-- F-E-05). The server now owns every write to both tables; take the browser
-- role's write privileges away, as 20260902000000_lock-billing-columns.sql did
-- for companies and reports.
--
-- SELECT stays: owners keep reading their own rows through the records API
-- (owner decision 1 in the R1 memo: after the trial the data is read-only, not
-- hidden). The server connects with its own role and is not affected.
-- A table-level REVOKE also revokes the matching column-level privileges.

REVOKE INSERT, UPDATE, DELETE ON public.emission_entries FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.facilities FROM anon, authenticated;

-- With the privileges gone these policies can never pass; they are pure attack
-- surface if a later grant brings a privilege back (compare companies_owner_delete).
DROP POLICY IF EXISTS emission_entries_owner_insert ON public.emission_entries;
DROP POLICY IF EXISTS emission_entries_owner_update ON public.emission_entries;
DROP POLICY IF EXISTS emission_entries_owner_delete ON public.emission_entries;
DROP POLICY IF EXISTS facilities_owner_insert ON public.facilities;
DROP POLICY IF EXISTS facilities_owner_update ON public.facilities;
DROP POLICY IF EXISTS facilities_owner_delete ON public.facilities;

-- Verify after applying. The first query must return f|f|f|f|f|f|t|t; the
-- second must list only emission_entries_owner_select and facilities_owner_select.
-- Re-run both after every later migration and platform update: if InsForge ever
-- re-applies its managed grants, INSERT comes back and the hole reopens.
--   SELECT concat_ws('|',
--     has_table_privilege('authenticated','public.emission_entries','INSERT'),
--     has_table_privilege('authenticated','public.emission_entries','UPDATE'),
--     has_table_privilege('authenticated','public.emission_entries','DELETE'),
--     has_table_privilege('authenticated','public.facilities','INSERT'),
--     has_table_privilege('authenticated','public.facilities','UPDATE'),
--     has_table_privilege('authenticated','public.facilities','DELETE'),
--     has_table_privilege('authenticated','public.emission_entries','SELECT'),
--     has_table_privilege('authenticated','public.facilities','SELECT'));
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('emission_entries','facilities');
--
-- Rollback. InsForge migrations are forward-only, so a rollback is a NEW
-- migration that re-grants and re-creates the policies (as in
-- 20260611141026_initial-schema.sql). It reopens F-D-01; use it only if the
-- server write API itself has to be rolled back.
--   GRANT INSERT, UPDATE, DELETE ON public.emission_entries, public.facilities TO authenticated;
--   CREATE POLICY emission_entries_owner_insert ON public.emission_entries FOR INSERT TO authenticated
--     WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));
--   CREATE POLICY emission_entries_owner_update ON public.emission_entries FOR UPDATE TO authenticated
--     USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())))
--     WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));
--   CREATE POLICY emission_entries_owner_delete ON public.emission_entries FOR DELETE TO authenticated
--     USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));
--   CREATE POLICY facilities_owner_insert ON public.facilities FOR INSERT TO authenticated
--     WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));
--   CREATE POLICY facilities_owner_update ON public.facilities FOR UPDATE TO authenticated
--     USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())))
--     WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));
--   CREATE POLICY facilities_owner_delete ON public.facilities FOR DELETE TO authenticated
--     USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));
