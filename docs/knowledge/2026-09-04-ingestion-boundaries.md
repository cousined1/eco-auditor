---
type: bugfix
tags: [csv, emissions, quota, transactions]
confidence: high
created: 2026-09-04
source: Ruflo swarm swarm-1788572917847-3vnyqj and executable regression checks
---

# Ingestion boundary audit

## Fixes

- Check catalog scope before accepting precomputed CO2e. Previously a known Scope 3 category declared as Scope 1 bypassed classification validation.
- Parse CSV records across quoted newlines; reject unterminated quoted fields instead of silently truncating notes.
- Persist CSV rows and quota events in the same locked transaction. Failed inserts previously consumed the monthly allowance.
- Batch inserts at 1,000 rows inside that transaction. A valid 100 KiB upload can exceed PostgreSQL's 65,535 bind-parameter ceiling with a single 14-column insert.
- Accept uppercase `.CSV` filenames in the file input.

## Execution trace

1. COMPLETED: isolated checkout of `cousined1/eco-auditor`; confirmed production tracks `master`, not a branch named `main`.
2. COMPLETED: two independent source-audit agents reviewed backend and client flows. Initial implementation worker failed; replacement provider reported a usage limit. Parent implemented fixes directly.
3. COMPLETED: four parser/classification regressions failed against the original engine and passed after repair.
4. COMPLETED: Oracle reviewed transaction/parser changes and identified the large-insert protocol limit; batching and later-batch rollback regressions added.
5. COMPLETED: `npm test` passed 250 tests in 28 files; `npm run lint` passed; `npm run build` passed TypeScript compilation and all 14 prerender routes. Locked dependency install reported zero vulnerabilities.
6. COMPLETED: local running Express API excluded a misclassified row with an error, imported a multiline CSV as one row, and rejected unterminated CSV with HTTP 400. Calculator summaries deliberately return HTTP 200 with per-row errors rather than failing the entire inventory.

## Limits and rejected findings

- This is a bounded audit, not proof that the application has no remaining bugs.
- Session preservation on transient server/network failures is intentional; changing it to logout would introduce an outage-triggered logout regression.
- Transaction tests execute the real transaction function with a simulated PostgreSQL client, not a live database. No production customer records or billing transactions were used as test fixtures.
- Local build used Node 24.15; production specifies Node 22. Local InsForge/Stripe build configuration is absent, so authenticated production flows were not claimed as verified.
- LSP refuses paths outside the original request directory; TypeScript build and ESLint were used as the available validation checks.
- Final PR and live deployment evidence belongs in the release report, after this artifact is committed.
