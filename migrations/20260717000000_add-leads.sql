-- Leads: server-side capture from /api/leads and the chatbot sales flow.
-- Public insert endpoint (no auth required), service-only reads via direct Postgres connection.

CREATE TABLE IF NOT EXISTS public.leads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 50),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  company TEXT CHECK (char_length(company) BETWEEN 0 AND 160),
  message TEXT CHECK (char_length(message) BETWEEN 0 AND 1000),
  preferred_date TEXT CHECK (char_length(preferred_date) BETWEEN 0 AND 40),
  preferred_time TEXT CHECK (char_length(preferred_time) BETWEEN 0 AND 40),
  source TEXT NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Public insert for anon/authenticated visitors (lead capture forms).
CREATE POLICY leads_public_insert ON public.leads
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- rollback:
-- DROP TABLE IF EXISTS public.leads CASCADE;
