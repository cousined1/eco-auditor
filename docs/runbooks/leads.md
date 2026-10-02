# Runbook: leads (who sees them, how to read them, where they can go unseen)

Every contact, demo and sales-chat form ends in one row in `public.leads`. A person
learns about it only if the lead notifier is on and got through. This page is how to
read the table yourself, why silence is possible even with the notifier on, and the
decisions that are still yours (audit findings F-A-07 and F-B-12, verification items
I-2 and D-3).

## What the code does

- **Stored first.** `POST /api/leads` (contact and demo forms) and the sales chat write the
  row with `writeLead` in `server.cjs`. In every environment a failed database write, or
  no database configured at all, answers 503 from `POST /api/leads` (500 only for an error
  that is not a data-store failure), so the visitor is told and can retry; the sales chat
  says it could not save the request and asks for an email instead. Nothing is stored in
  its place: the server writes no lead to a file.
- **Then announced, at most.** After the row is stored, `server-notify.cjs` POSTs one
  Slack-compatible message to `LEAD_NOTIFY_WEBHOOK_URL`, without waiting for it. Nothing
  else alerts anyone: there is no email, digest or admin screen.
- **The URL must be https** in production. Plain `http://` to loopback is accepted only
  when `NODE_ENV` is not production (a local sink for the tests); in production it is
  refused at boot with the warning `LEAD_NOTIFY_WEBHOOK_URL is not usable, lead
  notifications are disabled (it must be an https URL)` and the notifier stays off. The
  URL is a bearer secret: never log or paste it.
- **Do not set the variable yet.** `credential-rotation.md` (the `LEAD_NOTIFY_WEBHOOK_URL`
  row) holds it until the Privacy Policy and the DPA name the team-messaging workspace as
  a recipient of lead notifications. Until it is set, the SQL below is the only way a
  lead is seen, and the server logs `LEAD_NOTIFY_WEBHOOK_URL is not set: new leads are
  stored in public.leads but nobody is notified` once at boot.

## How a lead can be stored and never announced

1. **No usable variable** (unset, not https, credentials in the URL): the boot warning
   above, then silence for every lead.
2. **The cap is spent.** The notifier sends at most **30 messages per 10-minute window**
   per server process, counted across all sources. `/api/leads` allows 5 submissions per
   address per 10 minutes, so **six addresses are enough to use the whole budget**: a
   real lead in the same window is stored and not announced. The server logs one warning
   per window, `Lead notifications throttled; leads are still stored in public.leads`
   (with `maxPerWindow` and `windowMinutes`). The window lives in memory: a restart
   resets it, and a second instance would have its own.
3. **The webhook fails.** A non-2xx answer, a redirect (never followed), or no answer
   within 3 seconds is logged as a warning without lead data or the URL
   (`Lead notification rejected by the webhook`, `... refused: the webhook answered with
   a redirect`, `Lead notification failed`). The lead is **not retried**.
4. **The channel is not read.** Outside what the code can see.

So the notifier is a convenience, and the table is the record. While nobody has promised
to watch the channel, read the table.

## Read the table (owner, read-only)

In the InsForge SQL editor, or `psql "$DATABASE_URL"`. Every statement is a `SELECT`;
none writes. The rows are personal data (name, email, free text): look at them where you
run the query, and do not paste results into tickets, chat or a repository.

```sql
-- 1. The latest 50 leads, newest first.
SELECT id, created_at, type, source, name, email, company,
       preferred_date, preferred_time, left(message, 200) AS message
  FROM public.leads
 ORDER BY created_at DESC
 LIMIT 50;

-- 2. Everything since the last time you looked (edit the timestamp).
SELECT id, created_at, type, source, name, email, company, left(message, 200) AS message
  FROM public.leads
 WHERE created_at > TIMESTAMPTZ '2026-10-01 00:00:00+00'
 ORDER BY created_at;

-- 3. Leads per day and source, last 30 days: a quiet stretch after a launch, or a burst
--    from one source, is worth a look.
SELECT date_trunc('day', created_at) AS day, source, count(*) AS leads
  FROM public.leads
 WHERE created_at > now() - interval '30 days'
 GROUP BY 1, 2
 ORDER BY 1 DESC, 2;

-- 4. Busy 10-minute stretches, where the notifier's cap of 30 could have been spent.
--    Fixed buckets approximate its window, which starts at the first message after the
--    previous window ended.
SELECT to_timestamp(floor(extract(epoch FROM created_at) / 600) * 600) AS window_start,
       count(*) AS leads
  FROM public.leads
 WHERE created_at > now() - interval '30 days'
 GROUP BY 1
HAVING count(*) >= 20
 ORDER BY 1 DESC;

-- 5. The same address submitting repeatedly: spam, or one person being persistent.
SELECT lower(email) AS email, count(*) AS leads, min(created_at) AS first, max(created_at) AS last
  FROM public.leads
 WHERE created_at > now() - interval '30 days'
 GROUP BY 1
HAVING count(*) > 2
 ORDER BY leads DESC
 LIMIT 20;
```

When query 4 shows a busy stretch, read the leads of that stretch with query 2 before
you trust that the channel showed them all.

## Decisions that are yours

1. **Who reads the table, and how often,** until the notifier is on and you trust it.
   Nothing in the product replaces this; the forms promise a follow-up by email.
2. **Whether the notifier goes live, and when.** Only after the Privacy Policy and DPA
   text naming the recipient is live (see above), and only with a channel someone
   staffs. A time bound on the follow-up promise comes back in the copy only when that
   is true (F-A-07).
3. **A digest or a leads view.** Not built. A digest (new leads since yesterday, sent
   on a schedule) needs a scheduler and a recipient that receives the data, which is
   another place lead data goes and another line for the privacy text. A leads view in
   the app needs an admin role that does not exist (every user has one company, and
   user-editable metadata is deliberately not trusted for access). Pick one, or keep
   the SQL and a calendar reminder.
4. **An alert on the throttle line.** The warning is in the server log; whether it pages
   or only notifies is a choice in the monitoring setup (`monitoring.md`).
5. **How long leads are kept.** Nothing deletes them automatically (Privacy Policy,
   retention). Decide a period with counsel and delete by hand, or say otherwise.
