import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import DataIntake from '../src/pages/DataIntake';

vi.mock('../src/lib/insforge', () => ({ insforge: {} }));
vi.mock('../src/lib/api', () => ({
  buildApiRequestInit: () => ({ headers: {} }),
  getUpgradeRequired: () => null,
}));

it('uploads uppercase CSV filenames through the file input', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const request = vi.fn(async () => new Response(JSON.stringify({ success: true, imported: 1, total_rows: 1 })));
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  try {
    await act(async () => root.render(createElement(DataIntake)));
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    if (!input) throw new Error('File input missing');
    const file = new File(['scope,amount\n1,10'], 'EMISSIONS.CSV', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'scope,amount\n1,10' });
    Object.defineProperty(input, 'files', { value: { length: 1, item: () => file } });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(request).toHaveBeenCalledWith('/api/ingest/csv', expect.objectContaining({ method: 'POST', body: 'scope,amount\n1,10' }));
    expect(container.textContent).toContain('1 of 1 rows imported');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
