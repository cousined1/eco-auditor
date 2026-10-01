// K5 (F-B-03 = F-C-03): Settings > Company and Facilities. Before K5 no screen
// renamed the company or added a facility (Settings held billing and data only), so
// the company kept the server's "<email-prefix> Organization", CSV facility names
// never matched, and the advertised facility limits could not be reached. Every
// request goes through apiFetch (mocked fetch); the server side is
// tests/company-onboarding-route.test.ts.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CompanySection from '../src/components/settings/CompanySection';
import { buttonNamed, press, setField, settle } from './helpers/form-dom';
import { COMPANY_URL, companyOverview, jsonResponse } from './helpers/company-overview';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

type Call = { url: string; method: string; body: unknown };
type Handler = (call: Call, init: RequestInit | undefined) => Response | Promise<Response>;

const PLANT = { id: 3, company_id: 7, name: 'Plant A', type: 'factory' as const, city: 'Fresno' };
const UPGRADE_402 = { success: false, code: 'upgrade_required', requiredPlan: 'growth', error: 'Your starter plan includes 1 facility. Upgrade to growth to add more.' };

let container: HTMLDivElement;
let root: Root;
let calls: Call[];
let handlers: Record<string, Handler>;
let overview: ReturnType<typeof companyOverview>;

function serve(overrides: Record<string, Handler> = {}) {
  handlers = {
    [`GET ${COMPANY_URL}`]: () => jsonResponse(overview),
    'PATCH /api/companies/7': (call) => jsonResponse({
      success: true,
      data: { ...overview.company, ...(call.body as object) },
      onboarding: { needs_onboarding: false, auto_provisioned: true, completed_at: '2026-09-30T12:00:00.000Z', skipped_at: null },
    }),
    'POST /api/companies/7/facilities': (call) => jsonResponse({ success: true, data: { id: '9', company_id: '7', ...(call.body as object) } }, 201),
    'PATCH /api/companies/7/facilities/3': (call) => jsonResponse({ success: true, data: { ...PLANT, ...(call.body as object) } }),
    'DELETE /api/companies/7/facilities/3': () => jsonResponse({ success: true, deleted: 1 }),
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

const hang: Handler = (_call, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls = [];
  overview = companyOverview({ company: { name: 'ada Organization', industry: 'other' }, checklist: { company_named: false } });
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
const saveCompany = () => buttonNamed(container, /^Save company$/);

async function mount() {
  await act(async () => root.render(<MemoryRouter><CompanySection /></MemoryRouter>));
  await settle();
}

describe('the states of the section', () => {
  it('shows a loading status first', async () => {
    serve({ [`GET ${COMPANY_URL}`]: hang });
    await mount();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading company');
  });

  it('says so when the company cannot be loaded, and Try Again brings the cards back', async () => {
    let failing = true;
    serve({ [`GET ${COMPANY_URL}`]: () => (failing ? jsonResponse({ success: false, error: 'Data store temporarily unavailable. Please retry.' }, 503) : jsonResponse(overview)) });
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Data store temporarily unavailable');

    failing = false;
    await press(buttonNamed(container, /^Try Again$/));
    expect(container.querySelector('h2')?.textContent).toBe('Company');
    expect(byId<HTMLInputElement>('settings-company-name').value).toBe('ada Organization');
  });

  it('gives up after 15 s with an error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serve({ [`GET ${COMPANY_URL}`]: hang });
    await act(async () => root.render(<MemoryRouter><CompanySection /></MemoryRouter>));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('took too long');
  });

  it('after the trial, says the plan is paused, offers plans, and does not pretend the data is gone', async () => {
    serve({ [`GET ${COMPANY_URL}`]: () => jsonResponse({ success: false, code: 'upgrade_required', requiredPlan: 'starter', reason: 'trial_expired', trialEndedAt: '2026-09-01T00:00:00Z', error: 'Your trial has ended.' }, 402) });
    await mount();

    expect(container.querySelector('[aria-label="Trial ended"]')).not.toBeNull();
    expect(text()).toContain('Your data is not removed');
    expect(container.querySelector('#settings-company-name')).toBeNull();
  });
});

describe('Company', () => {
  it('shows the stored company: the placeholder name, the industry ("other" reads as Other), and the reporting basis', async () => {
    overview = companyOverview({ company: { name: 'ada Organization', industry: 'other', consolidation_approach: 'financial_control', base_year: 2019 } });
    serve();
    await mount();

    expect(byId<HTMLInputElement>('settings-company-name').value).toBe('ada Organization');
    expect(byId<HTMLSelectElement>('settings-industry').value).toBe('Other');
    expect(byId<HTMLSelectElement>('settings-consolidation').value).toBe('financial_control');
    expect(byId<HTMLInputElement>('settings-base-year').value).toBe('2019');
    expect(saveCompany().disabled).toBe(true); // nothing changed yet
  });

  it('renames the company and sends only what changed; the section shows the saved name and says what reports do with it', async () => {
    serve();
    await mount();
    await setField(byId<HTMLInputElement>('settings-company-name'), '  Northstar Foods ');
    await setField(byId<HTMLSelectElement>('settings-consolidation'), 'operational_control');
    await setField(byId<HTMLInputElement>('settings-base-year'), '2022');
    expect(saveCompany().disabled).toBe(false);
    await press(saveCompany());

    expect(sent('PATCH', '/api/companies/7').map((call) => call.body)).toEqual([
      { name: 'Northstar Foods', consolidation_approach: 'operational_control', base_year: 2022 },
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('reports you already generated are not changed');
    expect(saveCompany().disabled).toBe(true);
    expect(byId<HTMLInputElement>('settings-company-name').value).toBe('Northstar Foods');
  });

  it('can clear the industry and the base year', async () => {
    overview = companyOverview({ company: { industry: 'Healthcare', base_year: 2019 } });
    serve();
    await mount();
    await setField(byId<HTMLSelectElement>('settings-industry'), '');
    await setField(byId<HTMLInputElement>('settings-base-year'), '');
    await press(saveCompany());

    expect(sent('PATCH', '/api/companies/7').map((call) => call.body)).toEqual([{ industry: null, base_year: null }]);
  });

  it('explains the reporting basis: what each is, and what a report prints until it is set', async () => {
    serve();
    await mount();

    expect(byId('settings-consolidation-hint').textContent).toContain('GHG Protocol');
    expect(byId('settings-consolidation-hint').textContent).toContain('Reports will say “not specified” until you choose an approach.');
    expect(byId('settings-base-year-hint').textContent).toContain('“not set”');
  });

  it('refuses a blank name and an impossible base year before asking the server', async () => {
    serve();
    await mount();
    await setField(byId<HTMLInputElement>('settings-company-name'), '   ');
    await press(saveCompany());
    expect(byId('settings-company-name-error').textContent).toBe('Enter your company name.');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Check the highlighted fields.');

    await setField(byId<HTMLInputElement>('settings-company-name'), 'Northstar Foods');
    await setField(byId<HTMLInputElement>('settings-base-year'), '2999');
    await press(saveCompany());
    expect(byId('settings-base-year-error').textContent).toMatch(/Enter a year from 1990 to \d{4}/);
    expect(sent('PATCH', '/api/companies/7')).toEqual([]);
  });

  it('shows the server\'s refusal, keeps what was typed, and moves focus to the message', async () => {
    serve({ 'PATCH /api/companies/7': () => jsonResponse({ success: false, error: 'industry must be one of: Agriculture & Food, Construction, or empty.' }, 400) });
    await mount();
    await setField(byId<HTMLInputElement>('settings-company-name'), 'Northstar Foods');
    await press(saveCompany());

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('industry must be one of');
    expect(document.activeElement).toBe(alert);
    expect(byId<HTMLInputElement>('settings-company-name').value).toBe('Northstar Foods');
    expect(saveCompany().disabled).toBe(false);
  });
});

describe('Facilities', () => {
  it('lists them with their type and city, and says how many the plan allows', async () => {
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve();
    await mount();

    expect(text()).toContain('Plant A');
    expect(text()).toContain('Factory · Fresno');
    expect(text()).toContain('1 of 5 facilities used on the Growth plan');
  });

  it('with none, says so and shows the add form, which starts empty', async () => {
    serve();
    await mount();

    expect(text()).toContain('No facilities yet');
    expect(text()).toContain('0 of 1 facility used on the Starter plan');
    expect(byId<HTMLInputElement>('new-facility-name').value).toBe('');
  });

  it('adds a facility through the API and lists it, with a notice', async () => {
    serve();
    await mount();
    await setField(byId<HTMLInputElement>('new-facility-name'), ' Main Plant ');
    await setField(byId<HTMLSelectElement>('new-facility-type'), 'factory');
    await setField(byId<HTMLInputElement>('new-facility-city'), 'Fresno');
    await press(buttonNamed(container, /^Add facility$/));

    expect(sent('POST', '/api/companies/7/facilities').map((call) => call.body)).toEqual([{ name: 'Main Plant', type: 'factory', city: 'Fresno' }]);
    expect(text()).toContain('Main Plant');
    expect(container.querySelector('#facilities-settings [role="status"]')?.textContent).toBe('Facility “Main Plant” added.');
    // The plan allows one: the add form gives way to the upgrade prompt.
    expect(container.querySelector('#new-facility-name')).toBeNull();
    expect(container.querySelector('[aria-label="Upgrade required"]')?.textContent).toContain('Your Starter plan includes 1 facility');
  });

  it('at the plan cap shows the upgrade prompt instead of the form, naming the plan that raises it', async () => {
    overview = companyOverview({ facilities: [PLANT] });
    serve();
    await mount();

    const prompt = container.querySelector('[aria-label="Upgrade required"]');
    expect(prompt?.textContent).toContain('More facilities');
    expect(prompt?.textContent).toContain('Upgrade to Growth');
    expect(container.querySelector('#new-facility-name')).toBeNull();
  });

  it('a 402 from the server (another tab filled the last slot) becomes the upgrade prompt with the server\'s words', async () => {
    serve({ 'POST /api/companies/7/facilities': () => jsonResponse(UPGRADE_402, 402) });
    await mount();
    await setField(byId<HTMLInputElement>('new-facility-name'), 'Main Plant');
    await setField(byId<HTMLSelectElement>('new-facility-type'), 'office');
    await setField(byId<HTMLInputElement>('new-facility-city'), 'Reno');
    await press(buttonNamed(container, /^Add facility$/));

    expect(container.querySelector('[aria-label="Upgrade required"]')?.textContent).toContain('Your starter plan includes 1 facility. Upgrade to growth to add more.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('needs a name, a type and a city before it asks the server', async () => {
    serve();
    await mount();
    await press(buttonNamed(container, /^Add facility$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter the facility name.');
    await setField(byId<HTMLInputElement>('new-facility-name'), 'Main Plant');
    await press(buttonNamed(container, /^Add facility$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Choose the facility type.');
    await setField(byId<HTMLSelectElement>('new-facility-type'), 'office');
    await press(buttonNamed(container, /^Add facility$/));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter the city.');
    expect(sent('POST', '/api/companies/7/facilities')).toEqual([]);
  });

  it('renames a facility in place: prefilled, saved through PATCH, listed under its new name', async () => {
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve();
    await mount();
    await press(container.querySelector<HTMLButtonElement>('button[aria-label="Edit facility Plant A"]')!);

    expect(byId<HTMLInputElement>('facility-3-name').value).toBe('Plant A');
    expect(byId<HTMLSelectElement>('facility-3-type').value).toBe('factory');
    await setField(byId<HTMLInputElement>('facility-3-name'), 'Fresno Plant');
    await press(buttonNamed(container, /^Save facility$/));

    expect(sent('PATCH', '/api/companies/7/facilities/3').map((call) => call.body)).toEqual([{ name: 'Fresno Plant', type: 'factory', city: 'Fresno' }]);
    expect(text()).toContain('Fresno Plant');
    expect(text()).not.toContain('Plant A');
    expect(container.querySelector('#facilities-settings [role="status"]')?.textContent).toBe('Facility “Fresno Plant” saved.');
  });

  it('Cancel leaves the facility as it was and sends nothing', async () => {
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve();
    await mount();
    await press(container.querySelector<HTMLButtonElement>('button[aria-label="Edit facility Plant A"]')!);
    await setField(byId<HTMLInputElement>('facility-3-name'), 'Changed');
    await press(buttonNamed(container, /^Cancel$/));

    expect(text()).toContain('Plant A');
    expect(sent('PATCH', '/api/companies/7/facilities/3')).toEqual([]);
  });

  it('deletes after a confirmation; declining the confirmation sends nothing', async () => {
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve();
    await mount();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await press(container.querySelector<HTMLButtonElement>('button[aria-label="Delete facility Plant A"]')!);
    expect(sent('DELETE', '/api/companies/7/facilities/3')).toEqual([]);

    confirm.mockReturnValue(true);
    await press(container.querySelector<HTMLButtonElement>('button[aria-label="Delete facility Plant A"]')!);
    expect(sent('DELETE', '/api/companies/7/facilities/3')).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Delete facility Plant A"]')).toBeNull();
    expect(text()).toContain('No facilities yet');
    expect(container.querySelector('#facilities-settings [role="status"]')?.textContent).toBe('Facility “Plant A” deleted.');
  });

  it('a facility that entries still point at stays, with the server\'s message and a way to the entries', async () => {
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve({ 'DELETE /api/companies/7/facilities/3': () => jsonResponse({ success: false, code: 'facility_has_entries', entry_count: 2, error: 'This facility has 2 emission entries. Change the facility on those entries, or delete them, before deleting the facility.' }, 409) });
    await mount();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await press(container.querySelector<HTMLButtonElement>('button[aria-label="Delete facility Plant A"]')!);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('This facility has 2 emission entries.');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/app/calculator');
    expect(text()).toContain('Plant A');
  });

  it('a save that never answers ends at 15 s with an error and the row still editable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve({ 'PATCH /api/companies/7/facilities/3': hang });
    await act(async () => root.render(<MemoryRouter><CompanySection /></MemoryRouter>));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Edit facility Plant A"]')!.click(); });
    await setField(byId<HTMLInputElement>('facility-3-name'), 'Fresno Plant');
    await act(async () => { buttonNamed(container, /^Save facility$/).click(); });
    expect(buttonNamed(container, /Saving/).disabled).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('took too long');
    expect(buttonNamed(container, /^Save facility$/).disabled).toBe(false);
  });

  it('labels every control, so nothing relies on a placeholder', async () => {
    overview = companyOverview({ facilities: [PLANT], plan: { id: 'growth', facility_limit: 5 } });
    serve();
    await mount();
    for (const field of container.querySelectorAll('input, select')) {
      expect(container.querySelector(`label[for="${field.id}"]`), field.id).not.toBeNull();
    }
    expect(container.querySelector('button[aria-label="Edit facility Plant A"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Delete facility Plant A"]')).not.toBeNull();
  });
});
