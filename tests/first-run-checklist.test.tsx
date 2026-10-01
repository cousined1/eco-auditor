// K5 (F-B-03 = F-C-03): the first-run checklist on the dashboard: 1 name your
// company, 2 add a facility, 3 add data, 4 generate a report. Each item links to
// its screen and ticks from what the server says is stored; it stays until all
// four are done, and it never stands between the customer and the dashboard.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstRunChecklist } from '../src/components/onboarding/FirstRunChecklist';
import Dashboard from '../src/pages/Dashboard';
import { settle } from './helpers/form-dom';
import { COMPANY_URL, companyOverview, jsonResponse, placeholderOverview } from './helpers/company-overview';

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
const trend = { success: true, data: MONTHS.map((month) => ({ month, scope1: 0, scope2: 0, scope3: 0 })) };

let container: HTMLDivElement;
let root: Root;
let companyAnswer: () => Response;

function serve(total: number) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === COMPANY_URL) return companyAnswer();
    if (url.startsWith('/api/emissions/summary')) return jsonResponse(summary(total));
    return jsonResponse(trend);
  }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

const text = () => container.textContent ?? '';
const checklist = () => container.querySelector('section[aria-labelledby="first-run-title"]');
// The tick glyph is decorative (aria-hidden); what is read is the "Done:" / "To do:" text after it.
const steps = () => [...container.querySelectorAll('section[aria-labelledby="first-run-title"] li')].map((li) => (li.textContent ?? '').replace(/^✓/, ''));

async function mountDashboard() {
  await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>));
  await settle();
}

describe('the checklist', () => {
  const none = { company_named: false, facility_added: false, data_added: false, report_generated: false, complete: false };

  it('lists the four steps in order, each linked to the screen where it is done', async () => {
    await act(async () => root.render(<MemoryRouter><FirstRunChecklist checklist={none} /></MemoryRouter>));

    expect(container.querySelector('h2')?.textContent).toBe('Finish setting up');
    expect(steps()).toEqual([
      'To do: Name your company · Company settings',
      'To do: Add a facility · Facility settings',
      'To do: Add data · Import a CSV or Add an entry',
      'To do: Generate a report · Go to Reports',
    ]);
    expect([...container.querySelectorAll('li a')].map((a) => a.getAttribute('href'))).toEqual(['/app/settings', '/app/settings', '/app/intake', '/app/calculator', '/app/reports']);
    expect(text()).toContain('0 of 4 done');
  });

  it('ticks each step from its own data and counts what is done', async () => {
    await act(async () => root.render(
      <MemoryRouter><FirstRunChecklist checklist={{ ...none, company_named: true, data_added: true }} /></MemoryRouter>,
    ));

    expect(steps()[0]).toMatch(/^Done: Name your company/);
    expect(steps()[1]).toMatch(/^To do: Add a facility/);
    expect(steps()[2]).toMatch(/^Done: Add data/);
    expect(steps()[3]).toMatch(/^To do: Generate a report/);
    expect(text()).toContain('2 of 4 done');
  });
});

describe('on the dashboard', () => {
  it('a new account sees the checklist above the empty dashboard, with nothing ticked', async () => {
    companyAnswer = () => jsonResponse(placeholderOverview());
    serve(0);
    await mountDashboard();

    expect(text()).toContain('No Emissions Data Yet');
    expect(checklist()).not.toBeNull();
    expect(text()).toContain('0 of 4 done');
    // The checklist comes first; the empty-state actions are still there.
    expect(checklist()!.compareDocumentPosition(container.querySelector('a[href="/app/intake"]:not(section a)')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps asking for what is missing once there is data: named and imported, no facility yet, no report', async () => {
    companyAnswer = () => jsonResponse(companyOverview({ checklist: { company_named: true, facility_added: false, data_added: true, report_generated: false } }));
    serve(12.3);
    await mountDashboard();

    expect(text()).toContain('Carbon Accounting Overview');
    expect(steps().map((step) => step.split(':')[0])).toEqual(['Done', 'To do', 'Done', 'To do']);
    expect(text()).toContain('2 of 4 done');
  });

  it('disappears when all four are done', async () => {
    companyAnswer = () => jsonResponse(companyOverview());
    serve(12.3);
    await mountDashboard();

    expect(text()).toContain('Carbon Accounting Overview');
    expect(checklist()).toBeNull();
  });

  it('never blocks the dashboard: if the company cannot be loaded there is no checklist and the page is unharmed', async () => {
    companyAnswer = () => jsonResponse({ success: false, error: 'Data store temporarily unavailable. Please retry.' }, 503);
    serve(12.3);
    await mountDashboard();

    expect(text()).toContain('Carbon Accounting Overview');
    expect(checklist()).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows nothing for a plan that is paused; the dashboard\'s own paywall speaks', async () => {
    companyAnswer = () => jsonResponse({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: 'An active subscription is required for this feature' }, 402);
    serve(12.3);
    await mountDashboard();

    expect(checklist()).toBeNull();
  });
});
