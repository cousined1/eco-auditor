> **HISTORICAL DOCUMENT: do not build from it.** This is the original build prompt for the calculator.
> Its factor table is stale and partly wrong (for example natural gas "0.0053 kg per kWh", R-410A 2088
> and R-22 1810, which are IPCC AR4 values; the product uses AR5). The sample report's old R-410A figure
> came from here (audit F-E-17). The factors in use are in `emission-factors.json` (current catalog) and
> `emission-factors.v1.json` (the frozen 2026-07-24 catalog that prices older entries), with their
> sources in `src/lib/emission-factors/registry.ts`.

# EcoAuditor Carbon Calculator — Opencode Prompt
## Build in VS Code with OpenCode extension
## File location: `src/components/carbon-calculator.tsx`

---

## CONTEXT
EcoAuditor is a carbon accounting SaaS. The database is live at InsForge with these tables:
- `companies` (user's company profile)
- `facilities` (locations/buildings)
- `emission_entries` (individual emission sources)
- `reports` (generated PDFs)
- `trend_data` (monthly summaries)

**InsForge client is already configured** at `src/lib/insforge.ts`

---

## TASK
Build a React component `CarbonCalculator` that:

### 1. Fetches the user's company
```typescript
const { data: company } = await insforge
  .from('companies')
  .select('*')
  .eq('user_id', user.id)
  .single()
```

### 2. Fetches facilities
```typescript
const { data: facilities } = await insforge
  .from('facilities')
  .select('*')
  .eq('company_id', company.id)
```

### 3. Calculator Form
Fields:
- **Scope** (dropdown): Scope 1 (direct), Scope 2 (electricity), Scope 3 (supply chain)
- **Category** (dropdown based on scope):
  - Scope 1: Stationary combustion, Mobile combustion, Process emissions, Fugitive emissions
  - Scope 2: Purchased electricity, Purchased heat/steam
  - Scope 3: Purchased goods, Business travel, Employee commuting, Waste, Transportation
- **Source** (text): e.g., "Natural gas furnace", "Company fleet diesel", "AWS us-east-1"
- **Amount** (number): Quantity
- **Unit** (dropdown): kWh, therms, gallons, miles, kg, tons CO2e
- **Facility** (dropdown): Select from user's facilities

### 4. Calculation Logic
Use EPA emission factors:
```typescript
const EPA_FACTORS = {
  'natural-gas': 0.0053,        // kg CO2e per kWh
  'diesel': 10.21,              // kg CO2e per gallon
  'gasoline': 8.89,             // kg CO2e per gallon
  'electricity-grid': 0.0004,   // kg CO2e per kWh (varies by region)
  'jet-fuel': 9.57,             // kg CO2e per gallon
  'propane': 5.74,              // kg CO2e per gallon
  'coal': 0.095,                // kg CO2e per kWh
}

// Calculation function
function calculateEmissions(source: string, amount: number, unit: string): number {
  // Convert to kg CO2e
  const factor = EPA_FACTORS[source] || 0
  return amount * factor
}
```

### 5. Save to Database
```typescript
const { data, error } = await insforge
  .from('emission_entries')
  .insert({
    scope: formData.scope,
    category: formData.category,
    source: formData.source,
    amount: calculatedEmissions,
    unit: 'kg CO2e',
    facility_id: formData.facilityId,
    company_id: company.id,
  })
```

### 6. Display Results
Show:
- Total emissions by scope (pie chart)
- Facility breakdown (bar chart)
- Trend over time (line chart)
- Comparison to industry averages

### 7. Generate Report Button
```typescript
async function generateReport() {
  // 1. Fetch all emission entries
  const { data: emissions } = await insforge
    .from('emission_entries')
    .select('*')
    .eq('company_id', company.id)
  
  // 2. Calculate totals
  const totalScope1 = emissions
    .filter(e => e.scope === 'Scope 1')
    .reduce((sum, e) => sum + e.amount, 0)
  
  const totalScope2 = emissions
    .filter(e => e.scope === 'Scope 2')
    .reduce((sum, e) => sum + e.amount, 0)
  
  const totalScope3 = emissions
    .filter(e => e.scope === 'Scope 3')
    .reduce((sum, e) => sum + e.amount, 0)
  
  // 3. Save report to database
  const { data: report } = await insforge
    .from('reports')
    .insert({
      company_id: company.id,
      name: `Carbon Report ${new Date().toISOString().split('T')[0]}`,
      status: 'final',
    })
    .select()
    .single()
  
  // 4. Trigger PDF generation (edge function)
  await insforge.functions.invoke('generate-pdf', {
    body: { reportId: report.id }
  })
}
```

---

## COMPONENT STRUCTURE
```
src/components/carbon-calculator/
├── index.tsx                 # Main calculator page
├── EmissionForm.tsx          # Form for adding emissions
├── EmissionList.tsx          # Table of existing emissions
├── Dashboard.tsx             # Charts and summaries
├── ReportGenerator.tsx        # Button to generate PDF
└── utils.ts                  # EPA factors, calculations
```

---

## INSFORGE QUERIES NEEDED

### Fetch company + facilities (on mount)
```typescript
const [company, setCompany] = useState(null)
const [facilities, setFacilities] = useState([])

useEffect(() => {
  async function loadData() {
    const { data: { user } } = await insforge.auth.getUser()
    
    const { data: company } = await insforge
      .from('companies')
      .select('*')
      .eq('user_id', user.id)
      .single()
    
    const { data: facilities } = await insforge
      .from('facilities')
      .select('*')
      .eq('company_id', company.id)
    
    setCompany(company)
    setFacilities(facilities)
  }
  
  loadData()
}, [])
```

### Add emission entry
```typescript
async function addEmission(formData) {
  const kgCO2e = calculateEmissions(formData.source, formData.amount, formData.unit)
  
  const { data, error } = await insforge
    .from('emission_entries')
    .insert({
      scope: formData.scope,
      category: formData.category,
      source: formData.source,
      amount: kgCO2e,
      unit: 'kg CO2e',
      facility_id: formData.facilityId,
      company_id: company.id,
    })
    .select()
    .single()
  
  if (error) throw error
  return data
}
```

### Calculate totals by scope
```typescript
async function getEmissionsByScope(companyId: number) {
  const { data } = await insforge
    .from('emission_entries')
    .select('scope, amount')
    .eq('company_id', companyId)
  
  const totals = data.reduce((acc, entry) => {
    acc[entry.scope] = (acc[entry.scope] || 0) + entry.amount
    return acc
  }, {})
  
  return totals
}
```

---

## EPA EMISSION FACTORS TABLE
```typescript
export const EMISSION_FACTORS = {
  // Scope 1 - Direct emissions
  'stationary-combustion': {
    'natural-gas': 53.06,      // kg CO2e per MMBtu
    'propane': 62.87,          // kg CO2e per MMBtu
    'diesel': 73.96,           // kg CO2e per MMBtu
    'fuel-oil': 78.80,         // kg CO2e per MMBtu
    'coal': 95.35,             // kg CO2e per MMBtu
  },
  'mobile-combustion': {
    'gasoline': 8887,          // g CO2e per gallon
    'diesel': 10180,           // g CO2e per gallon
    'jet-fuel': 9537,          // g CO2e per gallon
    'natural-gas-vehicle': 11171, // g CO2e per gallon equivalent
  },
  'process-emissions': {
    'cement': 0.507,           // t CO2e per ton cement
    'steel': 1.85,             // t CO2e per ton steel
    'ammonia': 2.55,           // t CO2e per ton ammonia
  },
  'fugitive-emissions': {
    'refrigerant-r410a': 2088, // kg CO2e per kg leaked
    'refrigerant-r22': 1810,   // kg CO2e per kg leaked
    'natural-gas-leak': 25.3,  // kg CO2e per MCF leaked
  },
  
  // Scope 2 - Indirect emissions
  'purchased-electricity': {
    'us-average': 0.0004,      // kg CO2e per kWh
    'california': 0.00023,     // kg CO2e per kWh
    'texas': 0.00041,          // kg CO2e per kWh
    'new-york': 0.00028,       // kg CO2e per kWh
    'renewable': 0,            // kg CO2e per kWh
  },
  'purchased-heat': {
    'steam': 0.066,            // kg CO2e per lb steam
    'hot-water': 0.052,        // kg CO2e per lb hot water
  },
  
  // Scope 3 - Value chain
  'purchased-goods': {
    'paper': 0.94,             // kg CO2e per kg
    'plastic': 2.0,            // kg CO2e per kg
    'steel-product': 1.35,     // kg CO2e per kg
    'aluminum': 11.2,          // kg CO2e per kg
    'concrete': 0.107,         // kg CO2e per kg
  },
  'business-travel': {
    'air-short-haul': 0.255,   // kg CO2e per passenger mile
    'air-long-haul': 0.195,    // kg CO2e per passenger mile
    'hotel': 20.6,             // kg CO2e per room night
    'rental-car': 0.404,       // kg CO2e per mile
  },
  'employee-commuting': {
    'car-alone': 0.404,        // kg CO2e per mile
    'car-pool': 0.202,         // kg CO2e per mile
    'public-transit': 0.164,    // kg CO2e per mile
    'remote': 0,               // kg CO2e per mile
  },
  'waste': {
    'landfill': 0.586,         // kg CO2e per kg waste
    'recycling': 0.02,         // kg CO2e per kg recycled
    'composting': 0.01,        // kg CO2e per kg composted
  },
}
```

---

## CHARTS TO DISPLAY

### 1. Emissions by Scope (Pie Chart)
```typescript
const scopeData = [
  { name: 'Scope 1', value: totals.scope1, color: '#ef4444' },
  { name: 'Scope 2', value: totals.scope2, color: '#f59e0b' },
  { name: 'Scope 3', value: totals.scope3, color: '#3b82f6' },
]
```

### 2. Emissions by Facility (Bar Chart)
```typescript
const facilityData = facilities.map(f => ({
  name: f.name,
  scope1: emissions.filter(e => e.facility_id === f.id && e.scope === 'Scope 1').reduce((s, e) => s + e.amount, 0),
  scope2: emissions.filter(e => e.facility_id === f.id && e.scope === 'Scope 2').reduce((s, e) => s + e.amount, 0),
}))
```

### 3. Monthly Trend (Line Chart)
```typescript
const monthlyData = await insforge
  .from('trend_data')
  .select('*')
  .eq('company_id', company.id)
  .order('year', { ascending: true })
  .order('month', { ascending: true })
```

---

## EDGE FUNCTION FOR PDF GENERATION

Create `supabase/functions/generate-pdf/index.ts`:

```typescript
import { createClient } from '@insforge/sdk'

Deno.serve(async (req) => {
  const { reportId } = await req.json()
  
  const insforge = createClient(
    Deno.env.get('INSFORGE_URL'),
    Deno.env.get('INSFORGE_SERVICE_KEY')
  )
  
  // Fetch report data
  const { data: report } = await insforge
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .single()
  
  const { data: emissions } = await insforge
    .from('emission_entries')
    .select('*')
    .eq('company_id', report.company_id)
  
  // Generate PDF (use Deno PDF library)
  const pdf = await generatePDF(report, emissions)
  
  // Upload to storage
  const { data: upload } = await insforge.storage
    .from('reports')
    .upload(`${reportId}.pdf`, pdf)
  
  // Update report with download URL
  await insforge
    .from('reports')
    .update({ 
      status: 'final',
      download_url: upload.path 
    })
    .eq('id', reportId)
  
  return new Response(JSON.stringify({ success: true }))
})
```

---

## STYLING

Use Tailwind CSS classes:
- Container: `max-w-7xl mx-auto px-4 py-8`
- Cards: `bg-white rounded-lg shadow-md p-6`
- Form inputs: `w-full border border-gray-300 rounded-md px-3 py-2`
- Buttons: `bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700`
- Charts: Use `recharts` library

---

## OPENCODE COMMAND

Paste this into VS Code OpenCode terminal:

```
I need to build a CarbonCalculator component for EcoAuditor.

The database has these tables with RLS enabled:
- companies (user's company)
- facilities (locations)
- emission_entries (carbon sources)
- reports (generated PDFs)

Build a React component that:
1. Fetches the user's company and facilities from InsForge
2. Shows a form to add emission entries (scope, category, source, amount, unit)
3. Calculates kg CO2e using EPA emission factors
4. Saves entries to the database
5. Displays charts (pie for scope breakdown, bar for facilities)
6. Has a "Generate Report" button that creates a PDF

Use InsForge SDK for all database operations.
Use recharts for charts.
Use Tailwind CSS for styling.

The InsForge client is imported from '@/lib/insforge'.
```

---

*Calculator spec prepared by Javante*
*Date: 2026-05-12*
