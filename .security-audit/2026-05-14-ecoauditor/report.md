# EcoAuditor Security Audit

Date: 2026-05-14 23:20 America/Los_Angeles
Route: GODMYTHOS SECURITY_AUDIT
Skill pack: security-opencode-skill-v1.1.0

## Executive Summary

This audit found several production-blocking issues in the EcoAuditor app. The highest-risk items are a tracked secret-like environment file, tenant authorization gaps across emissions/compliance/report APIs, and fail-open development authentication behavior if the InsForge backend URL is missing. The core build and tests are healthy, but the authorization model needs hardening before this should be treated as production-ready.

## Scope

- App code: `server.cjs`, `src/**`, `package*.json`, `Dockerfile`, `index.html`
- Security configuration and deployment-adjacent files visible in the repository
- Static analysis with Semgrep community rules
- Dependency audit with `npm audit`
- No live DAST or destructive testing was performed.

## Critical Findings

### SEC-001: Tracked Secret-Like Value

- Severity: Critical
- Evidence: `.env.ollama:5`
- Source: Semgrep `generic.secrets.security.detected-generic-api-key`
- Risk: A secret-like API key is tracked in the repository. If this is a real token, anyone with repository access or deployment artifacts may be able to use it.
- Fix: Revoke and rotate the token, remove the file from git history if it contained a real secret, add `.env*` patterns with explicit safe exceptions, and move local-only values into untracked environment files or a secret manager.

### SEC-002: Cross-Tenant BOLA/IDOR Across Business APIs

- Severity: Critical
- Evidence:
  - `server.cjs:776` reads arbitrary `company_id` from query.
  - `server.cjs:865` reads facilities for arbitrary `:id`.
  - `server.cjs:903` signs off arbitrary compliance task ID.
  - `server.cjs:920` downloads report by report ID without owner check.
- Risk: An authenticated user can potentially read or mutate another company's emissions, facilities, compliance, and report data by changing `company_id`, company route params, facility IDs, task IDs, or report IDs.
- Fix: Derive the active company from the authenticated user/session or a server-side membership table. Check every object access against that membership before returning data or mutating state. Add negative tests for cross-tenant access.

### SEC-003: API Auth Guard Fails Open When InsForge Is Misconfigured

- Severity: Critical
- Evidence: `server.cjs:188`
- Risk: If `INSFORGE_BASE_URL` is missing, `apiAuthGuard` assigns a development user and allows protected routes through. A production misconfiguration would turn many protected emissions/compliance/report endpoints public.
- Fix: Fail closed outside an explicit local development mode. Require a deliberate `ALLOW_DEV_AUTH=true` plus `NODE_ENV !== 'production'` gate for mock users.

## High Findings

### SEC-004: Dashboard Hard-Codes Shared Test Tenant

- Severity: High
- Evidence: `src/pages/Dashboard.tsx:44`
- Risk: The dashboard fetches `test-company-1` for every browser session. Combined with weak server-side tenant checks, users can view the same tenant data.
- Fix: Use authenticated user/company context. Do not keep tenant IDs in client code as authority.

### SEC-005: Database Failure Falls Back To Sample Data

- Severity: High
- Evidence:
  - `server.cjs:710`
  - `server.cjs:727`
- Risk: On backend/database errors, production APIs can silently return seeded in-memory data. This creates confidentiality, integrity, and compliance problems because users may receive fabricated or unrelated data.
- Fix: Fail closed for production data endpoints. Return a controlled 503/500 and surface a non-sensitive error. Keep sample fallback behind local demo mode only.

## Medium Findings

### SEC-006: Public AI Chat Endpoint Needs Stronger Abuse Controls

- Severity: Medium
- Evidence: `server.cjs:582`, global limit at `server.cjs:84`
- Risk: `/api/chat` is public, accepts large prompts, and can call paid upstream LLM providers. A global 120 requests/minute/IP limit is not enough for cost control, and upstream fetches do not have explicit server-side timeouts.
- Fix: Add per-route quotas, request-size limits, upstream `AbortController` timeouts, abuse monitoring, and optionally require authenticated/session-scoped access.

### SEC-007: Public Lead Capture Stores PII In Plain Local JSON

- Severity: Medium
- Evidence: `server.cjs:669`
- Risk: `/api/leads` accepts public submissions and stores personal data on the app filesystem. It has no explicit message length limits, retention policy, bot controls, or encryption-at-rest story.
- Fix: Add field length limits, spam controls, retention policy, and move leads into an access-controlled store with clear data handling rules.

### SEC-008: Missing CSP And HSTS Headers

- Severity: Medium
- Evidence:
  - `server.cjs:75`
  - `server.cjs:78`
  - `server.cjs:79`
- Risk: The server sets several useful headers, but there is no `Content-Security-Policy` or `Strict-Transport-Security`. This weakens browser-side XSS containment and transport hardening.
- Fix: Add a CSP compatible with the app's script/style/font/image/connect needs, and add HSTS only when HTTPS is guaranteed.

### SEC-009: Dependency Audit Has Moderate Vulnerabilities

- Severity: Medium
- Evidence:
  - `package.json:30` uses `postcss` `^8.5.9`.
  - `package-lock.json:543` includes older `esbuild` via `@esbuild-kit`.
  - `package-lock.json:967` includes `@esbuild-kit/core-utils`.
- Risk: `npm audit --audit-level=high` passed, but `npm audit` reported moderate vulnerabilities in `postcss` and `esbuild` transitive dependencies.
- Fix: Upgrade `postcss` to a patched 8.5.10+ line and review the `drizzle-kit`/`@esbuild-kit` path for a safe upgrade that does not break migrations.

### SEC-010: Docker Base Image Is Not Digest-Pinned

- Severity: Medium
- Evidence: `Dockerfile:2`, `Dockerfile:18`
- Risk: `node:22-alpine` can change over time, which weakens build reproducibility and supply-chain integrity.
- Fix: Pin the image by digest and refresh intentionally on a patch cadence.

## Low / Informational

### SEC-011: Public Checkout Diagnostic Endpoint Exposes Config State

- Severity: Low
- Evidence: `server.cjs:258`
- Risk: `/api/checkout` returns whether Stripe is configured. This is low-sensitivity but unnecessary production exposure.
- Fix: Remove the diagnostic endpoint or restrict it to local/admin diagnostics.

### SEC-012: Embedded `openensemble/` Directory Has Many Semgrep Findings

- Severity: Info unless deployed
- Evidence: Semgrep reported most findings under `openensemble/**`, including path traversal warnings, insecure websocket warnings, and shell-install warnings.
- Risk: If `openensemble/` is packaged, deployed, or exposed, it should receive its own audit and threat model. If it is unrelated to EcoAuditor runtime, exclude it from application deployment and scans with explicit documentation.
- Fix: Confirm whether `openensemble/` belongs in this repo and deployment artifact. Remove, isolate, or audit it separately.

## Positive Controls Observed

- Stripe webhook uses signature verification.
- Checkout and portal routes require auth and Stripe configuration.
- SQL queries observed in Stripe customer code use parameterized statements.
- Global rate limiting exists.
- Several baseline headers are present: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- `npm run lint`, `npm test`, and `npm run build` passed.

## Verification

- `npm audit --audit-level=high`: passed with no high/critical advisories; moderate advisories remain.
- `npm run lint`: passed.
- `npm test`: passed, 8 files and 85 tests.
- `npm run build`: passed.
- `semgrep --config auto --json --output semgrep-audit.json .`: completed successfully after elevated retry, 240 raw findings across 331 tracked files.

## Coverage Gaps

- No live DAST was performed.
- No manual authentication bypass attempts were run against a deployed environment.
- InsForge RLS policies and backend metadata were not verified from live infrastructure.
- No GitHub Actions workflow hardening review was possible because no first-party root `.github/workflows` files were found.
- Additional tools were not installed locally: gitleaks, trivy, syft, grype, osv-scanner, zizmor, actionlint.
