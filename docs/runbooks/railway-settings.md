# Runbook: move the deploy settings out of `railway.toml` before 2026-12-01

Audit finding F-G-09. The healthcheck gate and the restart policy live only in
`railway.toml`, and Railway's config-as-code documentation (read 2026-09-30)
says config as code is deprecated and keeps working for legacy services only
until **2026-12-01**. After that date, unless the same settings exist in the
service settings (or in Railway's Infrastructure as Code, which the same page
recommends, with a "Migrating from Config as Code" guide), a deploy that cannot
reach its database would be promoted, and a crashed process would follow
whatever restart policy the dashboard has.

This is an **owner action** in the Railway dashboard. No setting was changed
when this runbook was written.

## 1. Set these in the service settings (NEEDS-OWNER)

Railway dashboard, the Eco-Auditor project, the web service, **Settings**. The
build and deploy sections hold the same fields as `railway.toml`; menu names
may differ slightly from the ones below.

| Setting | Value | From `railway.toml` |
|---|---|---|
| Builder | Dockerfile | `[build] builder = "dockerfile"` |
| Dockerfile path | `Dockerfile` | `[build] dockerfilePath` |
| Custom start command | `node server.cjs` (the Dockerfile's `CMD` is the same) | `[deploy] startCommand` |
| Healthcheck path | `/ready` | `[deploy] healthcheckPath` |
| Healthcheck timeout | `100` seconds (Railway's default is 300; the `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` service variable is the documented alternative) | `[deploy] healthcheckTimeout` |
| Restart policy | On Failure | `[deploy] restartPolicyType = "ON_FAILURE"` |
| Max restart retries | `10` | `[deploy] restartPolicyMaxRetries` |

While `railway.toml` exists, Railway applies its values over the dashboard's
("Configuration defined in code will always override values from the
dashboard"), so setting the dashboard now changes nothing today and keeps
everything the same after the cutoff.

**Build-time variables.** `VITE_STRIPE_PK`, `VITE_INSFORGE_BASE_URL`,
`VITE_INSFORGE_ANON_KEY` and `VITE_GTM_ID` are service variables like any other.
They reach the Vite build because the Dockerfile declares each with `ARG`, which
is how a Dockerfile build receives Railway variables; that already holds. The
`[[build.args]]` blocks in `railway.toml` are not a documented config-as-code
key and are not what injects them. A new `VITE_` variable needs its own `ARG`
line in the Dockerfile.

**What `/ready` answers.** 200 `{"status":"ok"}` when the app can serve (the
database answered, or none is configured) and 503 `{"status":"degraded"}` when
the configured database does not answer within 2 seconds. Railway sends the
healthcheck from `healthcheck.railway.app`; the app does not filter hosts, so
nothing needs allowing.

## 2. Verify that a deploy with an unreachable database is not promoted

Do this in a **non-production Railway environment** (a staging or PR
environment of the same service), never in production.

1. In that environment, set `DATABASE_URL` to an address that cannot answer,
   for example `postgresql://check:check@192.0.2.1:5432/check` (192.0.2.0/24 is
   reserved for documentation and is not routed).
2. Trigger a deploy of the current commit.
3. Expected: the deployment fails ("Healthcheck failed" in its deploy log) and
   the environment's previous deployment keeps serving. With
   `NODE_ENV=production` the process itself also refuses to boot
   (`DATABASE_URL is configured but unreachable`), and On Failure restarts it up
   to 10 times without it ever answering `/ready`.
4. Restore the environment's real `DATABASE_URL` and redeploy.
5. Record the date and result next to F-G-09 in the launch checklist.

Railway's documentation also notes that a service with an attached volume (the
intro video at `/app/videos`) has a short downtime on redeploy even with a
healthcheck. That is expected and unrelated to this check.

## 3. After the settings are verified

Delete `railway.toml` in its own change, then confirm that the settings page
still shows the values in section 1 and repeat the check in section 2 once.
Until then keep the file and the dashboard identical.
