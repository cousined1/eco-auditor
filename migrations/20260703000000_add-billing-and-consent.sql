-- Billing: subscription lifecycle columns on companies, synced from Stripe webhooks.
-- Consent: server-side audit trail of consent decisions (GDPR/CCPA record-keeping).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT,
  ADD COLUMN IF NOT EXISTS subscription_billing_cycle TEXT,
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_companies_stripe_customer_id
  ON public.companies(stripe_customer_id);

CREATE TABLE IF NOT EXISTS public.consent_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id TEXT,
  consent JSONB NOT NULL,
  policy_version TEXT NOT NULL,
  method TEXT NOT NULL CHECK (char_length(method) BETWEEN 1 AND 40),
  gpc BOOLEAN NOT NULL DEFAULT false,
  dnt BOOLEAN NOT NULL DEFAULT false,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_records_visitor_id ON public.consent_records(visitor_id);

-- Deny-by-default: only the server (direct Postgres connection) writes/reads this table.
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
