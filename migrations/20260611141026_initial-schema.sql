-- EcoAuditor initial schema: companies, facilities, emission_entries, reports, contact_submissions.
-- RLS: deny-by-default; tenant access chained through companies.user_id = auth.uid().
-- Note: bigint identity PKs (not uuid) because the frontend types expect numeric ids.

CREATE TABLE IF NOT EXISTS public.companies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  industry TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT companies_user_id_unique UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.facilities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  type TEXT,
  city TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facilities_company_id ON public.facilities(company_id);

CREATE TABLE IF NOT EXISTS public.emission_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  facility_id BIGINT REFERENCES public.facilities(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('Scope 1', 'Scope 2', 'Scope 3')),
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  unit TEXT NOT NULL,
  factor TEXT,
  method TEXT,
  confidence NUMERIC CHECK (confidence BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emission_entries_company_id ON public.emission_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_emission_entries_facility_id ON public.emission_entries(facility_id);
CREATE INDEX IF NOT EXISTS idx_emission_entries_created ON public.emission_entries(created_at DESC);

CREATE TABLE IF NOT EXISTS public.reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  type TEXT,
  status TEXT,
  last_updated TIMESTAMPTZ,
  completeness NUMERIC,
  signoff TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_company_id ON public.reports(company_id);

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  company TEXT,
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on every table (deny-by-default).
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Drop any auto-created policies so the explicit set below is the whole access model.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('companies', 'facilities', 'emission_entries', 'reports', 'contact_submissions')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- companies: owner-only CRUD
CREATE POLICY companies_owner_select ON public.companies
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE POLICY companies_owner_insert ON public.companies
FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY companies_owner_update ON public.companies
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY companies_owner_delete ON public.companies
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

-- facilities: access chained through company ownership
CREATE POLICY facilities_owner_select ON public.facilities
FOR SELECT TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY facilities_owner_insert ON public.facilities
FOR INSERT TO authenticated
WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY facilities_owner_update ON public.facilities
FOR UPDATE TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())))
WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY facilities_owner_delete ON public.facilities
FOR DELETE TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

-- emission_entries: access chained through company ownership
CREATE POLICY emission_entries_owner_select ON public.emission_entries
FOR SELECT TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY emission_entries_owner_insert ON public.emission_entries
FOR INSERT TO authenticated
WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY emission_entries_owner_update ON public.emission_entries
FOR UPDATE TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())))
WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY emission_entries_owner_delete ON public.emission_entries
FOR DELETE TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

-- reports: access chained through company ownership
CREATE POLICY reports_owner_select ON public.reports
FOR SELECT TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY reports_owner_insert ON public.reports
FOR INSERT TO authenticated
WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY reports_owner_update ON public.reports
FOR UPDATE TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())))
WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

CREATE POLICY reports_owner_delete ON public.reports
FOR DELETE TO authenticated
USING (company_id IN (SELECT id FROM public.companies WHERE user_id = (SELECT auth.uid())));

-- contact_submissions: public contact form — insert only, no read-back
CREATE POLICY contact_submissions_public_insert ON public.contact_submissions
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- rollback:
-- DROP TABLE IF EXISTS public.contact_submissions CASCADE;
-- DROP TABLE IF EXISTS public.reports CASCADE;
-- DROP TABLE IF EXISTS public.emission_entries CASCADE;
-- DROP TABLE IF EXISTS public.facilities CASCADE;
-- DROP TABLE IF EXISTS public.companies CASCADE;