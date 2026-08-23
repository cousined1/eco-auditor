# Eco-Auditor Core System-Path Audit — 2026-08-22

**Scope:** every core system path mapped against its stated intent; functions lacking guard clauses on user input or with ambiguous error handling in async chains.
**Method:** full read of the HTTP surface (`server.cjs` routes/middleware/helpers), `server-security.cjs` / `server-billing.cjs`, `emissions-engine.cjs` / `emission-factors.cjs` public functions, and a parallel subagent scan of `src/hooks|lib|pages|components` for async anti-patterns. Findings verified against source before classification.
**Statuses:** `CONFIRMED` = reproduced by code-path trace or test · `PROBABLE` = failure mode plausible from code shape, not executed · `REVIEWED-OK` = flagged by scan but intentional/correct on inspection.

---

## 1. System paths vs stated intent

| Path | Stated intent | Verdict |
|---|---|---|
| Auth (`authGuard`, `apiAuthGuard`, OAuth chain) | Verify bearer tokens against InsForge; never trust client identity | Server guards sound; **client-side async chain had unguarded throws** → F-01 |
| Tenant isolation (`requireCompanyAccess`, `resolveAuthorizedCompanyId`) | Every company-scoped route resolves the caller's own company first | Sound — existence oracles already closed in prior passes (facilities/reports/signoff) |
| Ingest (`POST /api/ingest/csv`) | Validate rows, persist atomically, meter honestly | Row validation sound; **catch-all mislabeled infra failures as bad input** → F-02 |
| Calculation (`calculateEntry`, `summarizeEntries`) | Reject non-finite/negative amounts; unknown factors throw | Sound; zero amounts accepted (documented); factor fallback risk → F-05 |
| Reporting (`reports/generate`, `/download`) | Deterministic PDF regenerated from persisted data | Sound; raw error echo → F-03 |
| Billing (Stripe checkout/webhook/sync) | Entitlement survives webhook loss; stale events can't resurrect cancellations | Sound — retryable-failure semantics, event watermarking, same-second tie-break all present |
| Public forms (chat, leads, consent) | Sanitize client-controlled state before persistence | Sound — honeypot, bounds, HMAC'd IP, rate limits present |
| Dashboard reads (summary/trend) | Cached, tenant-scoped, plan-gated | Sound |

## 2. Findings

| ID | File | Function | Expected behavior | Reproduction scenario (pre-fix) | Status | Fix |
|---|---|---|---|---|---|---|
| F-01a | `src/lib/socialAuth.ts` | `startSocialSignIn` | Always resolves to `{ok}` result; SDK/network throws become failed results | Disable network after clicking "Continue with Google" → SDK throw escapes; button stays pending, no error shown | CONFIRMED (test pins it) | try/catch → `{ok:false}` result |
| F-01b | `src/components/auth/authHelpers.ts` | `startProviderSignIn` | Never rejects; always reports via `onError` and clears stashed auth intent on failure | Any fault above `onError`'s reach → rejection propagates to page handler that has no catch | CONFIRMED | defense-in-depth try/catch |
| F-01c | `src/pages/AuthCallback.tsx` | `finishOAuth` | Thrown session faults render the error card with "Back to login" | Network drop mid-OAuth-callback → `getCurrentUser()` throw is an unhandled rejection; user stranded on infinite spinner forever | CONFIRMED | `.catch()` transform preserving `{data,error}` shape |
| F-02 | `server.cjs` | `POST /api/calculate` handler | Validation errors → 400 with user-facing message; data-store outage → 5xx generic message | Stop Postgres while authenticated, POST valid entries → `400 {"error":"Emission data store unavailable"}` — wrong class + internal text echoed | CONFIRMED (test pins it) | `classifyApiFailure` split |
| F-02b | `server.cjs` | `POST /api/ingest/csv` handler | Same split; quota-count pg faults are infra, CSV header errors are input | Missing `csv_import_events` table → raw pg relation error returned as 400 to the browser | PROBABLE (same pattern) | `classifyApiFailure` split |
| F-03 | `server.cjs` | `POST /api/companies/:id/reports/generate` | 500 with generic message; internals stay in server logs | DB insert failure during generate → response body echoes `err.message` verbatim | CONFIRMED | generic 500 payload |
| F-04 | `src/components/carbon-calculator/index.tsx` | dashboard load | Failed facilities query surfaces via `setError`, matching the company-query contract one block above | RLS/permission fault on `facilities` select → silently renders empty facility list that looks like "no facilities yet" | CONFIRMED | check `facilityError`, throw into existing catch |
| F-05 | `emission-factors.cjs` | `getSource` (~L41–47) | Unknown source should fail loudly, not fall back | CSV row with typo'd source name whose key equals its category key gets priced at the category default with no warning — wrong report number, no signal | CONFIRMED (code-traced) | **Not changed** — altering factor resolution changes report numbers for existing data; needs product decision. Recipe: reject unknown sources in `factorForEntry` and surface as ingest warning instead of silent default |
| F-06 | `src/lib/session.ts` | `isSessionValid` | — | Scan flagged fail-open on network error | REVIEWED-OK | Intentional, commented ("don't force logout on a blip"); 401 still fails closed via interceptor |
| F-07 | `src/lib/api.ts` | `getUpgradeRequired` | — | Scan flagged empty catch on JSON parse | REVIEWED-OK | Legitimate non-JSON handling; null means "no upgrade info", callers degrade correctly |
| F-08 | `src/lib/stripe.ts` | `getAuthToken`, `fetchPriceConfig`; `consent-context.tsx` audit post | Diagnostics only | Console-only logging, fire-and-forget audit | REVIEWED-OK (P2) | Deferred — observability polish, no user-facing failure path |

## 3. Verification

- `npm test` (vitest): new F-01/F-02 regression suites pass against fixes.
- `tsc -b`: clean.
- `eslint .`: clean on touched files.

## 4. Deferred / needs product input

1. **F-05 silent factor fallback** — recommend failing unknown sources loudly at ingest with a per-row warning, but this changes accepted-data semantics for existing tenants.
2. `summarizeEntries` excludes errored rows and returns them in `errors[]`; report consumers that ignore the array understate totals. Current server consumers surface `errors` in API responses — frontend display of those arrays was not audited end-to-end.
3. P2 diagnostics (F-08) — structured telemetry when observability work resumes.
