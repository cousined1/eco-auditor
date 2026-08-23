-- Persist what the CSV ingest already computes.
--
-- emission_entries.amount is polymorphic: the in-app calculator writes an
-- already-computed value (amount = kg CO2e, unit = 'kg CO2e') while the CSV
-- ingest writes the RAW activity amount with its activity unit (50000,
-- 'therms'). Nothing recorded the computed result, so every consumer had to
-- re-derive it -- and the client calculator did not, rendering imported rows
-- as if their activity amount were kilograms.
--
-- The ingest also built `date` and `notes` for each row and then dropped them:
-- `notes` (a documented CSV column) was silently discarded, and the activity
-- date survived only by overwriting created_at, destroying the import
-- timestamp needed for the audit trail.
ALTER TABLE public.emission_entries
  ADD COLUMN IF NOT EXISTS co2e_kg NUMERIC CHECK (co2e_kg >= 0),
  ADD COLUMN IF NOT EXISTS activity_date DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_emission_entries_activity_date
  ON public.emission_entries(activity_date);

-- rollback:
-- DROP INDEX IF EXISTS public.idx_emission_entries_activity_date;
-- ALTER TABLE public.emission_entries
--   DROP COLUMN IF EXISTS co2e_kg,
--   DROP COLUMN IF EXISTS activity_date,
--   DROP COLUMN IF EXISTS notes;
