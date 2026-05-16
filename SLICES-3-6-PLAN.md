# Slices 3-6 Implementation Plan

**Status**: Slices 1-2 COMPLETED ✅  
**Date**: May 14, 2026  
**Godmythos v10 Protocol**: Tracer-bullet vertical slices

---

## Slice 2: Dashboard → Calculator Wiring (P1 - CRITICAL)

### Current State
- **Backend**: ✅ GET /api/emissions/summary implemented (mock data)
- **Backend**: ✅ GET /api/emissions/trend implemented (mock data)
- **Frontend**: ❌ Dashboard still uses seed data from mockData.ts

### Implementation (Next Step)
**Goal**: Wire Dashboard to call real API endpoints, replacing mock data with dynamic calculations

#### Files to Modify
1. **src/pages/Dashboard.tsx** (70 LOC change)
   - Remove: `import { EMISSIONS_SUMMARY, TREND_DATA, ... } from '../data/mockData'`
   - Add: `useEffect(() => { fetch('/api/emissions/summary') })`
   - Hook up summary state to API call
   - Hook up trend data to API call

2. **src/lib/insforge.ts** (optional, if creating HTTP client)
   - OR use native fetch() directly in Dashboard.tsx

#### API Contract
```typescript
// GET /api/emissions/summary?company_id=X
Response:
{
  success: true,
  data: {
    total_co2e_tonnes: number,
    scope1_co2e_tonnes: number,
    scope2_co2e_tonnes: number,
    scope3_co2e_tonnes: number,
    scope1_pct: number,
    scope2_pct: number,
    scope3_pct: number,
    trend_vs_prior_period: { scope1: number, scope2: number, scope3: number }
  }
}

// GET /api/emissions/trend?company_id=X&period=monthly
Response:
{
  success: true,
  data: [
    { month: 'Jul', scope1: 198, scope2: 148, scope3: 132 },
    ...
  ]
}
```

#### Validation Checklist
- [ ] POST /api/calculate endpoint returns correct CO2e for known input
- [ ] GET /api/emissions/summary endpoint accessible (no 401/403)
- [ ] GET /api/emissions/trend endpoint accessible
- [ ] Dashboard loads without mockData errors
- [ ] Charts render with real API data
- [ ] Emissions cards (Scope 1/2/3) display correct totals

#### Test Data
```bash
# Test calculator endpoint
curl -X POST http://localhost:3000/api/calculate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${INSFORGE_TOKEN}" \
  -d '{
    "scope": "Scope 2",
    "category": "Purchased Electricity",
    "source": "California",
    "amount": 500,
    "unit": "kWh"
  }'

# Expected response:
{
  "success": true,
  "co2e_kg": 115,
  "co2e_tonnes": 0.115,
  "factor_value": 0.23,
  "factor_source": "eGRID 2024",
  "confidence": 97,
  "timestamp": "2026-05-14T10:30:00Z"
}
```

#### Estimated Time
**30 min** (straightforward state management + API calls)

---

## Slice 3: CSV Ingestion (P2)

### Goal
Implement `POST /api/ingest/csv` to bulk upload emission entries from CSV file

### Dependencies
- Add `csv-parser` to package.json: `npm install csv-parser`

### Expected CSV Format
```csv
facility_name,scope,category,source,amount,unit,date,notes
Sacramento HQ,Scope 1,Mobile Combustion,Gasoline,500,gallons,2026-03-15,Fleet fuel
Sacramento HQ,Scope 2,Purchased Electricity,California,8472,kWh,2026-03-15,March bill PG&E
Fresno Packaging,Scope 1,Stationary Combustion,Natural Gas,1200,MMBtu,2026-03-20,Heating
```

### Implementation (server.cjs: ~240 LOC)
```javascript
const csv = require('csv-parser');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/ingest/csv', authGuard, upload.single('file'), async (req, res) => {
  // Parse CSV from req.file.buffer
  // Validate each row:
  //   - Facility exists
  //   - Scope/category/source valid
  //   - Amount > 0
  // Calculate CO2e for each row
  // Insert batch into InsForge via SDK
  // Return: { success, imported, errors[], warnings[] }
});
```

### Frontend Integration (src/pages/DataIntake.tsx)
- Add file upload UI (already exists, just wire it)
- Call POST /api/ingest/csv with FormData
- Display results: "Imported 47 entries, 2 errors"

### Validation Rules
✓ Row has facility_name → Lookup facility in InsForge  
✓ Scope ∈ {Scope 1, Scope 2, Scope 3}  
✓ Category valid for scope (use SCOPE_CATEGORIES from utils.ts)  
✓ Source valid for category (use CATEGORY_SOURCES from utils.ts)  
✓ Amount is number > 0  
✓ Unit matches expectations  
✓ Date is valid ISO-8601  

### Error Handling
```json
{
  "success": true,
  "imported": 47,
  "errors": [
    { "row": 5, "error": "Invalid category 'Bad Cat'" },
    { "row": 12, "error": "Facility 'Unknown' not found" }
  ],
  "warnings": [
    { "row": 3, "warning": "Confidence 44% (low confidence estimate)" }
  ]
}
```

### Test Data
Create `tests/sample-upload.csv` with valid test data

### Estimated Time
**2-3 hours** (including dependency setup + error handling + testing)

---

## Slice 4: Facility-Level Aggregation (P2)

### Goal
Implement facility-level emissions summaries: `GET /api/facilities/:facility_id/emissions`

### Endpoint
```
GET /api/facilities/3/emissions/summary?company_id=X
Authorization: Bearer <token>

Response:
{
  facility_id: 3,
  facility_name: "Portland Distribution",
  total_co2e_kg: 482000,
  scope1_co2e_kg: 129940,
  scope2_co2e_kg: 86760,
  scope3_co2e_kg: 265300,
  entries: [
    { category, source, amount, co2e_kg, date, confidence },
    ...
  ]
}
```

### Implementation (server.cjs: ~180 LOC)
```javascript
app.get('/api/facilities/:facility_id/emissions/summary', authGuard, async (req, res) => {
  const { facility_id } = req.params;
  const { company_id } = req.query;
  
  // Query InsForge:
  //   SELECT * FROM emission_entries 
  //   WHERE facility_id = :facility_id 
  //   AND company_id = :company_id
  
  // Aggregate by scope:
  //   scope1_total = SUM(co2e_kg) where scope='Scope 1'
  //   scope2_total = SUM(co2e_kg) where scope='Scope 2'
  //   scope3_total = SUM(co2e_kg) where scope='Scope 3'
  
  // Return facility breakdown
});
```

### Frontend: Facility List Page
- Display cards for each facility
- Show Scope 1/2/3 breakdown
- Click to drill down into entries

### Cache Strategy
- Cache per-facility summaries for 5 min
- Invalidate on new entry insert

### Estimated Time
**1-2 hours** (queries + caching)

---

## Slice 5: PDF Report Generation (P3)

### Goal
Implement `POST /api/reports/generate` to export professional PDF reports

### Library Choice
**PDFMake** (not pdfkit) — 400 KB, no native dependencies

### Dependencies
```bash
npm install pdfmake
```

### Report Contents
1. **Cover page**: Company name, reporting period, timestamp
2. **Executive summary**: Total emissions + Scope breakdown %
3. **Trend chart**: 12-month emissions by scope (embed as image)
4. **Facility breakdown**: Table (name, Scope 1/2/3 totals, % of total)
5. **Methodology**: EPA factors used, confidence scores, sources
6. **Compliance readiness**: Score + dimensions
7. **Missing data alerts**: Top risks

### Implementation (server.cjs: ~350 LOC)
```javascript
const PdfPrinter = require('pdfmake/build/pdfmake');
const PdfFonts = require('pdfmake/build/vfs_fonts');

app.post('/api/reports/generate', authGuard, express.json(), async (req, res) => {
  const { company_id, period } = req.body;
  
  // Fetch data:
  //   - Emissions summary
  //   - Facility breakdown
  //   - Trend data (12 months)
  //   - Missing data alerts
  
  // Generate chart image (using recharts + puppeteer OR embed as SVG)
  
  // Define PDF structure (docDefinition)
  
  // Generate PDF buffer
  
  // Return as file or S3 URL
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
  res.send(pdfBuffer);
});
```

### Frontend Integration
- Reports page already exists (Reports.tsx)
- Wire "Generate PDF" button to POST /api/reports/generate
- Show download link when PDF ready

### Challenge: Embedding Charts
- Option 1: Use Recharts server-side (complex, requires Chrome/Puppeteer)
- Option 2: Embed static chart data as table (simple, fast)
- Option 3: Use canvas-based chart library (lightweight)

**Recommendation**: Option 2 (table for MVP, upgrade later)

### Test Data
- Generate report for sample company
- Verify PDF contains all sections
- Check file size < 5 MB

### Estimated Time
**3-4 hours** (PDFMake setup + styling + integration)

---

## Slice 6: Compliance Deadline Tracking (P3)

### Goal
Implement `GET /api/compliance/deadlines` to track regulatory deadlines

### Deadlines Tracked
| Regulation | Deadline | Scope | Status | Days Left |
|-----------|----------|-------|--------|-----------|
| CBAM | 2026-06-30 | Imports | at-risk | 47 |
| CSRD | 2026-12-31 | All | on-track | 231 |
| SEC Climate | 2027-01-31 | Scope 1/2 | on-track | 262 |
| AB 1305 | 2026-12-31 | All | at-risk | 231 |

### Implementation (server.cjs: ~150 LOC)
```javascript
const COMPLIANCE_DEADLINES = [
  { 
    regulation: 'CBAM', 
    deadline: '2026-06-30', 
    scope: ['Scope 3'],
    description: 'EU Carbon Border Adjustment Mechanism'
  },
  // ... others
];

function getComplianceStatus(daysLeft) {
  if (daysLeft <= 30) return 'at-risk';      // Red
  if (daysLeft <= 90) return 'pending';      // Yellow
  return 'on-track';                          // Green
}

app.get('/api/compliance/deadlines', authGuard, (req, res) => {
  const today = new Date();
  const deadlines = COMPLIANCE_DEADLINES.map(d => {
    const deadline = new Date(d.deadline);
    const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
    return {
      ...d,
      daysLeft,
      status: getComplianceStatus(daysLeft)
    };
  });
  res.json({ success: true, data: deadlines });
});
```

### Frontend: Compliance Dashboard Page
- Show deadline cards with status (green/yellow/red)
- List deadline details
- Show "days remaining" countdown
- Optional: Add calendar view

### Test Data
```bash
curl -H "Authorization: Bearer ${TOKEN}" \
  http://localhost:3000/api/compliance/deadlines

# Response:
{
  "success": true,
  "data": [
    { "regulation": "CBAM", "deadline": "2026-06-30", "daysLeft": 47, "status": "at-risk" },
    ...
  ]
}
```

### Estimated Time
**1 hour** (hardcoded, no dependencies)

---

## Deployment Sequence & Rollback

### Phase 1: Deploy Slices 1-2 (Already done)
1. ✅ POST /api/calculate endpoint
2. ✅ GET /api/emissions/summary endpoint
3. ✅ GET /api/emissions/trend endpoint
4. ✅ All 21 calculator tests pass
5. Run on staging, verify math

### Phase 2: Deploy Slices 3-4 (Next)
1. Implement CSV ingestion + facility aggregation
2. Test with sample CSV file
3. Verify no breaking changes to existing routes

### Phase 3: Deploy Slices 5-6 (Final)
1. Implement PDF generation + compliance tracking
2. Test PDF output
3. Deploy to production

### Rollback Plan
- Each slice independent (can disable by removing route)
- Feature flag: Use env var to enable/disable
- Database: No schema changes needed (using InsForge)

---

## Summary: Remaining Work

| Slice | Feature | Status | Est. Time | Priority |
|-------|---------|--------|-----------|----------|
| 2 | Dashboard Wiring | Ready | 30 min | P1 |
| 3 | CSV Ingestion | Planned | 2-3h | P2 |
| 4 | Facility Aggregation | Planned | 1-2h | P2 |
| 5 | PDF Reports | Planned | 3-4h | P3 |
| 6 | Compliance Deadlines | Planned | 1h | P3 |
| **Total** | | | **8-11h** | |

---

## Next Immediate Steps

1. **Slice 2** (30 min): Wire Dashboard to /api/emissions/summary + /api/emissions/trend
2. **Test** (15 min): Verify Dashboard loads real data without errors
3. **Commit**: Push code + document in CONTEXT.md
4. **Slice 3** (2-3h): Implement CSV upload
5. **Slice 4** (1-2h): Facility aggregation

---

Generated by godmythos v10 | May 14, 2026
