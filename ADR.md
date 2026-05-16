# ADR: EcoAuditor Slices 1-6 Implementation Decisions

**Date**: May 14, 2026  
**Status**: ACCEPTED  
**Godmythos v10 Protocol**: Compound loop (recon → plan → build → validate → iterate)

---

## ADR-001: Calculator Engine Implementation Location

### Decision
**Implement POST /api/calculate on Express backend** (server.cjs)

### Rationale
- ✅ Emission factors are sensitive (EPA-official, compliance-verified) → keep server-side
- ✅ Backend can audit-log every calculation for compliance
- ✅ Easier to update factors without frontend deployment
- ✅ Can validate user input server-side before storing
- ✅ Consistent with Stripe/auth guard pattern in server.cjs
- ❌ Frontend-only: No audit trail, factors exposed to client

### Implementation
- Add authGuard + stripeGuard (premium feature, limits to paid users)
- Accept JSON: `{ company_id, facility_id?, scope, category, source, amount, unit, save_entry? }`
- Return JSON: `{ success, co2e_kg, co2e_tonnes, factor_used, confidence, entry_id? }`
- Insert emission_entry into InsForge backend via SDK call
- Log to stdout for audit trail

### Files Modified
- `server.cjs` — Add POST /api/calculate (120 LOC)

---

## ADR-002: Emission Factor Storage

### Decision
**Duplicate EPA factors in server.cjs constants** (same as frontend utils.ts)

### Rationale
- ✅ Factors are identical on both sides (EPA official, immutable)
- ✅ Backend doesn't need to query database for every calculation (fast)
- ✅ Factors versioned in git for audit compliance
- ❌ Database table: Extra round-trip, migration overhead
- ❌ API call: Latency, single point of failure

### Implementation
- Copy `EMISSION_FACTORS` object from `src/components/carbon-calculator/utils.ts`
- Add to top of server.cjs: `const EMISSION_FACTORS = { ... }`
- Implement `lookupFactor(scope, category, source)` function
- Return `{ factor, source, confidence }` tuple

### Factor Source Attribution
- **Scope 1**: EPA GHG Factor Hub 2024, IPCC AR6 GWP-100
- **Scope 2**: eGRID 2024 regional rates (US Average, CA, TX, NY, Renewable)
- **Scope 3**: EPA WARM, GLEC Framework v3, EXIOBASE 3.8
- All factors in kg CO2e per unit (standard)

---

## ADR-003: Emission Entry Storage Strategy

### Decision
**Store calculated entries in InsForge backend** (via @insforge/sdk from frontend OR direct API call)

### Rationale
- ✅ InsForge already manages `emission_entries` table
- ✅ Consistent with existing auth/RLS patterns
- ✅ Automatically tracks created_at, updated_at, user_id
- ✅ Integrates with Reports, Suppliers, Audit Log tables
- ❌ PostgreSQL only: Would require new migration, schema management

### Implementation (Slice 1)
- Backend calculates but does NOT insert (frontend does)
- Response includes `co2e_kg`, `co2e_tonnes`, `factor_used`
- Frontend calls: `await insforge.from('emission_entries').insert([{ ...data, calculated_kg_co2e }])`
- OR backend can optionally insert if `save_entry=true` (requires InsForge SDK on backend)

### Implementation (Slice 2+)
- Backend aggregates from InsForge via SDK
- GET /api/emissions/summary queries InsForge directly (cached in memory)

---

## ADR-004: Dashboard Data Wiring (Slice 2)

### Decision
**Replace mock data with API calls, keep chart UI unchanged**

### Current (Mocks)
```typescript
// src/pages/Dashboard.tsx
import { EMISSIONS_SUMMARY, TREND_DATA, ... } from '../data/mockData'
```

### New (API calls)
```typescript
// src/pages/Dashboard.tsx
const [summary, setSummary] = useState(null)
const [trend, setTrend] = useState([])

useEffect(() => {
  async function load() {
    const res = await fetch('/api/emissions/summary')
    const data = await res.json()
    setSummary(data)
    
    const trendRes = await fetch('/api/emissions/trend?period=monthly')
    setTrend(await trendRes.json())
  }
  load()
}, [])
```

### API Endpoints (Slice 2)
```
GET /api/emissions/summary?company_id=X&period=latest
  Returns: { total_co2e_tonnes, scope1/2/3_tonnes, percentages, trend_vs_prior }

GET /api/emissions/trend?company_id=X&period=monthly|quarterly|annual
  Returns: [{ month, scope1, scope2, scope3 }, ...]
```

### Readiness, Alerts, Tasks
- Keep as mock data for now (non-critical for P1)
- Can integrate in Slice 3+ if time permits

---

## ADR-005: CSV Ingestion Strategy (Slice 3)

### Decision
**Implement POST /api/ingest/csv with validation + dry-run mode**

### CSV Format (Required Headers)
```
facility_name, scope, category, source, amount, unit, date [, notes]
Sacramento HQ, Scope 1, Mobile Combustion, Gasoline, 500, gallons, 2026-03-15
```

### Implementation
- Use `csv-parser` npm package (lightweight, streaming)
- Validate each row:
  - ✓ Facility exists for company
  - ✓ Scope ∈ {Scope 1, Scope 2, Scope 3}
  - ✓ Category valid for scope
  - ✓ Source valid for category
  - ✓ Amount is number > 0
  - ✓ Unit matches category expectations
- Calculate CO2e using calculator logic
- Insert batch into InsForge (transaction if possible)
- Return: `{ success, imported, errors[], warnings[] }`

### Headers
```
POST /api/ingest/csv
Content-Type: multipart/form-data
Authorization: Bearer <token>

Form:
  file: <binary CSV>
  dry_run?: boolean  (if true, validate only, don't insert)
```

### Dependencies
- Add `csv-parser` to package.json (dev or prod?)

---

## ADR-006: Facility-Level Emissions Aggregation (Slice 4)

### Decision
**Calculate per-facility totals server-side using InsForge queries**

### Endpoint
```
GET /api/facilities/:facility_id/emissions/summary?company_id=X
  Authorization: Bearer <token>

Response:
{
  facility_id: 3,
  facility_name: "Portland Distribution",
  total_co2e_kg: 482000,
  scope1_co2e_kg: 129940,
  scope2_co2e_kg: 86760,
  scope3_co2e_kg: 265300,
  entry_count: 47,
  last_updated: "2026-03-30T14:22:00Z"
}
```

### Implementation
- Query InsForge: `SELECT SUM(calculated_kg_co2e) FROM emission_entries WHERE facility_id=X AND scope='Scope N'`
- Cache result for 5 min (avoid query storm)
- Include facility metadata (name, city, type)

---

## ADR-007: PDF Report Generation (Slice 5)

### Decision
**Use PDFMake (lightweight, 400 KB) over pdfkit (7.2 MB)**

### Rationale
- ✅ PDFMake: Smaller, declarative, no system fonts required
- ✅ Works on Railway (no native libs needed)
- ✅ Node.js + browser compatible
- ❌ pdfkit: Larger, requires dependencies, more overhead

### Report Contents
1. **Cover**: Company name, reporting period, timestamp
2. **Executive Summary**: Total + Scope 1/2/3 tonnes, % breakdown
3. **Trend Chart**: Monthly emissions (6-12 months)
4. **Facility Breakdown**: Table (facility name, Scope 1/2/3 totals)
5. **Methodology**: Factors used, EPA sources, confidence scores
6. **Compliance Readiness**: Score + dimension breakdown
7. **Missing Data Alerts**: Top risks

### Endpoint
```
POST /api/reports/generate
Content-Type: application/json
Authorization: Bearer <token>

Request:
{
  company_id: number,
  period: "monthly" | "quarterly" | "annual",
  format: "pdf" | "json"
}

Response (pdf):
  Content-Type: application/pdf
  [Binary PDF file]

Response (json):
  {
    success: true,
    url: "s3://bucket/reports/eco-2026-q1.pdf",
    expires_in_hours: 24
  }
```

### Implementation
- npm install pdfmake (NOT pdfkit)
- Generate PDF in memory or stream to S3
- Return base64 or signed S3 URL

---

## ADR-008: Compliance Deadline Tracking (Slice 6)

### Decision
**Hardcoded compliance calendar in server.cjs (not database)**

### Rationale
- ✅ Deadlines change rarely (annual/multi-year cycles)
- ✅ No database query needed
- ✅ Version control audit trail
- ✓ Can be easily updated per customer if needed later

### Deadlines Tracked
```typescript
const COMPLIANCE_DEADLINES = [
  { regulation: 'CBAM', deadline: '2026-06-30', scope: ['Scope 3'], description: 'EU import declaration' },
  { regulation: 'CSRD', deadline: '2026-12-31', scope: ['Scope 1', 'Scope 2', 'Scope 3'], description: 'EU reporting' },
  { regulation: 'SEC Climate Rule', deadline: '2027-01-31', scope: ['Scope 1', 'Scope 2'], description: 'US public company disclosure' },
  { regulation: 'AB 1305', deadline: '2026-12-31', scope: ['Scope 1', 'Scope 2', 'Scope 3'], description: 'CA large company disclosure' },
]
```

### Endpoint
```
GET /api/compliance/deadlines?company_id=X
  Authorization: Bearer <token>

Response:
{
  deadlines: [
    { regulation: 'CBAM', deadline: '2026-06-30', days_left: 47, status: 'at-risk' },
    ...
  ]
}

Status logic:
  days_left <= 30 → "at-risk" (red)
  30 < days_left <= 90 → "pending" (yellow)
  days_left > 90 → "on-track" (green)
```

---

## ADR-009: Authentication & Authorization

### Decision
**Use existing authGuard for premium routes, no RLS changes**

### Applied To
- POST /api/calculate (Premium feature)
- POST /api/ingest/csv
- GET /api/emissions/summary
- GET /api/emissions/trend
- GET /api/facilities/:id/emissions/summary
- POST /api/reports/generate
- GET /api/compliance/deadlines

### Implementation
- Verify InsForge bearer token (existing pattern)
- Extract user.id and company_id from token/context
- Validate user owns company (InsForge RLS handles this)
- No new Drizzle tables needed for permissions

---

## ADR-010: Error Handling & Validation

### Standard Response Format
```typescript
// Success (200, 201)
{
  success: true,
  data: { ... },
  timestamp: "2026-05-14T10:30:00Z"
}

// Error (400, 401, 403, 500)
{
  success: false,
  error: "Descriptive message",
  code: "INVALID_CATEGORY" | "MISSING_COMPANY_ID" | "FACTOR_NOT_FOUND",
  timestamp: "2026-05-14T10:30:00Z"
}

// Partial Success (202)
{
  success: true,
  data: { imported: 45, errors: [...], warnings: [...] },
  timestamp: "2026-05-14T10:30:00Z"
}
```

### Validation Rules
- Amount must be > 0
- Unit must match category expectations
- Facility must belong to company
- Category must be valid for scope
- Source must be valid for category

---

## ADR-011: Caching & Performance

### Cache Strategy
| Route | TTL | Method | Key |
|-------|-----|--------|-----|
| GET /api/emissions/summary | 5 min | In-memory Map | `${company_id}:summary` |
| GET /api/emissions/trend | 1 hour | In-memory Map | `${company_id}:trend` |
| GET /api/facilities/:id/emissions | 5 min | In-memory Map | `facility:${id}` |
| GET /api/compliance/deadlines | 24 hours | In-memory Map | `compliance:deadlines` |

### Implementation
- Use simple `Map<string, { data, expires }>` in server.cjs
- Prune expired entries every 10 min
- No external Redis needed for MVP

---

## ADR-012: Testing Strategy (Slice 2)

### Unit Tests
- `tests/calculator.test.ts` — Test factor lookups + math
- `tests/emissions.test.ts` — Test API endpoints

### E2E Validation
- Slice 1: POST /api/calculate with known inputs, verify output
- Slice 2: GET /api/emissions/summary returns correct totals
- Slice 3: POST /api/ingest/csv with sample file
- Manual: Dashboard loads real data from API

### No Breaking Changes
- Existing tests continue to pass
- New tests in `tests/` directory

---

## ADR-013: Deployment & Environment Variables

### New Environment Variables
```bash
# Already set (no changes)
VITE_INSFORGE_BASE_URL=https://...
INSFORGE_BASE_URL=https://...
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=sk_live_...

# New for Slice 5 (PDF generation)
PDF_FORMAT=pdfmake  # or 'pdfkit'
AWS_S3_BUCKET_REPORTS=  # Optional, for signed URLs
```

### Deployment Flow
- No database migrations needed (using InsForge)
- Add new npm dependencies: `csv-parser`, `pdfmake`
- Build & deploy to Railway (existing workflow)
- Verify endpoints with curl:
  ```bash
  curl -X POST http://localhost:3000/api/calculate \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d '{"company_id":1,"scope":"Scope 1","category":"Mobile Combustion","source":"Gasoline","amount":500,"unit":"gallons"}'
  ```

---

## ADR-014: Migration Sequence & Risk Mitigation

### Deploy Order (Minimize Risk)
1. **Slice 1**: Add POST /api/calculate (no UI changes, backend-only)
2. **Slice 2**: Add GET /api/emissions/summary + wire Dashboard (test with staging data)
3. **Slice 3**: Add POST /api/ingest/csv (with dry-run mode enabled by default)
4. **Slice 4**: Add GET /api/facilities/:id/emissions
5. **Slice 5**: Add POST /api/reports/generate (new library, test carefully)
6. **Slice 6**: Add GET /api/compliance/deadlines (no dependencies, safe)

### Rollback Plan
- Each slice is independent; can disable by removing route
- Feature flags: Check env vars to enable/disable endpoints
- Database: No schema changes (using InsForge), no rollback needed

---

## ADR-015: Documentation & Code Comments

### Code Comments
- Document EPA factor sources (e.g., "eGRID WECC 2024: 0.23 kg CO2e/kWh")
- Explain confidence scores (why 96% vs 72%?)
- Reference GHG Protocol scope definitions

### API Documentation
- Add JSDoc comments to each new route
- Include example requests/responses
- Document error codes

### README Updates
- Add "Calculator Engine" section
- List supported categories/sources
- EPA factor attribution

---

## Summary Table

| ADR | Decision | Status |
|-----|----------|--------|
| 001 | Calculator on Express backend | ✅ APPROVED |
| 002 | Duplicate EPA factors in server.cjs | ✅ APPROVED |
| 003 | Store in InsForge backend | ✅ APPROVED |
| 004 | Dashboard API wiring | ✅ APPROVED |
| 005 | CSV ingestion with validation | ✅ APPROVED |
| 006 | Facility aggregation server-side | ✅ APPROVED |
| 007 | Use PDFMake (not pdfkit) | ✅ APPROVED |
| 008 | Hardcoded compliance calendar | ✅ APPROVED |
| 009 | Existing authGuard for premium routes | ✅ APPROVED |
| 010 | Standard error response format | ✅ APPROVED |
| 011 | In-memory caching (no Redis) | ✅ APPROVED |
| 012 | Test strategy (unit + E2E) | ✅ APPROVED |
| 013 | Env vars for new features | ✅ APPROVED |
| 014 | Deploy order (Slices 1→6) | ✅ APPROVED |
| 015 | Code comments + docs | ✅ APPROVED |

---

**Next**: Proceed to Slice 1 implementation (Calculator Engine)

Generated by godmythos v10 | May 14, 2026
