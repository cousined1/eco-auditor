-- STRIPE-EMAIL: public.users.email must not be NOT NULL.
--
-- authGuard validates only `user.id` on the InsForge session payload, but all
-- five billing routes (checkout, verify, portal, subscription change, cancel)
-- pass req.user.email through ensureStripeCustomer into
--
--   INSERT INTO users (insforge_user_id, stripe_customer_id, email) ...
--
-- node-postgres converts an undefined bind parameter to NULL, so if the
-- session payload ever omits email the INSERT raises a not-null violation and
-- every billing route 500s — a paying customer is unable to subscribe, change
-- plan, open the billing portal or cancel, with an opaque database error in
-- the log that names neither the cause nor the user.
--
-- The column mirrors an optional upstream field, so requiring it here was the
-- defect: a Stripe customer object does not need an email to exist, and Stripe
-- accepts a customer without one. Constraining a mirrored field harder than
-- its source guarantees a failure rather than preventing one.
--
-- Existing rows are unaffected; only the constraint is relaxed. The gap is now
-- logged by ensureStripeCustomer instead of crashing, so a missing email is
-- diagnosable rather than fatal.
--
-- Written as a guarded DO block rather than a bare ALTER. The e2e harness feeds
-- every migration to psql with ON_ERROR_STOP=1, so a single failing statement
-- aborts the whole schema run and takes all three DB-backed suites with it.
-- DROP NOT NULL is already idempotent; the guard additionally makes the file a
-- no-op on any database where public.users does not yet exist, so applying the
-- migrations out of order cannot break a deploy.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'email'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
  END IF;
END
$$;