-- Durable record of CSV imports, so the monthly import quota advertised on the
-- pricing page can actually be enforced.
--
-- Imports were previously tracked only in an in-memory Map (server.cjs
-- ingestJobs), which resets on every deploy and is not shared across instances
-- — useless as a billing counter.
CREATE TABLE IF NOT EXISTS public.csv_import_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The quota query is always "this company, this calendar month".
CREATE INDEX IF NOT EXISTS csv_import_events_company_created_idx
  ON public.csv_import_events (company_id, created_at DESC);

ALTER TABLE public.csv_import_events ENABLE ROW LEVEL SECURITY;

-- Deny-by-default, ownership chained through companies.user_id — same model as
-- facilities and emission_entries. The server writes with row_security = off.
DROP POLICY IF EXISTS csv_import_events_owner_select ON public.csv_import_events;
CREATE POLICY csv_import_events_owner_select ON public.csv_import_events
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = csv_import_events.company_id AND c.user_id = (SELECT auth.uid())
));

COMMENT ON TABLE public.csv_import_events IS
  'One row per accepted CSV import. Used to enforce the per-plan monthly import quota in plan-limits.json.';
