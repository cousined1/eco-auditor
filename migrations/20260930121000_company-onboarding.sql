-- K5 (audit F-B-03 = F-C-03, F-B-17, and the company half of F-E-08): onboarding
-- state, the company's reporting basis, and an edit trail for emission entries.
--
-- Why. requirePlan -> ensureCompanyForUser creates "<email-prefix> Organization"
-- on the first authenticated call, so the onboarding form (which only rendered
-- when no company row existed) never showed, and no screen renamed the company or
-- added a facility. The server now records that it made the placeholder, the SPA
-- routes such a company to onboarding first, and the app can rename it.
--
--   companies.auto_provisioned        true when the SERVER invented the company
--                                     (name = the placeholder). Set by
--                                     ensureCompanyForUser; defaults to false, so a
--                                     company created any other way (and every row
--                                     written by the previous server code) is never
--                                     sent to onboarding.
--   companies.onboarding_completed_at when the customer first saved a company name
--                                     through PATCH /api/companies/:id (onboarding
--                                     form or Settings). NULL until then.
--   companies.onboarding_skipped_at   when the customer chose "Finish later".
--   A company needs onboarding while it is auto_provisioned and both timestamps
--   are NULL (server-company.cjs needsOnboarding).
--
--   companies.consolidation_approach  the GHG Protocol consolidation approach the
--                                     company reports under: operational_control,
--                                     financial_control, equity_share or
--                                     'unspecified' (default; reports say "not
--                                     specified").
--   companies.base_year               the base year, NULL until set (reports say
--                                     "not set"). The upper bound (this year) is
--                                     checked by the server: a CHECK cannot
--                                     reference the clock.
--   Both are written only by the server; the browser role's column grants on
--   companies (20260902000000) are name and industry, and these columns are not
--   added to them.
--
--   emission_entries.updated_at       when the entry was last edited; NULL = never.
--   entry_history                     one row per edit (PATCH /api/entries/:id):
--                                     the values before and after, who (auth user
--                                     id) and when. Append-only: a trigger refuses
--                                     UPDATE. It goes with its entry (ON DELETE
--                                     CASCADE), so "Delete my audit data" still
--                                     removes everything it says it removes. This
--                                     is an edit trail for the customer, not the
--                                     tamper-evident audit log the product lists as
--                                     roadmap.
--
-- Additive only: nullable columns, one NOT NULL column with a constant default,
-- a new table with row level security on and no policies (only the server, which
-- writes with row_security off, reads or writes it), one trigger. No REVOKE, no
-- drop. Safe to apply BEFORE the new server code deploys (the previous code never
-- names these columns) and safe to leave applied on rollback.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS auto_provisioned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consolidation_approach TEXT NOT NULL DEFAULT 'unspecified'
    CONSTRAINT companies_consolidation_approach_check
    CHECK (consolidation_approach IN ('operational_control', 'financial_control', 'equity_share', 'unspecified')),
  ADD COLUMN IF NOT EXISTS base_year INTEGER
    CONSTRAINT companies_base_year_check CHECK (base_year BETWEEN 1990 AND 2100);

-- Backfill: decide once which EXISTING companies still need onboarding. A company
-- counts as not onboarded only when it is an untouched placeholder: a name in the
-- shape the server invents ("<email-prefix> Organization", or "My Organization" for
-- a company a Stripe webhook created) AND nothing recorded against it: no
-- facility, no emission entry, no report, no CSV import. Anything with a name the
-- customer chose, or with any data, keeps auto_provisioned = false and is never
-- sent through onboarding. The name test is deliberately about shape: it cannot
-- use the account's e-mail (this migration does not depend on the auth schema's
-- columns), so a no-data company that really is called "Something Organization"
-- sees the pre-filled, skippable form once. Nothing else changes.
UPDATE public.companies AS c
   SET auto_provisioned = true
 WHERE c.auto_provisioned = false
   AND c.onboarding_completed_at IS NULL
   AND (c.name = 'My Organization' OR c.name LIKE '% Organization')
   AND NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.emission_entries e WHERE e.company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.company_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.csv_import_events i WHERE i.company_id = c.id);

ALTER TABLE public.emission_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.entry_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES public.emission_entries(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  changed_by TEXT NOT NULL CHECK (char_length(changed_by) BETWEEN 1 AND 200),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS entry_history_entry_changed_idx
  ON public.entry_history (entry_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS entry_history_company_idx
  ON public.entry_history (company_id);

-- Deny-by-default, like consent_records: no policy, so the browser role sees and
-- writes nothing. The server connects with its own role and row_security off.
ALTER TABLE public.entry_history ENABLE ROW LEVEL SECURITY;

-- Append-only for every writer, the server included (it bypasses RLS, so a policy
-- would not bind it). Only UPDATE is refused: DELETE must stay possible for the
-- cascade from emission_entries and companies, and for erasure.
CREATE OR REPLACE FUNCTION public.entry_history_refuse_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'entry_history is append-only (row %)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'entry_history_refuse_update' AND tgrelid = 'public.entry_history'::regclass) THEN
    CREATE TRIGGER entry_history_refuse_update
      BEFORE UPDATE ON public.entry_history
      FOR EACH ROW EXECUTE FUNCTION public.entry_history_refuse_update();
  END IF;
END $$;

COMMENT ON COLUMN public.companies.auto_provisioned IS
  'true = the server created this company with a placeholder name (ensureCompanyForUser). Drives the first-run onboarding screen together with onboarding_completed_at / onboarding_skipped_at.';
COMMENT ON COLUMN public.companies.consolidation_approach IS
  'GHG Protocol consolidation approach the company reports under; unspecified until the customer chooses. Printed on reports generated afterwards.';
COMMENT ON TABLE public.entry_history IS
  'Append-only edit trail for emission entries: old and new values, who, when. Written by PATCH /api/entries/:id.';

-- Verify after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'companies'
--      AND column_name IN ('auto_provisioned','onboarding_completed_at','onboarding_skipped_at','consolidation_approach','base_year');  -- 5 rows
--   SELECT has_column_privilege('authenticated', 'public.companies', 'consolidation_approach', 'UPDATE'),
--          has_column_privilege('authenticated', 'public.companies', 'auto_provisioned', 'UPDATE');                                      -- f | f
--   SELECT count(*) FILTER (WHERE auto_provisioned) AS pending_onboarding, count(*) AS companies FROM public.companies;
--     -- pending_onboarding = the untouched placeholders only (review before deploying)
--
-- rollback (only once no deployed code reads these; it DELETES every stored edit
-- trail row, so leaving this migration applied under older code is the safe choice):
-- DROP TRIGGER IF EXISTS entry_history_refuse_update ON public.entry_history;
-- DROP FUNCTION IF EXISTS public.entry_history_refuse_update();
-- DROP TABLE IF EXISTS public.entry_history;
-- ALTER TABLE public.emission_entries DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE public.companies
--   DROP CONSTRAINT IF EXISTS companies_consolidation_approach_check,
--   DROP CONSTRAINT IF EXISTS companies_base_year_check,
--   DROP COLUMN IF EXISTS auto_provisioned,
--   DROP COLUMN IF EXISTS onboarding_completed_at,
--   DROP COLUMN IF EXISTS onboarding_skipped_at,
--   DROP COLUMN IF EXISTS consolidation_approach,
--   DROP COLUMN IF EXISTS base_year;
