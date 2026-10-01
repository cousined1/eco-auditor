import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import DataIntake from '../src/pages/DataIntake';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
vi.mock('../src/lib/api', () => ({
  buildApiRequestInit: () => ({ headers: {} }),
  apiFetch: (path: string, init?: RequestInit) => fetch(path, init),
  getUpgradeRequired: () => null,
}));

it('checks uppercase CSV filenames picked through the file input', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const request = vi.fn(async (url: string) =>
    String(url).startsWith('/api/ingest/imports')
      ? new Response(JSON.stringify({ success: true, data: [] }))
      : new Response(JSON.stringify({ success: true, dry_run: true, total_rows: 1, valid_rows: 1, error_count: 0, errors: [], warnings: [], conversions: [], can_commit: true })),
  );
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  try {
    await act(async () => root.render(createElement(DataIntake)));
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) throw new Error('File input missing');
    const file = new File(['scope,amount\n1,10'], 'EMISSIONS.CSV', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: { length: 1, item: () => file } });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(request).toHaveBeenCalledWith('/api/ingest/csv?dry_run=1&filename=EMISSIONS.CSV', expect.objectContaining({ method: 'POST', body: 'scope,amount\n1,10' }));
    expect(container.textContent).toContain('EMISSIONS.CSV — ready to import 1 row');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
