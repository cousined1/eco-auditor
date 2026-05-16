# Remediation Notes

Date: 2026-05-14 23:34 America/Los_Angeles

## Remediated

- Removed tracked `.env.ollama` secret-like file.
- Added `server-security.cjs` with tested security helpers for headers, dev-auth gating, tenant authorization, and public lead sanitization.
- Changed API auth to fail closed unless `ALLOW_DEV_AUTH=true` outside production.
- Enforced company membership checks on emissions, ingestion, facilities, compliance, and report endpoints.
- Stopped the dashboard from hard-coding `test-company-1`; same-origin API requests now forward the current InsForge bearer header when available.
- Prevented production sample-data fallback unless `ALLOW_SAMPLE_DATA=true`.
- Added CSP and production HSTS headers.
- Bounded public chat and lead payload sizes, added upstream AI/auth fetch timeouts, and normalized lead inputs.
- Removed the public checkout diagnostic response.
- Updated PostCSS and added an npm override for Drizzle's vulnerable transitive `esbuild` path.
- Pinned `node:22-alpine` by digest in the Dockerfile and copied required runtime helper files.
- Added `.semgrepignore` and `.dockerignore` entries for audit/tooling folders and non-runtime helper projects.

## Verification

- `npm test`: 10 files, 93 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm audit --audit-level=high`: found 0 vulnerabilities.
- `semgrep --config auto --json --output semgrep-audit.json .`: 0 findings.

## Remaining Operational Action

If `.env.ollama` contained a real token, revoke and rotate it. The file is deleted from the working tree, but secret exposure in prior git history requires rotation and, if needed, history cleanup.
