// K5 (F-B-03 = F-C-03) in the SPA: a company the server created is sent through
// onboarding BEFORE the dashboard or the calculator, and a real company is not.
// Before K5 the onboarding form rendered only when no company row existed, which
// the server made impossible by creating "<email-prefix> Organization" on the first
// call, so nobody ever saw it. Every request goes through apiFetch (mocked fetch);
// the server side is tests/company-onboarding-route.test.ts.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingGate from '../src/components/onboarding/OnboardingGate';
import { buttonNamed, press, setField, settle } from './helpers/form-dom';
import { COMPANY_URL, companyOverview, jsonResponse, placeholderOverview } from './helpers/company-overview';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

type Call = { url: string; method: string; body: unknown };
type Handler = (call: Call, init: RequestInit | undefined) => Response | Promise<Response>;

let container: HTMLDivElement;
let root: Root;
let calls: Call[];
let handlers: Record<string, Handler>;

/** Routes fetch by "METHOD url"; unknown requests fail the test loudly. */
function serve(overrides: Record<string, Handler> = {}) {
  handlers = {
    [`GET ${COMPANY_URL}`]: () => jsonResponse(placeholderOverview()),
    'PATCH /api/companies/7': (call) => jsonResponse({
      success: true,
      data: { ...placeholderOverview().company, ...(call.body as object), id: 7 },
      onboarding: { needs_onboarding: false, auto_provisioned: true, completed_at: '2026-09-30T12:00:00.000Z', skipped_at: null },
    }),
    'POST /api/companies/7/onboarding/skip': () => jsonResponse({
      success: true,
      onboarding: { needs_onboarding: false, auto_provisioned: true, completed_at: null, skipped_at: '2026-09-30T12:00:00.000Z' },
    }),
    'POST /api/companies/7/facilities': (call) => jsonResponse({ success: true, data: { id: '3', company_id: '7', ...(call.body as object) } }, 201),
    ...overrides,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const handler = handlers[`${call.method} ${url}`];
    if (!handler) throw new Error(`unexpected request ${call.method} ${url}`);
    return handler(call, init);
  }));
}

/** A request that never answers, but honours cancellation like a real fetch. */
const hang: Handler = (_call, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? '';
const byId = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
const sent = (method: string, url: string) => calls.filter((call) => call.method === method && call.url === url);

async function mount() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route element={<OnboardingGate />}>
            <Route path="/app" element={<h1>Dashboard page</h1>} />
            <Route path="/app/calculator" element={<h1>Calculator page</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ),
  );
  await settle();
}

async function fillCompany(name = 'Northstar Foods') {
  await setField(byId<HTMLInputElement>('onboarding-company-name'), name);
}

describe('who is sent to onboarding', () => {
  it('an auto-provisioned company sees onboarding, not the dashboard', async () => {
    serve();
    await mount();

    expect(container.querySelector('h1')?.textContent).toBe('Welcome to Eco-Auditor');
    expect(text()).not.toContain('Dashboard page');
    expect(byId<HTMLInputElement>('onboarding-company-name').value).toBe(''); // the placeholder is not offered as the answer
  });

  it('a company that is not a placeholder goes straight to the page', async () => {
    serve({ [`GET ${COMPANY_URL}`]: () => jsonResponse(companyOverview()) });
    await mount();

    expect(text()).toContain('Dashboard page');
    expect(container.querySelector('#onboarding-company-name')).toBeNull();
  });

  it('a plan gate (402) is not onboarding\'s business: the page shows its own paywall', async () => {
    serve({ [`GET ${COMPANY_URL}`]: () => jsonResponse({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: 'An active subscription is required for this feature' }, 402) });
    await mount();

    expect(text()).toContain('Dashboard page');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('the states of the check itself', () => {
  it('shows a loading status, and none of the page, while the company loads', async () => {
    serve({ [`GET ${COMPANY_URL}`]: hang });
    await mount();

    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading your workspace');
    expect(text()).not.toContain('Dashboard page');
  });

  it('gives up after 15 s with an error, a working Try again, and a way on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let answering = false;
    serve({ [`GET ${COMPANY_URL}`]: (call, init) => (answering ? jsonResponse(companyOverview()) : hang(call, init)) });
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/app']}>
          <Routes><Route element={<OnboardingGate />}><Route path="/app" element={<h1>Dashboard page</h1>} /></Route></Routes>
        </MemoryRouter>,
      ),
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('took too long');
    expect(text()).not.toContain('Dashboard page');

    answering = true;
    await act(async () => { buttonNamed(container, /^Try again$/).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(text()).toContain('Dashboard page');
  });

  it('a failed check offers "Continue to the app": a nudge must not lock anyone out', async () => {
    serve({ [`GET ${COMPANY_URL}`]: () => jsonResponse({ success: false, error: 'Data store temporarily unavailable. Please retry.' }, 503) });
    await mount();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Data store temporarily unavailable');
    await press(buttonNamed(container, /^Continue to the app$/));
    expect(text()).toContain('Dashboard page');
  });

  it('an answer in the wrong shape is an error, never "nothing to do"', async () => {
    serve({ [`GET ${COMPANY_URL}`]: () => jsonResponse({}) });
    await mount();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unexpected shape');
    expect(text()).not.toContain('Dashboard page');
  });
});

describe('onboarding: name the company and add a first facility', () => {
  it('saves the answers through the API, adds the facility, and carries on to the page', async () => {
    serve();
    await mount();
    await fillCompany('  Northstar Foods ');
    await setField(byId<HTMLSelectElement>('onboarding-industry'), 'Manufacturing');
    await setField(byId<HTMLSelectElement>('onboarding-consolidation'), 'operational_control');
    await setField(byId<HTMLInputElement>('onboarding-base-year'), '2022');
    await setField(byId<HTMLInputElement>('onboarding-facility-name'), 'Main Plant');
    await setField(byId<HTMLSelectElement>('onboarding-facility-type'), 'factory');
    await setField(byId<HTMLInputElement>('onboarding-facility-city'), 'Fresno');
    await press(buttonNamed(container, /^Save and continue$/));

    expect(sent('PATCH', '/api/companies/7').map((call) => call.body)).toEqual([
      { name: 'Northstar Foods', consolidation_approach: 'operational_control', industry: 'Manufacturing', base_year: 2022 },
    ]);
    expect(sent('POST', '/api/companies/7/facilities').map((call) => call.body)).toEqual([{ name: 'Main Plant', type: 'factory', city: 'Fresno' }]);
    expect(sent('POST', '/api/companies/7/onboarding/skip')).toEqual([]);
    expect(text()).toContain('Dashboard page');
  });

  it('the facility is optional, and only what was chosen is sent', async () => {
    serve();
    await mount();
    await fillCompany();
    await press(buttonNamed(container, /^Save and continue$/));

    expect(sent('PATCH', '/api/companies/7').map((call) => call.body)).toEqual([{ name: 'Northstar Foods', consolidation_approach: 'unspecified' }]);
    expect(calls.some((call) => call.url.endsWith('/facilities'))).toBe(false);
    expect(text()).toContain('Dashboard page');
  });

  it('"Finish later" saves that choice, leaves the name alone, and carries on', async () => {
    serve();
    await mount();
    await press(buttonNamed(container, /^Finish later$/));

    expect(sent('POST', '/api/companies/7/onboarding/skip')).toHaveLength(1);
    expect(sent('PATCH', '/api/companies/7')).toEqual([]);
    expect(text()).toContain('Dashboard page');
  });

  it('explains the reporting basis: one sentence for the approach (and for the chosen one) and one for the base year', async () => {
    serve();
    await mount();

    expect(byId('onboarding-consolidation-hint').textContent).toContain('Reports will say “not specified” until you choose an approach.');
    await setField(byId<HTMLSelectElement>('onboarding-consolidation'), 'equity_share');
    expect(byId('onboarding-consolidation-hint').textContent).toContain('proportion to your ownership share');
    expect(byId('onboarding-base-year-hint').textContent).toContain('reports then say “not set”');
    expect(byId<HTMLSelectElement>('onboarding-consolidation').getAttribute('aria-describedby')).toBe('onboarding-consolidation-hint');
  });

  it('labels every field, focuses the heading when it appears, and is a named form', async () => {
    serve();
    await mount();

    expect(document.activeElement).toBe(container.querySelector('h1'));
    for (const field of container.querySelectorAll('input, select')) {
      expect(container.querySelector(`label[for="${field.id}"]`), field.id).not.toBeNull();
    }
  });
});

describe('validation, and what a failure looks like', () => {
  it('needs a name, a real base year, and a type and city for a facility: nothing is sent until they are right', async () => {
    serve();
    await mount();

    await press(buttonNamed(container, /^Save and continue$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check the highlighted fields');
    expect(byId('onboarding-company-name-error').textContent).toBe('Enter your company name.');
    expect(byId<HTMLInputElement>('onboarding-company-name').getAttribute('aria-invalid')).toBe('true');

    await fillCompany();
    await setField(byId<HTMLInputElement>('onboarding-base-year'), '1989');
    await press(buttonNamed(container, /^Save and continue$/));
    expect(byId('onboarding-base-year-error').textContent).toMatch(/Enter a year from 1990 to \d{4}/);

    await setField(byId<HTMLInputElement>('onboarding-base-year'), '');
    await setField(byId<HTMLInputElement>('onboarding-facility-name'), 'Main Plant');
    await press(buttonNamed(container, /^Save and continue$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Add the facility type and city/);

    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('shows the server\'s message when the company cannot be saved, keeps the form, and lets the customer retry', async () => {
    serve({ 'PATCH /api/companies/7': () => jsonResponse({ success: false, error: 'name is required and must be at most 200 characters.' }, 400) });
    await mount();
    await fillCompany();
    await press(buttonNamed(container, /^Save and continue$/));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('name is required and must be at most 200 characters.');
    expect(document.activeElement).toBe(alert);
    expect(byId<HTMLInputElement>('onboarding-company-name').value).toBe('Northstar Foods');
    expect(buttonNamed(container, /^Save and continue$/).disabled).toBe(false);
    expect(text()).not.toContain('Dashboard page');
  });

  it('a save that never answers ends at 15 s with an error and an enabled form', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serve({ 'PATCH /api/companies/7': hang });
    await act(async () => root.render(<MemoryRouter initialEntries={['/app']}><Routes><Route element={<OnboardingGate />}><Route path="/app" element={<h1>Dashboard page</h1>} /></Route></Routes></MemoryRouter>));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await setField(byId<HTMLInputElement>('onboarding-company-name'), 'Northstar Foods');
    await act(async () => { buttonNamed(container, /^Save and continue$/).click(); });
    expect(buttonNamed(container, /Saving/).disabled).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('took too long');
    expect(buttonNamed(container, /^Save and continue$/).disabled).toBe(false);
  });

  it('when only the facility fails the company stays saved: retry repeats the facility, and looks before it adds one twice', async () => {
    let attempt = 0;
    serve({
      'POST /api/companies/7/facilities': (call) => {
        attempt += 1;
        // The first answer is lost after the server stored the facility; the retry must not add a second.
        return attempt === 1 ? jsonResponse({ success: false, error: 'Data store temporarily unavailable. Please retry.' }, 503) : jsonResponse({ success: true, data: { id: '3', company_id: '7', ...(call.body as object) } }, 201);
      },
    });
    await mount();
    await fillCompany();
    await setField(byId<HTMLInputElement>('onboarding-facility-name'), 'Main Plant');
    await setField(byId<HTMLSelectElement>('onboarding-facility-type'), 'factory');
    await setField(byId<HTMLInputElement>('onboarding-facility-city'), 'Fresno');
    await press(buttonNamed(container, /^Save and continue$/));

    expect(container.querySelector('h1')?.textContent).toBe('Your company is saved');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Your company was saved, but the facility was not added');
    expect(sent('PATCH', '/api/companies/7')).toHaveLength(1);

    // The retry asks the server what it has: the facility is there already.
    handlers[`GET ${COMPANY_URL}`] = () => jsonResponse(placeholderOverview({ facilities: [{ id: 3, company_id: 7, name: 'Main Plant', type: 'factory', city: 'Fresno' }] }));
    await press(buttonNamed(container, /^Try adding the facility again$/));
    expect(sent('POST', '/api/companies/7/facilities')).toHaveLength(1);
    expect(sent('PATCH', '/api/companies/7')).toHaveLength(1);
    expect(text()).toContain('Dashboard page');
  });

  it('"Continue without a facility" carries on; nothing more is sent', async () => {
    serve({ 'POST /api/companies/7/facilities': () => jsonResponse({ success: false, code: 'upgrade_required', requiredPlan: 'growth', error: 'Your starter plan includes 1 facility. Upgrade to growth to add more.' }, 402) });
    await mount();
    await fillCompany();
    await setField(byId<HTMLInputElement>('onboarding-facility-name'), 'Main Plant');
    await setField(byId<HTMLSelectElement>('onboarding-facility-type'), 'factory');
    await setField(byId<HTMLInputElement>('onboarding-facility-city'), 'Fresno');
    await press(buttonNamed(container, /^Save and continue$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Your starter plan includes 1 facility');

    await press(buttonNamed(container, /^Continue without a facility$/));
    expect(sent('POST', '/api/companies/7/facilities')).toHaveLength(1);
    expect(text()).toContain('Dashboard page');
  });

  it('"Finish later" that cannot be saved says so and keeps the screen', async () => {
    serve({ 'POST /api/companies/7/onboarding/skip': () => jsonResponse({ success: false, error: 'Data store temporarily unavailable. Please retry.' }, 503) });
    await mount();
    await press(buttonNamed(container, /^Finish later$/));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Data store temporarily unavailable');
    expect(container.querySelector('#onboarding-company-name')).not.toBeNull();
  });
});
