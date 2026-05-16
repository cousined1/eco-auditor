# EcoAuditor — Complete Build Guide for GitHub Copilot
**Give this entire file to Copilot. It contains everything.**

---

## 🧒 WHAT IS ECOAUDITOR? (Explain It Like I'm 10)

Imagine a restaurant that uses gas stoves, buys food from trucks, and uses electricity. All of that creates invisible pollution called "greenhouse gas emissions." The government is starting to **fine companies** that don't track and report their pollution.

**EcoAuditor is an app that does the math for them.** A company types in how much gas, electricity, and stuff they use, and EcoAuditor calculates exactly how much pollution they're creating — broken down into 3 buckets (called "scopes"). Then it generates a pretty report they can hand to an auditor.

**Who buys this?** Small and medium businesses (restaurants, factories, breweries) that need to prove they're tracking emissions for compliance laws like California's SB 253 and the EU's CSRD.

**Pricing:** Starter $149/mo, Growth $399/mo, Pro $999/mo.

---

## 🏗️ WHAT'S ALREADY BUILT (Don't Rebuild These!)

| Piece | Status | What It Does |
|-------|--------|-------------|
| Frontend (Vite + React 19 + Tailwind + Recharts) | ✅ Done | All pages: Landing, Dashboard, Calculator, DataIntake, Ledger, Reports, Suppliers, Settings, Pricing, Contact |
| Database schema (Drizzle ORM) | ✅ Done | 12 tables on Railway PostgreSQL |
| Stripe integration | ✅ Done | Checkout, portal, webhooks, subscription change/cancel — all LIVE |
| InsForge SDK (auth) | ✅ Done | Contact form + auth wiring |
| Express server (server.cjs) | ✅ Done | 14 routes, rate limiting, chatbot, lead capture |
| Landing page + legal pages | ✅ Done | Terms, Privacy, Cookie, Methodology |
| Railway deployment | ✅ Done | Live at ecoauditor.io |
| Carbon calculator UI component | ✅ Done | `src/components/carbon-calculator/` — the form exists |
| EPA emission factor data | ✅ Done | Scope 1, 2, 3 factors in calculator utils |

---

## ❌ WHAT'S MISSING (Build These!)

These are the 6 big things Copilot needs to build. Each one is explained in plain language.

---

### 🚩 MISSING PIECE 1: The Calculator Engine (MOST IMPORTANT)

**What it is:** The actual math. Right now the calculator form looks pretty but doesn't calculate anything.

**Think of it like this:** You have a calculator with buttons and a screen, but the wires inside are missing. When someone types "50,000 therms of natural gas," nothing happens. We need to wire up the math.

**How the math works (super simple version):**

```
pollution = amount_used × emission_factor

Example: 50,000 therms of natural gas
emission_factor for natural gas = 0.005302 tCO2e per therm
50,000 × 0.005302 = 265.1 tons of CO2 equivalent
```

**The 3 scopes explained like a 5th grader:**

- **Scope 1** = Pollution YOU make directly (burning gas in your own stoves, driving your own trucks)
- **Scope 2** = Pollution from the electricity you buy (the power plant burns coal so you can turn on lights)
- **Scope 3** = Pollution from everything else in your supply chain (the food you buy, the trucks delivering to you, employee commuting, waste disposal)

**What to build:**

1. An API endpoint at `POST /api/calculate` that:
   - Takes a company ID and period (year)
   - Looks up all emission entries for that company
   - Multiplies each entry's amount by its emission factor
   - Adds up Scope 1, Scope 2, and Scope 3 separately
   - Returns the totals with a confidence score

2. Wire the existing Carbon Calculator UI component to call this endpoint and display results

**Emission factors to use (EPA official numbers):**

```typescript
// SCOPE 1 — Direct Emissions (tCO2e per unit)
const SCOPE1_FACTORS = {
  natural_gas: { therms: 0.005302, mcf: 0.05302, gj: 50.68 },
  diesel: { gallons: 0.01021, liters: 0.002698 },
  propane: { gallons: 0.00579, liters: 0.001531 },
  coal: { short_tons: 2.07, metric_tons: 2.28 },
  fuel_oil_1: { gallons: 0.00975 },
  fuel_oil_2: { gallons: 0.01021 },
  fuel_oil_4: { gallons: 0.01069 },
  fuel_oil_6: { gallons: 0.01110 },
  kerosene: { gallons: 0.00968 },
  gasoline: { gallons: 0.00878 },
  lignite_coal: { short_tons: 1.41 },
  wood: { short_tons: 0.91 },
};

// Mobile (vehicles)
const MOBILE_FACTORS = {
  gasoline_passenger: 0.00878,  // tCO2e per gallon
  gasoline_light_truck: 0.00878,
  diesel_heavy_truck: 0.01021,
  diesel_bus: 0.01021,
};

// SCOPE 2 — Electricity (tCO2e per MWh by region)
const EGRID_FACTORS = {
  CAMX: 0.207,    // California
  RFCM: 0.487,    // Midwest
  RFCE: 0.327,    // Mid-Atlantic
  NYUP: 0.197,    // Upstate NY
  NEWE: 0.197,    // New England
  SRMV: 0.373,    // Mississippi Valley
  SRSO: 0.385,    // Southern
  SPNO: 0.416,    // Western
  ERCT: 0.341,    // Texas
};
const TRANSMISSION_LOSS_RATE = 0.0475; // 4.75% grid loss
// Scope 2 formula: MWh × eGRID_factor × (1 + 0.0475)

// SCOPE 3 — Supply Chain (tCO2e per dollar spent)
const SCOPE3_FACTORS = {
  purchased_goods: 0.000250,
  capital_goods: 0.000177,
  fuel_transport: 0.001060,
  transport_inbound: 0.000590,
  transport_outbound: 0.000450,
  waste: 0.001050,
  business_travel: 0.000260,
  employee_commuting: 0.000220,
  leased_assets: 0.000180,
};
```

**Calculator API response shape:**

```json
{
  "company_id": "uuid",
  "period": "2025",
  "total_emissions_tCO2e": 1847.5,
  "by_scope": {
    "scope1": 265.0,
    "scope2": 107.5,
    "scope3": 1475.0
  },
  "by_category": {
    "stationary_combustion": 265.0,
    "purchased_electricity": 107.5,
    "purchased_goods": 890.0,
    "transportation": 585.0
  },
  "confidence_score": 82,
  "methodology": "EPA GHG Protocol + IPCC AR6"
}
```

---

### 🚩 MISSING PIECE 2: CSV Upload & Data Ingestion

**What it is:** Let companies upload a spreadsheet of their energy use instead of typing it in one at a time.

**Think of it like this:** Imagine you have 50 receipts from gas stations. You could type each one into a calculator... OR you could take a photo of all 50 at once and have the calculator read them automatically. That's what CSV upload does.

**What to build:**

1. `POST /api/ingest/csv` — Upload endpoint
   - Accept a CSV file
   - Required columns: `scope,category,source,amount,unit,method,confidence`
   - Parse each row into an `emission_entries` database record
   - Return a job ID so user can check status

2. Example CSV format:
```csv
scope,category,source,amount,unit,method,confidence
1,stationary_combustion,natural_gas,50000,therms,calculation,85
2,purchased_electricity,grid,250000,kWh,calculation,90
3,purchased_goods,manufacturing,500000,USD,spend_based,60
```

3. `GET /api/ingest/status/:job_id` — Check if upload finished

4. Wire to the existing DataIntake page UI

---

### 🚩 MISSING PIECE 3: PDF Report Generation

**What it is:** Turn the emission numbers into a professional PDF report companies can hand to auditors, investors, or regulators.

**Think of it like this:** The calculator gives you numbers on a screen. But an auditor doesn't want to look at your phone. They want a printed report with a logo, company name, methodology explanation, and signatures. This generates that document.

**What to build:**

1. `POST /api/companies/:id/reports/generate` — Generate PDF
2. `GET /api/reports/:id/download` — Download the PDF
3. Use `puppeteer` or `@react-pdf/renderer` — whichever is easier

**PDF should contain:**
1. Executive Summary (total emissions, confidence score, year-over-year)
2. Scope 1 breakdown (stationary + mobile combustion)
3. Scope 2 breakdown (purchased electricity by region)
4. Scope 3 breakdown (top 5 categories)
5. Compliance Status (SB 253 on track? EU CSRD applicable?)
6. Methodology & Data Quality notes
7. Appendix with full entry table

---

### 🚩 MISSING PIECE 4: Dashboard with Real Data

**What it is:** Right now the dashboard shows fake/seed data. We need it to show REAL calculated numbers from the company's actual emission entries.

**Think of it like this:** You walk into a car dashboard and the speedometer says "50 mph" but the car isn't even moving. That's seed data. We need the speedometer to show real speed based on the actual engine.

**What to build:**

1. Dashboard should call `/api/calculate` on load (for the user's company + current period)
2. Replace mock/seed data with real API responses
3. Show:
   - Total emissions (big number)
   - Scope 1/2/3 pie chart (use existing Recharts)
   - Emissions trend over time (line chart)
   - Confidence score gauge
   - Compliance status badges (SB 253, CSRD)
4. Handle empty state gracefully (new company with zero entries = friendly "Add your first entry" message, NOT a blank white screen)

---

### 🚩 MISSING PIECE 5: Compliance Deadline Tracking

**What it is:** California's SB 253 law requires companies to report emissions by certain dates. EcoAuditor should track those deadlines and warn the user.

**Think of it like this:** You have homework due Friday. Your phone reminds you "Hey, homework is due in 2 days." Same thing, but for government reporting deadlines.

**Key compliance laws:**
- **SB 253 (California):** Companies with >$1B revenue must report Scope 1+2 by 2026, Scope 3 by 2027
- **EU CSRD:** Large EU companies must report starting 2025

**What to build:**

1. `GET /api/companies/:id/compliance` — Returns compliance status
2. `GET /api/compliance/deadlines` — Returns upcoming deadlines
3. `POST /api/compliance/:id/signoff` — Mark a task as done
4. Store compliance tasks in the existing `compliance_tasks` table
5. Show compliance badges on Dashboard

---

### 🚩 MISSING PIECE 6: Facility-Level Emissions

**What it is:** A company might have 3 factories. Right now we only show total emissions. We need to break it down per facility.

**Think of it like this:** You know your family spends $5,000/month on groceries. But you don't know if it's mostly snacks or mostly vegetables. Breaking it down by facility is like seeing the receipt for each store separately.

**What to build:**

1. `GET /api/companies/:id/facilities` — List facilities
2. `POST /api/companies/:id/facilities` — Add a facility
3. `GET /api/facilities/:id/emissions` — Emissions for one facility
4. Each facility has: name, type (office/factory/warehouse), city, scope1_pct, scope2_pct
5. Dashboard should show per-facility breakdown in a table

---

## 📊 DATABASE SCHEMA (Already Exists — For Reference)

Copilot needs to know what tables exist. Here are the 12 tables and what they store:

```
companies           → Who is tracking emissions (name, industry, employee count)
facilities          → Physical locations (factory, office, warehouse)
emission_entries    → The raw data (50,000 therms of natural gas, Scope 1)
ledger_entries      → Audit trail of changes (who entered what, when, verified?)
uploaded_files      → CSV/PDF files the company uploaded
suppliers           → Supply chain partners (for Scope 3)
reports             → Generated PDF reports (draft/published)
compliance_tasks    → Government deadlines (SB 253, CSRD)
missing_data_alerts → "Hey, you're missing Scope 2 data for Q3"
contact_submissions → Contact form submissions from the website
trend_data          → Month-by-month emissions for charts
user_settings       → User preferences
```

**ORM:** Drizzle ORM (NOT Prisma, NOT InsForge PostgREST for runtime queries)
**Database:** Railway PostgreSQL via `DATABASE_URL`
**Migration tool:** Drizzle Kit (`drizzle/` directory)

---

## 🔑 ENVIRONMENT VARIABLES (Copilot Needs These Names)

```env
# Database (Drizzle ORM connects here)
DATABASE_URL=postgresql://...

# InsForge (auth + contact form ONLY, NOT CRUD)
VITE_INSFORGE_BASE_URL=https://insforge-production-f926.up.railway.app
VITE_INSFORGE_ANON_KEY=...

# Stripe (already working)
STRIPE_SECRET_KEY=sk_live_...
VITE_STRIPE_PK=pk_live_...

# Stripe Price IDs (already configured in Stripe Dashboard)
STRIPE_PRICE_ID_STARTER_MONTHLY=price_...
STRIPE_PRICE_ID_STARTER_ANNUAL=price_...
STRIPE_PRICE_ID_GROWTH_MONTHLY=price_...
STRIPE_PRICE_ID_GROWTH_ANNUAL=price_...
STRIPE_PRICE_ID_PRO_MONTHLY=price_...
STRIPE_PRICE_ID_PRO_ANNUAL=price_...

# Webhook
STRIPE_WEBHOOK_SECRET=whsec_...
```

**⚠️ IMPORTANT: The env prefix is `VITE_*` (NOT `NEXT_PUBLIC_*`). This is a Vite app, not Next.js.**

---

## 🚨 CRITICAL THINGS TO NOT MESS UP

1. **This is Vite + React 19, NOT Next.js.** No `getServerSideProps`, no `app/` directory, no server components. The backend is Express in `server.cjs`.

2. **Drizzle ORM for CRUD, NOT InsForge PostgREST.** InsForge SDK is only for auth + contact form. All runtime database queries go through Drizzle → `pg` → `DATABASE_URL`.

3. **Don't break existing Stripe integration.** Checkout, portal, webhooks, and subscription management already work. Don't touch them.

4. **Don't rebuild existing pages.** All frontend pages already exist. Just wire them to real API data.

5. **The Express server has 14 routes.** Don't add conflicting routes. Check `server.cjs` first.

6. **Carbon calculator UI exists.** Build the engine behind it, not a new UI.

---

## 📅 BUILD ORDER (What Copilot Should Build First)

| Priority | What | Why |
|---------|------|-----|
| 🔴 P1 | Calculator Engine (`/api/calculate`) | Nothing else works without the math |
| 🔴 P1 | Dashboard with real data | Landing on the app shows fake numbers right now |
| 🟡 P2 | CSV upload & data ingestion | Users need to input data easily |
| 🟡 P2 | Facility-level emissions | Multi-facility companies need this |
| 🟢 P3 | PDF report generation | Nice to have but not blocking |
| 🟢 P3 | Compliance deadline tracking | Important but can ship without it |

---

## ✅ HOW TO KNOW IT WORKS (Test Checklist)

After building each piece, verify:

1. **Calculator:** Enter 50,000 therms natural gas → should get ~265 tCO2e for Scope 1
2. **Dashboard:** Create a test company, add entries, refresh dashboard → should show real numbers not seed data
3. **CSV upload:** Upload the example CSV above → entries should appear in emission_entries table
4. **PDF:** Click "Generate Report" → should download a real PDF
5. **Compliance:** Should show SB 253 deadline status for test company
6. **Facilities:** Add 2 facilities, check emissions break down per facility
7. **Empty state:** New company with zero entries → dashboard shows friendly message, not blank screen

---

## 📁 FILE STRUCTURE (Where Stuff Lives)

```
ecoauditor/
├── server.cjs              ← Express backend (14 routes, add new API routes here)
├── src/
│   ├── db/
│   │   ├── index.ts         ← Drizzle DB client
│   │   └── schema.ts        ← All 12 table definitions
│   ├── lib/
│   │   ├── stripe.ts         ← Stripe integration (WORKING, don't touch)
│   │   └── insforge.ts       ← InsForge auth SDK (WORKING, don't touch)
│   ├── components/
│   │   └── carbon-calculator/  ← Calculator UI (exists, wire up the engine)
│   └── pages/                ← All pages exist, just need real data
├── drizzle/                  ← Drizzle Kit migrations
├── migrations/               ← InsForge CLI migrations (separate system)
└── package.json               ← Vite + React 19 + Drizzle
```

---

*Built for GitHub Copilot. Just copy-paste this whole file into context and start building.*