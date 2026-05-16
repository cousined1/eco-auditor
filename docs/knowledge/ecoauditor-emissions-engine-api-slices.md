---
type: pattern
tags: [ecoauditor, emissions-engine, express-api, godmythos]
confidence: high
created: 2026-05-15
source: "COPILOT-BUILD-GUIDE implementation - trace: [engine tests: COMPLETED, server routes: COMPLETED, npm test/build/smoke: COMPLETED] outcome: SUCCESS"
supersedes: null
---

# Shared Emissions Engine for Server APIs

EcoAuditor's emissions math should live in one CommonJS engine module so `server.cjs` and Vitest can use the same calculation path. This avoids testing copied factor tables while the Express routes drift.

## When This Applies

Use `emissions-engine.cjs` for calculator, dashboard summary, CSV ingestion validation, compliance status, and facility aggregation behavior.

## When This Does Not Apply

Do not put Stripe billing logic or InsForge client auth behavior in this engine. Those remain in their existing billing/auth modules.
