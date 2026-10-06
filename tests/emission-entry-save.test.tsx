/**
 * Carbon calculator entry-save regressions.
 *
 * A successful INSERT followed by a failed re-read was reported to the user as
 * "Failed to add emission entry". The form keeps its values on a thrown error,
 * so pressing "Add Entry" again wrote a second row for the same activity —
 * silently inflating every downstream number (dashboard pie/bar, totals, PDF)
 * in a product whose output is an audit artifact.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarbonCalculator from '../src/components/carbon-calculator/index';

const databaseFrom = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/insforge', () => ({
  insforge: {
    getHttpClient: () => ({ getHeaders: () => ({ Authorization: 'Bearer user-fixture' }) }),
    auth: { getCurrentUser: async () => ({ data: { user: { id: 'user-fixture' } }, error: null }) },
    database: { from: databaseFrom },
  },
}));

let root: Root | undefined;
let container: HTMLDivElement;

async function mount(element: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter>{element}</MemoryRouter>));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  databaseFrom.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Opts = { entriesError?: unknown; rows?: unknown[] };

/** Wires the query-builder mock for auth -> company -> facilities -> entries. */
function stubDatabase({ entriesError = null, rows = [] }: Opts = {}) {
  const insert = vi.fn().mockResolvedValue({ data: [], error: null });
  // The calculator reads entries once at startup and again after every save.
  // `entriesError` must only break the *refresh* — failing the first read too
  // would render the "unable to load" card instead of the form.
  let reads = 0;

  databaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'companies':
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 7, name: 'Northstar Foods', user_id: 'user-fixture' },
                error: null,
              }),
            }),
          }),
        };
      case 'facilities':
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      case 'emission_entries': {
        // handleSubmit calls .from(...).insert([...]) directly; loadEntries
        // calls .from(...).select().eq().order(). Both start at this object.
        const chain: Record<string, unknown> = {
          eq: () => chain,
          order: async () => {
            reads += 1;
            const fail = entriesError && reads > 1;
            return fail ? { data: null, error: entriesError } : { data: rows, error: null };
          },
        };
        return { select: () => chain, insert };
      }
      default:
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    }
  });

  return { insert };
}

/** The calculator renders its form only after auth + company + facilities load. */
async function waitFor(selector: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (container.querySelector(selector)) return;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

const setSelect = async (id: string, value: string) => {
  const el = container.querySelector<HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const firstOptionValue = (id: string) =>
  container.querySelector<HTMLSelectElement>(`#${id}`)?.options[1]?.value;

/** Drives the real form: scope -> category -> source -> unit -> amount -> submit. */
async function fillAndSubmit() {
  await waitFor('form #scope');
  await setSelect('scope', 'Scope 1');
  const category = firstOptionValue('category');
  if (category) await setSelect('category', category);
  const source = firstOptionValue('source');
  if (source) await setSelect('source', source);
  const unit = firstOptionValue('unit');
  if (unit) await setSelect('unit', unit);

  const amount = container.querySelector<HTMLInputElement>('#amount')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '100');
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

const formAlert = () => container.querySelector('form [role="alert"]')?.textContent ?? '';
const statusText = () =>
  [...container.querySelectorAll('[role="status"]')].map((n) => n.textContent).join(' ');

describe('emission entry save regressions', () => {
  it('does not report a failed save when only the list refresh fails', async () => {
    const { insert } = stubDatabase({ entriesError: { message: 'Upstream 503' } });
    await mount(<CarbonCalculator />);
    await fillAndSubmit();

    // The row really was written...
    expect(insert).toHaveBeenCalledTimes(1);

    // ...so the form must not claim the save failed, and must not leave the
    // entered values sitting there inviting a duplicate submission.
    expect(formAlert()).not.toMatch(/failed to add/i);
    expect(container.querySelector<HTMLInputElement>('#amount')!.value).toBe('');

    // The refresh problem is surfaced separately and warns against re-adding.
    expect(statusText()).toMatch(/saved/i);
    expect(statusText()).toMatch(/could not be refreshed/i);
  });

  it('clears the form after a successful save so the same entry cannot be added twice', async () => {
    const { insert } = stubDatabase({ rows: [] });
    await mount(<CarbonCalculator />);
    await fillAndSubmit();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('#amount')!.value).toBe('');
  });

  it('still surfaces a genuine insert failure and keeps the form populated', async () => {
    const { insert } = stubDatabase({ rows: [] });
    await mount(<CarbonCalculator />);
    await fillAndSubmit();
    expect(insert).toHaveBeenCalledTimes(1);

    // Make the insert itself fail, then resubmit the same values.
    insert.mockResolvedValue({ data: null, error: { message: 'Row rejected by RLS' } });
    await fillAndSubmit();

    expect(formAlert()).toMatch(/row rejected by rls/i);
    // Values retained so the customer can correct and resubmit, not re-key.
    expect(container.querySelector<HTMLInputElement>('#amount')!.value).not.toBe('');
  });

  it('names a destructive delete with the row label, not the raw catalog key', async () => {
    stubDatabase({
      rows: [
        {
          id: 1,
          scope: 'scope1',
          category: 'stationary_combustion',
          source: 'natural_gas',
          amount: 1000,
          co2e_kg: 1000,
          unit: 'kg CO2e',
          facility_id: null,
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    });
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);

    await mount(<CarbonCalculator />);
    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Delete entry"]');
    expect(deleteButton).toBeTruthy();
    await act(async () => deleteButton!.click());

    expect(confirmSpy).toHaveBeenCalled();
    const prompt = confirmSpy.mock.calls[0]![0] as string;
    expect(prompt).not.toContain('natural_gas');
    expect(prompt.toLowerCase()).toMatch(/natural gas/);
    expect(deleteButton!.getAttribute('aria-label')!.toLowerCase()).toMatch(/natural gas/);
  });
});