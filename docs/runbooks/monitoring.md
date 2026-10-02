# Runbook: monitoring and alerting

What to watch in production, where the signal comes from, which tools fit, and
the thresholds recommended for alerts (audit findings F-G-08 and F-F-08). The
code now writes the signals; turning them into alerts is an **owner action**:
nothing below is configured yet, and no external account was touched when this
was written.

The thresholds are recommendations for a low-traffic launch, not measurements.
Revisit them after two weeks of real traffic.

## What the server writes

Every log line is one JSON object on stdout (stderr for `level: "error"`), which
Railway parses into attributes you can filter on (`@name:value`, and numeric
ranges such as `@status:500..599`).

| Line (`message`) | Level | Fields | Meaning |
|---|---|---|---|
| `request` | info | `method`, `route` (pattern, never the URL), `status`, `durationMs`, `requestId`, `userId`/`companyId` when signed in, `aborted` when the client left | one per request |
| `Request failed` | error | `route`, `status`, `error` (`name`, `message`, `code`, `stack`) | a handler threw or rejected; the client got 500 or 503 with the request id |
| `Unhandled rejection` | error | `error`, `rejectionsInWindow` | a promise nobody awaited failed; the process kept running |
| `Rejection storm: exiting ...` | error | `rejectionsInWindow` | 10 of those within 60 s; the process exits and Railway restarts it |
| `Uncaught exception: exiting ...` | error | `error` | the process exits and Railway restarts it |
| `Client error report` | warn | `source`, `route` (page path), `error` (`message`, truncated `stack`), `build` | a visitor's browser hit an error (render crash, uncaught error, unhandled rejection) |
| `Database health probe failed` | error | `error` | `/health`, `/api/health` or `/ready` could not reach the database |
| `Webhook signature verification failed`, `Webhook processing failed`, `Webhook sync did not persist ...`, `Webhook sync abandoned ...` | error | `type`, `id`, `error` | Stripe webhook problems |
| `Webhook rejected: STRIPE_WEBHOOK_SECRET is not configured` | error | | every Stripe webhook is being refused |

No line carries an email address, IP address, user agent, cookie, query string
or request body. Error text is scrubbed of connection-string credentials and
Stripe/InsForge keys before it is written.

## What to monitor, and the recommended thresholds

| Signal | Source | Alert when | Severity |
|---|---|---|---|
| Liveness | external HTTPS check of `GET https://ecoauditor.io/api/health`, expecting 200 and the body text `"status":"ok"` | 2 consecutive failures, or failures confirmed from 2 regions | page |
| Readiness | external check of `GET https://ecoauditor.io/ready`, expecting 200 | 2 consecutive failures (503 means the database is unreachable) | page |
| Server errors | `@status:500..599 AND @durationMs:>=0` (access lines only) | 5 or more in 5 minutes, or more than 2% of requests over 15 minutes | page |
| Crash or restart | `"Rejection storm"` or `"Uncaught exception"`; Railway deployment webhooks | any | page |
| Unawaited failures | `"Unhandled rejection"` | any (each one is a bug to fix) | notify |
| Browser errors | `"Client error report"` | more than 20 in 15 minutes, or any new `error.message` after a deploy | notify |
| Stripe webhooks | the webhook lines above; Stripe Dashboard, Developers, Webhooks, the endpoint's failed deliveries | any `Webhook rejected` line: page. Any other webhook error line, or a failed delivery in Stripe: notify | page / notify |
| Slow requests | `@durationMs:>=2000` (only access lines carry `durationMs`; Railway's own HTTP logs have `@totalDuration`) | more than 10 in 15 minutes on `/api/` routes | notify |
| Deploy identity | `GET /api/health` returns `sha` | after each deploy, `sha` must equal the commit that was meant to ship | manual |

Check from two regions (for example one in North America and one in Europe), so
an outage of one probe location is not reported as an outage of the site.

## Which tools fit (free tiers, as their pricing pages read on 2026-09-30)

- **Railway's healthcheck is not monitoring.** Railway's documentation says the
  healthcheck runs only at the start of a deployment and is "not used for
  continuous monitoring". It keeps a broken deploy from being promoted; it does
  not tell you when a running one breaks.
- **UptimeRobot, free plan:** 50 monitors, 5-minute interval, HTTP and keyword
  monitors, location-specific monitoring. The page describes the free plan as
  "Good for hobby and non-profit projects": read the terms before relying on it
  for a commercial service.
- **Better Stack Uptime, free tier:** 10 monitors and heartbeats, 1 status page,
  Slack and e-mail alerts, described as "Free for personal projects".
- **Uptime Kuma** (self-hosted; Railway's healthcheck page points to a template).
  If it runs on Railway it shares Railway's failures, so keep one external
  monitor as well.
- **Railway monitors** (CPU, RAM, disk, egress thresholds with e-mail, in-app
  and webhook notifications) require the Pro plan. They cover resources, not HTTP
  errors.
- **Railway webhooks** (Project, Settings, Webhooks) send deployment status
  changes; Railway formats them for Slack or Discord URLs. Use them for failed
  deploys and crashes.
- **Log-based alerts:** Railway's log documentation describes filtering, not
  alerting. To alert on the 5xx, rejection and client-error rates above, forward
  the logs to a service that alerts on a saved query (Railway suggests a
  forwarder such as Vector or Fluent Bit, a vendor SDK or OpenTelemetry). Until
  that exists, review the filters above daily and after every deploy.

## Owner actions (NEEDS-OWNER)

1. Create the two external checks (liveness and readiness) from two regions and
   route them to the phone of whoever is on call.
2. Add a Railway project webhook for deployment events to the team channel.
3. Decide on log forwarding for the rate-based alerts, or put the daily filter
   review on someone's calendar.
4. Save the filters above in the Railway log explorer so the review is one click.
5. Acceptance (F-F-08): on staging, a deliberately thrown route error shows up
   as a `Request failed` line within a minute; stopping the staging database
   makes the readiness check alert within 5 minutes.

## Client error reports and consent

`POST /api/client-error` receives the message, a truncated stack, the page path
and where the error came from. It sends no cookie (the browser omits
credentials), and the server reads no cookie, IP address or user agent for the
log. The reports hold no personal data, so they are not gated by the cookie
banner; the Privacy Policy wording is a separate owner decision (see the obs-a
report).
