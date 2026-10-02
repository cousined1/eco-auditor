// F-B-15 (calculator load failure had no retry, a hang had no end), F-C-17 (scope colours),
// F-C-25 ("1 Entries") and F-C-27 (badges wrapping beside the sidebar) in the calculator.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarbonCalculator from '../src/components/carbon-calculator';
import EmissionList from '../src/components/carbon-calculator/EmissionList';
import EmissionsDashboard from '../src/components/carbon-calculator/EmissionsDashboard';
import type { EmissionEntry, Facility } from '../src/components/carbon-calculator/utils';
import { ThemeProvider } from '../src/hooks/useTheme';
import { SCOPE_COLORS, SCOPE_COLORS_DARK } from '../src/lib/scopeColors';

const sdk = vi.hoisted(() => ({ getCurrentUser: vi.fn(), from: vi.fn() }));
vi.mock('../src/lib/insforge', () => ({
  insforge: { auth: { getCurrentUser: sdk.getCurrentUser }, database: { from: sdk.from } },
}));
vi.mock('recharts', async () => import('./helpers/recharts-stub'));

type Result = { data: unknown; error: unknown };
type Load = () => Promise<Result>;
type Tables = Partial<Record<'companies' | 'facilities' | 'emission_entries', Load>>;

const ok = (data: unknown): Load => async () => ({ data, error: null });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A stand-in for the database client's query builder: chainable, and awaitable
// (or .maybeSingle()) to produce the table's result. Since K2 the calculator
// reads entries from GET /api/entries (and the plan from /api/billing) instead of
// the records API, so `emission_entries` is served through fetch.
function useDatabase(tables: Tables) {
  sdk.from.mockImplementation((name: string) => {
    const load = tables[name as keyof Tables];
    if (!load || name === 'emission_entries') throw new Error(`unexpected table ${name}`);
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: () => load(),
      then: (onFulfilled: (result: Result) => unknown, onRejected: (error: unknown) => unknown) => load().then(onFulfilled, onRejected),
    };
    return builder;
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/billing') return json({ active: true, plan: 'starter' });
    if (url === '/api/entries' && tables.emission_entries) {
      const { data, error } = await tables.emission_entries();
      return error ? json({ success: false, error: String(error) }, 500) : json({ success: true, data });
    }
    throw new Error(`unexpected request ${url}`);
  }));
}

const COMPANY = { id: 7, name: 'Acme Ltd', industry: 'Retail' };

function entry(overrides: Partial<EmissionEntry> = {}): EmissionEntry {
  return {
    id: 1,
    scope: 'Scope 1',
    category: 'stationary_combustion',
    source: 'natural_gas',
    amount: '6367.2',
    unit: 'kg CO2e',
    factor: '1200 therms',
    method: 'EPA emission factor',
    confidence: 85,
    facility_id: null,
    co2e_kg: 6367.2,
    created_at: '2026-09-30T00:00:00Z',
    ...overrides,
  };
}

const healthy = (entries: EmissionEntry[] = [entry()], facilities: Facility[] = []): Tables => ({
  companies: ok(COMPANY),
  facilities: ok(facilities),
  emission_entries: ok(entries),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sdk.getCurrentUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
  sdk.from.mockReset();
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
  localStorage.removeItem('eco-theme');
  document.documentElement.classList.remove('dark');
});

async function mount(node: ReactNode) {
  await act(async () => root.render(node));
}

const text = () => container.textContent ?? '';

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no "${name}" button in: ${text()}`);
  return found;
}

describe('Calculator initial load (F-B-15)', () => {
  it('a hung load ends after 15 s in an error with Try again, and Try again works once the fault clears', async () => {
    useDatabase({ companies: () => new Promise<Result>(() => {}), facilities: ok([]), emission_entries: ok([]) });

    await mount(<CarbonCalculator />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull(); // still the skeleton

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(text()).toContain('Unable to load calculator');
    expect(text()).toContain('took too long');

    useDatabase(healthy());
    await act(async () => button('Try again').click());

    expect(text()).toContain('Track and calculate emissions for Acme Ltd');
    expect(text()).not.toContain('Unable to load calculator');
  });

  it('a failed load shows the reason and offers Try again (there was no retry, only a manual refresh)', async () => {
    useDatabase({
      ...healthy(),
      companies: async () => ({ data: null, error: new Error('Database unavailable') }),
    });

    await mount(<CarbonCalculator />);

    expect(text()).toContain('Unable to load calculator');
    expect(text()).toContain('Database unavailable');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.contains(button('Try again'))).toBe(true);

    useDatabase(healthy());
    await act(async () => button('Try again').click());
    expect(text()).toContain('Track and calculate emissions for Acme Ltd');
  });

  it('the error state still has a page heading', async () => {
    useDatabase({ ...healthy(), companies: async () => ({ data: null, error: new Error('nope') }) });

    await mount(<CarbonCalculator />);

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Carbon Calculator');
    expect(headings[0]?.classList.contains('sr-only')).toBe(true);
  });

  it('a late failure from an attempt that was already abandoned cannot flip a recovered screen back to an error', async () => {
    let failFirstAttempt: (result: Result) => void = () => {};
    let attempt = 0;
    useDatabase({
      ...healthy(),
      companies: () => {
        attempt += 1;
        return attempt === 1
          ? new Promise<Result>((resolve) => {
              failFirstAttempt = resolve;
            })
          : Promise.resolve({ data: COMPANY, error: null });
      },
    });

    await mount(<CarbonCalculator />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(text()).toContain('Unable to load calculator');

    await act(async () => button('Try again').click());
    expect(text()).toContain('Track and calculate emissions for Acme Ltd');

    // The first request finally answers, with an error.
    await act(async () => failFirstAttempt({ data: null, error: new Error('late failure') }));

    expect(text()).toContain('Track and calculate emissions for Acme Ltd');
    expect(text()).not.toContain('Unable to load calculator');
    expect(text()).not.toContain('late failure');
  });

  it('a late success from an abandoned attempt cannot overwrite what a newer attempt loaded', async () => {
    const facility: Facility = { id: 3, name: 'HQ', company_id: 7 };
    let answerFirstAttempt: (result: Result) => void = () => {};
    let attempt = 0;
    useDatabase({
      companies: ok(COMPANY),
      emission_entries: ok([entry()]),
      facilities: () => {
        attempt += 1;
        return attempt === 1
          ? new Promise<Result>((resolve) => {
              answerFirstAttempt = resolve;
            })
          : Promise.resolve({ data: [facility], error: null });
      },
    });

    await mount(<CarbonCalculator />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await act(async () => button('Try again').click());
    expect(container.querySelector('.badge-blue')?.textContent).toBe('1 facility');

    // The abandoned first attempt finally gets its (older, different) answer.
    await act(async () => answerFirstAttempt({ data: [], error: null }));

    expect(container.querySelector('.badge-blue')?.textContent).toBe('1 facility');
  });
});

describe('Calculator header badges (F-C-25, F-C-27)', () => {
  it('pluralises the counts: "1 entry" and "0 facilities", never "1 Entries"', async () => {
    useDatabase(healthy([entry()], []));

    await mount(<CarbonCalculator />);

    const badges = [...container.querySelectorAll('.badge-blue, .badge-green')].map((badge) => badge.textContent);
    expect(badges).toEqual(['0 facilities', '1 entry']);
  });

  it('uses the plural for several entries and the singular for one facility', async () => {
    const facility: Facility = { id: 3, name: 'HQ', company_id: 7 };
    useDatabase(healthy([entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3 })], [facility]));

    await mount(<CarbonCalculator />);

    const badges = [...container.querySelectorAll('.badge-blue, .badge-green')].map((badge) => badge.textContent);
    expect(badges).toEqual(['1 facility', '3 entries']);
  });

  it('keeps each badge on one line and lets the header wrap instead of squeezing them', async () => {
    useDatabase(healthy());

    await mount(<CarbonCalculator />);

    for (const badge of container.querySelectorAll('.badge-blue, .badge-green')) {
      expect(badge.classList.contains('whitespace-nowrap')).toBe(true);
    }
    const header = container.querySelector('h1')?.parentElement?.parentElement;
    expect(header?.classList.contains('flex-wrap')).toBe(true);
  });
});

describe('EmissionList (F-C-17, F-C-27)', () => {
  const rows = [
    entry({ id: 1, scope: 'Scope 1', co2e_kg: 6367.2 }),
    entry({ id: 2, scope: 'Scope 2', category: 'purchased_electricity', source: 'RFCE', co2e_kg: 4892.22 }),
    entry({ id: 3, scope: 'Scope 3', category: 'business_travel', source: 'air', co2e_kg: 255 }),
  ];

  it('marks each scope with its shared-palette colour and its name, on one line', async () => {
    await mount(<EmissionList entries={rows} facilities={[]} onDelete={() => {}} />);

    const badges = [...container.querySelectorAll('tbody tr td:first-child > span')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['Scope 1', 'Scope 2', 'Scope 3']);
    for (const badge of badges) expect(badge.classList.contains('whitespace-nowrap')).toBe(true);

    const dots = badges.map((badge) => (badge.querySelector('span') as HTMLElement).style.backgroundColor);
    // jsdom normalises hex to rgb()
    expect(dots).toEqual(['rgb(13, 122, 58)', 'rgb(15, 118, 110)', 'rgb(180, 83, 9)']);
    expect(SCOPE_COLORS['Scope 1']).toBe('#0d7a3a');
    expect(SCOPE_COLORS['Scope 2']).toBe('#0f766e');
    expect(SCOPE_COLORS['Scope 3']).toBe('#b45309');
  });

  it('shows amounts in the shared unit format, kilograms below one tonne', async () => {
    await mount(<EmissionList entries={rows} facilities={[]} onDelete={() => {}} />);

    const amounts = [...container.querySelectorAll('tbody tr td:nth-child(4)')].map((cell) => cell.textContent);
    expect(amounts).toEqual(['6.4 tCO2e', '4.9 tCO2e', '255.0 kg CO2e']);
    for (const cell of container.querySelectorAll('tbody tr td:nth-child(4)')) {
      expect(cell.classList.contains('whitespace-nowrap')).toBe(true);
    }
  });
});

describe('EmissionsDashboard charts (F-C-17)', () => {
  const facility: Facility = { id: 3, name: 'HQ', company_id: 7 };
  const entries = [
    entry({ id: 1, scope: 'Scope 1', co2e_kg: 6367.2, facility_id: 3 }),
    entry({ id: 2, scope: 'Scope 2', category: 'purchased_electricity', source: 'RFCE', co2e_kg: 4892.22, facility_id: 3 }),
  ];

  it('draws the pie and the facility bars in the same colours the main dashboard uses', async () => {
    await mount(<EmissionsDashboard entries={entries} facilities={[facility]} />);

    const slices = [...container.querySelectorAll('[data-cell-fill]')].map((el) => el.getAttribute('data-cell-fill'));
    expect(slices).toEqual([SCOPE_COLORS['Scope 1'], SCOPE_COLORS['Scope 2']]);
    const bars = [...container.querySelectorAll('[data-bar]')].map((el) => el.getAttribute('data-fill'));
    expect(bars).toEqual([SCOPE_COLORS['Scope 1'], SCOPE_COLORS['Scope 2'], SCOPE_COLORS['Scope 3']]);
    // Scope 1 was red here (and red also reads as "error").
    expect(container.innerHTML.toLowerCase()).not.toContain('#ef4444');
  });

  it('switches to the dark set of the same hues in dark mode', async () => {
    localStorage.setItem('eco-theme', 'dark');

    await mount(
      <ThemeProvider>
        <EmissionsDashboard entries={entries} facilities={[facility]} />
      </ThemeProvider>,
    );

    const slices = [...container.querySelectorAll('[data-cell-fill]')].map((el) => el.getAttribute('data-cell-fill'));
    expect(slices).toEqual([SCOPE_COLORS_DARK['Scope 1'], SCOPE_COLORS_DARK['Scope 2']]);
  });

  it('reads the totals in one unit format and puts each scope\'s colour beside its card', async () => {
    await mount(<EmissionsDashboard entries={entries} facilities={[facility]} />);

    expect(text()).toContain('Total: 11.3 tCO2e');
    const cards = [...container.querySelectorAll('.grid-cols-1.sm\\:grid-cols-3 > .card')];
    expect(cards.map((card) => card.textContent)).toEqual([
      'Scope 16.4 tCO2e56.5% of total',
      'Scope 24.9 tCO2e43.5% of total',
      'Scope 30.0 kg CO2e0.0% of total',
    ]);
    const dot = cards[0]?.querySelector('span') as HTMLElement;
    expect(dot.style.backgroundColor).toBe('rgb(13, 122, 58)');
  });

  it('says which unit the facility bars are plotted in (the axis carries none), only when there is a chart', async () => {
    await mount(<EmissionsDashboard entries={entries} facilities={[facility]} />);
    expect(text()).toContain('Kilograms CO2e (kg CO2e)');

    await mount(<EmissionsDashboard entries={[entry({ facility_id: null })]} facilities={[facility]} />);
    expect(text()).toContain('Assign facilities to entries to see this chart.');
    expect(text()).not.toContain('Kilograms CO2e (kg CO2e)');
  });

  it('stacks the three summary cards on a phone, where "255.0 kg CO2e" no longer fits three across', async () => {
    await mount(<EmissionsDashboard entries={entries} facilities={[facility]} />);

    const grid = container.querySelector('.sm\\:grid-cols-3');
    expect(grid?.classList.contains('grid-cols-1')).toBe(true);
  });
});
