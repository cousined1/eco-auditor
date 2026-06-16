-- Add trial_ends_at to companies table for automatic 14-day trial provisioning.
-- All new companies get a 14-day trial starting at creation time.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Backfill existing companies with a 14-day trial from their creation date
UPDATE public.companies
  SET trial_ends_at = created_at + INTERVAL '14 days'
  WHERE trial_ends_at IS NULL;
