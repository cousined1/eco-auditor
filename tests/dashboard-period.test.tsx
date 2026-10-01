// K3 / F-B-05: the Dashboard showed only the current calendar year ("FY 2026"),
// so in 2026 a customer reporting FY2025 could not see it, and the report the
// Calculator produced covered "All time" instead. The Dashboard now names the
// year it shows, lets the user pick another, and asks the server for exactly
// that year, the same year a report defaults to.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../src/pages/Dashboard';
import { setField, settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
vi.mock('recharts', async () => import('./helpers/recharts-stub'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const summary = (total: number) => ({
  success: true,
  data: {
    total_co2e_tonnes: total, scope1_co2e_tonnes: total, scope2_co2e_tonnes: 0, scope3_co2e_tonnes: 0,
    scope1_pct: 100, scope2_pct: 0, scope3_pct: 0, trend_vs_prior_period: null,
  },
});
const trend = (month: string, total: number) => ({
  success: true,
  data: MONTHS.map((m) => ({ month: m, scope1: m === month ? total : 0, scope2: 0, scope3: 0 })),
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// The audit's reproduction tenant: 20.525 t in 2026, 5.306 t in 2025 (review R2).
const BY_YEAR: Record<string, number> = { '2026': 20.525, '2025': 5.306 };

let requested: string[] = [];
let container: HTMLDivElement;
let root: Root;

function serve(byYear: Record<string, number>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    // The first-run checklist's own request (K5) is not what this test is about.
    if (url === '/api/company') return new Response('{}', { status: 404 });
    requested.push(url);
    const query = new URL(url, 'http://localhost').searchParams;
    if (url.startsWith('/api/emissions/summary')) return json(summary(byYear[query.get('period') ?? ''] ?? 0));
    return json(trend('Jun', byYear[query.get('year') ?? ''] ?? 0));
  }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
  requested = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? '';
const yearSelect = () => container.querySelector<HTMLSelectElement>('#dashboard-year');

async function mount() {
  await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
  await settle();
}

describe('Dashboard reporting year (F-B-05)', () => {
  it('opens on the current calendar year, names it, and asks the server for exactly that year', async () => {
    serve(BY_YEAR);
    await mount();

    expect(requested).toEqual(['/api/emissions/summary?period=2026', '/api/emissions/trend?period=monthly&year=2026']);
    expect(yearSelect()?.value).toBe('2026');
    expect(container.querySelector('label[for="dashboard-year"]')?.textContent).toBe('Calendar year');
    expect(text()).toContain('Calendar year 2026');
    expect(text()).toContain('20.5 tCO2e');
    expect(text()).not.toMatch(/\bFY \d{4}/);
  });

  it('shows an earlier year when it is chosen, with all twelve months of its trend', async () => {
    serve(BY_YEAR);
    await mount();
    await setField(yearSelect()!, '2025');
    await settle();

    expect(requested.slice(-2)).toEqual(['/api/emissions/summary?period=2025', '/api/emissions/trend?period=monthly&year=2025']);
    expect(text()).toContain('Calendar year 2025');
    expect(text()).toContain('5.3 tCO2e');
    expect(container.querySelector('[data-chart="area"]')?.getAttribute('data-periods')).toBe(MONTHS.join(','));
  });

  it('keeps the year choosable when the current year is empty, so last year\'s data is reachable', async () => {
    serve({ '2025': 5.306 });
    await mount();

    expect(text()).toContain('No Emissions Data Yet');
    expect(yearSelect()).not.toBeNull();
    await setField(yearSelect()!, '2025');
    await settle();

    expect(text()).toContain('5.3 tCO2e');
    expect(text()).toContain('Calendar year 2025');
  });
});
