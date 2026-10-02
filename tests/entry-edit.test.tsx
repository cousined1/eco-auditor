// K5 (F-B-17): an entry can be edited. Before K5 the list had a delete button and
// nothing else (the audit's eval found editButtons: 0), so correcting a typo meant
// delete and retype, with no record of what changed. The Edit action calls
// PATCH /api/entries/:id (the server recomputes CO2e; the figures in this file are
// fixtures of what it returns, the dialog shows whatever it says; the catalog's own
// arithmetic is asserted in tests/entry-edit-route.test.ts), says what changed, and
// when a signed-off report covers the period it says that the report will not change
// and asks for a confirmation first.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarbonCalculator from '../src/components/carbon-calculator';
import EmissionList from '../src/components/carbon-calculator/EmissionList';
import { describeEntryChange } from '../src/components/carbon-calculator/entryChange';
import type { EmissionEntry } from '../src/components/carbon-calculator/utils';
import { updateEntry } from '../src/lib/entries';
import { buttonNamed, press, setField, settle } from './helpers/form-dom';
import { jsonResponse } from './helpers/company-overview';

const sdk = vi.hoisted(() => ({ getCurrentUser: vi.fn(), from: vi.fn() }));
vi.mock('../src/lib/insforge', () => ({
  insforge: { auth: { getCurrentUser: sdk.getCurrentUser }, database: { from: sdk.from } },
}));
vi.mock('recharts', async () => import('./helpers/recharts-stub'));

const SHA = 'ab'.repeat(32);
const report = (over: Record<string, unknown>) => ({
  id: '11', title: 'Emissions report - Calendar year 2025', status: 'final', period: '2025', period_label: 'Calendar year 2025',
  period_start: '2025-01-01', period_end: '2025-12-31', generated_at: '2026-09-01T10:00:00.000Z', total_tco2e: 6.367,
  by_scope: { scope1: 6.367, scope2: 0, scope3: 0 }, entry_count: 1, pdf_sha256: SHA, signed_off_by: 'user-1',
  signed_off_at: '2026-09-01T11:00:00.000Z', download_url: '/api/reports/11/download', ...over,
});
const reportList = (...reports: Array<Record<string, unknown>>) => ({ success: true, company: { id: '7', name: 'Acme Ltd' }, default_period: '2026', reports });

function entry(over: Partial<EmissionEntry> = {}): EmissionEntry {
  return {
    id: 41, scope: 'Scope 1', category: 'stationary_combustion', source: 'natural_gas', amount: 1200, unit: 'therms',
    factor: '5.306 kg CO2e/therms', method: 'calculation', confidence: 90, facility_id: null, co2e_kg: 6367.2,
    activity_date: '2025-03-15', notes: null, activity_amount: 1200, activity_unit: 'therms', factor_value: 5.306,
    factor_source: 'epa-ghg-hub-2024', catalog_version: '2026-07-24+9841b57be1f6', created_at: '2026-09-30T10:00:00.000Z',
    updated_at: null, ...over,
  };
}
const edited = (over: Partial<EmissionEntry> = {}) =>
  entry({ amount: 1300, activity_amount: 1300, co2e_kg: 6897.8, updated_at: '2026-09-30T12:00:00.000Z', ...over });

const FACILITIES = [{ id: 5, name: 'Fresno Plant', company_id: 7 }, { id: 6, name: 'Reno Office', company_id: 7 }];

type Call = { url: string; method: string; body: unknown };
let container: HTMLDivElement;
let root: Root;
let calls: Call[];
let reports: () => Response | Promise<Response>;
let patch: (call: Call, init: RequestInit | undefined) => Response | Promise<Response>;

const hang = (_call: Call, init: RequestInit | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  calls = [];
  reports = () => jsonResponse(reportList());
  patch = () => jsonResponse({ success: true, data: edited() });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    if (call.method === 'GET' && url === '/api/reports') return reports();
    if (call.method === 'PATCH' && url === '/api/entries/41') return patch(call, init);
    if (url === '/api/billing') return jsonResponse({ active: true, plan: 'growth' });
    if (url === '/api/entries') return jsonResponse({ success: true, data: [edited()] });
    throw new Error(`unexpected request ${call.method} ${url}`);
  }));
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
const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const patches = () => calls.filter((call) => call.method === 'PATCH');
const save = () => buttonNamed(container, /^Save changes$/);
const editButton = () => container.querySelector<HTMLButtonElement>('button[aria-label^="Edit entry"]')!;

async function mountList(entries: EmissionEntry[] = [entry()], withUpdate = true) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <EmissionList
          entries={entries}
          facilities={FACILITIES}
          onDelete={() => {}}
          {...(withUpdate ? { onUpdate: (id: number, p: Parameters<typeof updateEntry>[1]) => updateEntry(id, p) } : {})}
        />
      </MemoryRouter>,
    ),
  );
  await settle();
}

async function openDialog(entries?: EmissionEntry[]) {
  await mountList(entries);
  await press(editButton());
}

describe('the Edit action', () => {
  it('is on every row, and absent when the list cannot save an edit', async () => {
    await mountList([entry(), entry({ id: 42, source: 'propane' })]);
    expect([...container.querySelectorAll('button[aria-label^="Edit entry"]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Edit entry natural_gas', 'Edit entry propane']);

    await mountList([entry()], false);
    expect(container.querySelector('button[aria-label^="Edit entry"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Delete entry"]')).not.toBeNull();
  });

  it('opens a labelled modal dialog on the first field, with the stored activity, and says category and source are fixed', async () => {
    await openDialog();

    const box = dialog()!;
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.getAttribute('aria-labelledby')).toBe('entry-edit-title');
    expect(byId('entry-edit-title').textContent).toBe('Edit entry');
    expect(document.activeElement).toBe(byId('edit-amount'));
    expect(byId<HTMLInputElement>('edit-amount').value).toBe('1200');
    expect(byId<HTMLSelectElement>('edit-unit').value).toBe('therms');
    expect(byId<HTMLInputElement>('edit-date').value).toBe('2025-03-15');
    expect(byId<HTMLSelectElement>('edit-facility').value).toBe('');
    expect(byId('entry-edit-description').textContent).toContain('Scope 1');
    expect(byId('entry-edit-description').textContent).toContain('To change the category or source, add a new entry and delete this one.');
    for (const field of box.querySelectorAll('input:not([type="checkbox"]), select')) {
      expect(box.querySelector(`label[for="${field.id}"]`), field.id).not.toBeNull();
    }
  });

  it('cannot be saved until something changes; Cancel and Escape close it without a request', async () => {
    await openDialog();
    expect(save().disabled).toBe(true);
    await press(buttonNamed(container, /^Cancel$/));
    expect(dialog()).toBeNull();

    await press(editButton());
    await act(async () => { dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(patches()).toEqual([]);
  });

  it('1200 -> 1300 therms: sends the amount with its unit and date, closes, and says what changed', async () => {
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');
    expect(text()).toContain('Estimated:');
    await press(save());

    expect(patches().map((call) => [call.url, call.body])).toEqual([
      ['/api/entries/41', { amount: 1300, unit: 'therms', activity_date: '2025-03-15' }],
    ]);
    expect(dialog()).toBeNull();
    const note = container.querySelector('[role="status"]');
    expect(note?.textContent).toBe('Updated “Natural Gas”: amount 1,200 → 1,300 therms; CO2e 6,367.2 kg → 6,897.8 kg.');
  });

  it('a change of facility is sent as facility_id, and the confirmation names both facilities', async () => {
    patch = () => jsonResponse({ success: true, data: edited({ amount: 1200, activity_amount: 1200, co2e_kg: 6367.2, facility_id: 6 }) });
    await openDialog([entry({ facility_id: 5 })]);
    await setField(byId<HTMLSelectElement>('edit-facility'), '6');
    await press(save());

    expect(patches().map((call) => call.body)).toEqual([{ amount: 1200, unit: 'therms', activity_date: '2025-03-15', facility_id: 6 }]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Updated “Natural Gas”: facility Fresno Plant → Reno Office; CO2e unchanged at 6,367.2 kg.');
  });

  it('marks an entry that was edited, with when', async () => {
    await mountList([entry({ updated_at: '2026-09-30T12:00:00.000Z' }), entry({ id: 42 })]);
    const badges = [...container.querySelectorAll('tbody .badge-gray')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['Edited']);
    expect(badges[0]?.getAttribute('title')).toMatch(/^Last edited /);
  });
});

describe('validation', () => {
  it('needs a positive amount, a unit, and a date that is not in the future', async () => {
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '0');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Amount must be a positive number.');
    expect(save().disabled).toBe(true);

    await setField(byId<HTMLInputElement>('edit-amount'), '1300');
    await setField(byId<HTMLInputElement>('edit-date'), '2999-01-01');
    expect(save().disabled).toBe(true);
    await setField(byId<HTMLInputElement>('edit-date'), '2025-03-15');
    await setField(byId<HTMLSelectElement>('edit-unit'), '');
    expect(save().disabled).toBe(true);
    await setField(byId<HTMLSelectElement>('edit-unit'), 'therms');
    expect(save().disabled).toBe(false);
  });
});

describe('a signed-off report covers the period', () => {
  const WARNING = 'A signed-off report covers this period. Your change will not alter that report; generate a new report afterwards.';

  it('says so, and asks for a confirmation before the change can be saved', async () => {
    reports = () => jsonResponse(reportList(report({})));
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');

    expect(text()).toContain(WARNING);
    expect(save().disabled).toBe(true);
    const confirm = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => { confirm.click(); });
    expect(save().disabled).toBe(false);
    await press(save());

    expect(patches()).toHaveLength(1);
    expect(dialog()).toBeNull();
  });

  it('still asks when the edit moves the entry out of the signed-off period (the report keeps it)', async () => {
    reports = () => jsonResponse(reportList(report({})));
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-date'), '2024-12-31');

    expect(text()).toContain(WARNING);
    expect(save().disabled).toBe(true);
  });

  it('asks when the edit moves the entry INTO a signed-off period', async () => {
    reports = () => jsonResponse(reportList(report({ period: '2024', period_label: 'Calendar year 2024', period_start: '2024-01-01', period_end: '2024-12-31' })));
    await openDialog();
    expect(text()).not.toContain(WARNING);
    await setField(byId<HTMLInputElement>('edit-date'), '2024-06-01');
    expect(text()).toContain(WARNING);
  });

  it('does not warn for a draft report, a legacy report, or a signed-off report of another period', async () => {
    reports = () => jsonResponse(reportList(
      report({ id: '12', status: 'draft', signed_off_by: null, signed_off_at: null }),
      report({ id: '5', status: 'legacy', period_start: null, period_end: null, pdf_sha256: null, download_url: null }),
      report({ id: '10', period: '2024', period_start: '2024-01-01', period_end: '2024-12-31' }),
    ));
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');

    expect(text()).not.toContain(WARNING);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('waits for the check: Save is off, with a status, while the reports load', async () => {
    reports = () => new Promise<Response>(() => {});
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');

    expect(text()).toContain('Checking signed-off reports…');
    expect(save().disabled).toBe(true);
  });

  it('when the check fails it says so without claiming anything false, lets the customer save, and can check again', async () => {
    let failing = true;
    reports = () => (failing ? jsonResponse({ success: false, error: 'Failed to load reports' }, 500) : jsonResponse(reportList(report({}))));
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');

    expect(text()).toContain('We could not check whether a signed-off report covers this period');
    expect(text()).toContain('Reports you already generated do not change when you edit an entry.');
    expect(save().disabled).toBe(false);

    failing = false;
    await press(buttonNamed(container, /^Check again$/));
    expect(text()).toContain(WARNING);
    expect(save().disabled).toBe(true);
  });
});

describe('when the save fails', () => {
  it('shows the server\'s message, keeps the dialog and what was typed, and moves focus to the message', async () => {
    patch = () => jsonResponse({ success: false, error: 'amount must be a number greater than 0.' }, 400);
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');
    await press(save());

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('amount must be a number greater than 0.');
    expect(document.activeElement).toBe(alert);
    expect(dialog()).not.toBeNull();
    expect(byId<HTMLInputElement>('edit-amount').value).toBe('1300');
    expect(save().disabled).toBe(false);
  });

  it('a plan gate (402) is shown as the message it carries', async () => {
    patch = () => jsonResponse({ success: false, code: 'upgrade_required', requiredPlan: 'growth', error: 'Scope 3 workflows are included from the growth plan up.' }, 402);
    await openDialog();
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');
    await press(save());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Scope 3 workflows are included from the growth plan up.');
  });
});

describe('older rows', () => {
  it('a row saved before activity was recorded starts empty (its CO2e was stored as kg), takes its date from when it was recorded, and sends amount, unit and date together', async () => {
    const old = entry({ amount: '6367.2', unit: 'kg CO2e', activity_amount: null, activity_unit: null, activity_date: null, factor_value: null, factor_source: null, created_at: '2025-06-10T09:00:00.000Z' });
    await openDialog([old]);

    expect(byId<HTMLInputElement>('edit-amount').value).toBe('');
    expect(byId<HTMLSelectElement>('edit-unit').value).toBe('');
    expect(byId<HTMLInputElement>('edit-date').value).toBe('2025-06-10');
    expect(text()).toContain('This entry was saved before its amount and unit were recorded.');
    expect(save().disabled).toBe(true);

    await setField(byId<HTMLInputElement>('edit-amount'), '1200');
    await setField(byId<HTMLSelectElement>('edit-unit'), 'therms');
    await press(save());
    expect(patches().map((call) => call.body)).toEqual([{ amount: 1200, unit: 'therms', activity_date: '2025-06-10' }]);
  });

  it('a CSV row holds its activity in amount and unit, so the dialog starts with them', async () => {
    await openDialog([entry({ amount: 500, unit: 'therms', activity_amount: null, activity_unit: null, factor_value: null, factor_source: null })]);
    expect(byId<HTMLInputElement>('edit-amount').value).toBe('500');
    expect(byId<HTMLSelectElement>('edit-unit').value).toBe('therms');
    expect(save().disabled).toBe(false); // the activity was never recorded as such: saving it does that
  });

  it('an entry whose category is not in the catalog cannot be edited, and says what to do instead', async () => {
    await openDialog([entry({ category: 'legacy_label_nobody_knows', source: 'whatever' })]);
    expect(dialog()?.textContent).toContain('This older entry cannot be edited here. Delete it and add it again.');
    expect(container.querySelector('#edit-amount')).toBeNull();
  });
});

describe('describeEntryChange', () => {
  it('names the activity, the date and the facility when they change, and always the CO2e', () => {
    expect(describeEntryChange(entry(), edited({ activity_date: '2025-04-01', facility_id: 6 }), FACILITIES))
      .toBe('Updated “Natural Gas”: amount 1,200 → 1,300 therms; activity date 2025-03-15 → 2025-04-01; facility no facility → Reno Office; CO2e 6,367.2 kg → 6,897.8 kg.');
  });

  it('shows the stored figure to the gram: the server keeps three decimals (1200 x 5.31145 = 6373.74, 1300 x 5.31145 = 6904.885)', () => {
    const before = entry({ factor: '5.31145 kg CO2e/therms', factor_value: 5.31145, co2e_kg: 6373.74 });
    const after = edited({ factor: '5.31145 kg CO2e/therms', factor_value: 5.31145, co2e_kg: 6904.885 });
    expect(describeEntryChange(before, after, FACILITIES)).toBe('Updated “Natural Gas”: amount 1,200 → 1,300 therms; CO2e 6,373.74 kg → 6,904.885 kg.');
  });

  it('names the units on both sides when the unit changes, and says "not recorded" for an activity that was never recorded', () => {
    const old = entry({ activity_amount: null, activity_unit: null, activity_date: null });
    expect(describeEntryChange(old, edited({ amount: 50, activity_amount: 50, activity_unit: 'MMBtu', co2e_kg: 2650 }), FACILITIES))
      .toBe('Updated “Natural Gas”: amount not recorded → 50 MMBtu; activity date not recorded → 2025-03-15; CO2e 6,367.2 kg → 2,650.0 kg.');
  });
});

// The calculator wiring: the edit goes to the server, the list is read again, and
// a request that never answers ends at 15 s inside the dialog.
describe('in the calculator', () => {
  const COMPANY = { id: 7, name: 'Acme Ltd', industry: 'Retail' };

  function useSdk() {
    sdk.from.mockImplementation((table: string) => {
      const result = () => ({ data: table === 'companies' ? COMPANY : [], error: null });
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder,
        maybeSingle: async () => result(), single: async () => result(),
        then: (ok: (value: unknown) => unknown, bad: (error: unknown) => unknown) => Promise.resolve().then(result).then(ok, bad),
      };
      return builder;
    });
  }

  async function mountCalculator(node: ReactNode = <CarbonCalculator />) {
    await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
    await settle();
  }

  beforeEach(() => {
    sdk.getCurrentUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } } });
    sdk.from.mockReset();
    useSdk();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
      calls.push(call);
      if (url === '/api/billing') return jsonResponse({ active: true, plan: 'growth' });
      if (url === '/api/entries' && call.method === 'GET') return jsonResponse({ success: true, data: calls.some((c) => c.method === 'PATCH') ? [edited()] : [entry()] });
      if (url === '/api/reports') return reports();
      if (url === '/api/entries/41' && call.method === 'PATCH') return patch(call, init);
      throw new Error(`unexpected request ${call.method} ${url}`);
    }));
  });

  it('edits through PATCH /api/entries/:id, reads the list again, and shows the new figure and what changed', async () => {
    await mountCalculator();
    expect(text()).toContain('6.4 tCO2e');
    await press(editButton());
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');
    await press(save());

    expect(patches().map((call) => call.url)).toEqual(['/api/entries/41']);
    expect(calls.filter((call) => call.url === '/api/entries' && call.method === 'GET')).toHaveLength(2);
    expect(text()).toContain('6.9 tCO2e');
    expect(text()).toContain('Updated “Natural Gas”: amount 1,200 → 1,300 therms; CO2e 6,367.2 kg → 6,897.8 kg.');
    expect(container.querySelector('tbody .badge-gray')?.textContent).toBe('Edited');
  });

  it('a save that never answers ends at 15 s with an error in the dialog, and the form is usable again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    patch = hang;
    await act(async () => root.render(<MemoryRouter><CarbonCalculator /></MemoryRouter>));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { editButton().click(); });
    await setField(byId<HTMLInputElement>('edit-amount'), '1300');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { save().click(); });
    expect(buttonNamed(container, /Saving/).disabled).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('took too long');
    expect(save().disabled).toBe(false);
  });
});
