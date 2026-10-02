-- CSV import batches: every committed import is a record the customer can see
-- and undo, and every row it stored points back to it (audit K4: F-E-04,
-- F-C-06, F-E-18, F-R2-01).
--
-- The import used to insert rows with nothing linking them to the upload, so an
-- identical file imported twice doubled the totals with no trace of which rows
-- came from which upload, and there was no way to take an import back. It also
-- overwrote created_at with the row's activity date, destroying the time the
-- number entered the system. From now on:
--   csv_import_events.file_sha256        SHA-256 (hex) of the file's normalised text; the same
--                                        file committed again answers 409 unless the caller
--                                        asks to replace that import or to import anyway
--   csv_import_events.status             'committed', or 'undone' once its rows were removed.
--                                        NULL on imports recorded before this migration
--                                        (they have no linked rows, so they cannot be undone)
--   csv_import_events.warning_count      warnings shown for the file when it was committed
--   csv_import_events.original_filename  the file name the browser reported (display only)
--   csv_import_events.undone_at          when the import was undone
--   emission_entries.import_id           the import that stored the row (NULL for rows
--                                        entered any other way, and for older CSV rows)
--   emission_entries.updated_at          set by a trigger on every UPDATE; NULL = never
--                                        changed since it was stored
-- csv_import_events.row_count (rows stored by the import) already exists
-- (20260724010000) and is used as it is.
--
-- The quota still counts csv_import_events rows per calendar month, whatever
-- their status: undoing an import does not refund it (review R2: revert softly
-- so quota and audit history survive). Dry runs, refused uploads and replayed
-- requests write no event.
--
-- Additive only: nullable columns, CHECKs that every existing row satisfies,
-- indexes, a trigger that only fills updated_at and one that keeps browser-role
-- writes off import_id. Nothing is backfilled, so
-- every existing row reports exactly what it reported before: period bucketing
-- (COALESCE(activity_date, created_at::date)) reads neither new column. Safe to
-- apply before the code that writes these columns deploys, and safe to leave
-- applied if that code is rolled back (the previous server never reads them;
-- its inserts leave them NULL, which the CHECKs allow).

ALTER TABLE public.csv_import_events
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('committed', 'undone')),
  ADD COLUMN IF NOT EXISTS warning_count INTEGER CHECK (warning_count >= 0),
  ADD COLUMN IF NOT EXISTS original_filename TEXT CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;

-- The duplicate check runs inside the import transaction: "this company, this file".
CREATE INDEX IF NOT EXISTS csv_import_events_company_sha_idx
  ON public.csv_import_events (company_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;

-- ON DELETE SET NULL: removing an event row never removes emission data. Undo
-- deletes an import's rows explicitly and keeps the event (status 'undone').
ALTER TABLE public.emission_entries
  ADD COLUMN IF NOT EXISTS import_id BIGINT REFERENCES public.csv_import_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_emission_entries_import_id
  ON public.emission_entries (import_id)
  WHERE import_id IS NOT NULL;

-- updated_at for every writer: the server writes with row_security off and
-- older app bundles still write through the records API, so a column only the
-- server remembers to set would be wrong for some rows. An INSERT always stores
-- NULL ("never changed"), whatever the writer sent.
CREATE OR REPLACE FUNCTION public.emission_entries_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := NULL;
  ELSE
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'emission_entries_touch_updated_at' AND tgrelid = 'public.emission_entries'::regclass) THEN
    CREATE TRIGGER emission_entries_touch_updated_at
      BEFORE INSERT OR UPDATE ON public.emission_entries
      FOR EACH ROW EXECUTE FUNCTION public.emission_entries_touch_updated_at();
  END IF;
END $$;

-- import_id and the browser roles. Until the deferred REVOKE (K2 step 4) the
-- records API still lets anon/authenticated write this table, and
-- emission_entries_guard_browser_writes (20260930100000) does not cover
-- import_id. A browser-role write can neither link a row to an import nor
-- unlink one: INSERT stores NULL, UPDATE keeps the stored value. The server
-- connects as its own role and is not affected. Every query that reads, undoes
-- or counts through import_id is also scoped by company_id
-- (server-csv-import-store.cjs), so this closes the forgery rather than a leak.
CREATE OR REPLACE FUNCTION public.emission_entries_guard_import_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.import_id := NULL;
  ELSE
    NEW.import_id := OLD.import_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'emission_entries_guard_import_id'
                   AND tgrelid = 'public.emission_entries'::regclass) THEN
    CREATE TRIGGER emission_entries_guard_import_id
      BEFORE INSERT OR UPDATE ON public.emission_entries
      FOR EACH ROW EXECUTE FUNCTION public.emission_entries_guard_import_id();
  END IF;
END $$;

-- A CSV import converts a unit the catalog has no factor for (ccf, lb, km ...)
-- before the factor lookup, so on such a row `amount`/`unit` hold the converted
-- quantity in the catalog unit and activity_amount/activity_unit what the file
-- said. The pinned factor is per `unit`; on every row without a conversion
-- (all manual entries so far) `unit` and activity_unit are the same.
COMMENT ON COLUMN public.emission_entries.factor_value IS
  'Emission factor applied, kg CO2e per `unit` (the catalog unit; equals activity_unit unless a unit conversion applied), pinned at write time. NULL = not recorded (legacy row).';
COMMENT ON COLUMN public.emission_entries.import_id IS
  'csv_import_events.id of the CSV import that stored this row. NULL for rows entered otherwise and for CSV rows imported before 2026-09-30.';
COMMENT ON COLUMN public.emission_entries.updated_at IS
  'Last UPDATE of the row (trigger emission_entries_touch_updated_at). NULL = unchanged since it was stored.';
COMMENT ON COLUMN public.csv_import_events.status IS
  'committed | undone. NULL = recorded before import history existed (no linked rows).';

-- Verify after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'csv_import_events'
--      AND column_name IN ('file_sha256','status','warning_count','original_filename','undone_at');   -- 5 rows
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'emission_entries' AND column_name IN ('import_id','updated_at');  -- 2 rows
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.emission_entries'::regclass AND NOT tgisinternal;
--     -- includes emission_entries_guard_import_id and emission_entries_touch_updated_at
--
-- rollback (only once no deployed code writes these columns; forward-only
-- platforms need this as a new migration; dropping import_id loses which rows
-- came from which import, and dropping the event columns loses the history):
-- DROP TRIGGER IF EXISTS emission_entries_guard_import_id ON public.emission_entries;
-- DROP FUNCTION IF EXISTS public.emission_entries_guard_import_id();
-- DROP TRIGGER IF EXISTS emission_entries_touch_updated_at ON public.emission_entries;
-- DROP FUNCTION IF EXISTS public.emission_entries_touch_updated_at();
-- DROP INDEX IF EXISTS public.idx_emission_entries_import_id;
-- DROP INDEX IF EXISTS public.csv_import_events_company_sha_idx;
-- ALTER TABLE public.emission_entries DROP COLUMN IF EXISTS import_id, DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE public.csv_import_events
--   DROP COLUMN IF EXISTS file_sha256, DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS warning_count,
--   DROP COLUMN IF EXISTS original_filename, DROP COLUMN IF EXISTS undone_at;
