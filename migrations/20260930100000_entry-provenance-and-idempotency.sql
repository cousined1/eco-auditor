-- K2 step 1 (additive only): the columns the server entry API (POST/PATCH
-- /api/entries in server.cjs, server-entries.cjs) writes for every manual entry.
--
-- The calculator used to insert rows straight through the records API with
-- client-computed numbers: `amount` held kg CO2e, the activity survived only as
-- free text in `factor` ("1200 therms"), and no row said which factor, dataset
-- or catalog edition produced its CO2e (audit F-E-05, F-D-01). The server now
-- computes every value from emission-factors.json and records it here.
--
--   activity_amount / activity_unit  the quantity the customer entered, always
--                                    an activity unit (never a CO2e unit)
--   factor_value                     kg CO2e per activity_unit, as applied.
--                                    Summaries use this pinned value, so a
--                                    later catalog correction cannot silently
--                                    restate the row (review R2).
--   factor_source                    the factorSource id of the catalog source
--                                    (e.g. epa-egrid-2023, internal-estimate)
--   catalog_version                  emission-factors.json `version` plus a
--                                    short hash of its content (the version
--                                    string alone is not maintained, F-E-17)
--   idempotency_key                  the client's Idempotency-Key, unique per
--                                    company, so a retried or double-clicked
--                                    save stores one row
--   imported_at                      when a CSV import stored the row (the
--                                    import path still overwrites created_at
--                                    with the activity date, F-E-18). NULL for
--                                    rows entered in the app, whose created_at
--                                    is the entry time.
--
-- Existing rows keep NULL in every new column; the app reads NULL provenance as
-- "not recorded" and summarises such rows exactly as before (recomputed from
-- the catalog). Nothing is backfilled, revoked or dropped, RLS is unchanged,
-- and the one trigger (below) only stops the browser roles from setting or
-- changing a pinned factor, so this is safe to apply BEFORE the code that writes it deploys,
-- and safe to leave applied if that code is rolled back: the previous server
-- and SPA never read these columns.
--
-- The follow-up that closes the direct write path (REVOKE on emission_entries
-- and facilities) is deliberately NOT a migration yet:
-- docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql,
-- ordered by docs/runbooks/k2-rollout.md.
ALTER TABLE public.emission_entries
  ADD COLUMN IF NOT EXISTS activity_amount NUMERIC CHECK (activity_amount >= 0),
  ADD COLUMN IF NOT EXISTS activity_unit TEXT CHECK (char_length(activity_unit) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS factor_value NUMERIC CHECK (factor_value >= 0),
  ADD COLUMN IF NOT EXISTS factor_source TEXT CHECK (char_length(factor_source) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS catalog_version TEXT CHECK (char_length(catalog_version) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

-- One row per (company, key). Partial, so the NULL keys of every existing row
-- and of every CSV row never collide. The server inserts with
-- ON CONFLICT (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS emission_entries_company_idempotency_key_idx
  ON public.emission_entries (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.emission_entries.activity_amount IS
  'Activity quantity as entered (server entry API). NULL on rows written before the server entry API existed.';
COMMENT ON COLUMN public.emission_entries.factor_value IS
  'Emission factor applied, kg CO2e per activity_unit, pinned at write time. NULL = not recorded (legacy row).';
COMMENT ON COLUMN public.emission_entries.factor_source IS
  'factorSource id from emission-factors.json for the factor applied. NULL = not recorded (legacy row).';
COMMENT ON COLUMN public.emission_entries.catalog_version IS
  'emission-factors.json version + content hash the factor was taken from. NULL = not recorded (legacy row).';

-- Browser-role writes (verification W2A, D-1). Until the deferred REVOKE the
-- records API still lets the browser roles write this table, and the engine
-- trusts a row's pinned factor_value. So a write as anon/authenticated can
-- neither create a pin nor change one:
--   INSERT  the provenance columns are cleared, so the row is priced from the
--           catalog like every legacy row (the old SPA never sends them).
--   UPDATE  the provenance columns keep their stored values. On a row the
--           server priced (factor_value set), so do the columns its CO2e was
--           computed from: the engine applies the pin to amount whatever the
--           unit, so a changed unit or category would misprice it.
-- The server connects as its own role and is not affected. After the REVOKE
-- the browser roles cannot write at all; this stays as the second layer in
-- case the platform re-grants them (docs/runbooks/k2-rollout.md, step 4).
CREATE OR REPLACE FUNCTION public.emission_entries_guard_browser_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.activity_amount := NULL;
    NEW.activity_unit := NULL;
    NEW.factor_value := NULL;
    NEW.factor_source := NULL;
    NEW.catalog_version := NULL;
    NEW.idempotency_key := NULL;
    NEW.imported_at := NULL;
    RETURN NEW;
  END IF;
  NEW.activity_amount := OLD.activity_amount;
  NEW.activity_unit := OLD.activity_unit;
  NEW.factor_value := OLD.factor_value;
  NEW.factor_source := OLD.factor_source;
  NEW.catalog_version := OLD.catalog_version;
  NEW.idempotency_key := OLD.idempotency_key;
  NEW.imported_at := OLD.imported_at;
  IF OLD.factor_value IS NOT NULL THEN
    NEW.scope := OLD.scope;
    NEW.category := OLD.category;
    NEW.source := OLD.source;
    NEW.amount := OLD.amount;
    NEW.unit := OLD.unit;
    NEW.factor := OLD.factor;
    NEW.method := OLD.method;
    NEW.confidence := OLD.confidence;
    NEW.co2e_kg := OLD.co2e_kg;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'emission_entries_guard_browser_writes'
                   AND tgrelid = 'public.emission_entries'::regclass) THEN
    CREATE TRIGGER emission_entries_guard_browser_writes
      BEFORE INSERT OR UPDATE ON public.emission_entries
      FOR EACH ROW EXECUTE FUNCTION public.emission_entries_guard_browser_writes();
  END IF;
END $$;

-- Verify after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'emission_entries'
--      AND column_name IN ('activity_amount','activity_unit','factor_value','factor_source',
--                          'catalog_version','idempotency_key','imported_at');   -- 7 rows
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'emission_entries_company_idempotency_key_idx';
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.emission_entries'::regclass AND NOT tgisinternal;  -- emission_entries_guard_browser_writes
--
-- rollback (only once no deployed code writes these columns; forward-only
-- platforms need this as a new migration):
-- DROP TRIGGER IF EXISTS emission_entries_guard_browser_writes ON public.emission_entries;
-- DROP FUNCTION IF EXISTS public.emission_entries_guard_browser_writes();
-- DROP INDEX IF EXISTS public.emission_entries_company_idempotency_key_idx;
-- ALTER TABLE public.emission_entries
--   DROP COLUMN IF EXISTS activity_amount,
--   DROP COLUMN IF EXISTS activity_unit,
--   DROP COLUMN IF EXISTS factor_value,
--   DROP COLUMN IF EXISTS factor_source,
--   DROP COLUMN IF EXISTS catalog_version,
--   DROP COLUMN IF EXISTS idempotency_key,
--   DROP COLUMN IF EXISTS imported_at;
