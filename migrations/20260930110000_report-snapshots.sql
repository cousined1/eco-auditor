-- A generated report is a frozen snapshot (audit AUDIT-RUN-20260929 K3:
-- F-B-04, F-G-20, F-E-03).
--
-- Reports stored only (company, period) and every download re-rendered the PDF
-- from the live emission_entries, so one report id went 20.525 -> 23.178 ->
-- 84.2 tCO2e as data changed, even after sign-off, while the row said
-- 'final' / completeness 100. From now on the server computes a report once, at
-- generation, and stores:
--   snapshot    the exact data the PDF was built from: per-scope totals,
--               per-facility, per-category and per-entry lines, the factor
--               values, sources and catalog version used, the company name,
--               the period and generated_at
--   pdf         the rendered bytes, served as-is by every download. Stored
--               rather than re-rendered from `snapshot`: a later change to the
--               renderer would otherwise change a report someone already holds
--               or has signed off (byte identity is what a sign-off binds to)
--   pdf_sha256  hex SHA-256 of `pdf`, checked on every download
--   period_start / period_end  the dates the report covers (inclusive)
--   status      'draft' at generation, 'final' after sign-off
--   signed_off_by / signed_off_at  who signed it off (auth user id) and when
--
-- Additive only: new nullable columns, NOT VALID checks (existing rows are not
-- re-checked; every row written from now on is), one index and two triggers
-- (the freeze, and a bound of 25 unsigned drafts per company).
-- Rows written before this migration have no pdf_sha256: the server lists them
-- as legacy (never frozen) and refuses to download or sign them off, and the
-- trigger ignores them. Safe to apply before the new server code deploys (the
-- previous code keeps writing status 'final' and a NULL or 4-digit period, both
-- allowed) and safe to leave applied on rollback.
--
-- "Delete my audit data" still leaves reports in place, as the Privacy Policy
-- says; a snapshot now holds a copy of the report's entries, so whether that
-- control should also delete reports is an owner decision (see the K3 report).

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS snapshot JSONB,
  ADD COLUMN IF NOT EXISTS pdf BYTEA,
  ADD COLUMN IF NOT EXISTS pdf_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE,
  ADD COLUMN IF NOT EXISTS signed_off_by TEXT,
  ADD COLUMN IF NOT EXISTS signed_off_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_status_check' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_status_check
      CHECK (status IS NULL OR status IN ('draft', 'final')) NOT VALID;
  END IF;
  -- A calendar year ('2025') or an inclusive date range ('2025-04-01/2026-03-31').
  -- NULL is what the old UI sent ("All time"); the new server always sets one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_period_format_check' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_period_format_check
      CHECK (period IS NULL OR period ~ '^[0-9]{4}$' OR period ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_pdf_check' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_pdf_check
      CHECK ((pdf IS NULL) = (pdf_sha256 IS NULL) AND (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')) NOT VALID;
  END IF;
  -- A stored PDF always comes with the snapshot and the dates it was built from.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_snapshot_check' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_snapshot_check
      CHECK (pdf_sha256 IS NULL OR (snapshot IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL AND period_start <= period_end)) NOT VALID;
  END IF;
  -- A frozen report marked final names who signed it off and when. Legacy rows
  -- (status 'final' from the old code, no pdf_sha256) are exempt.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_signoff_check' AND conrelid = 'public.reports'::regclass) THEN
    ALTER TABLE public.reports ADD CONSTRAINT reports_signoff_check
      CHECK (pdf_sha256 IS NULL OR status IS DISTINCT FROM 'final'
             OR (signed_off_by IS NOT NULL AND char_length(signed_off_by) BETWEEN 1 AND 200 AND signed_off_at IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- The reports list is "this company, newest first".
CREATE INDEX IF NOT EXISTS idx_reports_company_created
  ON public.reports (company_id, created_at DESC);

-- Immutability is enforced here as well as in the server: the server writes with
-- row_security off, so an RLS policy would not bind it. A frozen draft may only
-- be signed off; a final report cannot change at all. DELETE is not blocked
-- (company deletion cascades, and erasure must stay possible).
CREATE OR REPLACE FUNCTION public.reports_guard_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.pdf_sha256 IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'report % is signed off and cannot be changed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'final' THEN
    RAISE EXCEPTION 'report % can only move from draft to final', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- A draft records who signed it off only in the UPDATE that makes it final.
  IF NEW.status IS DISTINCT FROM 'final'
     AND (NEW.signed_off_by IS DISTINCT FROM OLD.signed_off_by OR NEW.signed_off_at IS DISTINCT FROM OLD.signed_off_at) THEN
    RAISE EXCEPTION 'report % is a draft: its sign-off is recorded only together with the move to final', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'signoff', 'signed_off_by', 'signed_off_at', 'last_updated'])
     IS DISTINCT FROM
     (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'signoff', 'signed_off_by', 'signed_off_at', 'last_updated']) THEN
    RAISE EXCEPTION 'report % is frozen: only its sign-off can change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reports_guard_frozen' AND tgrelid = 'public.reports'::regclass) THEN
    CREATE TRIGGER reports_guard_frozen
      BEFORE UPDATE ON public.reports
      FOR EACH ROW EXECUTE FUNCTION public.reports_guard_frozen();
  END IF;
END $$;

-- Storage bound (VERIFY-W2A-DATA F5; MAX_DRAFT_REPORTS in
-- src/lib/reports/report-limits.cjs): storing a frozen draft deletes the same
-- company's older frozen drafts beyond the newest 25, inside the insert's
-- transaction. Signed-off finals and legacy rows (no pdf_sha256) are never
-- deleted here, and rows the previous server code writes do not fire it.
CREATE OR REPLACE FUNCTION public.reports_prune_drafts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.reports AS r
   WHERE r.company_id = NEW.company_id
     AND r.status = 'draft'
     AND r.pdf_sha256 IS NOT NULL
     AND r.id NOT IN (
       SELECT k.id FROM public.reports AS k
        WHERE k.company_id = NEW.company_id AND k.status = 'draft' AND k.pdf_sha256 IS NOT NULL
        ORDER BY k.created_at DESC, k.id DESC
        LIMIT 25);
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reports_prune_drafts' AND tgrelid = 'public.reports'::regclass) THEN
    CREATE TRIGGER reports_prune_drafts
      AFTER INSERT ON public.reports
      FOR EACH ROW WHEN (NEW.status = 'draft' AND NEW.pdf_sha256 IS NOT NULL)
      EXECUTE FUNCTION public.reports_prune_drafts();
  END IF;
END $$;

-- Verify after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name IN ('snapshot', 'pdf', 'pdf_sha256');  -- 3 rows
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.reports'::regclass AND NOT tgisinternal;             -- reports_guard_frozen, reports_prune_drafts
--
-- rollback (only if the columns must go: it DELETES every stored snapshot and
-- PDF; leaving this migration applied under older code is safe):
-- DROP TRIGGER IF EXISTS reports_prune_drafts ON public.reports;
-- DROP FUNCTION IF EXISTS public.reports_prune_drafts();
-- DROP TRIGGER IF EXISTS reports_guard_frozen ON public.reports;
-- DROP FUNCTION IF EXISTS public.reports_guard_frozen();
-- DROP INDEX IF EXISTS public.idx_reports_company_created;
-- ALTER TABLE public.reports
--   DROP CONSTRAINT IF EXISTS reports_status_check,
--   DROP CONSTRAINT IF EXISTS reports_period_format_check,
--   DROP CONSTRAINT IF EXISTS reports_pdf_check,
--   DROP CONSTRAINT IF EXISTS reports_snapshot_check,
--   DROP CONSTRAINT IF EXISTS reports_signoff_check,
--   DROP COLUMN IF EXISTS snapshot,
--   DROP COLUMN IF EXISTS pdf,
--   DROP COLUMN IF EXISTS pdf_sha256,
--   DROP COLUMN IF EXISTS period_start,
--   DROP COLUMN IF EXISTS period_end,
--   DROP COLUMN IF EXISTS signed_off_by,
--   DROP COLUMN IF EXISTS signed_off_at;
