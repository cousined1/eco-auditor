// K4 on Data Intake (F-C-06, F-E-04, F-B-16): the CSV format panel and its
// template, the check before import, the explicit Import (with an
// Idempotency-Key a retry reuses), a file imported before, a Windows-1252 file,
// and the import history with Undo, including the signed-off-report warning.
// Before K4 the page had no template or column list, imported a file the moment
// it was picked, and "Uploaded Files" never listed an import.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../emission-factors.json';
import DataIntake from '../src/pages/DataIntake';
import { TEMPLATE_FILENAME, buildCsvTemplate } from '../src/lib/csvTemplate';
import { buttonNamed, press, settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

type Call = { url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const checked = (over: Record<string, unknown> = {}) => ({
  success: true, dry_run: true, total_rows: 2, valid_rows: 2, error_count: 0, errors: [], warnings: [], conversions: [],
  duplicate_of: null, overlapping_rows: 0, tonnes: { scope1: 5.306, scope2: 1.95, scope3: 0, total: 7.256 }, imports_left: 8, can_commit: true, ...over,
});

const record = (over: Record<string, unknown> = {}) => ({
  id: '11', created_at: '2026-09-30T10:00:00.000Z', original_filename: 'a.csv', row_count: 3, warning_count: 0,
  status: 'committed', undone_at: null, rows_present: 3, signed_off_reports: [], ...over,
});

let container: HTMLDivElement;
let root: Root;
let calls: Call[];

/** Stubs fetch with one handler per endpoint and records every call. */
function serve(handlers: { history?: Handler; check?: Handler; commit?: Handler; undo?: Handler }) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    if (call.url.startsWith('/api/ingest/imports') && call.url.endsWith('/undo')) return handlers.undo!(call);
    if (call.url.startsWith('/api/ingest/imports')) return handlers.history ? handlers.history(call) : json({ success: true, data: [] });
    if (call.url.includes('dry_run=1')) return handlers.check!(call);
    return handlers.commit!(call);
  }));
}

const callsTo = (fragment: string) => calls.filter((call) => call.url.includes(fragment));
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];
const text = () => container.textContent ?? '';

async function mount() {
  await act(async () => root.render(<MemoryRouter><DataIntake /></MemoryRouter>));
  await settle();
}

async function upload(file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: { length: 1, item: () => file } });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
}

const csvFile = (name = 'a.csv', body = 'scope,category,source,amount,unit,date\nScope 1,stationary_combustion,natural_gas,1000,therms,2025-11-20\n') =>
  new File([body], name, { type: 'text/csv' });

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

describe('the CSV format panel (F-C-06)', () => {
  it('names the columns, lists every catalog category and source, and downloads the template built in code', async () => {
    serve({});
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { saved.push(blob); return 'blob:template'; });
    URL.revokeObjectURL = vi.fn();
    let downloadName = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloadName = this.download; });
    await mount();

    expect(text()).toContain('Required columns: scope, category, source, amount, unit. Optional: date, facility_name, notes, method, confidence.');
    for (const category of catalog.categories) {
      expect(text()).toContain(category.key);
      for (const source of category.sources) expect(text()).toContain(source.key);
    }
    expect(text()).toContain('therms never become kWh of electricity');

    await press(buttonNamed(container, /^Download template$/));
    expect(downloadName).toBe(TEMPLATE_FILENAME);
    expect(await saved[0]!.text()).toBe(buildCsvTemplate());
  });
});

describe('check first, then import', () => {
  it('a file with errors shows every error, imports nothing and offers no Import', async () => {
    serve({ check: () => json(checked({ valid_rows: 1, error_count: 1, can_commit: false, errors: ['Line 3: amount "0x1F" is not a plain number.'] })) });
    await mount();
    await upload(csvFile());

    expect(text()).toContain('a.csv — 1 error: nothing was imported');
    expect(text()).toContain('Line 3: amount "0x1F" is not a plain number.');
    expect(text()).toContain('Nothing from this file was imported. Fix these rows and upload the file again: each row is counted once.');
    expect([...container.querySelectorAll('button')].some((b) => /^Import /.test(b.textContent ?? ''))).toBe(false);
    expect(callsTo('/api/ingest/csv?filename')).toHaveLength(0);
  });

  it('Import sends the checked text with an Idempotency-Key, then the history reloads', async () => {
    serve({
      check: () => json(checked({ conversions: ['1 row in ccf converted to MCF (x 0.1): line 2'], warnings: ['1 row (line 3) has no date: counted in 2026, the year of the import.'] })),
      commit: () => json({ success: true, replayed: false, imported: 2, total_rows: 2, errors: [], warnings: [], conversions: [], replaced_imports: [], import: record({ row_count: 2 }) }),
    });
    await mount();
    await upload(csvFile());

    expect(text()).toContain('a.csv — ready to import 2 rows');
    expect(text()).toContain('2 of 2 rows valid: 7.3 tCO2e (Scope 1 5.3 tCO2e, Scope 2 2.0 tCO2e).');
    expect(text()).toContain('1 row in ccf converted to MCF (x 0.1): line 2');
    expect(text()).toContain('Importing uses 1 of the 8 imports left this month.');
    expect(callsTo('/api/ingest/imports')).toHaveLength(1);

    await press(buttonNamed(container, /^Import 2 rows$/));
    const [commit] = callsTo('/api/ingest/csv?filename=a.csv');
    expect(commit!.init.body).toBe(callsTo('dry_run=1')[0]!.init.body);
    expect(header(commit!, 'Idempotency-Key')).toMatch(/^[A-Za-z0-9-]{8,}$/);
    expect(text()).toContain('Imported 2 rows from a.csv.');
    expect(text()).toContain('It is listed under Uploaded Files, where it can be undone.');
    expect(callsTo('/api/ingest/imports')).toHaveLength(2);
  });

  it('a file imported before offers "Replace the earlier import" and "Import anyway"', async () => {
    serve({
      check: () => json(checked({ duplicate_of: record(), warnings: ['This file was already imported on 2026-09-30 (3 rows, a.csv). Importing it again counts every row twice.'] })),
      commit: () => json({ success: true, replayed: false, imported: 2, total_rows: 2, errors: [], warnings: [], conversions: [], replaced_imports: ['11'], import: record({ id: '12' }) }),
    });
    await mount();
    await upload(csvFile());

    expect(text()).toContain('a.csv — this file was imported before');
    expect(text()).toContain('This file was already imported on 2026-09-30 (3 rows, a.csv).');
    expect(buttonNamed(container, /^Import anyway$/)).toBeDefined();
    await press(buttonNamed(container, /^Replace the earlier import$/));
    expect(callsTo('on_duplicate=replace')).toHaveLength(1);
    expect(text()).toContain('It replaced the earlier import of this file.');
  });

  it('an import that fails in transit is tried again with the same Idempotency-Key', async () => {
    let attempt = 0;
    serve({
      check: () => json(checked()),
      commit: () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError('Failed to fetch');
        return json({ success: true, replayed: true, imported: 2, total_rows: 2, errors: [], warnings: [], conversions: [], replaced_imports: [], import: record({ row_count: 2 }) });
      },
    });
    await mount();
    await upload(csvFile());
    await press(buttonNamed(container, /^Import 2 rows$/));
    expect(text()).toContain('a.csv — failed: Failed to fetch');

    await press(buttonNamed(container, /^Try again$/));
    const commits = callsTo('/api/ingest/csv?filename=a.csv');
    expect(commits).toHaveLength(2);
    expect(header(commits[1]!, 'Idempotency-Key')).toBe(header(commits[0]!, 'Idempotency-Key'));
    expect(text()).toContain('a.csv was already imported (2 rows).');
  });

  it('a Windows-1252 file is read as Windows-1252, with a note, instead of turning ü into a replacement character (F-B-16)', async () => {
    serve({ check: () => json(checked()) });
    await mount();
    const bytes = new TextEncoder().encode('scope,category,source,amount,unit,notes\nScope 1,stationary_combustion,natural_gas,10,therms,Z?rich\n');
    bytes[bytes.indexOf('?'.charCodeAt(0))] = 0xfc; // "ü" in Windows-1252, invalid alone in UTF-8
    await upload(new File([bytes], 'excel.csv', { type: 'text/csv' }));

    expect(callsTo('dry_run=1')[0]!.init.body).toContain('Zürich');
    expect(text()).toContain('This file is not UTF-8, so it was read as Windows-1252');
  });
});

describe('Uploaded Files: the history and Undo', () => {
  it('lists each import; Undo says what it does, then removes the rows and marks the import undone', async () => {
    serve({
      history: () => json({ success: true, data: [record(), record({ id: '10', original_filename: 'b.csv', status: 'undone', undone_at: '2026-09-29T09:00:00.000Z', rows_present: 0 }), record({ id: '3', original_filename: null, status: 'legacy', warning_count: null })] }),
      undo: () => json({ success: true, removed_rows: 3, import: record({ status: 'undone', undone_at: '2026-09-30T11:00:00.000Z' }) }),
    });
    await mount();

    expect(text()).toContain('a.csv');
    expect(text()).toContain('Imported before import history (cannot be undone here)');
    expect([...container.querySelectorAll('button')].filter((b) => b.textContent === 'Undo')).toHaveLength(1);

    await press(buttonNamed(container, /^Undo$/));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Undo the import of a.csv?');
    expect(dialog.textContent).toContain('Its 3 rows will be removed from your inventory.');
    expect(dialog.textContent).not.toContain('signed-off report');

    await press(buttonNamed(container, /^Undo import$/));
    const [undo] = callsTo('/api/ingest/imports/11/undo');
    expect(JSON.parse(String(undo!.init.body))).toEqual({ confirm_signed_off: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(text()).toContain('Undid the import of a.csv: 3 rows removed.');
    expect(text()).toMatch(/Undone /);
  });

  it('an import inside a signed-off report\'s period is undone only after the warning is confirmed', async () => {
    const report = { id: '4', title: 'Emissions report', period: '2025', period_start: '2025-01-01', period_end: '2025-12-31' };
    serve({
      history: () => json({ success: true, data: [record({ signed_off_reports: [report] })] }),
      undo: () => json({ success: true, removed_rows: 3, import: record({ status: 'undone' }) }),
    });
    await mount();
    await press(buttonNamed(container, /^Undo$/));

    // VF-12: the required sentence is kept exactly (the API sends the same words); the report names follow it as their own clause.
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain(
      'This import falls in a period with a signed-off report. Undoing it will not change that report; generate a new report afterwards. The signed-off report is report 4 (2025-01-01 to 2025-12-31).',
    );
    await press(buttonNamed(container, /^Undo import$/));
    expect(JSON.parse(String(callsTo('/undo')[0]!.init.body))).toEqual({ confirm_signed_off: true });
  });

  it('with two signed-off reports the sentence is the same and the names follow it as a list (VF-12)', async () => {
    const first = { id: '4', title: 'Emissions report', period: '2025', period_start: '2025-01-01', period_end: '2025-12-31' };
    const second = { id: '6', title: 'Emissions report', period: '2024', period_start: '2024-01-01', period_end: '2024-12-31' };
    serve({ history: () => json({ success: true, data: [record({ signed_off_reports: [first, second] })] }) });
    await mount();
    await press(buttonNamed(container, /^Undo$/));

    const dialog = container.querySelector('[role="dialog"]')!.textContent ?? '';
    expect(dialog).toContain('This import falls in a period with a signed-off report. Undoing it will not change that report; generate a new report afterwards.');
    expect(dialog).toContain('The signed-off reports are report 4 (2025-01-01 to 2025-12-31), report 6 (2024-01-01 to 2024-12-31).');
    expect(dialog).not.toContain('signed-off report (');
  });

  it('a report signed off after the list loaded: the server\'s refusal shows the warning, and a second confirm goes through', async () => {
    const report = { id: '5', title: null, period: '2025', period_start: '2025-01-01', period_end: '2025-12-31' };
    let attempt = 0;
    serve({
      history: () => json({ success: true, data: [record()] }),
      undo: () => (++attempt === 1
        ? json({ success: false, code: 'signed_off_report', error: 'This import falls in a period with a signed-off report.', reports: [report] }, 409)
        : json({ success: true, removed_rows: 3, import: record({ status: 'undone' }) })),
    });
    await mount();
    await press(buttonNamed(container, /^Undo$/));
    await press(buttonNamed(container, /^Undo import$/));

    expect(container.querySelector('[role="dialog"]')!.textContent).toContain(
      'This import falls in a period with a signed-off report. Undoing it will not change that report; generate a new report afterwards. The signed-off report is report 5 (2025-01-01 to 2025-12-31).',
    );
    await press(buttonNamed(container, /^Undo import$/));
    expect(callsTo('/undo').map((call) => JSON.parse(String(call.init.body)))).toEqual([{ confirm_signed_off: false }, { confirm_signed_off: true }]);
    expect(text()).toContain('Undid the import of a.csv: 3 rows removed.');
  });

  it('a history that cannot load says so and offers Try again', async () => {
    let attempt = 0;
    serve({ history: () => (++attempt === 1 ? json({ success: false, error: 'Data store temporarily unavailable. Please retry.' }, 503) : json({ success: true, data: [] })) });
    await mount();

    expect(text()).toContain('Data store temporarily unavailable. Please retry.');
    await press(buttonNamed(container, /^Try again$/));
    expect(text()).toContain('No imports yet.');
  });
});
