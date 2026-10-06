/**
 * Customer-journey regressions found by the 2026-10-05 audit's second pass.
 *
 * These sit alongside DATA-01, which fixed the "row saved but refresh failed is
 * reported as a save failure" bug on the INSERT path. Every finding here is a
 * sibling defect that the insert fix did not reach:
 *
 * CJU-01 (high) — ReportGenerator called URL.revokeObjectURL synchronously
 *   immediately after link.click(). Releasing the blob before the browser has
 *   read it means Firefox and Safari produce no file at all, while the card
 *   reported "Report generated and downloaded." There was no error and no
 *   retry, on the product's headline paid action.
 *
 * CJU-02 (medium) — handleDelete threw the InsForge SDK's plain error object,
 *   so EmissionList's `err instanceof Error` was false and every failure
 *   collapsed to "Failed to delete entry" — never the real reason. And because
 *   the post-delete re-read was unisolated, a refresh failure was reported as a
 *   failed delete for a row that was already gone, so every retry re-issued a
 *   DELETE for a row that no longer existed.
 *
 * CJU-03 (medium) — the dashboard treated any 400 OR 403, from either of two
 *   parallel requests, as "no company yet". A 403 from the trend call dropped an
 *   existing account with real data onto the "Welcome to EcoAuditor" screen,
 *   which has no retry and no way back.
 *
 * CJU-04/05/06/07 (low) — a plan-gate message rendered in the success green,
 *   plus three async result regions with no live region.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarbonCalculator from '../src/components/carbon-calculator/index';
import ReportGenerator from '../src/components/carbon-calculator/ReportGenerator';
import Dashboard from '../src/pages/Dashboard';
import { downloadBlob } from '../src/lib/api';

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
  // The deferred object-URL revoke is asserted directly, so time must be
  // controllable while async work still settles.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type DeleteOpts = { deleteError?: unknown; rows?: unknown[]; failsAfterFirstRead?: unknown };

function stubDatabase({ deleteError = null, rows = [], failsAfterFirstRead = null }: DeleteOpts = {}) {
  let reads = 0;

  databaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'companies':
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 7, name: 'Northstar Foods', user_id: 'user-fixture' }, error: null }),
            }),
          }),
        };
      case 'facilities':
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      case 'emission_entries': {
        const chain: Record<string, unknown> = {
          eq: () => chain,
          order: async () => {
            reads += 1;
            // Only the post-delete re-read fails; failing the first read too
            // would render the "unable to load" card instead of the table.
            if (failsAfterFirstRead && reads > 1) return { data: null, error: failsAfterFirstRead };
            return { data: rows, error: null };
          },
        };
        return {
          select: () => chain,
          insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          // handleDelete does .from(...).delete().eq('id', id), so the delete
          // branch has to resolve to a result object — not a builder.
          delete: () => ({ eq: async () => ({ data: null, error: deleteError }) }),
        };
      }
      default:
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    }
  });

  return { deleteError };
}

async function waitFor(selector: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const el = container.querySelector(selector);
    if (el) return el;
    await act(async () => {
      await Promise.resolve();
    });
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

const ENTRY = {
  id: 41,
  scope: 'Scope 1',
  category: 'stationary_combustion',
  source: 'natural_gas',
  amount: 1200,
  co2e_kg: 1200,
  unit: 'therms',
  facility_id: null,
};

async function mountCalculator(opts: DeleteOpts = {}) {
  stubDatabase({ rows: [ENTRY], ...opts });
  await mount(<CarbonCalculator />);
  await waitFor('table');
}

const confirmSpy = () => vi.spyOn(window, 'confirm').mockReturnValue(true);

const COMPANY = { id: 7, name: 'Northstar Foods' } as never;
const ENTRIES = [{ id: 1 }] as never;

/** jsdom has no object URLs and no anchor navigation; stub both. */
function stubBlobAndUrl() {
  const createObjectURL = vi.fn().mockReturnValue('blob:report');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { createObjectURL, revokeObjectURL, click };
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, blob: async () => new Blob(['pdf']) };
}

/** Clicks the single Generate PDF button and lets its async work settle. */
async function clickGenerate() {
  await waitFor('button');
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button')!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** fetch stub that answers the generate call, then the download. */
function stubGenerateThenDownload() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/reports/generate')
        ? okResponse({ success: true, report_id: 'r1', download_url: '/api/reports/r1/download' })
        : okResponse({})
    )
  );
}

describe('CJU-02 a failed delete surfaces the real reason', () => {
  it('shows the server message instead of a generic string', async () => {
    stubDatabase({
      rows: [ENTRY],
      deleteError: { message: 'permission denied for table emission_entries' },
    });
    await mount(<CarbonCalculator />);
    await waitFor('table');

    confirmSpy();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="Delete entry"]')!.click();
      await Promise.resolve();
    });

    const alert = await waitFor('[role="alert"]');
    expect(alert.textContent).toContain('permission denied');
    expect(alert.textContent).not.toBe('Failed to delete entry');
  });

  it('announces the failure to assistive tech', async () => {
    stubDatabase({ rows: [ENTRY], deleteError: { message: 'constraint violation' } });
    await mount(<CarbonCalculator />);
    await waitFor('table');

    confirmSpy();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="Delete entry"]')!.click();
      await Promise.resolve();
    });

    // role="alert" so a delete that fails while focus is elsewhere is still read
    // out; without it the row looks untouched.
    const alert = await waitFor('[role="alert"]');
    expect(alert.getAttribute('role')).toBe('alert');
  });
});

describe('CJU-02 a refresh failure after a successful delete is not a delete failure', () => {
  it('reports the refresh separately and does not show a delete error', async () => {
    // The DELETE succeeds; the subsequent re-read fails. Reporting that as a
    // failed delete left the row on screen with an error beside it, and every
    // retry re-issued a DELETE for a row that no longer existed.
    await mountCalculator({ failsAfterFirstRead: { message: 'connection reset' } });

    confirmSpy();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="Delete entry"]')!.click();
      await Promise.resolve();
    });

    await waitFor('[role="status"]');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Entry deleted');
    expect(container.querySelector('[role="status"]')!.textContent).toContain('could not be refreshed');
  });
});

describe('CJU-01 the downloaded PDF is released after the browser reads it', () => {
  it('does not revoke the object URL in the same turn as click()', async () => {
    // The defect: revoking synchronously releases the blob before Firefox and
    // Safari resolve the download, so no file is produced — while the card
    // reported success and offered no retry.
    const { revokeObjectURL, click } = stubBlobAndUrl();
    stubGenerateThenDownload();

    await mount(<ReportGenerator company={COMPANY} entries={ENTRIES} />);
    await clickGenerate();

    expect(click).toHaveBeenCalled();
    // The click has been dispatched and the handler has settled — if the revoke
    // were still in the same turn, it would already have fired.
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('still frees the object URL once the download has had time to complete', async () => {
    const { revokeObjectURL } = stubBlobAndUrl();
    stubGenerateThenDownload();

    await mount(<ReportGenerator company={COMPANY} entries={ENTRIES} />);
    await clickGenerate();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Deferring must not mean leaking: advance past the delay and it fires.
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('reports the download as successful', async () => {
    stubBlobAndUrl();
    stubGenerateThenDownload();

    await mount(<ReportGenerator company={COMPANY} entries={ENTRIES} />);
    await clickGenerate();
    await waitFor('[role="status"]');
    expect(container.querySelector('[role="status"]')!.textContent).toContain('downloaded');
  });
});

describe('CJU-04 a plan gate is not styled as a success', () => {
  it('renders the upgrade message in the warn tone, not the success green', async () => {
    // The old rule was `status.startsWith('Error') ? risk-high : risk-low`, so
    // "Reports require an active plan" took the success branch and rendered a
    // blocked action in green.
    stubBlobAndUrl();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 402,
        clone: () => ({ json: async () => ({ code: 'upgrade_required', requiredPlan: 'growth' }) }),
      }))
    );

    await mount(<ReportGenerator company={COMPANY} entries={ENTRIES} />);
    await clickGenerate();

    await waitFor('[role="status"]');
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('require an active plan');
    expect(status.className).toContain('text-risk-medium');
    expect(status.className).not.toContain('text-risk-low');
  });
});

describe('CJU-06 the report status region is a live region', () => {
  it('announces an error result', async () => {
    stubBlobAndUrl();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

    await mount(<ReportGenerator company={COMPANY} entries={ENTRIES} />);
    await clickGenerate();

    await waitFor('[role="status"]');
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.className).toContain('text-risk-high');
  });
});

/**
 * SET-01 — the same revoke-before-download defect existed independently in the
 * account data export. Both call sites now share one helper, so this tests the
 * helper itself rather than either caller.
 */
describe('SET-01 downloadBlob is the single safe download path', () => {
  it('defers the revoke and still frees the URL', () => {
    const { revokeObjectURL, click } = stubBlobAndUrl();

    downloadBlob(new Blob(['{}']), 'export.json');

    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(11_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('is used by the GDPR data export rather than a second hand-rolled copy', () => {
    const source = readFileSync(resolve(__dirname, '..', 'src', 'pages', 'Settings.tsx'), 'utf8');
    expect(source).toContain('downloadBlob(');
    // The raw anchor dance must not reappear in either caller.
    expect(source).not.toMatch(/createObjectURL/);
    expect(source).not.toMatch(/revokeObjectURL/);
  });

  it('is used by the report generator too', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'src', 'components', 'carbon-calculator', 'ReportGenerator.tsx'),
      'utf8'
    );
    expect(source).toContain('downloadBlob(');
    expect(source).not.toMatch(/createObjectURL|revokeObjectURL/);
  });
});

/**
 * CJU-03 — the dashboard must not confuse a failing trend request with "this
 * account has no company yet".
 */
describe('CJU-03 only a failing summary request means onboarding', () => {
  function res(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      clone: () => ({ json: async () => body }),
      json: async () => body,
    };
  }

  const SUMMARY_OK = res(200, {
    success: true,
    data: {
      total_co2e_tonnes: 42,
      scope1_co2e_tonnes: 10,
      scope2_co2e_tonnes: 20,
      scope3_co2e_tonnes: 12,
      scope1_pct: 23.8,
      scope2_pct: 47.6,
      scope3_pct: 28.6,
    },
  });

  function stubDashboardFetch(summaryResponse: unknown, trendResponse: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('/trend') ? trendResponse : summaryResponse))
    );
  }

  async function mountDashboard() {
    await mount(<Dashboard />);
  }

  it('shows onboarding when the summary says 400 (no company yet)', async () => {
    // The one case that legitimately means onboarding.
    stubDashboardFetch(res(400, { error: 'no company' }), res(200, { success: true, data: [] }));

    await mountDashboard();
    const heading = await waitFor('h2');
    expect(heading.textContent).toContain('Welcome to EcoAuditor');
  });

  it('shows an error, not onboarding, when the trend request 403s', async () => {
    // The defect: an existing account with a working summary was dropped onto
    // the onboarding screen, which has no retry and no way back.
    stubDashboardFetch(SUMMARY_OK, res(403, { error: 'forbidden' }));

    await mountDashboard();
    await waitFor('h2');
    expect(container.textContent).not.toContain('Welcome to EcoAuditor');
  });

  it('offers a retry when the trend request fails', async () => {
    stubDashboardFetch(SUMMARY_OK, res(403, { error: 'forbidden' }));

    await mountDashboard();
    await waitFor('button');
    const labels = Array.from(container.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
    expect(labels.join(' ').toLowerCase()).toMatch(/try again|retry/);
  });

  it('does not treat a 403 from the summary as onboarding either', async () => {
    // 403 is a permission/expired-token signal, not a missing-company signal.
    stubDashboardFetch(res(403, { error: 'forbidden' }), res(200, { success: true, data: [] }));

    await mountDashboard();
    await waitFor('h2');
    expect(container.textContent).not.toContain('Welcome to EcoAuditor');
  });

  it('announces the loading state', async () => {
    // CJU-05: the whole dashboard swaps in after the fetch; without a live region
    // that arrives silently.
    let resolveSummary: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolveSummary = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('/trend') ? res(200, { success: true, data: [] }) : pending))
    );

    await mount(<Dashboard />);
    const loading = await waitFor('[role="status"]');
    expect(loading.textContent).toContain('Loading your emissions data');

    await act(async () => {
      resolveSummary(SUMMARY_OK);
      await pending;
      await Promise.resolve();
    });
  });
});