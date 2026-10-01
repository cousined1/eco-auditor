// F-C-15: status and error messages in the app were silent to assistive
// technology ("Report generated and downloaded.", a saved entry, the CSV
// warnings), and a saved entry dropped focus to <body>. Each of these now
// carries a live-region role, and "Add Entry" returns focus to the form.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmissionForm from '../src/components/carbon-calculator/EmissionForm';
import ReportGenerator from '../src/components/carbon-calculator/ReportGenerator';
import {
  categoriesForScope,
  sourcesForCategory,
  unitsForSource,
  type EmissionEntry,
} from '../src/components/carbon-calculator/utils';
import DataIntake from '../src/pages/DataIntake';
import { buttonNamed, press, setField, settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
const live = (selector: string) => container.querySelector<HTMLElement>(selector);

describe('Generate PDF status (ReportGenerator)', () => {
  const company = { id: 7, name: 'Acme Ltd', industry: 'Retail' };
  const entries = [{ id: 1 }] as unknown as EmissionEntry[];

  beforeEach(async () => {
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
    // jsdom cannot navigate to the blob URL the download link points at.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => root.render(<ReportGenerator company={company} entries={entries} />));
  });

  it('announces a finished report politely, as a status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/reports/generate')
          ? json({ success: true, report_id: 'r1', download_url: '/api/reports/r1/download' })
          : new Response(new Blob(['%PDF']), { status: 200 }),
      ),
    );
    await press(buttonNamed(container, /^Generate PDF$/));

    const status = live('[role="status"]');
    expect(status?.textContent).toBe('Report generated and downloaded.');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(live('[role="alert"]')).toBeNull();
  });

  it('announces a failure at once, as an alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: 'Report builder is down' }, 500)));
    await press(buttonNamed(container, /^Generate PDF$/));

    const alert = live('[role="alert"]');
    expect(alert?.textContent).toBe('Error: Report builder is down');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    expect(live('[role="status"]')).toBeNull();
  });

  it('announces the plan requirement as a status (it is a notice, not a fault)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ success: false, code: 'upgrade_required', requiredPlan: 'starter' }, 402)),
    );
    await press(buttonNamed(container, /^Generate PDF$/));

    expect(live('[role="status"]')?.textContent).toContain('Reports require an active plan');
  });
});

describe('Add Entry (EmissionForm)', () => {
  const category = categoriesForScope('Scope 1')[0]!.key;
  const source = sourcesForCategory(category)[0]!.key;
  const unit = unitsForSource(category, source)[0]!;
  const byId = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const onSubmit = vi.fn();

  async function fillAndSubmit() {
    await setField(byId<HTMLSelectElement>('category'), category);
    await setField(byId<HTMLSelectElement>('source'), source);
    await setField(byId<HTMLSelectElement>('unit'), unit);
    await setField(byId<HTMLInputElement>('amount'), '100');
    // Required since F-E-05: the activity date decides the reporting year.
    await setField(byId<HTMLInputElement>('activity-date'), '2025-06-30');
    await press(buttonNamed(container, /^Add Entry$/));
  }

  beforeEach(async () => {
    onSubmit.mockReset().mockResolvedValue(undefined);
    await act(async () => root.render(<EmissionForm facilities={[]} onSubmit={onSubmit} />));
  });

  it('says the entry was added, with its size, and puts focus back on the first field', async () => {
    await fillAndSubmit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const status = live('[role="status"]');
    expect(status?.textContent).toMatch(/^Entry added — [\d,.]+ (kg CO2e|tCO2e)$/);
    expect(status?.getAttribute('aria-live')).toBe('polite');
    // The button disabled itself as the form emptied; focus must not be left on <body>.
    expect(document.activeElement).toBe(byId('scope'));
    expect(byId<HTMLInputElement>('amount').value).toBe('');
  });

  it('says nothing about success, and keeps the error as an alert, when the save fails', async () => {
    onSubmit.mockRejectedValue(new Error('Row level security violation'));
    await fillAndSubmit();

    expect(live('[role="alert"]')?.textContent).toBe('Row level security violation');
    expect(live('[role="status"]')).toBeNull();
    expect(text()).not.toContain('Entry added');
  });

  it('drops the previous "Entry added" message as soon as the next save starts', async () => {
    await fillAndSubmit();
    expect(live('[role="status"]')).not.toBeNull();

    let finish!: () => void;
    onSubmit.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await fillAndSubmit();
    expect(live('[role="status"]')).toBeNull();

    await act(async () => finish());
    await settle();
    expect(live('[role="status"]')).not.toBeNull();
  });
});

describe('CSV import result (DataIntake)', () => {
  const upload = async (name: string) => {
    const file = new File(['scope,amount\n1,10'], name, { type: 'text/csv' });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: { length: 1, item: () => file } });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await settle();
  };

  it('announces the check of the file, with its errors and warnings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).startsWith('/api/ingest/imports')
          ? json({ success: true, data: [] })
          : json({ success: true, dry_run: true, total_rows: 3, valid_rows: 2, error_count: 1, errors: ['Line 4: bad unit.'], warnings: ['Line 2: estimated.'], conversions: [], can_commit: false }),
      ),
    );
    await act(async () =>
      root.render(
        <MemoryRouter>
          <DataIntake />
        </MemoryRouter>,
      ),
    );
    await upload('emissions.csv');

    const card = [...container.querySelectorAll<HTMLElement>('[role="status"]')].find((el) =>
      el.textContent?.includes('Upload results'),
    );
    expect(card, 'the results card must be a live region').toBeDefined();
    expect(card?.getAttribute('aria-live')).toBe('polite');
    expect(card?.textContent).toContain('Line 4: bad unit.');
    expect(card?.textContent).toContain('Line 2: estimated.');
  });
});
