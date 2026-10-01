// F-B-15 (a hung request spun forever), F-B-13 (whole-tonne rounding), F-C-17 (charts) and
// F-C-16/F-C-25 (no H1 outside the data view; paywall copy) on the Dashboard page.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../src/pages/Dashboard';
import { ThemeProvider } from '../src/hooks/useTheme';
import { SCOPE_COLORS, SCOPE_COLORS_DARK } from '../src/lib/scopeColors';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
vi.mock('recharts', async () => import('./helpers/recharts-stub'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The audited account (b-1): 6.3672 + 4.89222 + 0.255 = 11.51442 t, imported in September.
const SUMMARY = {
  success: true,
  data: {
    total_co2e_tonnes: 11.51442,
    scope1_co2e_tonnes: 6.3672,
    scope2_co2e_tonnes: 4.89222,
    scope3_co2e_tonnes: 0.255,
    scope1_pct: 55.3,
    scope2_pct: 42.5,
    scope3_pct: 2.2,
    trend_vs_prior_period: null,
  },
};
const TREND = {
  success: true,
  data: MONTHS.map((month) => ({
    month,
    scope1: month === 'Sep' ? 6.3672 : 0,
    scope2: month === 'Sep' ? 4.89222 : 0,
    scope3: month === 'Sep' ? 0.255 : 0,
  })),
};
const EMPTY_SUMMARY = { success: true, data: { ...SUMMARY.data, total_co2e_tonnes: 0, scope1_co2e_tonnes: 0, scope2_co2e_tonnes: 0, scope3_co2e_tonnes: 0 } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function healthy(url: string): Response {
  return json(url.startsWith('/api/emissions/summary') ? SUMMARY : TREND);
}

// A request that never answers, but honours cancellation like a real fetch.
function hang(init: RequestInit | undefined, signals: AbortSignal[]): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signals.push(signal);
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Only the clock the code under test reads: React's own scheduling stays real.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

async function mount(node: ReactNode = <Dashboard />) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
}

const text = () => container.textContent ?? '';

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no "${name}" button in: ${text()}`);
  return found;
}

describe('Dashboard: a request that never answers (F-B-15)', () => {
  it('gives up after 15 s with a visible error and a working Try Again, and cancels the hung requests', async () => {
    const signals: AbortSignal[] = [];
    let hanging = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (hanging ? hang(init, signals) : healthy(url))));

    await mount();
    expect(text()).toContain('Loading your emissions data');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(text()).toContain('Loading your emissions data');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(text()).toContain('Unable to Load Dashboard');
    expect(text()).toContain('took too long');
    expect(container.querySelector('[role="status"]')).toBeNull(); // the spinner is gone
    expect(signals).toHaveLength(2); // summary and trend
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    hanging = false;
    await act(async () => button('Try Again').click());
    expect(text()).toContain('Carbon Accounting Overview');
    expect(text()).not.toContain('Unable to Load Dashboard');
  });

  it('still recovers through Try Again from a server error, as before', async () => {
    let failing = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (failing ? json({ success: false }, 500) : healthy(url))),
    );

    await mount();
    expect(text()).toContain('Unable to Load Dashboard');
    expect(text()).toContain('Something went wrong while loading');
    expect(text()).not.toContain('took too long');

    failing = false;
    await act(async () => button('Try Again').click());
    expect(text()).toContain('Carbon Accounting Overview');
  });

  it('a late answer to a request that was already abandoned cannot flip the screen back to an error', async () => {
    const signals: AbortSignal[] = [];
    let hanging = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (hanging ? hang(init, signals) : healthy(url))));

    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    hanging = false;
    await act(async () => button('Try Again').click());
    expect(text()).toContain('Carbon Accounting Overview');

    // The abandoned attempt's aborted requests have long since rejected; nothing may resurface.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(text()).toContain('Carbon Accounting Overview');
    expect(text()).not.toContain('Unable to Load Dashboard');
  });

  it('cancels its requests when the page is left', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => hang(init, signals)));

    await mount();
    expect(signals.every((signal) => signal.aborted)).toBe(false);

    await act(async () => root.render(<MemoryRouter>{null}</MemoryRouter>));

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe('Dashboard: figures (F-B-13)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => healthy(url)));
  });

  it('renders the audited account as 6.4 / 4.9 / 255.0 kg / 11.5, not 6 / 5 / "0 tCO2e" / 12', async () => {
    await mount();

    expect(text()).toContain('6.4 tCO2e');
    expect(text()).toContain('4.9 tCO2e');
    expect(text()).toContain('255.0 kg CO2e');
    expect(text()).toContain('11.5 tCO2e'); // the total
    expect(text()).not.toMatch(/(^|[^\d.])0 tCO2e/); // Scope 3 was "0 tCO2e · 2.2% of total"
    expect(text()).not.toMatch(/(^|[^\d.])12 tCO2e/);
  });

  it('derives each share from the same figures it displays, and they add up', async () => {
    await mount();

    const shares = ['55.3% of total', '42.5% of total', '2.2% of total'];
    for (const share of shares) expect(text()).toContain(share);
    expect(55.3 + 42.5 + 2.2).toBeCloseTo(100, 5);
  });

  it('computes the share from the displayed values even if the server\'s own percentages disagree', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        json(
          url.startsWith('/api/emissions/summary')
            ? { success: true, data: { ...SUMMARY.data, scope1_pct: 1, scope2_pct: 1, scope3_pct: 98 } }
            : TREND,
        ),
      ),
    );

    await mount();

    expect(text()).toContain('55.3% of total');
    expect(text()).not.toContain('98% of total');
  });

  it('shows a visible H1 in the data view, and only one', async () => {
    await mount();

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Dashboard');
    expect(headings[0]?.classList.contains('sr-only')).toBe(false);
  });
});

describe('Dashboard: trend chart (F-C-17)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => healthy(url)));
  });

  it('does not draw the months that have not happened yet (Oct-Dec as zero)', async () => {
    await mount();

    const chart = container.querySelector('[data-chart="area"]');
    expect(chart?.getAttribute('data-periods')).toBe(MONTHS.slice(0, 9).join(','));
  });

  it('draws straight segments, not a spline that invents a hump around a single import', async () => {
    await mount();

    const types = [...container.querySelectorAll('[data-area]')].map((el) => el.getAttribute('data-type'));
    expect(types).toEqual(['linear', 'linear', 'linear']);
  });

  it('colours the scopes from the shared palette, and the legend swatches match', async () => {
    await mount();

    const strokes = [...container.querySelectorAll('[data-area]')].map((el) => el.getAttribute('data-stroke'));
    expect(strokes).toEqual([SCOPE_COLORS['Scope 1'], SCOPE_COLORS['Scope 2'], SCOPE_COLORS['Scope 3']]);

    const swatches = [...container.querySelectorAll('span.rounded-full')].map((el) => (el as HTMLElement).style.backgroundColor);
    expect(swatches).toHaveLength(3);
    // jsdom normalises "#0d7a3a" to rgb(13, 122, 58)
    expect(swatches[0]).toBe('rgb(13, 122, 58)');
  });

  it('uses the dark set of the same hues in dark mode', async () => {
    localStorage.setItem('eco-theme', 'dark');

    await mount(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>,
    );

    const strokes = [...container.querySelectorAll('[data-area]')].map((el) => el.getAttribute('data-stroke'));
    expect(strokes).toEqual([SCOPE_COLORS_DARK['Scope 1'], SCOPE_COLORS_DARK['Scope 2'], SCOPE_COLORS_DARK['Scope 3']]);
  });

  it('formats a tooltip value with a unit, one decimal ("36.0 tCO2e", not "35.9602")', async () => {
    await mount();

    expect(container.querySelector('[data-tooltip]')?.textContent).toBe('36.0 tCO2e');
  });

  it('offers the same numbers as a table for screen readers', async () => {
    await mount();

    const rows = container.querySelectorAll('table.sr-only tbody tr');
    expect(rows).toHaveLength(9);
    const september = [...(rows[8]?.querySelectorAll('th, td') ?? [])].map((cell) => cell.textContent);
    expect(september).toEqual(['Sep', '6.4 tCO2e', '4.9 tCO2e', '255.0 kg CO2e']);
    expect(container.querySelector('table.sr-only caption')?.textContent).toContain('Emissions');
  });
});

describe('Dashboard: every state has a page heading (F-C-16) and honest copy (F-C-25)', () => {
  function expectSingleScreenReaderHeading() {
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Dashboard');
    expect(headings[0]?.classList.contains('sr-only')).toBe(true);

    // axe "heading-order": a heading may go at most one level deeper than the one before it.
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => Number(heading.tagName.slice(1)));
    levels.forEach((level, index) => expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1));
  }

  it('loading', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    await mount();

    expect(text()).toContain('Loading your emissions data');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expectSingleScreenReaderHeading();
  });

  it('failed to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 500)));
    await mount();

    expect(text()).toContain('Unable to Load Dashboard');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expectSingleScreenReaderHeading();
  });

  it('no company yet (onboarding)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: 'no company' }, 403)));
    await mount();

    // One spelling of the brand everywhere (F-C-20): "Eco-Auditor".
    expect(text()).toContain('Welcome to Eco-Auditor');
    expect(text()).not.toContain('EcoAuditor');
    expectSingleScreenReaderHeading();
  });

  it('empty account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => json(url.startsWith('/api/emissions/summary') ? EMPTY_SUMMARY : { success: true, data: [] })),
    );
    await mount();

    expect(text()).toContain('No Emissions Data Yet');
    expectSingleScreenReaderHeading();
  });

  it('plan gate (expired trial): keeps the server\'s reason and says export still works, with a link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: 'An active subscription is required for this feature' }, 402),
      ),
    );
    await mount();

    expect(text()).toContain('Your dashboard is a paid feature');
    // The paywall title is an h2 under the page's h1, not an h4 that skips two levels.
    expect(container.querySelector('[role="region"] h2')?.textContent).toBe('Your dashboard is a paid feature');
    expect(container.querySelector('h4')).toBeNull();
    expect(text()).toContain('An active subscription is required for this feature');
    const exportLink = [...container.querySelectorAll('a')].find((a) => a.textContent === 'export your data from Settings');
    expect(exportLink?.getAttribute('href')).toBe('/app/settings');
    expectSingleScreenReaderHeading();
  });

  it('marks the decorative emoji as hidden from assistive technology', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false }, 500)));
    await mount();

    const emoji = [...container.querySelectorAll('div')].find((d) => d.textContent === '⚠️');
    expect(emoji?.getAttribute('aria-hidden')).toBe('true');
  });
});
