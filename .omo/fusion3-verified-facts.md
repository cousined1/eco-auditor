# fusion-3 — Web-Verified Facts (orchestrator-resolved contradictions)

Verified by the orchestrator (glm-5.2) via EPA.gov on 2026-07-11, per fusion-3
Step 3.5 ("verify with your own web/bash first"). The judge must treat these as
ground truth and override any panelist claim that contradicts them.

## P0-04 — Emission factor versions (VERIFIED)

### eGRID
- **eGRID2023** (data year 2023) — released **January 15, 2025** (EPA, 18th
  edition). Revision 1: 1/17/2025. Revision 2: 6/12/2025.
- **eGRID2024** — was *planned* for "January of 2026" but, per the EPA
  "Detailed Data" page (last updated **May 20, 2026**), eGRID2023 is **still the
  current/latest version available for download**. eGRID2024 had NOT been
  released as of that page update.
- **Conclusion:** "eGRID 2024" is NOT a real release as of 2026-07-11. Every
  `eGRID 2024` / `eGRID2024` string in the codebase must become **eGRID 2023**
  (data year 2023, publishedYear 2025). `verified: true`.
  - GPT-5.6's proposal to use "eGRID 2022" is **WRONG** (rejected).
  - GPT-5.6's proposal to keep "2024" with `verified: true` **violates §3**
    (rejected).
  - Opus 4.8's correction (eGRID2023, released 2025-01-15) is **CORRECT and
    adopted**.
- Source: https://www.epa.gov/egrid/detailed-data (page updated 2026-05-20);
  https://www.epa.gov/system/files/documents/2025-01/egrid2023_technical_guide.pdf

### EPA GHG Emission Factors Hub
- **2025 GHG Emission Factors Hub** — released **January 2025**; EPA page last
  updated **January 12, 2026**. It is the latest version (archived versions back
  to 2011 are available, including 2024).
- The 2025 Hub uses eGRID **2022** generation data for purchased-electricity
  factors (it was finalized before eGRID2023 was available).
- **Conclusion:** "EPA GHG Factor Hub 2024" must become **"EPA GHG Factor Hub
  2025"**. `verified: true`. Both panels agreed; adopted.
- Source: https://www.epa.gov/climateleadership/ghg-emission-factors-hub

## P0-06 — backupsDeletionWindowDays (35 vs 30) — RESOLVED

- GPT-5.6 correctly flagged: the value **35** does NOT appear in any source
  file. `Security.tsx:108` says **"Automated daily backups with 30-day
  retention"**. The "35" originated from the *audit's desired* trustFacts spec,
  not from code or confirmed infrastructure.
- **Resolution:** The real backup-retention window is NOT ops-confirmed in this
  session. Per §3 ("do not publish guessed values"), `trustFacts.backupsDeletionWindowDays`
  must be set to the **current documented value 30** with `verified: false`
  (because the code's own claim is not infrastructure-confirmed), and the UI
  renders "(verify before publication)" next to it. Do NOT assert 35, and do
  NOT assert 30 as a verified fact. 35 is a *recommendation* to raise with ops,
  recorded in the launch-readiness checklist, not a value to publish.
- Security.tsx:108 "30-day retention" stays as-is (it matches the documented
  value); the trustFacts entry reconciles to 30 + verified:false.

## P0-05 — Model A vs B — RESOLVED

- Both surviving panelists independently recommend **Model B** (fix the
  marketing copy to match the existing card-backed, auto-charge Stripe
  wiring). No panelist argued for Model A. The orchestrator confirms Model B
  is the ponytail choice: zero billing-code change, zero Stripe-config change,
  zero Terms amendment. **Adopted: Model B.**

## Other Opus brief-corrections (adopted)

- `SampleReport.tsx:82` badge is "GHG Protocol aligned" (not "audit-ready");
  the "audit-ready" strings are at `:9, :37, :46`.
- `robots.txt` already disallows `/login` and `/auth/`; only `/signup` needs
  adding (do not duplicate).
- `server.cjs` salesbot pricing line is 805 (closing brace 806).
- `PrivacyPolicy.tsx` TLS bullet is at :163 (section opens :160).
- `prerender.mjs:13-17` stale comment says renderToStaticMarkup but
  `entry-server.tsx:14` uses renderToString — doc inconsistency to fix in
  passing, not load-bearing.

## Still unverified (must be `verified:false` + "(verify before publication)")

- Deploy target: Railway vs AWS (code says "AWS and InsForge"; DPA says generic
  "Cloud hosting provider"). `trustFacts.cloudHosting` = VERIFY.
- Real Stripe price IDs / amounts behind env vars (the $49/$149/$499 vs
  $149/$399/$999 inconsistency is real; the *correct* values depend on Stripe
  config the panels cannot see). `pricing.ts` must read amounts from a single
  source and the launch checklist must reconcile against Stripe config.
- "Set up in under 10 minutes" claim — soften to "Most teams are up and running
  quickly" unless verifiable.