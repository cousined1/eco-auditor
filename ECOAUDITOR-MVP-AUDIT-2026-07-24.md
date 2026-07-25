# Eco-Auditor — UX/UI & MVP Functional Audit

**Date:** 2026-07-24
**Commit audited:** `6de4e1d` (local `master`)
**Deployed SHA:** `6de4e1d` — verified live via `GET https://ecoauditor.io/api/health`. Local `master` and production are in sync; every finding below is live.
**Method:** static analysis of the full repo + live HTTP probes + local build/test/lint. Findings from six parallel audit passes (marketing claims, billing/entitlement, core functionality, UX/accessibility, auth/access-control, external factor accuracy), then an adversarial verification pass that re-tested the ten highest-severity claims and corrected two of them.
**Not done:** no authenticated end-to-end run against production (no test account), no Stripe test-mode transaction, no automated a11y tool run. Items depending on those are marked `UNVERIFIED`.

---

## Fixed in this branch

The audit below is the snapshot at `6de4e1d`. Two items have since been fixed on this branch:

- **P0-4 (mock methodology page)** — `/app/methodology` now renders `ComingSoon` instead of fictional facilities. `src/pages/Methodology.tsx`.
- **P0-1 (factor errors)** — corrected in `emissions-engine.cjs` and `src/components/carbon-calculator/utils.ts`:
  - `natural_gas.gj` 50.68 → 0.050253 (the 1000× unit bug)
  - eGRID table replaced with all 27 eGRID2023 Rev 2 subregions; the silent CAMX fallback now throws
  - Fugitive natural-gas leak 25.3 → 512 kg CO2e/MCF (~20× correction)
  - Fuel Oil No. 1 → 10.18, kerosene → 10.15, wood → 1.64 (EPA Hub 2025)
  - Client mobile factors aligned to the server and to Hub 2025 (gasoline 8.887 → 8.78, diesel 10.18 → 10.21, jet fuel 9.537 → 9.75)
  - Client electricity factors replaced with eGRID2023 values; "New York" split into the two subregions eGRID actually publishes
  - **GWP basis standardised on AR5** across the code, the registry, the public methodology page, and `llms.txt` — because EPA Hub 2025 and eGRID2023 both use AR5, so the whole inventory now sits on one basis. This is a reversible methodology decision: see "Still open" below.

- **P0-1 (two tables) and P0-2 (unit selector)** — the two tables are now one. `emission-factors.json` at the repo root is the single catalog; `emission-factors.cjs` is the server lookup and `src/lib/emission-factors/factors.ts` the client lookup. Both hardcoded tables are gone.
  - Every factor now carries explicit units, a `factorSource` registry id, and a `verified` flag. A category/source/unit triple with no factor returns `null` / throws — never a silent zero or another unit's factor.
  - The form's Unit dropdown is populated from the selected source and clears when the source changes, so `Natural Gas + miles` is no longer selectable. `calculateEmissions()` now takes the unit.
  - Scope 2 no longer applies the 4.75% T&D gross-up — under GHG Protocol that belongs in Scope 3 Cat 3, and it existed only on the server side, which was a second reason the two paths disagreed.
  - `tests/factor-parity.test.ts` walks the entire catalog and asserts the client and engine return the same number for every entry, so this class of divergence cannot come back silently.
  - Two further audit findings fell out of the merge: `RFCW` was missing from the old eGRID table (rows for it were silently priced as California), and process/fugitive categories can now be CSV-imported — previously the form accepted them but the importer rejected them.

**Still open in P0-1:** Scope 3 spend factors remain untraceable to any published EEIO dataset (now labelled `internal-estimate` / `verified: false` in the catalog rather than "EPA WARM", but the marketing copy still says WARM); wood's biogenic CO2 is still inside Scope 1 rather than a separate biogenic line; T&D losses are no longer in Scope 2 but Scope 3 Cat 3 accounting for them is not built; `Natural Gas Vehicle`, `Coal`, `Hot Water`, and the process-emissions factors are marked `verified: false` pending a source.

**Also still open:** `tests/calculator.test.ts` (P1-9) still defines its own local `calculateEmissions` and tests nothing in the product — it is now doubly misleading, since the real function has a different signature. `tests/factor-parity.test.ts` is its intended replacement; delete it when convenient.

Verification after the fixes: `npm test` **179/179 PASS**, `npm run build` **PASS**, `npx tsc -b` **PASS**, lint unchanged (the same 1 pre-existing error + 1 warning). CSV smoke test through the real engine returns correct values for all three scopes including the vendor-fallback and fugitive paths.

---

## 0. Verification evidence

| Check | Command / probe | Result |
|---|---|---|
| Unit + integration tests | `npm test` | **PASS** — 166/166 across 21 files |
| Tests on a clean checkout | `npm test` before `npm run build` | **FAIL** — 7 tests in `tests/routes-prerender.test.ts` error on missing `static/`. The suite silently depends on a prior build. See P2-1. |
| Production build | `npm run build` | **PASS** — 12/12 routes prerendered |
| Lint | `npm run lint` | **1 error, 1 warning** — `src/App.tsx:176` (`react-hooks/set-state-in-effect`), `src/pages/Login.tsx:58` (missing dep) |
| Deployment integrity | `GET /api/health` | **PASS** — `sha: 6de4e1d…` matches `master` HEAD |
| Security headers | `curl -I https://ecoauditor.io/` | **PASS** — CSP, HSTS (preload), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy all present |
| SEO / crawlability | live probes | **PASS** — per-route canonical + OG tags, `robots.txt` 200, `sitemap.xml` 200, 404 route returns real 404 |
| Route availability | 13 routes probed | **PASS** — all 200 (via a 301 to the trailing-slash canonical); `/dashboard` correctly 302s to `/login` |
| Video captions | `GET /video/product-workflow.en.vtt` | **FAIL — 404.** The `<track>` in `LandingPage.tsx:161` points at a file that does not exist (`public/video/` is absent). Video itself serves fine via `/api/video`. |
| Contrast math | computed from `tailwind.config.js` | `text-surface-400` on white = **2.46:1** (fails AA). See P1-8. |
| Emission factors vs cited sources | EPA eGRID2023, EPA GHG Emission Factors Hub 2025, IPCC AR6 WG1 Ch.7 SM, EPA Supply Chain Factors v1.3 | **FAIL** — factors do not match the datasets the site names. See P0-1 for the per-factor table and citations. |
| Bundle size | `static/assets/` | 465 kB main + 390 kB charts + 221 kB vendor (uncompressed); 112 kB gzip main. Acceptable; charts chunk is a lazy-load candidate. |

---

## 1. Verdict

The product is more real than the file count suggests. Dashboard, Calculator, CSV intake, PDF generation, Stripe billing, and auth are genuinely wired to Postgres/InsForge — not mocks. Tenant isolation holds on every data endpoint traced. The `ComingSoon` gating pattern is honest and well-executed. Prior audit rounds clearly landed: prices are consistent, "AI extraction"/"OCR" language is gone, testimonials are labelled illustrative.

Three things block calling this MVP-ready:

1. **The numbers are wrong — at the factor level and at the arithmetic level.** The emission factors do not match the sources the site names: the refrigerant GWPs labelled "IPCC AR6" are verbatim AR4 values, the electricity factors labelled "eGRID2023" are ~19–23% off and the subregion table matches no eGRID vintage (one entry is +79%, two are identical placeholders, unknown regions silently fall back to California's clean grid), and there is a literal 1000× unit error in the natural-gas GJ factor. On top of that, the Calculator's unit selector is decorative — required to submit, never used in the calculation — and the Calculator page renders CSV-imported activity amounts as if they were kg CO2e. Every one of these passes the current test suite untouched. For a product whose entire pitch is audit defensibility, this is the finding that matters most.
2. **Every paid tier delivers identical functionality.** Facility caps, CSV import quotas, and Scope 3 restrictions are advertised on the pricing page and enforced nowhere. Growth ($399) and Pro ($999) customers currently receive exactly what Starter ($149) receives.
3. **Marketing describes systems that do not exist.** A 5-level (L1–L5) data-quality hierarchy, a human review queue, CSV ledger export, reviewer attribution, and version history are all asserted in present tense across the homepage, methodology page, and JSON-LD structured data. None are implemented. One of these is recorded as `status: 'approved'` in the claims register on evidence that is factually false.

Everything else — accessibility, conversion polish, brand consistency — is ordinary MVP debt and can ship after.

---

## 2. P0 — blocking

### P0-1 · The emission factors do not match the sources the site cites

**Status:** CONFIRMED against published sources (EPA, IPCC, GHG Protocol — citations below)
**Files:** `emissions-engine.cjs:3-47`, `src/components/carbon-calculator/utils.ts:27-92`, `src/lib/emission-factors/registry.ts:21-72`

This is the deepest problem in the product, because it is invisible: nothing crashes, no test fails, and the output looks authoritative. The site cites specific authoritative datasets by name and version. The numbers in the code do not come from them.

**1. "IPCC AR6 GWP-100" is false — the refrigerant GWPs are verbatim AR4 (2007) values.**

| Coded | Site claims | AR4 | AR6 (actual) | Error |
|---|---|---|---|---|
| R-410A = 2,088 (`utils.ts:47`) | AR6 GWP-100 | **2,088** | 2,256 | −7.4% |
| R-22 = 1,810 (`utils.ts:48`) | AR6 GWP-100 | **1,810** | 1,960 | −7.7% |

Both coded values are exact AR4 figures. The engine's own output string `methodology: 'EPA GHG Protocol + IPCC AR6'` (`emissions-engine.cjs:181`) is wrong for the same reason — and EPA's Hub 2025, which the engine's fuel factors do follow, itself uses AR5.
Sources: [GHG Protocol GWP values, Aug 2024](https://ghgprotocol.org/sites/default/files/2024-08/Global-Warming-Potential-Values%20(August%202024).pdf) · [IPCC AR6 WG1 Ch.7 Supplementary Material](https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_Chapter_07_Supplementary_Material.pdf)

**2. "eGRID2023" is false everywhere.** eGRID2023's US average is **770.884 lb/MWh = 0.3497 kg/kWh** ([EPA eGRID Summary Data](https://www.epa.gov/egrid/summary-data)). The code uses **0.417** (`utils.ts:52`) — **+19.2%**, matching no current release (roughly a 2018–19 era grid). State values are off by similar margins: California 0.23 vs CAMX 0.195 (+18%), Texas 0.41 vs ERCT 0.334 (+23%).

The engine's subregion table is worse — it matches no eGRID vintage at all:

| Subregion | Coded (t/MWh) | eGRID2023 | Error |
|---|---|---|---|
| NYUP | 0.197 | 0.1101 | **+78.9%** |
| RFCE | 0.327 | 0.2718 | +20.3% |
| NEWE | 0.197 | 0.2464 | −20.0% |
| RFCM | 0.487 | 0.4427 | +10.0% |
| SRMV | 0.373 | 0.3365 | +10.9% |
| CAMX | 0.207 | 0.1950 | +6.1% |
| SPNO | 0.416 | 0.3936 | +5.7% |
| ERCT | 0.341 | 0.3341 | +2.1% |
| SRSO | 0.385 | 0.3837 | +0.3% |

`NYUP` and `NEWE` are both exactly `0.197` — a placeholder pattern, visible in the source. The table covers **9 of 26** eGRID subregions, and unknown regions **silently fall back to CAMX** (`emissions-engine.cjs:113`), one of the cleanest grids in the country — so a Texas or Midwest customer is systematically understated with no warning.

**3. A 1000× unit bug in the Scope 1 table.** `emissions-engine.cjs:4`:

```js
natural_gas: { therms: 0.005302, mcf: 0.05302, gj: 50.68 },
```

The table is in **tonnes** per unit — `therms: 0.005302` = 5.302 kg, correct. But `gj: 50.68` is a **kg-scale** number sitting in a tonnes table; the correct value is ≈ **0.0503** t/GJ. Any natural-gas row submitted in GJ is inflated by a factor of ~1000. Verified by the table's own internal consistency, no external source needed.

**4. Fugitive natural-gas leak factor is ~20× low.** `utils.ts:49` uses 25.3 kg CO2e/MCF. One MCF of leaked natural gas ≈ 19.2 kg CH4 × GWP ~27–30 ≈ **520–570 kg CO2e/MCF**. The coded 25.3 looks like the AR4 methane GWP (25) pasted in as a per-MCF factor.

**5. Other fuel factors drift from EPA Hub 2025.** Correct: diesel (10.21 kg/gal), gasoline (8.78), No. 2 oil, natural gas per therm. Incorrect: `fuel_oil_1` uses 9.75 (that is the **jet fuel** factor; No. 1 is 10.18, −4.2%), kerosene 9.68 vs 10.15 (−4.6%), wood 0.91 vs 1.64 t/short ton (−44%), propane +1.2%, No. 4 −2.5%, No. 6 −1.5%, `mcf` −2.6% (ignores the 1.026 MMBtu/MCF heat content).
Source: [EPA GHG Emission Factors Hub 2025](https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf)

**6. Scope 3 spend factors are untraceable.** The nine per-USD constants (`emissions-engine.cjs:37-47`) are the right order of magnitude but correspond to no row in EPA's [Supply Chain GHG Emission Factors v1.3](https://catalog.data.gov/dataset/supply-chain-greenhouse-gas-emission-factors-v1-3-by-naics-6) (1,016 NAICS-6 commodities), which publishes no aggregate categories like "purchased_goods". Separately, **"EPA WARM" is a category error**: WARM is a waste model in t CO2e per short ton of *material* and cannot produce a per-USD factor, yet it is cited at `mockData.ts:37` and `Methodology.tsx:94`.

**7. T&D losses are in the wrong scope.** `TRANSMISSION_LOSS_RATE = 0.0475` grosses up location-based Scope 2 by 4.75%. Under the GHG Protocol Scope 2 Guidance, transmission and distribution losses belong in Scope 3 Category 3 — so Scope 2 is overstated by that amount on top of the factor errors above.

**8. Two factor tables coexist and disagree with each other.** The client (`utils.ts:27-92`) and the server engine (`emissions-engine.cjs:3-47`) are independent, and the same activity produces different results depending on which path the data took:

| Activity | Client (form) | Engine (CSV) |
|---|---|---|
| Mobile gasoline | 8.887 kg/gal | 8.78 kg/gal |
| Mobile diesel | 10.18 kg/gal | 10.21 kg/gal |
| Electricity | 0.417 kg/kWh ("US Average") | 0.2168 kg/kWh (CAMX × loss factor) |

The taxonomies don't even overlap — the client offers "US Average / California / Texas", the engine expects eGRID subregion codes. The client's mobile factors match EPA's older passenger-vehicle fact sheet rather than Hub 2025. The engine has **no fugitive-emissions category at all**, so refrigerants can only be entered via the form. Both sets of numbers then coexist in the same server-side summary, because pre-computed form rows pass through the engine's `kg_co2e` passthrough.

**9. The registry's `verified: true` flags are unearned.** `registry.ts` declares `ipcc-ar6-gwp100` and `epa-egrid-2023` as verified. Neither is true of the numbers actually in use. `epa-efh-2025` is partially true.

**Fix:**
- Fix the `gj` 1000× bug and the fugitive leak factor immediately — those are outright calculation errors, not sourcing disputes.
- Re-transcribe the eGRID table from the [eGRID2023 published data](https://www.epa.gov/egrid/summary-data), all 26 subregions, and replace the silent CAMX fallback with a per-row error.
- Either update the refrigerant GWPs to AR6 values or relabel the site as AR4 — the numbers and the citation must agree.
- Set `verified: false` on `ipcc-ar6-gwp100` and `epa-egrid-2023` until the values match.
- Collapse the two factor tables into one source of truth consumed by both the client and the engine, with each value carrying a `registry.ts` factor ID (see P0-2/P0-3, which share this root cause).
- Relabel the Scope 3 factors as internal estimates, or wire in EPA Supply Chain Factors v1.3 properly. Remove the "EPA WARM" attribution.

**Acceptance:** every numeric factor maps to a registry entry with publisher, version, and year; a spot-check of five factors against the cited publication matches to published precision; a Scope 2 calculation for an unlisted subregion errors instead of silently using CAMX; a GJ natural-gas row produces a plausible result.

---

### P0-2 · The Calculator's unit selector does not affect the calculation

**Status:** CONFIRMED (independently verified)
**Files:** `src/components/carbon-calculator/utils.ts:108-114`, `src/components/carbon-calculator/EmissionForm.tsx:36-45`

`calculateEmissions(category, source, amount)` never receives the unit. The form *requires* a unit to enable submit (`EmissionForm.tsx:45`), then discards it — it is stored only as a display string in the `factor` column (`index.tsx:99`).

```ts
// utils.ts:108 — unit is absent from the signature entirely
export function calculateEmissions(category: string, source: string, amount: number): number {
  const factors = EMISSION_FACTORS[category];
  if (!factors) return 0;
  const factor = factors[source];
  if (factor === undefined) return 0;
  return amount * factor;   // factor's implicit unit is never checked
}
```

Failing scenarios:

| Input | Stored | Correct | Error |
|---|---|---|---|
| Natural Gas, 1000, **therms** | 53,060 kg (factor is per MMBtu) | ~5,306 kg | **10× over** |
| US Avg electricity, 10, **MWh** | 4.17 kg (factor is per kWh) | 4,170 kg | **1000× under** |
| Gasoline, 10,000, **miles** | 88,870 kg (factor is per gallon) | ~3,500 kg @ 25 mpg | **25× over** |

**Fix:** make factors unit-aware. Change `EMISSION_FACTORS` values from bare numbers to `{ factor, unit }`, derive the Unit dropdown from the selected source rather than offering all units for all sources, and add an explicit conversion table for the accepted alternates (therms→MMBtu ×0.1, MWh→kWh ×1000, tons→kg ×907.18). Pass `unit` into `calculateEmissions` and reject unconvertible pairs at validation time rather than silently computing.

**Acceptance:** a test that imports the real `utils.ts` (see P1-9 — the current calculator test does not) asserting 1000 therms Natural Gas ≈ 5,306 kg and 10 MWh US-average ≈ 4,170 kg; the form cannot submit `Natural Gas + miles`.

---

### P0-3 · CSV-imported rows display as CO2e when they are raw activity amounts

**Status:** CONFIRMED (independently verified)
**Files:** `src/components/carbon-calculator/index.tsx:97-98`, `server.cjs:1464`, `server.cjs:1487`, `EmissionList.tsx:85`, `EmissionsDashboard.tsx:19,36-38`

`emission_entries.amount` carries two incompatible meanings depending on the write path:

- **Form path** (`index.tsx:97`) — stores `amount: data.calculatedKg`, `unit: 'kg CO2e'`. Already-computed emissions.
- **CSV path** (`server.cjs:1464`) — stores `amount: Number(row.amount)`, the raw activity figure (e.g. 50,000 therms). The computed `co2e_tonnes` **is discarded** — it is not in the insert column list at `server.cjs:1487`.

The Calculator UI then renders every row through `formatCO2e(parseFloat(e.amount))` (`EmissionList.tsx:85`) and sums them as kg into the scope totals and charts.

**Failing scenario:** import `1,stationary_combustion,natural_gas,50000,therms`. The `/app` Dashboard (server engine, correct) shows **265.1 t**. The `/app/calculator` page shows **50.0 t** for the same row. Two dashboards in the same product disagree about the same data.

**Fix:** add `co2e_tonnes` to the CSV insert column list and persist it on the form path too, then have `EmissionList` and `EmissionsDashboard` read the computed CO2e column rather than `amount`. Longer term, split the schema cleanly: one column for activity data + unit, one for computed CO2e. Do not branch on `unit === 'kg CO2e'` as a permanent fix — that encodes the ambiguity rather than removing it.

**Acceptance:** import the 50,000-therm fixture; `/app/calculator` and `/app` show the same total.

---

### P0-4 · The in-app Methodology page shows a fictional company's data as the user's own

**Status:** CONFIRMED (independently verified — the file contains no "sample"/"demo"/"example" label anywhere in its 129 lines)
**Files:** `src/pages/Methodology.tsx:1,5,67-82`, `src/data/mockData.ts:14-18,163-172`

`/app/methodology` renders `FACILITIES` and `METHODOLOGY_SETTINGS` imported straight from `mockData.ts`. Every authenticated user — including a customer who just signed up — sees "Sacramento HQ", "Fresno Packaging", and "Portland Distribution" presented as their own facility list, alongside fabricated boundary and base-year settings and factor libraries marked "Active".

This directly contradicts the product's own `ComingSoon` copy ("kept gated until the live workflow is ready, so you do not see sample records") and is the single worst trust hole in the app: a carbon-accounting tool showing invented facilities as real destroys exactly the credibility it sells.

**Fix (choose one):**
- *Fast:* replace the page body with `return <ComingSoon featureName="Methodology & Boundaries" />;`, matching Ledger/Reports/Suppliers. One line, removes the risk today.
- *Proper:* fetch real facilities from the existing `GET /api/companies/:id/facilities` (`server.cjs:1545`) and drop the fabricated boundary card.

Either way, delete the dead "Enable" button at `Methodology.tsx:59` (no `onClick`) and the mock imports.

**Acceptance:** a fresh account opening `/app/methodology` sees no "Northstar Foods" or "Sacramento HQ" anywhere.

---

### P0-5 · Advertised plan tiers are enforced nowhere

**Status:** CONFIRMED (adversarial pass searched middleware, route handlers, engine, schema, and migrations — found no enforcement)
**Files:** `src/content/pricing.ts:39-86`, `src/data/mockData.ts:186-206`, `server.cjs:1326,1349,1375,1393,1552,1624,1647`

Every plan-gated endpoint uses the identical gate `requirePlan('starter')`. `'growth'` and `'pro'` are never required anywhere in the codebase.

| Advertised | Where sold | Enforcement |
|---|---|---|
| Starter 1 facility / Growth up to 5 / Pro unlimited | `pricing.ts:42,60` | **None** — `POST /api/companies/:id/facilities` (`server.cjs:1552`) has no count check |
| Starter 10 CSV imports/month | `pricing.ts:43` | **None** — no counter, and no usage table exists in schema or migrations |
| Scope 3 workflows = Growth+ | `pricing.ts:47` | **None** — engine calculates Scope 3 for any caller |
| Starter 1 template / Growth+ "all standard templates" | `pricing.ts` | **None** — exactly one template exists for everyone (`createSimplePdf`, `server.cjs:1714`) |
| Pro "unlimited companies" | `mockData.ts:186-206` | **Unfulfillable** — multi-company does not exist; every user is capped at one by auto-provisioning |

Net: a $999 Pro customer receives nothing a $149 Starter customer doesn't. This is a refund-and-chargeback exposure, not just a roadmap gap.

**Compounding issue:** the Calculator writes entries **directly via the InsForge client SDK** (`src/components/carbon-calculator/index.tsx:91-104`), bypassing the Express server entirely — so even the one gate that exists is bypassable for entry creation, and post-trial users can keep adding entries.

**Fix (choose one — this is a business decision, not a technical one):**
- *Enforce:* `req.billing.plan` is already attached at `server.cjs:561`. Add a facility count check in the facility-create route, a monthly import counter (new table) checked in `/api/ingest/csv`, and a Scope 3 rejection for `starter` returning `402 { code: 'upgrade_required', requiredPlan: 'growth' }` — the client paywall (`api.ts:26-34` → `UpgradePrompt`) already renders that response correctly. Route Calculator writes through the server so the gate applies.
- *Retract:* rewrite the plan feature lists to reflect what actually differs today (nothing but price and support tier) and move the rest to the roadmap arrays.

**Acceptance:** on a Starter account, the 2nd facility create and the 11th monthly import both return 402; a Scope 3 row returns 402 with `requiredPlan: 'growth'`. Or, if retracting: no plan card lists a limit the server doesn't enforce.

---

### P0-6 · Claims register marks a false claim as "approved"

**Status:** CONFIRMED (independently verified — no CSV export exists in `src/` or `server.cjs`; no reviewer or source-document column exists in the schema)
**Files:** `src/content/claims.ts:78-87`, `src/content/claims.ts:88-98`, `src/pages/SampleReport.tsx:163-166`, `server.cjs:1631-1737`

`claims.ts:82` records the claim *"No proprietary formats"* with evidence **"Reports export as PDF and CSV; ledger is a standard CSV"** and `status: 'approved'`.

Reality: there is **no CSV export anywhere in the product**. The only CSVs are static marketing samples in `public/sample-report/`. The only real export is a ~10-line text PDF containing a total, three scope lines, a confidence percentage, and a methodology string (`createSimplePdf`, `server.cjs:1714`).

`claims.ts:92` compounds it: *"Ledger records source document, emission factor, reviewer, and timestamp per entry."* The `emission_entries` table (`migrations/20260611141026_initial-schema.sql:25+`) has **no reviewer column and no source-document column** — verified by grep across schema and all migrations. `SampleReport.tsx:163-166` additionally promises a detailed entry ledger (CSV), citations, reviewer + timestamp per entry, and version history with diffs. None exist.

This is the most legally exposed finding in the audit: a formal internal claims register asserting approval on evidence that is false, feeding public-facing copy.

**Fix:** either implement `GET /api/companies/:id/ledger.csv` streaming the entry columns that do exist and extend the PDF with a per-entry table — or flip both claims to `unverified`, correct the evidence strings, and delete the CSV/citations/reviewer/version-history bullets from `SampleReport.tsx`.

**Acceptance:** every bullet under "Every report package includes" is producible from a live account, or has been removed. No claim in `claims.ts` carries `status: 'approved'` with evidence that cannot be demonstrated.

---

### P0-7 · Present-tense marketing for a review queue and quality hierarchy that do not exist

**Status:** CONFIRMED
**Files:** `src/pages/LandingPage.tsx:121,229,258-261`, `src/pages/MethodologyPublic.tsx:20,55-61,195-231,271`, `index.html:115,123-130`, `public/llms.txt`

Asserted publicly, in present tense, un-badged:

- "flag low-confidence entries for review" and a "human review queue" — the Review Queue tab is a `ComingSoon` stub (`DataIntake.tsx:213-215`); no flagging logic exists anywhere.
- "Every data point is scored on a 5-level quality hierarchy (L1–L5)" with specific confidence ranges — no L1–L5 field exists; the insert columns at `server.cjs:1487` have no quality-level field.
- The confidence model "combines source type, source recency, coverage, estimation method, factor specificity, and review status. Users can inspect the inputs and override classifications with a recorded reason." Actual implementation: a static per-category lookup table (`emissions-engine.cjs:49-62`), falling back to 70. There is nothing to inspect and no override feature.
- "Generate compliance packages for SB 253, CBAM" — no templates exist.

These appear in the **FAQPage JSON-LD** (`MethodologyPublic.tsx:20`) and the `SoftwareApplication` featureList (`index.html:123-130`), plus `public/llms.txt` — i.e. they are being fed to search engines and AI answer engines as structured fact.

The sales chatbot repeats claims the site itself was already scrubbed of: "automates data collection and reporting across all three scopes" (`server.cjs:973`), "Third-party verification support", "Public disclosure templates" (`:977`), "Generate CBAM-aligned reports", "Calculate carbon costs" (`:985`).

**Fix:** rewrite to what exists ("assign a confidence score per entry"), badge the review-queue card `comingSoon`, strip unshipped features from the JSON-LD featureList and `llms.txt`, and rewrite the chatbot knowledge base at `server.cjs:973-985`.

**Acceptance:** `grep -iE "review queue|L1|L5|quality hierarchy|CBAM-aligned|automates data collection"` across `src/`, `index.html`, `public/llms.txt`, and the chatbot KB returns only roadmap-qualified phrasing. Validate the JSON-LD with Google's Rich Results test.

---

## 3. P1 — fix before or immediately after launch

### P1-1 · Webhook soft-failures silently drop a paying customer's entitlement

**Status:** CONFIRMED with correction — the original finding overstated this; here is the accurate version.
**Files:** `server.cjs:786-792`, `server.cjs:488-525`

The webhook **does** return 500 (triggering Stripe retry) when persistence *throws* — `server.cjs:786-790` is explicitly commented for this. Credit where due.

But `syncSubscriptionRecord` has four soft-fail branches that `return false` **without throwing**: no DB configured (`:488-491`), no `stripeCustomerId` (`:492`), **no `users` row for the Stripe customer** (`:498-501`), and `rowCount === 0` after the company UPDATE (`:522-525`). The webhook then acks **200** (`:792`). Stripe marks delivery successful and never retries — the customer has paid and has no entitlement.

Compounding: on return from checkout, `App.tsx:173-180` only displays a "being finalized" banner. Nothing verifies the `session_id`, so there is no recovery path other than manual support.

**Fix:** distinguish retryable soft-failures (missing DB, missing user row, zero rows updated) from genuinely terminal ones and return 500 for the retryable set. Add `POST /api/checkout/verify` (authGuard) that retrieves the session from Stripe, confirms the customer matches the caller, and runs the sync; call it from the `session_id` branch in `App.tsx` before showing the banner.

**Acceptance:** with webhook delivery disabled, complete a test checkout — `GET /api/billing` shows the active plan after redirect. A sync that finds no `users` row produces a non-2xx in the Stripe dashboard and retries.

### P1-2 · Webhook is not idempotent or order-safe

**Files:** `server.cjs:756-785`
No event-ID dedup and no `event.created` ordering guard. Stripe does not guarantee order: a stale `customer.subscription.updated` (status `active`) delivered after `customer.subscription.deleted` overwrites `canceled` and **restores access**. Store the last-applied `event.created` per `stripe_subscription_id` and skip older events.
**Acceptance:** unit test — apply `deleted` (created=T2), replay `updated` (created=T1), DB still shows `canceled`.

### P1-3 · Unrecognized price ID locks out an actively paying customer

**Files:** `server-billing.cjs:76,86-90`
If a subscription's price ID doesn't match current env vars (price rotation, env drift between deploys), `planFromPriceId` returns null → `subscriptionActive` is false → a paying customer is paywalled. Their own test demonstrates the null path (`tests/server-billing.test.ts:139-150`). Treat an active-status subscription with an unknown plan as the lowest tier and alert, rather than deactivating.

### P1-4 · Expired customers retain read access to paid data

**Files:** `server.cjs:1545,1584,1599,1679`
Four endpoints carry auth but no `requirePlan`: GET facilities, GET facility emissions, GET compliance, and **GET report download — which regenerates a fresh PDF from live data**. Dashboard summary/trend are gated but the same data is reachable per-facility. Add `requirePlan('starter')` to all four.

**Note on the "read-only at trial end" caveat** (`claims.ts:40`): it is false in both directions. Reads *are* blocked (`requirePlan` is on GET summary and trend), so it isn't read-only — but the Calculator's direct-SDK writes still work, so it isn't fully locked either. Rewrite the caveat to describe actual behaviour once P0-5 is settled.

### P1-5 · "No card required" is false on the path most users take

**Status:** CONFIRMED with nuance.
**Files:** `server.cjs:695-713`, `src/content/claims.ts:36-38`, `LandingPage.tsx:104`

Two different trial mechanisms exist and the copy conflates them:
- **Signup path** — genuinely card-free. `ensureCompanyForUser` sets `trial_ends_at = now() + 14 days` on first API access, no Stripe involved (`server.cjs:406-407`). The claim is true here.
- **Pricing "Start free trial" path** — creates a `mode: 'subscription'` Checkout session with `trial_period_days: 14` and **no `payment_method_collection`**. Stripe's default for subscription mode is `'always'`, so the customer is shown a card form despite $0 due. The claim is false here, and `claims.ts:38`'s evidence ("without requiring a payment method") is wrong.

**Fix:** add `payment_method_collection: 'if_required'` (with `trial_settings.end_behavior.missing_payment_method`) to the checkout session, or change the pricing-page copy to distinguish the two paths.

### P1-6 · OAuth signup drops the purchase intent

**Files:** `src/pages/Login.tsx:88-92`, `src/pages/Signup.tsx:106-110,74`, `src/pages/AuthCallback.tsx:33`
The `plan`/`billing` param threading added in `b10a79f` covers email login only. `handleSocialLogin` sends a bare `/auth/callback` and `AuthCallback.tsx:33` hardcodes `navigate('/app')`. A prospect who clicks "Buy Growth annual" then "Continue with Google" lands on an empty dashboard with the sale dropped. The email-verification `redirectTo` (`Signup.tsx:74`) loses them too.
**Fix:** stash the params in `sessionStorage` before the OAuth redirect and consume them in `AuthCallback`, or append them to the callback path and validate on arrival.

### P1-7 · No self-service password reset

**Files:** `src/pages/Login.tsx:159-166`
"Forgot password?" is a `mailto:hello@developer312.com` link — an off-brand domain on a B2B trust product, and a locked-out paying customer waits for a human. The vendored SDK already ships `auth.resetPassword` and `resendVerificationEmail`. Add a `/forgot-password` route. Also missing from Settings: change password, change email, delete account (GDPR Art. 17 exposure for a product marketed on EU compliance), and log-out-other-sessions.

### P1-8 · Accessibility: skip link, focus traps, contrast

- **Skip link is a no-op on five pages.** `Header.tsx:131` targets `#main-content`, which exists only in the legal layout (`App.tsx:230`) and the pricing wrapper (`App.tsx:366`). `LandingPage`, `Demo`, `MethodologyPublic`, `SampleReport`, and `Security` render the header but contain no `<main>` element at all. Wrap each page's body in `<main id="main-content">`.
- **Modals have no focus management.** The cookie preferences modal (`CookieConsentBanner.tsx:72-79`) declares `role="dialog" aria-modal="true"` but has no focus trap, no initial focus, no Escape handler, and no focus restore. Same for the chatbot panel.
- **Contrast failures (computed, not estimated):** `text-surface-400` (#9ca8a0) on white = **2.46:1** — used for real copy including the trial note (`LandingPage.tsx:104`) and legal text (`Pricing.tsx:176`). `text-surface-500` on `bg-surface-50` = **4.31:1**, just under AA, and it is the default body pairing. `text-risk-medium` on white = **3.19:1** used for small trend text (`Dashboard.tsx:308`).
- **No text alternative for charts** (Recharts SVG only), **no `aria-live`** on chatbot replies, **broken `aria-controls`** on the DataIntake tabs (`DataIntake.tsx:186-197` references panel ids that are never rendered).
- **Video captions 404** — verified live. Either add `public/video/product-workflow.en.vtt` or remove the `<track>`.

### P1-9 · The calculator test suite tests nothing

**Files:** `tests/calculator.test.ts:10-12,111-113`
It defines its own local `calculateEmissions(amount, factor)` and never imports `src/components/carbon-calculator/utils.ts`. It is structurally incapable of catching P0-2 or P0-3 — and didn't. Same pattern in `tests/dashboard-integration.test.ts` (re-implements `buildTrend`) and `tests/stripe.test.ts` (tests client-side no-op stubs).

Untested entirely: the `/api/webhook` route, `requirePlan`, the checkout price allowlist, `syncSubscriptionRecord`, and every auth guard against the running Express app — `tests/server.test.ts` contains **zero 401/403 assertions**. The single highest-value missing test is an integration test hitting `/api/emissions/summary?company_id=<other>` with a mocked InsForge upstream.

### P1-10 · UX friction on the activation path

- **No scroll restoration or focus reset on route change** — verified absent. Every SPA navigation lands mid-page.
- **Dead "Add" buttons on all four pricing add-ons** (`Pricing.tsx:203`) — a purchase-shaped control in the money path with no handler. Either wire to `/contact?topic=sales` (ContactUs already maps `?topic=`) or remove.
- **DataIntake auto-dismisses errors after 4s** (`DataIntake.tsx:30-34`) — failed imports vanish before they can be read. Only auto-dismiss successes.
- **Empty dashboard routes to manual entry, not CSV import** (`Dashboard.tsx:174-200`) — contradicting the CSV-first promise that sold the signup. Add an "Import a CSV" CTA to `/app/intake`.
- **Chat window is `width: 380px` fixed** (`ChatbotWidget.tsx:186`) — overflows a 375px viewport and covers the cookie banner's buttons. Use `min(380px, calc(100vw - 32px))`.
- **Dashboard uses `bg-blue-600`** (`Dashboard.tsx:118,155,176,197`) instead of brand tokens — the first screen a new user sees is off-brand.
- **Two competing onboarding sources of truth** — the server auto-provisions a company on first API call, while the Calculator independently queries `companies` client-side and may prompt the user to create one that already exists (`carbon-calculator/index.tsx:41-53`).
- **4 of 10 sidebar items are `ComingSoon`** with no badge in the nav. Add a "Soon" pill so users learn before clicking.

---

## 4. P2 — quality and hygiene

1. **Tests depend on build order.** 7 prerender tests fail on a clean checkout because `static/` doesn't exist yet. Either make `npm test` build first, guard those tests with a skip-if-absent, or document the dependency in CI.
2. **Lint error in `App.tsx:176`** (`set-state-in-effect`) and missing-dep warning in `Login.tsx:58`.
3. **Fail-open billing paths** — `requirePlan` calls `next()` on any error (`server.cjs:565`), `/api/trial-status` returns `trial: true` on DB error (`:272`), and a missing `DATABASE_URL` makes everyone active. Deliberate availability tradeoffs, but a production misconfiguration silently gives the product away. Add a startup assertion refusing to boot in production without `DATABASE_URL`.
4. **Latent cross-tenant defect (not currently exploitable).** `getAuthorizedCompanyIds` (`server-security.cjs:55-67`) unions company IDs from `user.user_metadata` / `user.app_metadata`. The adversarial pass established this is **not reachable as deployed**: InsForge returns custom data under `profile`/`metadata`, not those Supabase-style keys, and `requireCompanyAccess` overwrites `user.company_id` from the DB first. But it is dead trust of provider-controlled data that becomes a cross-tenant hole the moment the auth provider's payload shape changes. Derive the authorized set exclusively from the DB.
5. **`/api/chat` is an unauthenticated paid-LLM proxy** (`server.cjs:1125`) with only the global 120/min/IP limit. Add a per-route limiter and a daily cap.
6. **`authGuard` turns upstream 5xx into 401** (`server.cjs:323-325`), and the client force-logs-out on the first `/api/*` 401 — so an InsForge outage logs out every active user mid-session. Return 503 for upstream ≥500.
7. **Compliance sign-off endpoint fabricates success** — `POST /api/compliance/:id/signoff` (`server.cjs:1624-1628`) persists nothing and returns `status: 'completed'`. Remove it or make it real; a compliance product cannot ship a fake sign-off.
8. **Whole-file CSV rejection on one bad amount** (`emissions-engine.cjs:279-280`) while other row errors are per-row. Make it consistent.
9. **Engine unit handling is silent where it should error** (`emissions-engine.cjs:100-123`) — any non-kWh Scope 2 unit is treated as MWh (a GJ row is overstated 3.6×), Scope 3 spend-based factors are applied to any unit (1000 kg of waste is priced as $1,000 of spend), and mobile factors ignore units entirely (miles priced as gallons). Validate units per scope and reject unconvertible ones. The related eGRID fallback is covered in P0-1.
10. **Stale summary cache** — form inserts bypass the server, so the 5-minute cache on `/api/emissions/summary` (`server.cjs:1355`) isn't invalidated; the Dashboard can lag the Calculator by up to 5 minutes.
11. **Brand and identity drift** — "Eco-Auditor" vs "EcoAuditor"; two different logos (gradient leaf in the app/auth shells, rounded-square "M" in the marketing header and favicon, with a TODO acknowledging it at `Footer.tsx:15`); support addresses split between `hello@developer312.com` and `support@ecoauditor.io`.
12. **Scope colors disagree across views** — Dashboard uses green/teal/amber, Calculator uses red/amber/blue, SampleReport uses red/blue/emerald for Scopes 1/2/3.
13. **Security page renders a placeholder to the public** — `Security.tsx:116` prints the literal string "(verify before publication)" because `trust-facts.ts:15` has `verified: false`.
14. **Security page present-tense integration claim** (`Security.tsx:114`) — QuickBooks/Xero described as existing; they're roadmap everywhere else.
15. **Sample factor register lists unwired sources** — `public/sample-report/pacific-freight-factor-register.csv` lists `uk-defra-2024` and `exiobase-3-eeio-2021` as active with placeholder `sha256:ab12` checksums. DEFRA is absent from the codebase; EXIOBASE is marked roadmap in `registry.ts`.
16. **SB 253 deadline mismatch** — public page says Aug 10 2026 (`MethodologyPublic.tsx:139`), the API says 2026-01-01 (`emissions-engine.cjs:334`).
17. **Subprocessor list omits the LLM providers** used by `/api/chat` (`trust-facts.ts:24-30`), and still carries `cloudHosting = 'VERIFY'`.
18. **Two unverified claims are review-due 2026-08-15** — the "$15K–$40K consultant" comparison and "up and running quickly" (`claims.ts:57-77`). Source them or remove them.
19. **Chatbot says "Online now"** (`ChatbotWidget.tsx:229`), implying live staffing. It's a regex bot. Change to "Automated assistant".
20. **Dead code** — `EMISSIONS_SUMMARY`, `READINESS_SCORE`, `TREND_DATA`, `CFO_METRICS`, `REPORTS`, `SUPPLIERS`, `CHAT_MESSAGES`, `MISSING_DATA_ALERTS`, `COMPLIANCE_TASKS`, `ONBOARDING_CHECKLIST` in `mockData.ts` are imported by nothing but their own tests. `handleWebhookEvent`/`WEBHOOK_HANDLERS` in `src/lib/stripe.ts:226-239` are client-side no-ops. `trialEligiblePriceIds` (`server-billing.cjs:39-46`) is imported but never used — and `tests/server-billing.test.ts:35-42` asserts behaviour the server does not implement.
21. **Nine orphan API endpoints** with no client caller: `/api/calculate`, `/api/ingest/status/:job_id`, GET+POST facilities, `/api/facilities/:id/emissions`, `/api/companies/:id/compliance`, `/api/compliance/deadlines`, `/api/compliance/:id/signoff`, `/api/leads`. Facilities can only ever be created through Onboarding.
22. **Reports split is confusing** — `/app/reports` is `ComingSoon` while a working PDF generator sits inside the Calculator, and the `reports` table already records generated reports.
23. **CSP allows `'unsafe-inline'` scripts** plus GTM. With the access token readable from JS by design, a compromised GTM container can exfiltrate live sessions. Move to nonces.
24. **Charts chunk is 390 kB** and eagerly loaded. Lazy-load Recharts on the dashboard route.

---

## 5. What is genuinely working

Worth recording so it doesn't get "fixed":

- **Tenant isolation holds.** Every data endpoint was traced; `requireCompanyAccess` → `resolveAuthorizedCompanyId` rejects cross-tenant IDs, and RLS is deny-by-default with owner-chained policies. The ID-swapping attack does not work.
- **Token handling is better than typical.** The access token is in memory only; the refresh token is in an httpOnly cookie with a CSRF companion. Nothing auth-related is in localStorage.
- **No secrets in the client bundle** — only public identifiers (`VITE_INSFORGE_ANON_KEY`, `VITE_STRIPE_PK`, price IDs).
- **Checkout price IDs are allowlisted server-side** (`server.cjs:667-674`) — no client price injection.
- **Webhook signatures are verified and fail closed** when the secret is unset.
- **Trial abuse is blocked** — trial only for customers with no prior subscription.
- **Period-end backstop** — even a missed cancellation webhook lapses access at period end.
- **Every SQL query is parameterized**, including the dynamically built CSV batch insert.
- **The dev-auth bypass is properly gated** behind `NODE_ENV !== 'production' && ALLOW_DEV_AUTH === 'true'`.
- **Session expiry is handled cleanly** — a 401 interceptor plus interval/focus revalidation forces clean re-auth rather than a broken UI.
- **The double-counting bug from earlier audits is genuinely fixed** and regression-tested (`tests/emissions-engine.test.ts:44-68`).
- **`ComingSoon` gating is honest** — Ledger, Reports, Suppliers, AI Assistant, and 2 of 3 DataIntake tabs are all properly stubbed rather than faked.
- **Testimonials are labelled illustrative**; prices are consistent across all surfaces.
- **Marketing forms work** — Demo and Contact both persist to the `leads` table with field-level inline validation and `aria-invalid`/`aria-describedby`.

---

## 6. Suggested order of work

**Before taking another paying customer:**
1. P0-4 (one-line `ComingSoon` swap) — removes the worst trust hole in an hour.
2. The two outright arithmetic errors inside P0-1 — the `gj: 50.68` 1000× bug and the fugitive leak factor. Both are one-line corrections.
3. P0-2 + P0-3 — unit handling and the CO2e display semantics.
4. The rest of P0-1 — re-transcribe the eGRID table, reconcile the GWP labelling, collapse the two factor tables. This is the largest single piece of work in the audit and the one that decides whether the product's core claim is true.
5. P0-5 — decide enforce-or-retract on plan tiers. Retracting is a copy change and can ship same-day.
6. P0-6 + P0-7 — copy and claims-register corrections; no engineering required.

**Before scaling acquisition:**
5. P1-1 through P1-5 (billing integrity), P1-6/P1-7 (auth journey).
6. P1-8 (accessibility) and P1-9 (real tests for the calculator).

**Then:** P1-10 UX polish and the P2 list.

---

*Generated by a multi-agent audit pass. Every P0 and every "CONFIRMED" label was re-verified against current code; two findings (webhook retry behaviour, the metadata trust path) were downgraded by the adversarial pass and are stated here in their corrected form. Items marked UNVERIFIED need a live authenticated session or an external source to settle.*
