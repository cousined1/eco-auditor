-- K10 follow-up (additive only): when the visitor made a consent choice, next to
-- when the server received the record.
--
-- consent_records.created_at is the time the SERVER received the record, and for
-- some records that is not the time of the choice. POST /api/consent-audit is
-- rate limited per IP (10 a minute), so a choice answered with a 429 waits in the
-- visitor's browser (the localStorage outbox eco_consent_outbox) and is delivered
-- on a later visit, stamped with that later time. The record that is meant to
-- show when a person consented then says they consented days after they did.
--
--   decided_at   the time of the choice as the BROWSER reported it (decidedAt in
--                the POST body, taken when the choice was queued). The server keeps
--                it only when it is a well-formed UTC timestamp no more than
--                5 minutes after the time it received the record (a fast clock)
--                and no more than 30 days before it; a value outside that window,
--                or no value, is ignored and the column stays NULL. The record is
--                stored either way: consent evidence is never refused over a
--                wrong clock.
--                Read it as COALESCE(decided_at, created_at): the decision time
--                when the browser gave a believable one, else the receipt time.
--                created_at keeps meaning "received", so both times are on the row.
--
-- Additive only: one nullable column, nothing backfilled (every row that exists
-- today stays NULL, which reads as "the receipt time is all we have"), no
-- constraint, no REVOKE, no drop, RLS unchanged. The window is checked by the
-- server and deliberately not by a CHECK here: a CHECK against created_at would
-- compare the browser's time with the DATABASE host's clock, and a skew between
-- that host and the application's would refuse legitimate records.
--
-- Apply BEFORE the server code that names this column deploys (its INSERT lists
-- decided_at; until the column exists it answers 503 retryable and the visitor's
-- browser keeps the record queued). Safe to leave applied on rollback: the previous
-- server never names it. Re-runnable (IF NOT EXISTS).

ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

COMMENT ON COLUMN public.consent_records.decided_at IS
  'When the visitor made the choice, from their browser clock, kept only if within 5 minutes after and 30 days before created_at (the server receipt time); NULL = none sent or not believable, use created_at.';

-- Verify after applying:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'consent_records' AND column_name = 'decided_at';
--     -- 1 row: decided_at | timestamp with time zone | YES
--   SELECT count(*) FILTER (WHERE decided_at IS NULL) AS without_decision_time, count(*) AS records
--     FROM public.consent_records;
--     -- every record from before this migration is in without_decision_time (nothing is backfilled)
--   After the new server code has handled a choice:
--   SELECT id, COALESCE(decided_at, created_at) AS decided, created_at AS received
--     FROM public.consent_records ORDER BY id DESC LIMIT 10;
--
-- rollback (only once no deployed code writes this column; it DELETES every stored
-- decision time, so leaving the migration applied under older code is the safe
-- choice; a forward-only platform needs this as a new migration):
-- ALTER TABLE public.consent_records DROP COLUMN IF EXISTS decided_at;
