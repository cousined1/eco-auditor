// F-C-16 (the hidden file input was an invisible focus stop) and F-C-25 (an expired upload
// said the same thing three times; "error(s)") on Data Intake. Since K4 an upload is
// checked first (a dry run) and imported by an explicit Import; these tests follow
// that flow. The flows themselves are in tests/data-intake-import.test.tsx.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataIntake from '../src/pages/DataIntake';
import { buttonNamed, press, settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

const PLAN_MESSAGE = 'An active subscription is required for this feature';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const gated = () => json({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: PLAN_MESSAGE }, 402);

/** A dry-run answer (POST /api/ingest/csv?dry_run=1). */
const checked = (over: Record<string, unknown> = {}) =>
  json({
    success: true, dry_run: true, total_rows: 1, valid_rows: 1, error_count: 0, errors: [], warnings: [], conversions: [],
    duplicate_of: null, overlapping_rows: 0, tonnes: { scope1: 0.05, scope2: 0, scope3: 0, total: 0.05 }, imports_left: 9, can_commit: true, ...over,
  });

const committed = (rows: number) =>
  json({ success: true, replayed: false, imported: rows, total_rows: rows, errors: [], warnings: [], conversions: [], replaced_imports: [], import: { id: '1', status: 'committed', row_count: rows } });

/** Routes the page's requests: the import history, the dry run, the commit. */
function server(handlers: { check: () => Response; commit?: () => Response; history?: () => Response }) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/ingest/imports')) return handlers.history ? handlers.history() : json({ success: true, data: [] });
    if (String(url).includes('dry_run=1')) return handlers.check();
    return (handlers.commit ?? (() => committed(1)))();
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // UpgradePrompt links to /app/pricing, so the page needs a router.
  await act(async () =>
    root.render(
      <MemoryRouter>
        <DataIntake />
      </MemoryRouter>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? '';
const occurrences = (needle: string) => text().split(needle).length - 1;
const fileInput = () => container.querySelector('input[type="file"]') as HTMLInputElement;

async function upload(names: string[]) {
  const files = names.map((name) => new File(['scope,amount\n1,10'], name, { type: 'text/csv' }));
  Object.defineProperty(fileInput(), 'files', {
    configurable: true,
    value: { length: files.length, item: (i: number) => files[i] ?? null },
  });
  await act(async () => fileInput().dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
}

describe('the hidden file input (F-C-16)', () => {
  it('is out of the tab order and hidden from assistive technology', () => {
    const input = fileInput();

    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.classList.contains('sr-only')).toBe(true);
  });

  it('leaves "Upload Files" as the first thing keyboard focus reaches, and the button still opens the picker', async () => {
    const focusable = [...container.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]')].filter(
      (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled'),
    );
    expect(focusable[0]?.textContent).toBe('Upload Files');

    const openPicker = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
    await act(async () => (focusable[0] as HTMLButtonElement).click());
    expect(openPicker).toHaveBeenCalledTimes(1);
  });
});

describe('an upload refused by the plan gate (F-C-25)', () => {
  it('says so once: the plan notice, with no results list and no error banner repeating it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gated()));

    await upload(['emissions.csv']);

    expect(occurrences(PLAN_MESSAGE)).toBe(1);
    expect(text()).toContain('CSV import requires an active plan');
    expect(text()).not.toContain('Upload results');
    expect(text()).not.toContain('did not import');
    // Announced on its own, since nothing else on screen reports the refusal.
    expect(container.querySelector('[role="alert"] [role="region"]')?.textContent).toContain(PLAN_MESSAGE);
    // Its title sits directly under the page's h1 (it was an h4).
    expect(container.querySelector('[role="alert"] h2')?.textContent).toBe('CSV import requires an active plan');
    expect(container.querySelector('h4')).toBeNull();
  });

  it('in a mixed batch still lists every file, but keeps the server\'s reason to the plan notice', async () => {
    let call = 0;
    vi.stubGlobal('fetch', server({ check: () => (++call === 1 ? checked() : gated()) }));

    await upload(['ok.csv', 'refused.csv']);

    expect(text()).toContain('Upload results');
    expect(text()).toContain('ok.csv — ready to import 1 row');
    expect(text()).toContain('refused.csv');
    expect(text()).toContain('blocked by your plan — see the notice below');
    expect(occurrences(PLAN_MESSAGE)).toBe(1);
  });

  it('a later batch that checks and imports cleanly clears the plan notice', async () => {
    let refuse = true;
    vi.stubGlobal('fetch', server({ check: () => (refuse ? gated() : checked()) }));

    await upload(['emissions.csv']);
    expect(text()).toContain('CSV import requires an active plan');

    refuse = false;
    await upload(['emissions.csv']);
    expect(text()).not.toContain('CSV import requires an active plan');
    await press(buttonNamed(container, /^Import 1 row$/));
    expect(text()).toContain('Imported 1 row from emissions.csv.');
  });
});

describe('counts read correctly (F-C-25)', () => {
  it('"1 error", "2 warnings", not "error(s)"', async () => {
    vi.stubGlobal(
      'fetch',
      server({ check: () => checked({ total_rows: 3, valid_rows: 2, error_count: 1, errors: ['Line 4: bad unit.'], warnings: ['Line 2: estimated.', 'Line 3: estimated.'], can_commit: false }) }),
    );

    await upload(['emissions.csv']);

    const badges = [...container.querySelectorAll('.badge-amber')].map((badge) => badge.textContent);
    expect(badges).toEqual(['1 error', '2 warnings']);
    expect(text()).not.toContain('(s)');
  });

  it('says "1 row" and "2 rows" in the import banner', async () => {
    let rows = 1;
    vi.stubGlobal('fetch', server({ check: () => checked({ total_rows: rows, valid_rows: rows }), commit: () => committed(rows) }));

    await upload(['a.csv']);
    await press(buttonNamed(container, /^Import 1 row$/));
    expect(text()).toContain('Imported 1 row from a.csv.');

    rows = 2;
    await upload(['b.csv']);
    await press(buttonNamed(container, /^Import 2 rows$/));
    expect(text()).toContain('Imported 2 rows from b.csv.');
  });
});
