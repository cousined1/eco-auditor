-- Entitlement columns on companies are written ONLY by the server (Stripe
-- webhooks and checkout verification over the direct Postgres connection).
-- The browser SDK connects as `authenticated`, which held INSERT, UPDATE and
-- DELETE on every column, and companies_owner_update lets a user modify their
-- own row — so one SDK call from the browser console could set
-- subscription_plan='pro', subscription_status='active' (or push trial_ends_at
-- into the future) and billingStateFromCompany would grant the entitlement.
-- Keep the two columns the onboarding form legitimately writes; take away the
-- rest.
REVOKE UPDATE ON public.companies FROM anon, authenticated;
GRANT UPDATE (name, industry) ON public.companies TO authenticated;
REVOKE INSERT ON public.companies FROM anon, authenticated;
GRANT INSERT (user_id, name, industry) ON public.companies TO authenticated;

-- DELETE closes the same hole from the other side: deleting your own row
-- cascades away csv_import_events (the monthly quota) and the next API call
-- re-provisions a company with a fresh 14-day trial. Nothing in the client
-- deletes companies, so the grant and policy were pure attack surface.
REVOKE DELETE ON public.companies FROM anon, authenticated;
DROP POLICY IF EXISTS companies_owner_delete ON public.companies;

-- reports are server-owned too: signoff='completed' is the compliance audit
-- trail, and no client code reads or writes the table through the SDK.
REVOKE INSERT, UPDATE, DELETE ON public.reports FROM anon, authenticated;

-- The onboarding form's INSERT never set trial_ends_at, so a user whose first
-- page was /app/calculator got a company with no trial and a 402 on every data
-- route. Default it at the table so every creation path starts the trial.
ALTER TABLE public.companies
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + INTERVAL '14 days');
UPDATE public.companies
  SET trial_ends_at = created_at + INTERVAL '14 days'
  WHERE trial_ends_at IS NULL;

-- Verify after applying (must all be false):
--   SELECT has_column_privilege('authenticated','public.companies','subscription_plan','UPDATE'),
--          has_table_privilege('authenticated','public.companies','DELETE'),
--          has_table_privilege('authenticated','public.reports','UPDATE');
--
-- rollback (restores the pre-migration browser-role privileges; anon never had a
-- matching RLS policy and is deliberately not re-granted; the column-level
-- grants above are subsumed by the table-level grant and may stay):
-- ALTER TABLE public.companies ALTER COLUMN trial_ends_at DROP DEFAULT;
-- GRANT INSERT, UPDATE, DELETE ON public.companies TO authenticated;
-- CREATE POLICY companies_owner_delete ON public.companies
--   FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
-- GRANT INSERT, UPDATE, DELETE ON public.reports TO authenticated;
