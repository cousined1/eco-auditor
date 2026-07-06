-- Billing identity map: InsForge user -> Stripe customer.
-- Every Stripe route (ensureStripeCustomer at server.cjs) and the webhook
-- subscription-sync (syncSubscriptionRecord) SELECT/INSERT against public.users.
-- No prior migration created it — only src/db/schema.ts (Drizzle) declared it,
-- and the deploy runs bare `node server.cjs` with no db:push/migrate step.
-- Without this table, checkout/portal/subscription 500 and every webhook 500s,
-- so subscription state never persists. See audit finding (users table missing).

CREATE TABLE IF NOT EXISTS public.users (
  insforge_user_id UUID PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook handlers look users up by Stripe customer id.
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON public.users(stripe_customer_id);

-- Deny-by-default: only the server (direct Postgres connection) touches this table.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
