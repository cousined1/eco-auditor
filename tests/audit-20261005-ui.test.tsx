import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '../src/hooks/useFocusTrap';
import Dashboard from '../src/pages/Dashboard';
import DataIntake from '../src/pages/DataIntake';
import ChatWidget from '../src/components/ChatbotWidget';

vi.mock('../src/lib/insforge', () => ({ insforge: { getHttpClient: () => ({ getHeaders: () => ({ Authorization: 'Bearer user-fixture' }) }) } }));
vi.mock('../src/lib/consent-context', () => ({ useConsent: () => ({ consentState: { hasConsented: true, consent: { analytics: false } } }) }));
vi.mock('recharts', () => ({
  AreaChart: () => null, Area: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, ResponsiveContainer: () => null,
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
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('October audit UI regressions', () => {
  it('keeps focus in the current control across dialog edits and uses the latest close callback', async () => {
    const closed = vi.fn();
    function Dialog() {
      const [value, setValue] = useState('');
      const ref = useFocusTrap<HTMLDivElement>(() => closed(value));
      return <div ref={ref} role="dialog"><button>First</button><input value={value} onChange={e => setValue(e.target.value)} /></div>;
    }
    await mount(<Dialog />);
    const input = container.querySelector('input')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'latest');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.activeElement).toBe(input);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(closed).toHaveBeenCalledWith('latest');
  });
  it('shows small inventories accurately and does not turn an incomparable null trend into 0%', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {
        total_co2e_tonnes: 0.12, scope1_co2e_tonnes: 0.12, scope2_co2e_tonnes: 0, scope3_co2e_tonnes: 0,
        scope1_pct: 100, scope2_pct: 0, scope3_pct: 0,
        trend_vs_prior_period: { scope1: null, scope2: null, scope3: null },
      } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await mount(<Dashboard />);
    expect(container.textContent).toContain('0.12');
    expect(container.textContent).not.toContain('% vs prior');
    expect(fetchMock.mock.calls.every(call => call[1].signal instanceof AbortSignal)).toBe(true);
  });
  it('rejects oversized CSV files before reading them into memory or issuing a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await mount(<DataIntake />);
    const file = new File(['x'.repeat(102401)], 'large.csv', { type: 'text/csv' });
    const read = vi.fn();
    Object.defineProperty(file, 'text', { value: read });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: { length: 1, item: () => file } });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('100 KB import limit');
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends chat successfully when localStorage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, response: 'Pricing details', quickReplies: [] })));
    vi.stubGlobal('fetch', fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
    await mount(<ChatWidget />);
    const launcher = container.querySelector('button')!;
    await act(async () => launcher.click());
    const quickReply = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Pricing'))!;
    await act(async () => quickReply.click());
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sessionId).toMatch(/^sess_/);
    expect(container.textContent).toContain('Pricing details');
    expect(container.textContent).not.toContain('Blocked');
    await act(async () => quickReply.click());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).sessionId).toBe(body.sessionId);
  });
});
