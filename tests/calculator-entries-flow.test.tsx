// K2 (F-D-01, F-E-05) in the SPA: the calculator and onboarding write entries
// and facilities through the server API only. Before K2 they inserted and
// deleted rows through the records API (insforge.database) with a CO2e the
// browser computed, confidence 85, no activity date and no plan check.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarbonCalculator from '../src/components/carbon-calculator';
import type { EmissionEntry } from '../src/components/carbon-calculator/utils';
import { buttonNamed, press, setField, settle } from './helpers/form-dom';

const sdk = vi.hoisted(() => ({ getCurrentUser: vi.fn(), from: vi.fn() }));
vi.mock('../src/lib/insforge', () => ({
  insforge: { auth: { getCurrentUser: sdk.getCurrentUser }, database: { from: sdk.from } },
}));
vi.mock('recharts', async () => import('./helpers/recharts-stub'));

const COMPANY = { id: 7, name: 'Acme Ltd', industry: 'Retail' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

let container: HTMLDivElement;
let root: Root;
let calls: Call[];
let listed: EmissionEntry[];
let plan: string | null;
let onPost: (call: Call) => Response | Promise<Response>;
let onList: () => Response;
let sdkTables: string[];
let sdkFacilities: Array<{ id: number; company_id: number; name: string; type: string; city: string }>;

function serverEntry(overrides: Partial<EmissionEntry> = {}): EmissionEntry {
  return {
    id: 41,
    scope: 'Scope 2',
    category: 'purchased_electricity',
    source: 'CAMX',
    amount: 1000,
    unit: 'kWh',
    factor: '0.19504 kg CO2e/kWh',
    method: 'calculation',
    confidence: 97,
    facility_id: null,
    co2e_kg: 195.04,
    activity_date: '2025-03-15',
    notes: null,
    activity_amount: 1000,
    activity_unit: 'kWh',
    factor_value: 0.19504,
    factor_source: 'epa-egrid-2023',
    catalog_version: '2026-07-24+9841b57be1f6',
    created_at: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}

// The records API stand-in: company and facility reads only. Any write, and any
// read of emission_entries, is recorded so a test can prove it never happens.
function useSdk(company: typeof COMPANY | null) {
  sdk.from.mockImplementation((table: string) => {
    sdkTables.push(table);
    let action = 'select';
    const result = () => {
      if (table === 'companies' && action === 'select') return { data: company, error: null };
      if (table === 'companies') return { data: { ...COMPANY, name: 'Northstar Foods' }, error: null };
      if (table === 'facilities' && action === 'select') return { data: sdkFacilities, error: null };
      throw new Error(`unexpected records-API ${action} on ${table}`);
    };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      insert: () => { action = 'insert'; return builder; },
      update: () => { action = 'update'; return builder; },
      delete: () => { action = 'delete'; return builder; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (onFulfilled: (value: unknown) => unknown, onRejected: (error: unknown) => unknown) =>
        Promise.resolve().then(result).then(onFulfilled, onRejected),
    };
    return builder;
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  calls = [];
  sdkTables = [];
  sdkFacilities = [];
  listed = [];
  plan = 'growth';
  onPost = () => json({ success: true, data: serverEntry() }, 201);
  onList = () => json({ success: true, data: listed });
  sdk.getCurrentUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  sdk.from.mockReset();
  useSdk(COMPANY);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    if (url === '/api/billing') return json({ active: plan !== null, plan });
    if (url === '/api/entries' && call.method === 'GET') return onList();
    if (url === '/api/entries' && call.method === 'POST') return onPost(call);
    if (url.startsWith('/api/entries/') && call.method === 'DELETE') return json({ success: true, deleted: 1 });
    if (/^\/api\/companies\/\d+\/facilities$/.test(url) && call.method === 'POST') {
      const body = call.body as { name: string; type: string; city: string };
      return json({ success: true, data: { id: '12', company_id: '9', ...body } }, 201);
    }
    throw new Error(`unexpected request ${call.method} ${url}`);
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await settle();
}

const text = () => container.textContent ?? '';
const byId = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
const posts = () => calls.filter((call) => call.method === 'POST' && call.url === '/api/entries');

async function fillElectricity(amount = '1000', date = '2025-03-15') {
  await setField(byId<HTMLSelectElement>('scope'), 'Scope 2');
  await setField(byId<HTMLSelectElement>('category'), 'purchased_electricity');
  await setField(byId<HTMLSelectElement>('source'), 'CAMX');
  await setField(byId<HTMLSelectElement>('unit'), 'kWh');
  await setField(byId<HTMLInputElement>('amount'), amount);
  await setField(byId<HTMLInputElement>('activity-date'), date);
}

describe('adding an entry', () => {
  it('sends the activity and its date to POST /api/entries with an Idempotency-Key, and nothing through the records API', async () => {
    await mount(<CarbonCalculator />);
    await fillElectricity();
    listed = [serverEntry()];
    await press(buttonNamed(container, /^Add Entry$/));

    expect(posts()).toHaveLength(1);
    const [post] = posts();
    expect(post.body).toEqual({
      scope: 'Scope 2',
      category: 'purchased_electricity',
      source: 'CAMX',
      amount: 1000,
      unit: 'kWh',
      activity_date: '2025-03-15',
      facility_id: null,
    });
    expect(post.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{32,36}$/);
    // The list is re-read from the server, which returns the value the dashboard counts.
    expect(calls.filter((call) => call.url === '/api/entries' && call.method === 'GET')).toHaveLength(2);
    expect(text()).toContain('195.0 kg CO2e');
    expect(sdkTables).not.toContain('emission_entries');
  });

  it('cannot be saved without an activity date', async () => {
    await mount(<CarbonCalculator />);
    await fillElectricity('1000', '');
    expect(buttonNamed(container, /^Add Entry$/).disabled).toBe(true);
    expect(byId<HTMLInputElement>('activity-date').required).toBe(true);
  });

  it('a retry after a failed save reuses its Idempotency-Key; the next entry gets a new one', async () => {
    await mount(<CarbonCalculator />);
    await fillElectricity();
    onPost = () => { throw new TypeError('Failed to fetch'); };
    await press(buttonNamed(container, /^Add Entry$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Failed to fetch');

    onPost = () => json({ success: true, replayed: true, data: serverEntry() }, 200);
    await press(buttonNamed(container, /^Add Entry$/));
    await fillElectricity('2000', '2025-04-15');
    await press(buttonNamed(container, /^Add Entry$/));

    const keys = posts().map((call) => call.headers['Idempotency-Key']);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('a 402 from the plan gate shows the upgrade prompt, not an error', async () => {
    await mount(<CarbonCalculator />);
    await fillElectricity();
    onPost = () => json({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: 'An active subscription is required for this feature' }, 402);
    await press(buttonNamed(container, /^Add Entry$/));

    const prompt = container.querySelector('[aria-label="Upgrade required"]');
    expect(prompt?.textContent).toContain('An active subscription is required for this feature');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

// F-B-03: no screen used to create a facility, so this dropdown was empty for everyone. The
// facilities come from onboarding and Settings (the server routes); the calculator lists them.
describe('the Facility dropdown', () => {
  it('lists the company\'s facilities, and an entry is attached to the one chosen', async () => {
    sdkFacilities = [
      { id: 5, company_id: 7, name: 'Fresno Plant', type: 'factory', city: 'Fresno' },
      { id: 6, company_id: 7, name: 'Reno Office', type: 'office', city: 'Reno' },
    ];
    await mount(<CarbonCalculator />);
    const options = [...byId<HTMLSelectElement>('facility').options].map((option) => [option.value, option.textContent]);
    expect(options).toEqual([['', 'No facility'], ['5', 'Fresno Plant'], ['6', 'Reno Office']]);

    await fillElectricity();
    await setField(byId<HTMLSelectElement>('facility'), '6');
    listed = [serverEntry({ facility_id: 6 })];
    await press(buttonNamed(container, /^Add Entry$/));
    expect(posts().map((call) => (call.body as { facility_id: number | null }).facility_id)).toEqual([6]);
  });

  it('offers only "No facility" until the company has added one', async () => {
    await mount(<CarbonCalculator />);
    expect([...byId<HTMLSelectElement>('facility').options].map((option) => option.textContent)).toEqual(['No facility']);
  });
});

describe('Scope 3 on a plan without it', () => {
  it('shows Scope 3 locked behind the upgrade prompt, with the form disabled', async () => {
    plan = 'starter';
    await mount(<CarbonCalculator />);
    await setField(byId<HTMLSelectElement>('scope'), 'Scope 3');

    const prompt = container.querySelector('[aria-label="Upgrade required"]');
    expect(prompt?.textContent).toContain('Scope 3 workflows');
    expect(prompt?.textContent).toContain('Upgrade to Growth');
    expect(byId<HTMLSelectElement>('category').disabled).toBe(true);
    expect(buttonNamed(container, /^Add Entry$/).disabled).toBe(true);

    await setField(byId<HTMLSelectElement>('scope'), 'Scope 1');
    expect(container.querySelector('[aria-label="Upgrade required"]')).toBeNull();
  });

  it('stays open on Growth', async () => {
    await mount(<CarbonCalculator />);
    await setField(byId<HTMLSelectElement>('scope'), 'Scope 3');
    expect(container.querySelector('[aria-label="Upgrade required"]')).toBeNull();
    expect(byId<HTMLSelectElement>('category').disabled).toBe(false);
  });
});

describe('the entry list', () => {
  it('shows each entry\'s activity date, activity, factor and dataset, and says when an older row has none', async () => {
    listed = [
      serverEntry(),
      serverEntry({ id: 9, scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: '6367.2', unit: 'kg CO2e', co2e_kg: 6367.2, activity_date: null, activity_amount: null, activity_unit: null, factor_value: null, factor_source: null, catalog_version: null }),
    ];
    await mount(<CarbonCalculator />);

    const rows = [...container.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));
    expect(rows[0]?.slice(5, 9)).toEqual(['2025-03-15', '1,000 kWh', '0.19504 kg CO2e/kWh', 'eGRID2023']);
    expect(rows[1]?.slice(5, 9)).toEqual(['Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
    // K7: an unpinned row is priced by the frozen 2026-07-24 catalog, not the
    // current one, so a factor correction does not restate it.
    expect(text()).toContain('Its CO2e is calculated from the 2026-07-24 factor catalog');
    expect(text()).not.toContain('current factor catalog');
  });

  it('marks a row the totals report beside the scopes, and leaves it out of the scope totals on this page', async () => {
    listed = [
      serverEntry(),
      serverEntry({ id: 12, scope: 'Scope 1', category: 'fugitive_emissions', source: 'refrigerant_r22', amount: '10', unit: 'kg', co2e_kg: 17600, reporting_bucket: 'memo:non-kyoto' }),
    ];
    await mount(<CarbonCalculator />);
    expect(text()).toContain('reported separately, not in Scope 1');
    // The page total is the CAMX row only, as on the dashboard; before, it added the 17.6 t of R-22.
    expect(text()).toContain('Total: 195.0 kg CO2e');
  });

  it('deletes through DELETE /api/entries/:id', async () => {
    listed = [serverEntry()];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mount(<CarbonCalculator />);
    listed = [];
    await press(container.querySelector<HTMLButtonElement>('button[aria-label^="Delete entry"]')!);

    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/entries/41')).toBe(true);
    expect(sdkTables).not.toContain('emission_entries');
    expect(text()).toContain('No entries yet');
  });
});

describe('after the trial ends', () => {
  it('the calculator is paused like the dashboard, and export is still offered', async () => {
    plan = null;
    onList = () => json({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: 'An active subscription is required for this feature' }, 402);
    await mount(<CarbonCalculator />);

    expect(text()).toContain('The calculator needs an active plan');
    expect(container.querySelector('a[href="/app/settings"]')?.textContent).toContain('export your data from Settings');
    expect(container.querySelector('#amount')).toBeNull();
    expect(text()).not.toContain('Unable to load calculator');
  });
});

describe('a company row that does not exist yet', () => {
  // K5 moved onboarding out of the calculator: it used to render only when no
  // company row existed, which the server made impossible by creating one on the
  // first call, so nobody ever saw it (F-B-03). The OnboardingGate in front of this
  // page (tests/onboarding-gate.test.tsx) shows it while the company is a placeholder.
  it('no longer draws an onboarding form: it says the workspace is not set up and links to the dashboard', async () => {
    useSdk(null);
    await mount(<CarbonCalculator />);

    expect(container.querySelector('#onboarding-company-name')).toBeNull();
    expect(text()).toContain('Your workspace is not set up yet');
    expect(container.querySelector('a[href="/app"]')?.textContent).toBe('Go to the dashboard');
    expect(container.querySelector('#amount')).toBeNull();
    // Nothing is created through the records API, and no facility through the server.
    expect(sdkTables.filter((table) => table !== 'companies')).toEqual([]);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
});
