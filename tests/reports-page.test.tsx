// K3 (audit AUDIT-RUN-20260929: F-C-05, F-B-09, F-B-05, F-E-03). The Reports
// page replaced a "Coming soon" stub: choose a period, generate, find every
// report again, download the stored PDF, sign a draft off after a confirmation
// that says it freezes the report. The calculator's report button takes the
// same period picker. All calls go through apiFetch (mocked fetch here).
import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportGenerator from '../src/components/carbon-calculator/ReportGenerator';
import type { EmissionEntry } from '../src/components/carbon-calculator/utils';
import { downloadReport, generateReport, listReports, signOffReport } from '../src/lib/reports';
import Reports from '../src/pages/Reports';
import { buttonNamed, press, setField, settle } from './helpers/form-dom';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));

const { MAX_DRAFT_REPORTS } = createRequire(import.meta.url)('../src/lib/reports/report-limits.cjs') as { MAX_DRAFT_REPORTS: number };

const SHA = 'ab'.repeat(32);
const DRAFT = {
  id: '12', title: 'Emissions report - Calendar year 2026', status: 'draft', period: '2026', period_label: 'Calendar year 2026',
  period_start: '2026-01-01', period_end: '2026-12-31', generated_at: '2026-09-30T14:22:05.000Z', total_tco2e: 20.525,
  by_scope: { scope1: 1.021, scope2: 19.504, scope3: 0 }, entry_count: 2, pdf_sha256: SHA, signed_off_by: null, signed_off_at: null,
  download_url: '/api/reports/12/download',
};
const FINAL = {
  ...DRAFT, id: '11', title: 'Emissions report - Calendar year 2025', status: 'final', period: '2025', period_label: 'Calendar year 2025',
  total_tco2e: 5.306, pdf_sha256: 'cd'.repeat(32), signed_off_by: 'user-1', signed_off_at: '2026-09-01T10:00:00.000Z', download_url: '/api/reports/11/download',
};
const LEGACY = {
  ...DRAFT, id: '5', title: 'Carbon Report 2026-07-01', status: 'legacy', period: null, period_label: 'All time', total_tco2e: null,
  by_scope: null, entry_count: null, pdf_sha256: null, download_url: null,
};
const LIST = { success: true, company: { id: '3', name: 'Müller Umwelt GmbH' }, default_period: '2026', reports: [DRAFT, FINAL, LEGACY] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pdf = () => new Response('%PDF-1.4', { status: 200, headers: { 'Content-Type': 'application/pdf' } }); // a string body: jsdom's Blob has no stream(), which Node 22's Response calls

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let container: HTMLDivElement;
let root: Root;

/** Routes fetch by URL; `overrides` answer first (undefined falls through). Records every call. */
function serve(overrides: Record<string, (init: RequestInit | undefined) => Response | Promise<Response> | undefined> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = overrides[`${init?.method ?? 'GET'} ${url}`]?.(init);
    if (answer) return answer;
    if (url === '/api/reports') return json(LIST);
    if (url.endsWith('/download')) return pdf();
    if (url === '/api/companies/3/reports/generate') {
      return json({ success: true, report_id: '13', download_url: '/api/reports/13/download', report: { ...DRAFT, id: '13', download_url: '/api/reports/13/download' } });
    }
    if (url === '/api/reports/12/signoff') {
      return json({ success: true, report: { ...DRAFT, status: 'final', signed_off_by: 'user-1', signed_off_at: '2026-09-30T15:00:00.000Z' } });
    }
    return json({ success: false, error: `unexpected ${url}` }, 500);
  }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  calls = [];
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
});

const text = () => container.textContent ?? '';
const byId = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
const labelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const posted = (url: string) => calls.filter((c) => c.method === 'POST' && c.url === url);

async function mountReports() {
  await act(async () => root.render(<MemoryRouter><Reports /></MemoryRouter>));
  await settle();
}

describe('Reports page (F-C-05, F-B-09)', () => {
  it('lists every report with its period, total and status, and offers only what each can do', async () => {
    serve();
    await mountReports();

    expect(container.querySelector('h1')?.textContent).toBe('Reports');
    expect(text()).not.toContain('Coming soon');
    expect(text()).toContain('Calendar year 2026');
    expect(text()).toContain('20.5 tCO2e');
    expect(text()).toContain('Draft, not signed off');
    expect(text()).toMatch(/Signed off .*2026/);
    expect(text()).toContain('Not frozen (created before reports were stored)');
    expect(labelled('Download report 12')).not.toBeNull();
    expect(labelled('Download report 11')).not.toBeNull();
    expect(labelled('Sign off report 12')).not.toBeNull();
    // A signed-off report cannot be signed again; a legacy one has nothing frozen to download or sign.
    expect(labelled('Sign off report 11')).toBeNull();
    expect(labelled('Download report 5')).toBeNull();
    expect(labelled('Sign off report 5')).toBeNull();
    // The draft bound the server enforces is the one the page states (VERIFY-W2A F5).
    expect(text()).toContain(`The ${MAX_DRAFT_REPORTS} most recent unsigned drafts are kept`);
  });

  it('generates the Dashboard\'s year by default, downloads the PDF and lists the new report first', async () => {
    serve();
    await mountReports();
    expect(byId<HTMLSelectElement>('report-period-year').value).toBe('2026');

    await press(buttonNamed(container, /^Generate PDF$/));

    expect(posted('/api/companies/3/reports/generate')).toEqual([{ url: '/api/companies/3/reports/generate', method: 'POST', body: { period: '2026' } }]);
    expect(calls.some((c) => c.url === '/api/reports/13/download')).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Report 13 (Calendar year 2026) generated and downloaded');
    expect(container.querySelector('tbody tr td')?.textContent).toBe('#13');
  });

  it('sends the chosen year or date range, and refuses an impossible range before calling the server', async () => {
    serve();
    await mountReports();

    await setField(byId<HTMLSelectElement>('report-period-year'), '2025');
    await press(buttonNamed(container, /^Generate PDF$/));
    expect(posted('/api/companies/3/reports/generate').at(-1)?.body).toEqual({ period: '2025' });

    await setField(byId<HTMLSelectElement>('report-period-kind'), 'range');
    expect(byId<HTMLInputElement>('report-period-start').value).toBe('2025-01-01');
    await setField(byId<HTMLInputElement>('report-period-start'), '2025-04-01');
    await setField(byId<HTMLInputElement>('report-period-end'), '2026-03-31');
    await press(buttonNamed(container, /^Generate PDF$/));
    expect(posted('/api/companies/3/reports/generate').at(-1)?.body).toEqual({ period: '2025-04-01/2026-03-31' });

    const before = posted('/api/companies/3/reports/generate').length;
    await setField(byId<HTMLInputElement>('report-period-end'), '2025-03-31');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('The end date is before the start date.');
    expect(buttonNamed(container, /^Generate PDF$/).disabled).toBe(true);
    expect(posted('/api/companies/3/reports/generate')).toHaveLength(before);
  });

  it('says so when the period has no entries, and lists nothing new (F-E-03)', async () => {
    serve({
      'POST /api/companies/3/reports/generate': () =>
        json({ success: false, code: 'empty_period', error: 'There are no emission entries in Calendar year 2024, so no report was created.' }, 422),
    });
    await mountReports();
    await press(buttonNamed(container, /^Generate PDF$/));

    expect(container.querySelector('[role="status"]')?.textContent).toBe('There are no emission entries in Calendar year 2024, so no report was created.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(calls.some((c) => c.url.endsWith('/download'))).toBe(false);
  });

  it('downloads a listed report from its stored PDF', async () => {
    serve();
    await mountReports();
    await press(labelled('Download report 11')!);

    expect(calls.map((c) => c.url)).toContain('/api/reports/11/download');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Report 11 downloaded.');
  });

  it('asks before signing off, says it freezes the report, and binds the sign-off to the PDF digest', async () => {
    serve();
    await mountReports();
    await press(labelled('Sign off report 12')!);

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain('Signing off freezes this report as final');
    expect(dialog?.textContent).toContain('can never be changed or signed off again');
    expect(posted('/api/reports/12/signoff')).toHaveLength(0);

    await press(buttonNamed(container, /^Sign off and freeze$/));

    expect(posted('/api/reports/12/signoff')).toEqual([{ url: '/api/reports/12/signoff', method: 'POST', body: { pdf_sha256: SHA } }]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(labelled('Sign off report 12')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Report 12 is signed off');
  });

  it('Cancel leaves the report a draft and sends nothing', async () => {
    serve();
    await mountReports();
    await press(labelled('Sign off report 12')!);
    await press(buttonNamed(container, /^Cancel$/));

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(posted('/api/reports/12/signoff')).toHaveLength(0);
    expect(labelled('Sign off report 12')).not.toBeNull();
  });

  it('shows the server\'s refusal when the report was already signed off (409)', async () => {
    serve({
      'POST /api/reports/12/signoff': () =>
        json({ success: false, code: 'report_final', error: 'This report is signed off and final. It cannot be changed or signed off again; generate a new report to include later data.' }, 409),
    });
    await mountReports();
    await press(labelled('Sign off report 12')!);
    await press(buttonNamed(container, /^Sign off and freeze$/));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('This report is signed off and final');
  });

  it('gives up on a request that never answers after 15 s, with an error and a working Try again (F-B-15)', async () => {
    const signals: AbortSignal[] = [];
    let hanging = true;
    serve({
      'POST /api/companies/3/reports/generate': (init) => {
        if (!hanging) return undefined;
        signals.push(init!.signal!);
        return new Promise<Response>(() => {}); // ignores the abort too, like a client that takes no signal
      },
    });
    await mountReports();
    // Fake only the request clock, now that the list has loaded; React's scheduling stays real.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });

    await act(async () => buttonNamed(container, /^Generate PDF$/).click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(buttonNamed(container, /^Generating…$/).disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Error: The request took too long to respond.');
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(buttonNamed(container, /^Generate PDF$/).disabled).toBe(false);

    hanging = false;
    await act(async () => buttonNamed(container, /^Try again$/).click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posted('/api/companies/3/reports/generate')).toHaveLength(2);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Report 13 (Calendar year 2026) generated and downloaded');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the upgrade prompt when the plan gate answers 402', async () => {
    serve({
      'GET /api/reports': () => json({ success: false, code: 'upgrade_required', requiredPlan: 'starter', error: 'An active subscription is required for this feature' }, 402),
    });
    await mountReports();

    expect(text()).toContain('Reports are a paid feature');
    expect(text()).toContain('An active subscription is required for this feature');
    expect(container.querySelector('button')?.textContent).not.toBe('Generate PDF');
  });
});

describe('calculator report button (F-B-05)', () => {
  const company = { id: 7, name: 'Acme Ltd', industry: 'Retail' };
  const entries = [{ id: 1 }] as unknown as EmissionEntry[];

  it('sends the period chosen in the same picker, defaulting to the Dashboard\'s year (never "All time")', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return url.endsWith('/reports/generate') ? json({ success: true, report_id: 'r1', download_url: '/api/reports/r1/download' }) : pdf();
    }));
    await act(async () => root.render(<ReportGenerator company={company} entries={entries} />));

    await press(buttonNamed(container, /^Generate PDF$/));
    expect(posted('/api/companies/7/reports/generate').at(-1)?.body).toEqual({ period: '2026' });

    await setField(byId<HTMLSelectElement>('calculator-report-period-year'), '2025');
    await press(buttonNamed(container, /^Generate PDF$/));
    expect(posted('/api/companies/7/reports/generate').at(-1)?.body).toEqual({ period: '2025' });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Report generated and downloaded.');
  });

  it('reports an empty period as a notice, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, code: 'empty_period', error: 'There are no emission entries in Calendar year 2026, so no report was created.' }, 422)));
    await act(async () => root.render(<ReportGenerator company={company} entries={entries} />));
    await press(buttonNamed(container, /^Generate PDF$/));

    expect(container.querySelector('[role="status"]')?.textContent).toBe('There are no emission entries in Calendar year 2026, so no report was created.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

// K3 follow-up (VERIFY-W2A-DATA F5): generating is capped at 20 per company per hour, and the 429 used to
// surface as the bare server text "Too many requests" with a Try again that could not work. The message
// now says why and when to come back, from the Retry-After header (seconds; the body repeats it).
describe('a 429 says why and when to come back', () => {
  const GENERATED = 'You have generated a lot of reports this hour.';
  const GENERAL = 'You have made a lot of requests in a short time.';
  const tooMany = (retryAfter: string | null, body: Record<string, unknown> = { error: 'Too many requests' }) =>
    new Response(JSON.stringify(body), { status: 429, headers: { 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) } });

  it.each([
    ['3540', `${GENERATED} Try again in about 59 minutes.`],
    ['61', `${GENERATED} Try again in about 2 minutes.`],
    ['60', `${GENERATED} Try again in about 1 minute.`],
    ['30', `${GENERATED} Try again in less than a minute.`],
    [null, `${GENERATED} Try again in a few minutes.`],
  ])('generate with Retry-After %s', async (retryAfter, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => tooMany(retryAfter)));
    expect(await generateReport('3', '2026')).toEqual({ kind: 'error', message: expected });
  });

  it('uses the retryAfter the body repeats when the header is missing, and ignores a value it cannot read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tooMany(null, { error: 'Too many requests', retryAfter: 600 })));
    expect(await generateReport('3', '2026')).toEqual({ kind: 'error', message: `${GENERATED} Try again in about 10 minutes.` });
    vi.stubGlobal('fetch', vi.fn(async () => tooMany('soon', { error: 'Too many requests', retryAfter: 'later' })));
    expect(await generateReport('3', '2026')).toEqual({ kind: 'error', message: `${GENERATED} Try again in a few minutes.` });
  });

  it('sign-off, the list and a download only meet the general limit, so none of them says "reports this hour"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tooMany('45')));
    expect(await signOffReport('12', SHA)).toEqual({ kind: 'error', message: `${GENERAL} Try again in less than a minute.` });
    expect(await listReports()).toEqual({ kind: 'error', message: `${GENERAL} Try again in less than a minute.` });
    await expect(downloadReport('/api/reports/12/download', '12')).rejects.toThrow(`${GENERAL} Try again in less than a minute.`);
  });

  it('leaves every other failure as it was', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ success: false, error: 'Boom' }, 500)));
    expect(await generateReport('3', '2026')).toEqual({ kind: 'error', message: 'Boom' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await generateReport('3', '2026')).toEqual({ kind: 'error', message: 'Report generation failed (503)' });
  });

  it('the Reports page shows it with a working Try again, and never the bare server text', async () => {
    let limited = true;
    serve({
      'POST /api/companies/3/reports/generate': () => (limited ? tooMany('3540', { error: 'Too many requests', retryAfter: 3540 }) : undefined),
    });
    await mountReports();
    await press(buttonNamed(container, /^Generate PDF$/));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(`Error: ${GENERATED} Try again in about 59 minutes.`);
    expect(text()).not.toContain('Too many requests');

    limited = false;
    await press(buttonNamed(container, /^Try again$/));
    expect(posted('/api/companies/3/reports/generate')).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('the calculator button shows the same words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tooMany('3540', { error: 'Too many requests', retryAfter: 3540 })));
    await act(async () => root.render(<ReportGenerator company={{ id: 7, name: 'Acme Ltd', industry: 'Retail' }} entries={[{ id: 1 }] as unknown as EmissionEntry[]} />));
    await press(buttonNamed(container, /^Generate PDF$/));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(`Error: ${GENERATED} Try again in about 59 minutes.`);
    expect(buttonNamed(container, /^Try again$/)).toBeTruthy();
  });
});
