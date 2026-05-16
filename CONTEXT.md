# EcoAuditor Architecture Context Map

Generated: May 14, 2026 | Updated: May 15, 2026 | Build Phase: Calculator/API slices implemented

---

## 1. PROJECT STRUCTURE

### Frontend (Vite + React 19)
```

Root module:
- `emissions-engine.cjs` - Canonical EPA emissions math shared by server routes and tests
src/
├── pages/           # 9 pages (all exist, don't rebuild)
│   ├── Dashboard.tsx          # P1: Wire real data from calculator
│   ├── DataIntake.tsx         # Upload CSV (Slice 3)
│   ├── Ledger.tsx             # Transaction ledger
│   ├── Reports.tsx            # P3: PDF report export
│   ├── Suppliers.tsx          # Supplier management
│   ├── Settings.tsx           # Account settings
│   ├── Pricing.tsx            # Pricing
│   ├── LandingPage.tsx        # Marketing
│   └── AIAssistant.tsx        # Chatbot
├── components/
│   ├── carbon-calculator/     # P1: Calculator UI exists
│   │   ├── index.tsx          # Main component
│   │   ├── EmissionForm.tsx   # Form captures scope/category/source/amount
│   │   ├── EmissionList.tsx   # Lists entries
│   │   ├── EmissionsDashboard.tsx  # Displays summary
│   │   ├── ReportGenerator.tsx     # P3: PDF stub
│   │   └── utils.ts           # EPA emission factors (all 11 categories, 50+ sources)
│   └── ...
├── hooks/           # Custom React hooks
├── lib/
│   ├── insforge.ts  # InsForge SDK client
│   └── ...
├── data/
│   └── mockData.ts  # SEED DATA (replace with API calls in Slice 2)
└── db/
    └── schema.ts    # Drizzle schema (1 table: users for Stripe mapping)
```

### Backend (Express on Railway)
```
server.cjs (900 lines)
├── Health routes (3)
│   ├── GET /api/version       # For forced-update watchdog
│   ├── GET /health            # Health check
│   └── GET /ready             # Readiness probe
├── Stripe routes (6)
│   ├── GET /api/config/prices # Price IDs
│   ├── POST /api/checkout     # Create checkout session
│   ├── PATCH /api/subscription # Update subscription
│   ├── DELETE /api/subscription # Cancel subscription
│   ├── POST /api/portal       # Billing portal
│   └── POST /api/webhook      # Stripe webhooks
├── Chat API (1)
│   └── POST /api/chat         # Salesbot engine + AI fallback
├── Leads API (1)
│   └── POST /api/leads        # Lead capture
├── Video streaming (1)
│   └── GET /api/video         # MP4 streaming with range support
├── Static files + SPA fallback
├── Guards
│   ├── authGuard()            # Verifies InsForge bearer token
│   ├── stripeGuard()          # Checks Stripe configured
│   └── Rate limiting (120 req/min sliding window, in-memory)
└── Logging: Structured JSON to stdout/stderr
```

### Database Layer

**PostgreSQL (Railway)**
```
users table (1)
├── insforge_user_id (uuid) [PK]
├── stripe_customer_id (text)
├── email (text)
└── created_at (timestamp)
```

**InsForge Backend** (Real app data, accessed via SDK)
- companies
- facilities
- emission_entries
- reports
- suppliers
- uploaded_files
- compliance_tasks
- audit_logs
- (other InsForge-managed tables)

---

## 2. EXISTING DATA FLOW

### Scope: Company → Facilities → Emission Entries

```
Frontend (React)
  ↓ (Auth bearer token from InsForge)
InsForge SDK
  ↓ (CRUD operations)
InsForge Backend
  ↓ (Manages companies, facilities, emission_entries)
PostgreSQL (via InsForge PostgREST)
```

### Emission Entry Structure (from mockData)
```typescript
{
  id: number
  company_id: number              // Facility belongs to this company
  facility_id?: number            // Optional facility location (Slice 4)
  scope: 'Scope 1' | 'Scope 2' | 'Scope 3'
  category: string                // e.g., "Electricity", "Mobile Combustion"
  source: string                  // e.g., "US Average", "Gasoline"
  amount: number                  // e.g., 500 (kWh, gallons, miles, etc.)
  unit: string                    // e.g., "kWh", "gallons", "MMBtu"
  calculated_kg_co2e: number      // Result of calculator (Slice 1)
  factor: string                  // EPA factor used (e.g., "eGRID WECC 2024")
  confidence: number              // 0-100 confidence score
  method: string                  // e.g., "Location-based", "Average-based"
  created_at: timestamp
  updated_at: timestamp
}
```

---

## 3. EMISSION FACTORS (EPA OFFICIAL)

All factors in kg CO2e per unit, sourced from:
- EPA GHG Factor Hub 2024
- eGRID regional emission rates
- IPCC AR6 GWP-100 (for refrigerants)
- GLEC Framework v3 (freight)

### Scope 1: Direct Emissions (6 categories)
| Category | Sources | Example Factor |
|----------|---------|---|
| Stationary Combustion | Natural Gas, Propane, Diesel, Fuel Oil, Coal | 53.06 kg/MMBtu (Natural Gas) |
| Mobile Combustion | Gasoline, Diesel, Jet Fuel, NG Vehicle | 8.887 kg/gal (Gasoline) |
| Process Emissions | Cement, Steel, Ammonia | 507 kg/ton (Cement) |
| Fugitive Emissions | Refrigerants (R-410A, R-22), NG leaks | 2088 kg/kg (R-410A) |

### Scope 2: Purchased Electricity (1 category)
| Category | Sources | Example Factor |
|----------|---------|---|
| Purchased Electricity | US Average, CA, TX, NY, Renewable | 0.417 kg/kWh (US Avg), 0.23 kg/kWh (CA) |

### Scope 3: Value Chain (5 categories)
| Category | Sources | Example Factor |
|----------|---------|---|
| Purchased Goods | Paper, Plastic, Steel, Aluminum, Concrete | 0.94 kg/kg (Paper) |
| Business Travel | Air Haul (short/long), Hotel, Rental Car | 0.255 kg/pax-mile (Air Short Haul) |
| Employee Commuting | Car Alone, Carpool, Transit, Remote | 0.404 kg/mile (Car Alone) |
| Waste | Landfill, Recycling, Composting | 0.586 kg/kg (Landfill) |
| Transportation | Heavy/Medium/Light Duty, Rail | 1.018 kg/mile (Heavy Duty Diesel) |

---

## 4. EXISTING 14 EXPRESS ROUTES

| Route | Method | Purpose | Auth | Status |
|-------|--------|---------|------|--------|
| /api/version | GET | Version + build info | - | ✓ Working |
| /health | GET | Health check | - | ✓ Working |
| /ready | GET | Readiness probe | - | ✓ Working |
| /api/config/prices | GET | Stripe price IDs | - | ✓ Working |
| /api/checkout | GET/POST | Stripe checkout session | authGuard | ✓ Working |
| /api/subscription | PATCH | Update subscription | authGuard, stripeGuard | ✓ Stub |
| /api/subscription | DELETE | Cancel subscription | authGuard, stripeGuard | ✓ Stub |
| /api/portal | POST | Billing portal link | authGuard, stripeGuard | ✓ Working |
| /api/webhook | POST | Stripe webhook | - (sig verify) | ✓ Working |
| /api/chat | POST | Salesbot + AI | - | ✓ Working |
| /api/leads | POST | Lead capture | - | ✓ Working |
| /api/video | GET | MP4 streaming | - | ✓ Working |
| /* (static) | GET | Static files (Vite build) | - | ✓ Working |
| /* (fallback) | GET | SPA fallback to index.html | - | ✓ Working |

---

## 5. DASHBOARD CURRENT STATE

**Location**: [Dashboard.tsx](src/pages/Dashboard.tsx)

**Mock Data Used**:
- `EMISSIONS_SUMMARY` — Total + Scope 1/2/3 with trend %
- `TREND_DATA` — Monthly emissions chart data (Jul–Mar)
- `READINESS_SCORE` — Reporting readiness percentage
- `MISSING_DATA_ALERTS` — Data gaps & alerts
- `COMPLIANCE_TASKS` — Deadline tracking
- `CFO_METRICS` — Business metrics (consultant $ saved, contracts at risk, audit defensibility %)

**Components**:
- AreaChart (Recharts) — Scope 1/2/3 trend over time
- EmissionsCard — Display scope totals
- ReadinessCircle — Circular progress % indicator
- AlertsList — Missing data warnings
- CFOMetricCard — Business metrics grid

**Integration Point (Slice 2)**:
- Replace `EMISSIONS_SUMMARY` with API call to `GET /api/emissions/summary`
- Replace `TREND_DATA` with API call to `GET /api/emissions/trend?period=monthly`
- Keep readiness/alerts/tasks as seed for now (can integrate later)

---

## 6. CALCULATOR ENGINE DESIGN (Slice 1)

**Canonical implementation:** `emissions-engine.cjs`

The engine owns factor lookup, scope normalization, summary aggregation, CSV parsing, facility aggregation, and compliance status helpers. Server routes call this module instead of duplicating factor tables.

### Math Formula
```
CO2e_kg = amount × emission_factor
```

Where:
- `amount` = user input (e.g., 500 kWh, 10 gallons, 2 tons)
- `emission_factor` = EPA factor for (scope, category, source, region) from utils.ts
- `CO2e_kg` = result in kilograms CO2 equivalent

### Input Source
- **Frontend** (EmissionForm.tsx): Captures (scope, category, source, amount, unit, facility_id)
- **POST /api/calculate** endpoint receives JSON payload
- **Backend**: Looks up factor, multiplies, stores in database

### Example Calculation
```
User inputs:
  scope: "Scope 2"
  category: "Purchased Electricity"
  source: "California"
  amount: 500
  unit: "kWh"
  facility_id: null

API call:
  POST /api/calculate
  { scope, category, source, amount, unit, facility_id }

Backend logic:
  factor = EMISSION_FACTORS["Purchased Electricity"]["California"] = 0.23
  co2e_kg = 500 × 0.23 = 115 kg

Response:
  { 
    success: true,
    co2e_kg: 115,
    co2e_tonnes: 0.115,
    factor_used: "0.23 kg CO2e/kWh",
    factor_source: "eGRID WECC 2024",
    confidence: 96
  }
```

### Endpoint Design (Slice 1)
```typescript
POST /api/calculate
Content-Type: application/json

Request:
{
  company_id: number
  facility_id?: number
  scope: "Scope 1" | "Scope 2" | "Scope 3"
  category: string
  source: string
  amount: number
  unit: string
  save_entry?: boolean  // If true, auto-create emission_entry in DB
}

Response (200 OK):
{
  success: true,
  co2e_kg: number
  co2e_tonnes: number
  factor_used: string
  factor_source: string
  confidence: number
  entry_id?: number  // If save_entry=true
}

Error Response (400/500):
{
  success: false,
  error: "Invalid category" | "Factor not found" | "Missing company_id"
}
```

---

## 7. CSV INGESTION DESIGN (Slice 3)

### Supported CSV Format
```csv
facility_name,scope,category,source,amount,unit,date
Sacramento HQ,Scope 1,Mobile Combustion,Gasoline,500,gallons,2026-03-15
Sacramento HQ,Scope 2,Purchased Electricity,California,8472,kWh,2026-03-15
Fresno Packaging,Scope 1,Stationary Combustion,Natural Gas,1200,MMBtu,2026-03-20
```

### Endpoint Design (Slice 3)
```typescript
POST /api/ingest/csv
Content-Type: multipart/form-data

Form data:
  file: <binary CSV file>

Response (200 OK):
{
  success: true,
  imported: 47,
  errors: [
    { row: 5, error: "Category 'Bad Cat' not found" },
    { row: 12, error: "Invalid amount: 'abc'" }
  ],
  warnings: [
    { row: 3, warning: "Confidence 44% (low confidence estimate)" }
  ]
}
```

---

## 8. FACILITY-LEVEL AGGREGATION (Slice 4)

### Per-Facility Totals
```typescript
GET /api/facilities/:facility_id/emissions/summary

Response:
{
  facility_id: 3,
  facility_name: "Portland Distribution",
  total_co2e_kg: 482000,  // Sum of all entries
  scope1_co2e_kg: 129940,
  scope2_co2e_kg: 86760,
  scope3_co2e_kg: 265300,
  entry_count: 47,
  last_updated: "2026-03-30T14:22:00Z"
}
```

### Aggregation Logic
```
Per facility:
  scope1_total = SUM(emission_entries.co2e_kg WHERE scope='Scope 1' AND facility_id=X)
  scope2_total = SUM(emission_entries.co2e_kg WHERE scope='Scope 2' AND facility_id=X)
  scope3_total = SUM(emission_entries.co2e_kg WHERE scope='Scope 3' AND facility_id=X)
  
Company-wide:
  company_total = SUM(emission_entries.co2e_kg WHERE company_id=X)
```

---

## 9. PDF REPORT GENERATION (Slice 5)

### Libraries
- **pdfkit** (7.2 MB) OR **PDFMake** (400 KB) — Choose in ADR
- Flow: Backend generates PDF → Returns file or link

### Report Contents
- Executive summary (total, scope breakdown %)
- Emissions trend chart (embed as image)
- Facility breakdown table
- Methodology & factors used
- Compliance readiness score
- Missing data alerts

---

## 10. COMPLIANCE DEADLINE TRACKING (Slice 6)

### Tracked Deadlines
- **CBAM** (Carbon Border Adjustment Mechanism): EU reporting for imports
- **CSRD** (Corporate Sustainability Reporting Directive): EU large companies
- **SEC Climate Rule**: US public companies (Scope 1/2 disclosure)
- **California AB 1305** (Climate Corporate Data Accountability Act): CA companies

### Feature
```typescript
GET /api/compliance/deadlines

Response:
{
  deadlines: [
    { regulation: "CBAM", deadline: "2026-06-30", status: "at-risk", days_left: 47 },
    { regulation: "CSRD", deadline: "2026-12-31", status: "on-track", days_left: 231 },
    { regulation: "SEC Climate", deadline: "2027-01-31", status: "on-track", days_left: 262 },
    { regulation: "AB 1305", deadline: "2026-12-31", status: "at-risk", days_left: 231 },
  ]
}
```

---

## 11. EMISSIONS SUMMARY CALCULATION

### Current Mock Data
```typescript
EMISSIONS_SUMMARY = {
  total: 4872,     // tCO2e
  scope1: { value: 1834, pct: 37.6, trend: -3.2 },
  scope2: { value: 1453, pct: 29.8, trend: +1.4 },
  scope3: { value: 1585, pct: 32.5, trend: +8.1 }
}
```

### Real API (Slice 2)
```typescript
GET /api/emissions/summary?company_id=X&period=latest|quarterly|annual

Response:
{
  total_co2e_tonnes: 4872,
  scope1_co2e_tonnes: 1834,
  scope2_co2e_tonnes: 1453,
  scope3_co2e_tonnes: 1585,
  scope1_pct: 37.6,
  scope2_pct: 29.8,
  scope3_pct: 32.5,
  trend_vs_prior_period: {
    scope1: -3.2,
    scope2: +1.4,
    scope3: +8.1
  },
  updated_at: "2026-03-30T14:22:00Z"
}
```

---

## 12. DEPENDENCIES

### Frontend
- React 19.2.4
- React Router 7.14.0
- Recharts 3.8.1 (charts)
- Tailwind 3.4 (fixed version)
- @insforge/sdk 1.2.4
- TypeScript 6.0.2

### Backend
- Express 4.22.1
- Drizzle ORM 0.45.2
- pg 8.20.0 (PostgreSQL driver)
- stripe 22.0.1
- **(New for Slice 5)**: pdfkit 0.13.0 OR PDFMake 0.2.0

### Testing
- Vitest 4.1.4
- jsdom 29.0.2

---

## 13. KEY CONSTRAINTS RECAP

✅ **MUST DO**
- Vite + React 19 (NOT Next.js)
- Express backend (NOT Vercel Functions)
- Drizzle ORM (NOT raw SQL, NOT Sequelize)
- Real code changes, not stubs
- Validate each slice end-to-end

❌ **NEVER MODIFY**
- Stripe integration (checkout, portal, webhooks all working)
- Existing 9 pages (just wire data)
- InsForge auth setup
- Carbon calculator UI component (build engine, not new forms)
- Existing 14 Express routes (add new ones, don't modify these)

---

## 14. SLICES & DELIVERABLES

| Slice | Feature | Endpoint | P | Status | LOC Est |
|-------|---------|----------|---|--------|---------|
| 1 | Calculator Engine | POST /api/calculate | P1 | TODO | 120 |
| 2 | Dashboard → Calculator | GET /api/emissions/summary | P1 | TODO | 280 |
| 3 | CSV Ingestion | POST /api/ingest/csv | P2 | TODO | 240 |
| 4 | Facility Aggregation | GET /api/facilities/:id/emissions | P2 | TODO | 180 |
| 5 | PDF Report | POST /api/reports/generate | P3 | TODO | 350 |
| 6 | Compliance Tracking | GET /api/compliance/deadlines | P3 | TODO | 150 |
| **Total** | | | | | **~1,320 LOC** |

---

Generated by godmythos v10 orchestration | May 14, 2026
