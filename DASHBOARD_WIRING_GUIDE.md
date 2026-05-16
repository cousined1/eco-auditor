# Dashboard Integration Guide — Wiring Real API Data

**Objective:** Replace seed/mock data with real emissions calculations from the Calculator Engine.

**Time Required:** 30-45 minutes  
**Complexity:** Medium  
**Dependencies:** Slices 1-2 (already complete in server.cjs)

---

## 📍 CURRENT STATE: Dashboard.tsx

**Location:** [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx)

**Current behavior:**
- ❌ Displays hardcoded mockData (seed data)
- ❌ No API calls to `/api/emissions/summary`
- ❌ No real company emissions data

**Target behavior:**
- ✅ Fetches `/api/emissions/summary?company_id=${companyId}`
- ✅ Loads real scope 1/2/3 totals
- ✅ Shows accurate pie chart + trend line
- ✅ Handles empty state (new company, zero entries)
- ✅ Shows loading state while fetching

---

## 🎯 IMPLEMENTATION PLAN

### Step 1: Read Current Dashboard Component

First, examine the existing [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx):

```bash
# Get line count
wc -l src/pages/Dashboard.tsx

# View the component structure
head -100 src/pages/Dashboard.tsx
```

**Key sections to find:**
- `mockData` imports
- Pie chart component rendering
- Trend line chart component
- Data state variables

---

### Step 2: Update Component State

Replace mock data state with API-driven state:

**Old pattern:**
```typescript
import { mockData } from '../data/mockData';

export function Dashboard() {
  const emissions = mockData.emissions;  // Static
  const trend = mockData.trend;          // Static
  // ...
}
```

**New pattern:**
```typescript
import { useEffect, useState } from 'react';

export function Dashboard() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [emissions, setEmissions] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/emissions/summary?company_id=${companyId}`)
        .then(r => r.json()),
      fetch(`/api/emissions/trend?company_id=${companyId}&period=monthly`)
        .then(r => r.json())
    ])
      .then(([summaryRes, trendRes]) => {
        if (summaryRes.success) {
          setEmissions(summaryRes.data);
        } else {
          setError('Failed to load emissions');
        }
        if (trendRes.success) {
          setTrend(trendRes.data);
        }
      })
      .catch(err => {
        setError(err.message);
        console.error('Dashboard fetch error:', err);
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return <div>Loading emissions data...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!emissions) return <div>No emissions data available. Add your first entry to get started.</div>;

  return (
    <div className="space-y-6">
      {/* Pie Chart */}
      <div>
        <h2 className="text-xl font-bold">Total Emissions: {emissions.total_co2e_tonnes.toLocaleString()} tCO2e</h2>
        {/* Render pie chart with emissions.scope1_pct, scope2_pct, scope3_pct */}
      </div>

      {/* Trend Chart */}
      <div>
        <h2 className="text-xl font-bold">Emissions Trend</h2>
        {/* Render line chart with trend data */}
      </div>

      {/* Scope Breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div>Scope 1: {emissions.scope1_co2e_tonnes.toFixed(1)} tCO2e ({emissions.scope1_pct.toFixed(1)}%)</div>
        <div>Scope 2: {emissions.scope2_co2e_tonnes.toFixed(1)} tCO2e ({emissions.scope2_pct.toFixed(1)}%)</div>
        <div>Scope 3: {emissions.scope3_co2e_tonnes.toFixed(1)} tCO2e ({emissions.scope3_pct.toFixed(1)}%)</div>
      </div>
    </div>
  );
}
```

---

### Step 3: Get Company ID from Auth Context

The Dashboard needs to know which company's data to load. This comes from the authenticated user.

**Option A: From InsForge Auth (Recommended)**

```typescript
import { useInsforgeAuth } from '../hooks/useInsforgeAuth'; // Adjust path

export function Dashboard() {
  const { user } = useInsforgeAuth();
  const companyId = user?.company_id; // Assuming user object has company_id

  useEffect(() => {
    if (!companyId) return;
    // Fetch emissions for this company
  }, [companyId]);
}
```

**Option B: From URL Params**

```typescript
import { useSearchParams } from 'react-router-dom';

export function Dashboard() {
  const [params] = useSearchParams();
  const companyId = params.get('company_id');

  useEffect(() => {
    if (!companyId) return;
    // Fetch emissions for this company
  }, [companyId]);
}
```

**Option C: From Redux Store or Context**

```typescript
import { useSelector } from 'react-redux'; // Or your state management

export function Dashboard() {
  const companyId = useSelector(state => state.app.companyId);

  useEffect(() => {
    if (!companyId) return;
    // Fetch emissions for this company
  }, [companyId]);
}
```

---

### Step 4: Transform API Response to Chart Data

The pie chart needs scope breakdown. Transform the API response:

```typescript
// From /api/emissions/summary response:
// {
//   scope1_co2e_tonnes: 1834,
//   scope2_co2e_tonnes: 1453,
//   scope3_co2e_tonnes: 1585,
//   scope1_pct: 37.6,
//   scope2_pct: 29.8,
//   scope3_pct: 32.5
// }

const pieData = emissions ? [
  { name: 'Scope 1 (Direct)', value: emissions.scope1_pct, fill: '#ef4444' },
  { name: 'Scope 2 (Electricity)', value: emissions.scope2_pct, fill: '#f59e0b' },
  { name: 'Scope 3 (Supply Chain)', value: emissions.scope3_pct, fill: '#3b82f6' }
] : [];

// Render Recharts PieChart
<PieChart width={300} height={300}>
  <Pie data={pieData} cx="50%" cy="50%" labelLine={false} label />
  <Tooltip />
</PieChart>
```

The trend data is already in the right format:

```typescript
// From /api/emissions/trend response:
// [
//   { month: 'Jan', scope1: 168, scope2: 142, scope3: 158 },
//   { month: 'Feb', scope1: 155, scope2: 139, scope3: 165 },
//   ...
// ]

// Render Recharts LineChart
<LineChart data={trend}>
  <CartesianGrid strokeDasharray="3 3" />
  <XAxis dataKey="month" />
  <YAxis />
  <Tooltip />
  <Legend />
  <Line type="monotone" dataKey="scope1" stroke="#ef4444" />
  <Line type="monotone" dataKey="scope2" stroke="#f59e0b" />
  <Line type="monotone" dataKey="scope3" stroke="#3b82f6" />
</LineChart>
```

---

### Step 5: Handle Empty State

When a new company has zero entries, show a friendly message:

```typescript
export function Dashboard() {
  // ... state and fetch logic ...

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Loading your emissions data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-4">
        <p className="text-red-700">Error loading emissions: {error}</p>
      </div>
    );
  }

  if (!emissions || emissions.entry_count === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-gray-400 mb-4">📊</div>
        <h2 className="text-2xl font-bold text-gray-700 mb-2">No Emissions Data Yet</h2>
        <p className="text-gray-600 mb-6">Add your first emission entry to get started.</p>
        <a href="/app/calculator" className="btn btn-primary">
          Add Entry Now
        </a>
      </div>
    );
  }

  // Render normal dashboard...
}
```

---

### Step 6: Add Error Boundaries

Wrap the dashboard with React error boundary:

```typescript
import { ErrorBoundary } from 'react-error-boundary';

function DashboardErrorFallback({error, resetErrorBoundary}) {
  return (
    <div className="bg-red-50 p-4 rounded-lg">
      <p className="font-bold text-red-700">Dashboard Error</p>
      <p className="text-red-600 text-sm">{error.message}</p>
      <button onClick={resetErrorBoundary} className="mt-2 text-blue-600 underline">
        Try again
      </button>
    </div>
  )
}

export function DashboardPage() {
  return (
    <ErrorBoundary FallbackComponent={DashboardErrorFallback}>
      <Dashboard />
    </ErrorBoundary>
  );
}
```

---

## 🧪 VALIDATION CHECKLIST

After implementing, test these scenarios:

- [ ] **Initial Load:** Dashboard loads without errors
- [ ] **Real Data Display:** Shows actual emissions totals (not mocked)
- [ ] **Pie Chart:** Scope 1/2/3 percentages add up to 100%
- [ ] **Trend Chart:** Shows 9+ months of data with realistic trends
- [ ] **Loading State:** Shows spinner while fetching
- [ ] **Error State:** Shows error message if API fails
- [ ] **Empty State:** New company with zero entries shows friendly message
- [ ] **Caching:** Second page visit shows "cached: true" in network tab
- [ ] **Auth Check:** Unauthenticated users can't see dashboard

---

## 🔍 DEBUGGING

If the dashboard doesn't show data:

1. **Check browser console for errors:**
   ```bash
   Open DevTools (F12) → Console tab
   Look for fetch errors or CORS issues
   ```

2. **Verify API is responding:**
   ```bash
   curl -H "Authorization: Bearer $(xclip -selection clipboard)" \
     "http://localhost:3000/api/emissions/summary?company_id=test"
   ```

3. **Check authentication:**
   ```javascript
   // In browser console:
   fetch('/api/emissions/summary?company_id=test', {
     headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
   }).then(r => r.json()).then(console.log)
   ```

4. **Verify company ID is being passed:**
   ```javascript
   // In browser console:
   console.log('Company ID:', companyId);
   console.log('Request URL:', `/api/emissions/summary?company_id=${companyId}`);
   ```

---

## 📚 RELATED FILES

- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) — Full implementation overview
- [server.cjs](server.cjs#L893-L1030) — Emissions API endpoints
- [src/components/carbon-calculator/](src/components/carbon-calculator/) — Input component
- [src/pages/](src/pages/) — Other pages for reference

---

## ✅ COMPLETION

Once the Dashboard is wired to real data, **Slices 1-2 are fully complete** and ready for production.

**Next:** Start Slice 3 (CSV Upload) or Slice 4 (Facility-level breakdown).

See [SLICES-3-6-PLAN.md](SLICES-3-6-PLAN.md) for roadmap.
