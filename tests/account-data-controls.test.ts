import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteMyData, exportMyData } from '../src/lib/api';

// DATA-005 (SPA side): self-serve data controls. Guards (a) the typed
// api.ts wrappers for GET /api/account/export and POST /api/account/delete-data,
// and (b) the legal-page alignment — the pages must state what is actually
// implemented (JSON export + audit-data deletion from Settings; account
// deletion via support) instead of the removed "90 days then securely deleted"
// lifecycle. Source-reading assertions follow the convention in
// contact-page.test.tsx / legal-placeholders.test.ts.

const authedClient = {
  getHttpClient() {
    return {
      getHeaders() {
        return { Authorization: 'Bearer token-abc' };
      },
    };
  },
};

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  fetchMock.mockImplementation(impl);
  vi.stubGlobal('fetch', fetchMock);
}

describe('exportMyData (DATA-005)', () => {
  it('GETs /api/account/export with the SDK authorization header and returns blob + filename', async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ companies: [], facilities: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="eco-auditor-export-2026.json"',
        },
      })
    );

    const result = await exportMyData(authedClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filename).toBe('eco-auditor-export-2026.json');
    expect((await result.data.blob.text()).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/account/export', expect.objectContaining({
      headers: { Authorization: 'Bearer token-abc' },
      signal: expect.any(AbortSignal), // RT-06: bounded fetch
    }));
  });

  it('falls back to a default filename when Content-Disposition is absent', async () => {
    stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await exportMyData(authedClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filename).toBe('eco-auditor-data-export.json');
  });

  it('maps a 401 to a signed-in message and a 500 to the server error', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 401 }));
    expect(await exportMyData(authedClient)).toEqual({ ok: false, error: 'You must be signed in to manage your data.' });

    stubFetch(async () => new Response(JSON.stringify({ error: 'export unavailable' }), { status: 500 }));
    expect(await exportMyData(authedClient)).toEqual({ ok: false, error: 'export unavailable' });
  });
});

describe('deleteMyData (DATA-005)', () => {
  it('POSTs /api/account/delete-data with the SDK authorization header', async () => {
    stubFetch(async () => new Response(JSON.stringify({ deleted: { emissionEntries: 3, facilities: 1 } }), { status: 200 }));
    const result = await deleteMyData(authedClient);
    expect(result).toEqual({ ok: true, data: { deleted: { emissionEntries: 3, facilities: 1 } } });
    expect(fetchMock).toHaveBeenCalledWith('/api/account/delete-data', expect.objectContaining({
      headers: { Authorization: 'Bearer token-abc' },
      method: 'POST',
      signal: expect.any(AbortSignal), // RT-06: bounded fetch
    }));
  });

  it('maps failures to the server error or the signed-in message', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'delete failed' }), { status: 500 }));
    expect(await deleteMyData(authedClient)).toEqual({ ok: false, error: 'delete failed' });

    stubFetch(async () => new Response('unauthorized', { status: 401 }));
    expect(await deleteMyData(authedClient)).toEqual({ ok: false, error: 'You must be signed in to manage your data.' });
  });
});

// ─── Legal / claims alignment (DATA-005) ─────────────────────────────────────

function srcOf(rel: string): string {
  return readFileSync(resolve(rel), 'utf8');
}

const SECURITY = srcOf('src/pages/Security.tsx');
const PRIVACY = srcOf('src/pages/PrivacyPolicy.tsx');
const TERMS = srcOf('src/pages/TermsOfService.tsx');
const DPA = srcOf('src/pages/DataProcessingAddendum.tsx');
const SETTINGS = srcOf('src/pages/Settings.tsx');
const CLAIMS = srcOf('src/content/claims.ts');

const LEGAL_PAGES: Array<[string, string]> = [
  ['Security.tsx', SECURITY],
  ['PrivacyPolicy.tsx', PRIVACY],
  ['TermsOfService.tsx', TERMS],
  ['DataProcessingAddendum.tsx', DPA],
];

describe('legal pages state the implemented data controls (DATA-005)', () => {
  it('no longer promises the fictional 90-days-then-secure-deletion lifecycle', () => {
    for (const [name, src] of LEGAL_PAGES) {
      expect(src.includes('90 days'), `${name} must not claim 90-day retention`).toBe(false);
    }
  });

  it('describes the self-serve JSON export from Settings', () => {
    for (const [name, src] of LEGAL_PAGES) {
      expect(src.includes('machine-readable JSON'), `${name} must describe the JSON export`).toBe(true);
      expect(src.includes('Settings'), `${name} must point to Settings for export`).toBe(true);
      // The pages may mention CSV import (existing fact) but must not promise CSV export.
      const csvExportPromise = /(CSV[^.\n]{0,60}export|export[^.\n]{0,60}CSV)/i.test(src);
      expect(csvExportPromise, `${name} must not promise CSV export`).toBe(false);
    }
  });

  it('describes self-serve audit-data deletion plus support-assisted account deletion within 30 days', () => {
    // Security.tsx renders the window from trust-facts (single source of truth);
    // the other pages state it inline.
    expect(SECURITY.includes('accountDeletionRequestWindowDays')).toBe(true);
    for (const [name, src] of [
      ['PrivacyPolicy.tsx', PRIVACY],
      ['TermsOfService.tsx', TERMS],
      ['DataProcessingAddendum.tsx', DPA],
    ] as Array<[string, string]>) {
      expect(src.includes('30 days'), `${name} must state the 30-day support deletion window`).toBe(true);
  }
    expect(SECURITY.includes('Delete my audit data')).toBe(true);
    expect(PRIVACY.includes('Delete my audit data')).toBe(true);
    expect(DPA.includes('within 30 days of the request')).toBe(true);
    expect(TERMS.includes('account deletion is available via support')).toBe(true);
  });
});

describe('Settings data controls card (DATA-005)', () => {
  it('offers export and delete with the true behavior in the copy', () => {
    expect(SETTINGS.includes('Data controls')).toBe(true);
    expect(SETTINGS.includes('Export my data')).toBe(true);
    expect(SETTINGS.includes('Delete my audit data')).toBe(true);
    expect(SETTINGS.includes('emissions entries and facilities')).toBe(true);
    expect(SETTINGS.includes('full account deletion is available via support')).toBe(true);
  });

  it('deletion is confirm-guarded and both actions go through the typed wrappers', () => {
    expect(SETTINGS.includes('window.confirm')).toBe(true);
    expect(SETTINGS.includes('exportMyData(insforge)')).toBe(true);
    expect(SETTINGS.includes('deleteMyData(insforge)')).toBe(true);
  });

  it('download copy and export result say JSON, not CSV', () => {
    expect(SETTINGS.includes('machine-readable JSON')).toBe(true);
    expect(SETTINGS.includes('CSV')).toBe(false);
  });
});

describe('claims register reflects the implemented export (DATA-005)', () => {
  it('no-proprietary-formats caveat tracks the shipped JSON export', () => {
    expect(CLAIMS.includes("Do not claim CSV export")).toBe(false);
    expect(CLAIMS.includes('machine-readable JSON export')).toBe(true);
    expect(CLAIMS.includes('/api/account/export')).toBe(true);
  });
});
