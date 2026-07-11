# Marketing-Claims Copy Review — for approval

**Date:** 2026-07-06
**Status:** 🟡 DRAFT — proposed edits only. **No source files changed.** Approve per-item, then I apply.
**Why:** The site advertises capabilities the code does not implement (legal/false-advertising exposure for a compliance product). Each item below shows the exact current copy, the problem, and a truthful replacement. Where a claim is a real roadmap item, I give a **roadmap-framed** alternative so you can keep the intent without asserting it exists today.

**Ground truth (what the product actually does today):**
- **Factors:** hardcoded **EPA** emission factors + **eGRID** regional electricity (location-based), IPCC AR6 GWPs. ~9 spend-based Scope 3 factors. No GLEC/EXIOBASE/EPA-WARM datasets; no market-based Scope 2; not "all 15 Scope 3 categories."
- **Ingestion:** **CSV text parsing only.** No OCR, no "AI extraction," no QuickBooks/Xero/ERP connectors, no public API, no webhooks.
- **AI Assistant:** gated "Coming Soon" (not live).
- **Reports:** generates a report record + a basic in-memory PDF. No GHG assertion letters, no SB 253 / CBAM "packages," no XLSX/JSON/XBRL exports.
- **Audit trail:** no immutable/versioned audit schema — entries are editable/deletable.
- **Security stack:** TLS/HTTPS, CSP/HSTS headers, rate limiting, Postgres RLS, consent records, InsForge auth, Stripe (no card data stored by the app). Hosting is **Railway + InsForge**, not AWS. No RBAC, SSO/SAML/OIDC, scoped API keys, or configurable retention in code.
- **Pricing (real, from checkout):** Starter **$149/mo** ($1,490/yr) · Growth **$399/mo** ($3,990/yr) · Pro **$999/mo** ($9,990/yr). Trial on Starter/Growth **monthly** only. **No free tier.**
- **Compliance naming:** the Climate Corporate Data Accountability Act is **SB 253** — *not* AB 1305. **AB 1305** is the separate Voluntary Carbon Market Disclosures Act. The SEC climate-disclosure rule was withdrawn in 2025.

Legend: 🔴 false today · 🟠 overstated/misleading · 🟣 needs host verification (may be true depending on infra).

---

## 1. Pricing consistency (H1) — three sources disagree

Real prices are **$149 / $399 / $999**, but SEO/meta/chatbot say **$49 / $149 / $499** and invent a "Free tier."

### 1a. `src/pages/Pricing.tsx:12-14` — 🔴 JSON-LD schema prices wrong + "AI extraction"
**Current:** `price: "49"` (Starter), `"149"` (Growth, desc "Full Scope 1/2/3 reporting with AI extraction"), `"499"` (Pro).
**Proposed:**
- Starter → `"price": "149"`
- Growth → `"price": "399"`, description → `"Full Scope 1/2/3 reporting with CSV import"`
- Pro → `"price": "999"`

### 1b. `src/pages/Pricing.tsx:12` (list description) + `:29` (meta description) — 🔴 "Free tier" + wrong prices + "no credit card"
**Current (`:29`):** `'Eco-Auditor pricing: Free tier, Starter $49/mo, Growth $149/mo, Pro $499/mo. Audit-ready Scope 1-3 emissions tracking. 14-day free trial, no credit card required.'`
**Proposed:** `'Eco-Auditor pricing: Starter $149/mo, Growth $399/mo, Pro $999/mo. Audit-ready Scope 1–3 emissions tracking. 14-day free trial on monthly plans.'`
> Remove "Free tier" (none exists) and "no credit card required" (Stripe trial collects a payment method). Also fix the list `description` at `:11` ("From free tier to enterprise-grade…") → "From startups to enterprise-grade compliance reporting."

### 1c. `server.cjs:~809 & ~837` — 🔴 chatbot prices + nonexistent "Enterprise" plan
**Current:** `Starter — $49/mo … Growth — $149/mo … Enterprise — Custom pricing` and elsewhere `Starter plan at $49/mo`.
**Proposed:** `Starter — $149/mo … Growth — $399/mo … Pro — $999/mo`. (There is no "Enterprise" plan; the top tier is **Pro $999/mo**.)

---

## 2. `src/pages/LandingPage.tsx`

### 2a. `:111,218,248` + FAQ `:14,15,24,25` — 🔴 "AI extracts", "OCR", "AI-powered document extraction"
Only CSV text parsing exists.
**Current:** `title: 'AI extracts & calculates'` · `title: 'AI Extraction', desc: 'OCR and AI parse your documents…'` · `description="Upload utility bills, invoices, and freight docs. OCR extraction with confidence scores…"` · FAQ "AI-powered document extraction" / "our AI extracts the data".
**Proposed (honest-now):** reframe around CSV import:
- `'Import & calculate'` — desc: `'Import activity data by CSV; we apply EPA/eGRID emission factors and flag low-confidence entries for review.'`
- Step 02 `'Import & Map'` — `'Import CSV activity data; we apply emission factors and flag low-confidence rows for your review.'`
- Feature card: `'Upload CSV activity data with confidence scores and a human review queue.'`
- FAQ: replace "AI-powered document extraction" → "CSV-based activity import with confidence scoring"; "our AI extracts the data" → "you import a CSV and we apply emission factors".
**Proposed (roadmap alt), if OCR/AI is genuinely planned:** keep the concept but tag it: `'AI document extraction (coming soon)'` and ensure it's not implied as available in the "up and running in 10 minutes" flow.

### 2b. `:219,258,285` — 🟠 "immutable audit trail" / "version history"
No immutable audit schema; entries are editable/deletable.
**Current:** `'…builds an immutable audit trail.'` · `description="Immutable audit trail. Every entry shows source, emission factor, reviewer, timestamp, and version history."`
**Proposed:** `'…builds a reviewable emissions ledger.'` · `description="Traceable emissions ledger. Every entry records its source, emission factor, and confidence score."` (Drop "immutable", "reviewer", "version history" until those exist.)

### 2c. `:285,290` — 🟠 fabricated testimonials (prior H4, still present)
Named-customer quotes ("We went from a 40-page spreadsheet…", "largest retail buyer… ready in 3") on a beta product.
**Proposed:** Remove, or relabel the section header to **"Illustrative scenarios"** and strip any implied real attribution/logos.

### 2d. `:327` — 🟠 "Join hundreds of SMBs" on a beta product
**Current:** `Join hundreds of SMBs turning messy data into defensible emissions records. Start free — no credit card, no consultant required.`
**Proposed:** `Turn messy data into defensible emissions records. Start your 14-day free trial — no consultant required.` (Remove "hundreds of SMBs" and "Start free/no credit card".)

### 2e. FAQ `:14,24` — 🟠 price range "$49–$499/month"
**Proposed:** `$149–$999/month` (match real pricing).

---

## 3. `src/pages/MethodologyPublic.tsx`

### 3a. `:17,240-243,266` — 🟠 factor databases not in the engine
Claims GLEC Framework v3, EXIOBASE 3.8, EPA WARM/EEIO as active factor libraries. Engine ships EPA + eGRID + IPCC AR6 GWPs only.
**Proposed (honest-now):** list only what's used: **"EPA GHG Emission Factors Hub, eGRID (location-based electricity), IPCC AR6 GWP-100."** Remove GLEC/EXIOBASE/WARM cards (`:240-243`) and trim the JSON-LD/FAQ answers accordingly.
**Roadmap alt:** keep them under a clearly-labeled **"Planned factor sources"** subsection.

### 3b. `:41` — 🟠 Scope 2 "Location & market-based"
Only location-based (eGRID) is implemented.
**Proposed:** badge → `'Location-based'`; if market-based is planned, note "market-based method planned."

### 3c. `:49,50,137` — 🟠 "15 categories supported" / "covering all 15 categories"
Engine has ~9 spend-based Scope 3 factors; not full 15-category coverage.
**Proposed:** `'Spend-based estimates for common Scope 3 categories'`; badge → `'Spend-based Scope 3'`. Drop "all 15 categories" unless/until implemented.

### 3d. `:20,138,149,269` — 🟠 SB 253 / CBAM "reporting packages … pre-configured"
No polished framework packages exist yet (report gen is basic).
**Proposed:** soften to `'export your inventory to support SB 253 and CBAM reporting'` rather than "pre-configured reporting packages … designed to satisfy … requirements."

### 3e. `:271` — 🔴 "custom emission factors on Pro/Enterprise … tracked in the audit trail"
No custom-factor upload or audit trail exists; there's no "Enterprise" plan.
**Proposed:** remove this FAQ, or mark "planned."

---

## 4. `src/pages/SampleReport.tsx`

### 4a. `:162` — 🔴 "Compliance Package": assertion letter, SB 253 pack, CBAM templates, base-year memo
None generated by the app.
**Proposed:** replace the list with what exists — `['Emissions summary (PDF)', 'Detailed entry ledger (CSV)', 'Scope 1/2/3 breakdown', 'Confidence scoring']` — or clearly label the card **"Planned / on the roadmap."**

### 4b. `:186` — 🔴 export formats "XLSX, JSON, XBRL"
Only PDF (basic) and CSV exist.
**Proposed:** `['PDF (executive summary)', 'CSV (detailed ledger)']`. Remove XLSX/JSON/XBRL until implemented.

### 4c. `:200` — 🔴 "Upload your first utility bills and invoices. We'll extract the data…"
No document extraction.
**Proposed:** `Import your activity data by CSV and we'll build your carbon inventory. Start your 14-day free trial.` (Drop "extract" and "no credit card required".)

---

## 5. `src/pages/Security.tsx` — 🟣 mostly needs host verification, several 🔴

> Several claims may be *partially* true via Railway/InsForge but are asserted as product features that aren't in code. **Do not publish any you can't evidence.**

| Line | Claim | Verdict | Proposed |
|---|---|---|---|
| `:9,17,98` | "SOC 2-aligned controls" / "SOC 2 Type II in progress (Q3 2026)" | 🟠 | Only state if truthfully in progress with a real timeline; otherwise remove. |
| `:17,78` | "role-based access" / "RBAC per workspace" | 🔴 | Remove — no RBAC in code. |
| `:79` | "SSO-ready: SAML 2.0 and OIDC on Pro plan" | 🔴 | Remove or mark "planned." |
| `:80` | "API keys scoped to specific permissions" | 🔴 | Remove — no API/keys exist. |
| `:17,90` | "automated data retention" / "retention policies configurable per workspace" | 🔴 | Remove — not implemented. |
| `:59-61,108-109` | "AES-256 at rest", "backups encrypted", "automated daily backups, 30-day retention", "cross-region replication" | 🟣 | Keep only what the host (Railway/InsForge) contractually provides and you can evidence; otherwise soften to "encryption in transit (TLS 1.3); data stored with our infrastructure providers." |
| `:68` | "Cloud infrastructure on AWS and InsForge" | 🟠 | Correct to the real hosts (Railway + InsForge) or remove the specific provider name. |
| `:126` | "Our AI extracts relevant data points…" | 🔴 | Rewrite to CSV import; no AI extraction. |
| `:129` | "data retained for 90 days … deleted from backups and DR storage" | 🟣 | Only assert if you have a real, enforced deletion process. |

**Truthful baseline you *can* claim today:** HTTPS/TLS 1.3, security headers (CSP/HSTS/X-Frame-Options), rate limiting, row-level security on the database, OAuth via InsForge, PCI handled by Stripe (card data never touches our servers), and "we never sell or share your data."

---

## 6. `server.cjs` chatbot (~`:809-845`)

### 6a. `:~817` — 🟠 "Automatic data collection from your systems" + "AI-powered insights"
No auto-collection; AI Assistant is Coming Soon.
**Proposed:** `• CSV import of activity data` and drop "AI-powered insights" (or "AI insights — coming soon").

### 6b. `:~817` — 🔴 "California AB 1305" mislabeled as the corporate disclosure law
**Current:** "Compliance readiness for SEC, CBAM, and California AB 1305" and a dedicated block "built for California's Climate Corporate Data Accountability Act (AB 1305)".
**Problem:** The Climate Corporate Data Accountability Act is **SB 253**. **AB 1305** is the Voluntary Carbon Market Disclosures Act (a different law about carbon-offset claims). The **SEC** climate rule was withdrawn in 2025.
**Proposed:** replace "AB 1305" with **"SB 253/SB 261"** wherever the corporate emissions-disclosure law is meant; drop "SEC" or soften to "voluntary GHG disclosures." Update the dedicated AB 1305 response block to describe **SB 253**.

### 6c. `:~845` — 🔴 "Direct API", "Pre-built connectors for major ERPs", "Webhook support"
None exist (only CSV import/export).
**Proposed:** `• CSV import/export for spreadsheets` only; remove API/connectors/webhooks (or "integrations — on the roadmap").

---

## How to proceed
Tell me which to apply. Fast options:
- **"Apply all honest-now"** — I make every edit above using the truthful (non-roadmap) wording, keep tests/tsc/lint green, and commit to the PR branch.
- **"Apply all except Security §5"** — do §1–4 + §6 now; you verify host claims for §5 separately.
- **Pick items** — e.g. "1, 2a, 6b only."
- For any you'd rather keep as roadmap, say "roadmap-frame" and I'll use the tagged-as-planned wording instead of removing.
