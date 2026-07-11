-- Reports store the reporting period they cover so the PDF can be regenerated
-- deterministically on download (stateless — no in-memory PDF store needed).
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS period TEXT;
