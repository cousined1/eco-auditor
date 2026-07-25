-- Ordering guard for Stripe subscription webhooks.
--
-- Stripe does not guarantee delivery order. A stale customer.subscription.updated
-- (status "active") delivered after customer.subscription.deleted would overwrite
-- the canceled state and restore access until period end. Recording the
-- event.created of the last applied event lets syncSubscriptionRecord skip any
-- event older than what the row already reflects.
--
-- NULL means "no event applied yet", so the first event of any age wins.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_event_at TIMESTAMPTZ;

COMMENT ON COLUMN public.companies.subscription_event_at IS
  'event.created of the most recently applied Stripe subscription event. Used to reject out-of-order webhook deliveries.';
