BLOCKED (5 blockers)

# EcoAuditor Full MVP Launch Audit

## 1. Executive summary

- **Product / target:** EcoAuditor SaaS at `https://ecoauditor.io`.
- **Audit window:** 2026-08-26, production plus a local production build, America/Los_Angeles.
- **Checklist:** `saas-launch-audit-skill-v2 (1).md`, full MVP gate.
- **Repository:** branch `audit/full-launch-2026-08-26`, starting commit `972b44b914ea69c2edf3ddf3c2ae6219526ee6f8`. The workspace was already dirty; pre-existing changes in `findings.sarif`, `src/lib/socialAuth.ts`, and `tests/social-auth.test.ts` were preserved and excluded from this audit's commits.
- **Released:** PR #22 merged at `5b493e3dceb36e784b91c2be1a1eb9afe75650fa`; production QA exposed a Railway consent-storage mismatch, fixed by PR #23 and deployed at `53be5f98cf11fc46496b3a798691c6b91db9484e`.
- **Verdict:** **BLOCKED (5 blockers)**. The build, public journeys, protected API behavior, migrations, accessibility, mobile layout, domain/TLS, dependency audit, and security headers have verified evidence. A full launch remains blocked because controlled authentication/tenant tests, historical credential rotation evidence, provider-backed billing tests, a recovery drill, and operational alert ownership are not evidenced.

This is a truthful release audit, not a declaration that the five human/provider gates passed. The remediations applied in this session reduce immediate web and database risk but do not waive those gates.

## 2. System map

| Boundary | Components | Data / trust concern |
|---|---|---|
| Browser | Vite/React public pages, auth UI, calculator/dashboard | Untrusted input, consent, bearer tokens, accessibility |
| Railway app | Express `server.cjs`, static assets, health/API routes | Auth guard, rate limits, Stripe webhook verification, lead validation |
| InsForge | Auth, PostgreSQL/PostgREST, storage, realtime | RLS, tenant isolation, anonymous role grants, backup/recovery |
| Stripe | Checkout, portal, subscription, signed webhooks | Money, entitlements, replay/idempotency |
| DNS/TLS | `ecoauditor.io`, `www` redirect, Railway edge | Availability, certificates, canonical host |

Critical journeys audited: landing to signup/login, password recovery entry point, pricing, demo/contact capture, protected API rejection, public blog rendering, mobile consent/keyboard navigation, and deployment health.

## 3. Full MVP launch gate

| # | Gate item | Status | Evidence |
|---:|---|---|---|
| 1 | Production build and runtime start | PASS | `npm run build`; 14/14 prerenders; live `/api/health` and `/ready` healthy |
| 2 | Acquisition-to-value journey | PARTIAL | Public signup/demo/contact controls render and validate; no controlled account-to-first-value run |
| 3 | Authentication and recovery | UNVERIFIED | Routes exist; no disposable production inbox/account or recovery token test |
| 4 | Protected APIs reject anonymous traffic | PASS | Live emissions summary and billing endpoints returned 401 without a bearer token |
| 5 | Authorization and tenant isolation | UNVERIFIED | RLS inspected; no two-tenant adversarial fixture was authorized/available |
| 6 | No unresolved critical/high exploitable issue | PASS | `npm audit --audit-level=high` and `npm run security:audit` pass; public write and stored-XSS paths remediated |
| 7 | Secret hygiene and historical rotation owner | FAIL | No active committed secret found; historical credential findings lack rotation/history-cleanup evidence |
| 8 | Billing, entitlements, signed webhooks | UNVERIFIED | Code/tests pass; no Stripe test-mode checkout/webhook/cancel run with provider access |
| 9 | Critical write integrity / duplicate protection | PASS | Server lead boundary, validation/rate limiting, billing tests, and sanitized publishing verified |
| 10 | Safe migration path | PASS | Pre-release backup; isolated InsForge branch; dry-run reports transaction, 0 conflicts, no table drops |
| 11 | Backup ownership and recovery | FAIL | Backup completed, but no restore drill, named owner, or approved RPO/RTO evidence |
| 12 | Production config, domain, TLS, redirects | PASS | Apex HTTPS healthy; `www` 301s to apex; canonical/robots/sitemap and security headers verified |
| 13 | Error visibility, monitoring, incident owner | PARTIAL | Structured logs and health endpoints exist; alert routing/on-call ownership not evidenced |
| 14 | Legal/privacy consistency | PASS | Privacy, terms, and DPA routes build and render; consent control present; placeholder scan passes |
| 15 | Keyboard and mobile usability | PASS | Axe 0 violations; first-tab primary CTA; mobile invalid-form errors; consent overlay collision fixed |
| 16 | No launch-blocking dead control or placeholder | PASS | Route crawl 10/10; demo CTA repaired; build-time legal-placeholder check passes |
| 17 | Provider/DNS human tasks completed | UNVERIFIED | DNS/TLS verified, but Stripe, auth email, secret rotation, restore, and alert evidence remain human-owned |
| 18 | All gate items have PASS evidence | PARTIAL | 9 PASS, 2 FAIL, 3 PARTIAL, 4 UNVERIFIED; therefore launch is blocked |

## 4. Blockers

| ID | Sev | Domain | Problem / evidence | Owner | Bucket | Re-test |
|---|---|---|---|---|---|---|
| AUTH-001 | HIGH | Authentication / authorization | No controlled signup, login, reset-token replay, or two-tenant isolation run | Engineering + Security | HUMAN | Execute the matrix in `HUMAN_ACTIONS.md`; retain redacted request IDs/results |
| SEC-001 | HIGH | Secret hygiene | Historical scan detected credential material; rotation and history cleanup are not evidenced | Security | HUMAN | Rotate each affected credential, invalidate old values, rescan current tree and Git history |
| BILL-001 | HIGH | Billing | Stripe-backed checkout, signed webhook, entitlement transition, and cancellation not run end to end | Engineering + Finance | HUMAN | Complete test-mode lifecycle and reconcile app, provider, and database state |
| REC-001 | HIGH | Recovery | Backup exists but no restore drill, named owner, RPO, or RTO | Platform / Data | HUMAN | Restore into an isolated target and record integrity checks and elapsed time |
| OPS-001 | HIGH | Operations | Health/logging exist but alert delivery and incident ownership are not evidenced | Platform | HUMAN | Trigger a safe synthetic failure and capture alert acknowledgement/escalation |

## 5. Readiness scorecard

| Status | Count |
|---|---:|
| PASS | 9 |
| FAIL | 2 |
| PARTIAL | 3 |
| UNVERIFIED | 4 |
| N/A | 0 |

The communication-only pass ratio is 50% (9/18). It does not override the blocked verdict.

## 6. Complete findings

The complete checklist is the 18-row launch-gate table above. Finding IDs group the seven non-PASS rows into five actionable blockers: AUTH-001 covers gates 3 and 5; SEC-001 gate 7; BILL-001 gate 8; REC-001 gate 11; OPS-001 gates 13, 17, and 18. `LAUNCH_AUDIT.json` records the same 18 statuses in machine-readable form.

Additional non-gating observations: the SEO crawl returned all audited routes successfully, with low-severity title-width/orphan heuristics only; production cache/lock diagnostics showed no pressure; source LSP diagnostics were unavailable because the TypeScript language server is not installed, so `tsc -b`, ESLint, Vitest, and the production build are the type/diagnostic evidence.

## 7. Fixed this session

| Finding | Files | Change | Verification |
|---|---|---|---|
| WEB-001 | `src/pages/ContactUs.tsx`, `src/pages/Demo.tsx`, `src/lib/leads.ts`, `migrations/20260827001003_harden-public-lead-writes.sql` | Moved anonymous lead writes behind the rate-limited/validated server endpoint and removed public table grants/policies | Client tests, server tests, migration dry-run |
| SEC-002 | `server-publish.cjs`, `server.cjs`, `tests/publish-endpoint.test.ts` | Sanitized new and legacy blog HTML at both write and read boundaries | Stored-XSS regression tests |
| A11Y-001 | `src/pages/LandingPage.tsx`, `src/components/Footer.tsx` | Corrected heading hierarchy and marked the primary hero CTA | Axe: 0 violations; keyboard check |
| UX-001 | `scripts/build-partials.js`, `src/components/Header.tsx`, `tests/contact-page.test.tsx` | Routed shared “Book a Demo” CTA to `/demo` | Focused navigation regression test |
| UX-002 | `src/components/ChatbotWidget.tsx`, `tests/contact-page.test.tsx` | Suppressed chat until consent resolves, preventing mobile overlay collision | Focused consent regression test and mobile inspection |
| OPS-002 | `server.cjs`, `tests/server.test.ts` | Provisioned the Railway-owned consent audit table before accepting consent writes | Regression red/green; runtime migration log; production consent POST 202; no deployment errors |

## 8. Human actions

The provider-specific steps, safety constraints, owners, completion evidence, and re-test commands are in `HUMAN_ACTIONS.md`. They are ordered: secret rotation, controlled auth/tenant test, Stripe lifecycle, restore drill, then alert/on-call proof.

## 9. Deferred work

| Item | Tier | Rationale | Owner / target |
|---|---|---|---|
| Narrow unusually wide SEO titles | V1 | Low severity; no indexing or functional failure | Marketing, next content release |
| Add GSC and production analytics evidence | V1 | Visibility improvement, not a security/data gate | Growth, within 14 days |
| Replace in-memory rate limiting with shared storage before horizontal scale | V1 | Current single-instance control works; multi-instance consistency needed before scale-out | Platform, before >1 replica |

## 10. Command and evidence log

| Command / check | Environment | Result | Limitation |
|---|---|---|---|
| `npm run lint` | local candidate | exit 0 | LSP unavailable |
| `npm test -- --run` | local candidate | exit 0, 25 files / 220 tests | Provider calls mocked or guarded |
| `npm run build` | local candidate | exit 0, 14 prerenders | Local build intentionally lacks production secrets |
| `npm audit --audit-level=high` | local candidate | exit 0, 0 vulnerabilities | Registry advisory scope only |
| `npm run security:audit` | local candidate | exit 0 | Repository-specific dependency policy |
| `git diff --check` | local candidate | exit 0 | Whitespace only |
| Browser route/axe/mobile checks | production baseline + local candidate | 0 axe violations; critical public routes render | Auth provider lifecycle not exercised |
| InsForge advisor/schema/branch dry-run | production + isolated branch | 2 public-write criticals identified and staged for removal; 0 merge conflicts | Production merge occurs only after code deployment |
| Backup create | InsForge production | `pre-launch-audit-2026-08-26` completed | Restore not exercised |
| Production release | Railway | PR #22 SHA healthy; follow-up PR #23 SHA healthy | Railway configuration-as-code deprecation warning is non-blocking |
| Consent persistence probe | Railway production | Synthetic reject-all record returned 202; runtime migration completed; 0 deployment error logs | One synthetic audit record was intentionally created |
| `npm run db:migrate:check` | InsForge production | 10 migrations current; both release migrations applied | Branch-merge API failed server-side; repository migration runner applied the identical reviewed files |

## 11. Changed-file review

Audit-owned changes are limited to the files listed in “Fixed this session,” plus `tests/leads-client.test.ts`, this report, `LAUNCH_AUDIT.json`, `HUMAN_ACTIONS.md`, `dogfood-report.md`, and three historical audit text files whose credential values were redacted to satisfy the repository secret gate. Generated evidence is under `dogfood-output/screenshots/`. Pre-existing changes in `findings.sarif`, `src/lib/socialAuth.ts`, and `tests/social-auth.test.ts`, and the supplied checklist file, are not part of the audit commits.

## 12. Known limitations

- No disposable production auth users/inboxes or permission to generate tenant data.
- No Stripe dashboard/test credentials for a provider-backed lifecycle.
- No recovery target or authorization to perform a production-data restore drill.
- No alerting/on-call dashboard access.
- No Google Search Console or analytics account evidence.
- TypeScript LSP unavailable by prior environment choice; compiler/lint/build evidence substituted.
- The InsForge branch-merge endpoint returned an internal server error while leaving production unchanged. The same two dry-run migrations were applied successfully through `npm run db:migrate`; the isolated branch remains available for provider investigation.
- The current InsForge backend cannot trigger an on-demand advisor scan. Direct catalog queries prove the two permissive policies/grants are absent; the displayed scheduled advisor snapshot remains stale until the next provider scan or backend upgrade.

## 13. Re-audit procedure

1. Complete each action in `HUMAN_ACTIONS.md` and attach redacted evidence.
2. Run `npm run lint && npm test -- --run && npm run build && npm audit --audit-level=high && npm run security:audit`.
3. Run `npm run db:migrate:check`, the InsForge advisor, and verify the two public insert policies/grants are absent.
4. Repeat signup/login/recovery and two-tenant negative tests, then the Stripe test-mode lifecycle.
5. Restore the named backup into an isolated target and execute integrity checks.
6. Trigger and acknowledge a safe synthetic alert.
7. Re-crawl production, run axe, check keyboard/mobile consent behavior, and verify `/api/health`, `/ready`, protected 401s, TLS, redirect, robots, sitemap, and security headers.
8. Update both audit files. The first line may become `LAUNCHABLE` only when all 18 applicable rows have PASS evidence.
