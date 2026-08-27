-- Public lead capture now enters through POST /api/leads, where the Express
-- boundary enforces an 8 KiB body limit, per-IP rate limiting, a honeypot, and
-- shared payload validation before the server-side database write.
DROP POLICY IF EXISTS leads_public_insert ON public.leads;
REVOKE INSERT ON public.leads FROM anon, authenticated;

-- This legacy table has no application write path. Keeping an unconditional
-- anonymous insert policy only expands the spam and storage-abuse surface.
DROP POLICY IF EXISTS contact_submissions_public_insert ON public.contact_submissions;
REVOKE INSERT ON public.contact_submissions FROM anon, authenticated;

-- Rollback (only if the direct public write path is deliberately restored):
-- GRANT INSERT ON public.leads TO anon, authenticated;
-- CREATE POLICY leads_public_insert ON public.leads
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
-- GRANT INSERT ON public.contact_submissions TO anon, authenticated;
-- CREATE POLICY contact_submissions_public_insert ON public.contact_submissions
--   FOR INSERT TO anon, authenticated WITH CHECK (true);
