import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ComingSoon } from '../src/components/ComingSoon.tsx';
import AIAssistant from '../src/pages/AIAssistant.tsx';
import Ledger from '../src/pages/Ledger.tsx';
import Reports from '../src/pages/Reports.tsx';
import Suppliers from '../src/pages/Suppliers.tsx';

// Reports left this list with K3 (F-C-05): it is a working page now, covered by
// tests/reports-page.test.tsx; the last test below keeps it from sliding back.
const GATED_PAGES = [
  { Component: AIAssistant, featureName: 'AI Carbon Assistant', mockText: 'Northstar Foods' },
  { Component: Ledger, featureName: 'Emissions Ledger', mockText: 'Export Ledger' },
  { Component: Suppliers, featureName: 'Supplier Engagement Hub', mockText: '+ Send Questionnaire' },
] as const;

describe('ComingSoon', () => {
  it('renders an honest unavailable-feature message with a dashboard return link', () => {
    // Given: a feature that is intentionally not connected to production data yet.
    const featureName = 'AI Carbon Assistant';

    // When: the ComingSoon gate is rendered for that feature.
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ComingSoon featureName={featureName} />
      </MemoryRouter>
    );

    // Then: users see an honest status instead of mock data or fake controls.
    expect(html).toContain('AI Carbon Assistant');
    expect(html).toContain('Coming soon');
    expect(html).toContain('is on our roadmap and is not available yet');
    // F-C-19: developer jargon ("production data", "placeholder controls") is gone.
    expect(html).not.toMatch(/production data|placeholder/i);
    expect(html).toContain('Back to dashboard');
    expect(html).toContain('href="/app"');
  });

  it.each(GATED_PAGES)('gates $featureName instead of rendering mock data', ({ Component, featureName, mockText }) => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    );

    expect(html).toContain(featureName);
    expect(html).toContain('Coming soon');
    expect(html).toContain('is not available yet');
    expect(html).not.toContain(mockText);
  });

  it('Reports is a working page, not a Coming soon gate (F-C-05)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Reports />
      </MemoryRouter>
    );

    expect(html).toContain('<h1');
    expect(html).toContain('Reports');
    expect(html).not.toContain('Coming soon');
    expect(html).not.toContain('Reporting Center');
    expect(html).not.toContain('+ New Report');
  });
});
