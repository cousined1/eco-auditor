# Human actions required before full MVP launch

The automated audit remains **BLOCKED (5 blockers)**. Complete these actions in order and attach redacted evidence to the launch record. Never paste credential values, reset tokens, customer data, or full webhook payloads into GitHub.

## 1. Security: rotate and invalidate historically exposed credentials

- **Finding:** SEC-001
- **Owner / priority:** Security, P0
- **Why IDE access is insufficient:** Rotation must occur in provider consoles and production secret stores. Git history cleanup can invalidate clones and requires coordinated approval.
- **Safety warning:** This changes production credentials. Keep the old and new values out of terminals with command history, tickets, commits, screenshots, and chat. Verify each dependent service before revoking the old value; coordinate any history rewrite with all repository users.
- **Step-by-step procedure for the findings in `SECURITY-HISTORY.md`:** `docs/runbooks/credential-rotation.md` (order matters: revoke, rotate, verify, close the ledger, and only then add the gitleaks baseline).
- **Steps:**
  1. Open the secret-scan evidence available to the Security owner and map each redacted finding to its provider and environment.
  2. In each provider console, create a replacement credential with the least required scope. Repository variable names identify consumers; examples include `INSFORGE_ANON_KEY`, `INSFORGE_SERVICE_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`, and Railway/Stripe variables. Copy values only into the approved provider secret store.
  3. Update the corresponding Railway production variable and any CI secret. Redeploy one service at a time.
  4. Exercise `/api/health`, `/ready`, authentication, database access, AI/chat if configured, and billing for the changed provider.
  5. Revoke the old credential and prove a request using the old value is rejected. Record only provider audit-event IDs and timestamps.
  6. Decide with the repository owner whether to rewrite Git history. If approved, schedule a freeze, use the organization's secret-removal procedure, force-push only during the window, and require fresh clones.
- **Expected evidence:** Provider rotation/revocation event IDs, Railway deployment ID, green health checks, old-value rejection, and the repository owner's history decision.
- **Re-test:** Run the current-tree and full-history secret scanners; verify zero active credentials and that every historical finding has a rotation record.

## 2. Engineering + Security: controlled authentication, recovery, and tenant-isolation matrix

- **Findings:** AUTH-001 and AUTH-002
- **Owner / priority:** Engineering primary, Security witness, P0
- **Why IDE access is insufficient:** The test requires production auth email delivery, disposable users, real bearer tokens, and two isolated tenant fixtures.
- **Safety warning:** Use synthetic companies and email addresses. Do not attempt cross-tenant probes against real customer records, and do not record passwords, bearer tokens, or reset URLs.
- **Steps:**
  1. Create two disposable inboxes and two production users, A and B, through `/signup`.
  2. Verify email delivery if required, log in, refresh, log out, and confirm the old session cannot access a protected endpoint.
  3. From `/forgot-password`, request a reset for A. Confirm the public response does not disclose whether an arbitrary address exists.
  4. Use A's reset link once, confirm the new password works and the old password fails, then replay the link and confirm rejection.
  5. Create synthetic Company A and Company B records with one facility, emission entry, and report each. (The schema has no supplier, upload, or compliance-task tables, so there is nothing to create for those.)
  6. With A's token, attempt to read, update, and delete every B resource through the same SDK/API paths the app uses. Repeat B against A. Every attempt must be denied or return no rows.
  7. Confirm anonymous requests to protected emissions and billing endpoints return 401 and authenticated wrong-tenant requests return the documented denial behavior.
  8. Delete the synthetic data/users under the approved data-retention procedure.
- **Expected evidence:** Redacted test matrix with timestamps, route/resource types, HTTP/result categories, email delivery ID, and reset replay rejection. Tokens and resource data must be omitted.
- **Re-test:** Repeat after every auth provider, RLS, or tenant-query change.

## 3. Engineering + Finance: Stripe test-mode lifecycle

- **Finding:** BILL-001
- **Owner / priority:** Engineering primary, Finance approval, P0
- **Why IDE access is insufficient:** A provider-backed test requires Stripe test mode, configured price IDs, webhook endpoint events, and observation of application entitlements.
- **Safety warning:** Confirm Stripe is in test mode before beginning. Never use a real card, customer, or production subscription and never paste webhook signing secrets into commands or reports.
- **Steps:**
  1. In Stripe test mode, verify the configured variables `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the six price ids `STRIPE_PRICE_{STARTER,GROWTH,PRO}_{MONTHLY,ANNUAL}` (the server also accepts their `VITE_`-prefixed aliases), and `VITE_STRIPE_PK` point to the same test account/environment.
  2. Create a disposable EcoAuditor user and start checkout from `/pricing`.
  3. Pay with Stripe's documented successful test payment method. Confirm redirect/cancel URLs use `https://ecoauditor.io` and that exactly one customer/subscription is created.
  4. In Stripe Workbench, confirm the webhook endpoint is exactly `https://ecoauditor.io/api/webhook` (any other path answers 404), receives a signed successful event, and the app maps the subscription/customer to the correct InsForge user.
  5. Resend the same event. Confirm no duplicate entitlement, user mapping, or side effect is created.
  6. Open the billing portal, change plan if supported, then cancel. Confirm Stripe, the app entitlement, and the database converge after each event.
  7. Run one declined-payment test and verify no paid entitlement is granted and the user sees a safe error.
- **Expected evidence:** Redacted Stripe request/event IDs, test customer/subscription IDs, app state before/after, duplicate-event result, cancellation state, and Finance sign-off.
- **Re-test:** Run `npm test -- --run tests/server-billing.test.ts tests/stripe.test.ts`, then repeat the provider lifecycle after billing changes.

## 4. Platform + Data: isolated restore drill and recovery objectives

- **Finding:** REC-001
- **Owner / priority:** Platform primary, Data owner, P0
- **Why IDE access is insufficient:** The backup must be restored through InsForge/provider controls into an isolated target; the business must approve RPO/RTO and data ownership.
- **Safety warning:** Never restore over production. Confirm the destination project/branch is isolated and access-restricted before starting.
- **Steps:**
  1. Name a primary and backup recovery owner and approve an RPO and RTO for authentication and application data.
  2. Select backup `pre-launch-audit-2026-08-26` in the InsForge backup interface/CLI.
  3. Create or designate an isolated non-production restore target with no outbound integrations, billing webhooks, email delivery, or customer access.
  4. Restore the backup to that target and record start/completion timestamps and provider job ID.
  5. Compare table counts and sample relational integrity for the tables the migrations create: `companies`, `facilities`, `emission_entries`, `reports`, `csv_import_events`, `users`, `consent_records`, `leads`, and `contact_submissions`, plus `blog_posts`, which `/api/publish` writes but no migration creates (there are no supplier, upload, compliance-task, or audit-log tables). Use synthetic/redacted identifiers only.
  6. Run a login/read test with a disposable restored account only if the recovery procedure permits it.
  7. Destroy or quarantine the restore target under the data-retention policy after evidence review.
- **Expected evidence:** Named owners, approved RPO/RTO, restore job ID, elapsed time, integrity checklist, deviations, and cleanup record.
- **Re-test:** Schedule at least quarterly and after material schema/provider changes.

## 5. Platform: alert routing and incident ownership proof

- **Finding:** OPS-001
- **Owner / priority:** Platform, P0
- **Why IDE access is insufficient:** Alert rules, notification integrations, and on-call rotations live in Railway/monitoring/communications providers.
- **Safety warning:** Use a synthetic non-destructive failure during an agreed window. Do not intentionally take the production service down or expose secrets in logs.
- **Steps:**
  1. Name a primary on-call owner, backup, escalation window, and incident communication channel.
  2. Configure external HTTPS checks for `/api/health` and `/ready`, plus alerts for sustained 5xx rate, failed deployments/restarts, database connectivity failures, and Stripe webhook failures. What to watch, which free tools fit and the thresholds: `docs/runbooks/monitoring.md`.
  3. Set thresholds to require more than one failed sample where appropriate, document suppression/maintenance behavior, and send alerts to both primary and backup paths.
  4. Trigger a safe synthetic alert using the monitoring provider's test function or an isolated staging failure.
  5. Confirm the primary receives and acknowledges it within the target time; confirm escalation to the backup by using a provider test/escalation feature, not by ignoring a real incident.
  6. Link the runbook for health failure, database failure, credential rotation, rollback, and webhook backlog.
- **Expected evidence:** Rule IDs, redacted notification screenshots, acknowledgement/escalation timestamps, named owners, and runbook links.
- **Re-test:** Monthly alert test and after monitoring, Railway, database, or notification-provider changes.

## Launch-owner closeout

After all five sections are complete, rerun the re-audit procedure in `LAUNCH_AUDIT.md`. Change the verdict only when every applicable launch-gate row has PASS evidence and `LAUNCH_AUDIT.md` and `LAUNCH_AUDIT.json` agree.
