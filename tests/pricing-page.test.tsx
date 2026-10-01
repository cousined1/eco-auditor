// F-B-11 — a failed checkout must show up where the user just clicked, be
// announced, and take focus. It used to render below the whole plan grid (about
// 2,000 px down on a phone), so "Start free trial" looked dead.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stripe = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(async () => ({
    ok: false as const,
    error: 'Pricing is temporarily unavailable. Please try again in a moment.',
  })),
}));
const session = vi.hoisted(() => ({ hasSession: vi.fn((): boolean => true) }));
vi.mock('../src/lib/stripe', () => stripe);
vi.mock('../src/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api')>()), hasSession: session.hasSession }));

import Pricing from '../src/pages/Pricing';

let container: HTMLDivElement;
let root: Root;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );
  });
}

const ctaButtons = () => [...container.querySelectorAll('button')].filter((b) => /start free trial|get started/i.test(b.textContent ?? ''));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  session.hasSession.mockReset();
  session.hasSession.mockReturnValue(true);
  stripe.createCheckoutSession.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Pricing checkout errors (F-B-11)', () => {
  it('renders the error inside the card that was clicked, announced, and focused', async () => {
    await mount();
    const [starter, growth] = ctaButtons();
    expect(starter).toBeTruthy();
    expect(growth).toBeTruthy();

    await act(async () => {
      growth!.click();
      await tick();
    });

    expect(stripe.createCheckoutSession).toHaveBeenCalledTimes(1);
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    const alert = alerts[0]!;
    expect(alert.textContent).toContain('temporarily unavailable');
    // Same plan card as the button, not appended below the grid.
    expect(growth!.closest('.card')?.contains(alert)).toBe(true);
    expect(starter!.closest('.card')?.contains(alert)).toBe(false);
    expect(document.activeElement).toBe(alert);
  });

  it('moves the error to the plan that was clicked last and clears it while retrying', async () => {
    await mount();
    const [starter, growth] = ctaButtons();

    await act(async () => {
      growth!.click();
      await tick();
    });
    expect(growth!.closest('.card')?.querySelector('[role="alert"]')).toBeTruthy();

    await act(async () => {
      starter!.click();
      await tick();
    });
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(starter!.closest('.card')?.querySelector('[role="alert"]')).toBeTruthy();
    expect(growth!.closest('.card')?.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends a signed-out visitor to signup instead of showing an error', async () => {
    session.hasSession.mockReturnValue(false);
    await mount();
    await act(async () => {
      ctaButtons()[0]!.click();
      await tick();
    });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('Pricing first render (F-C-10)', () => {
  it('opens on monthly billing with a free-trial call to action on Starter and Growth', async () => {
    await mount();
    const toggle = container.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(ctaButtons().map((b) => b.textContent)).toEqual(['Start free trial', 'Start free trial', 'Get started']);
  });

  it('switching to annual billing drops the trial button and says where the trial is offered', async () => {
    await mount();
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(ctaButtons().map((b) => b.textContent)).toEqual(['Get started', 'Get started', 'Get started']);
    expect(container.textContent).toContain('Free trial available on monthly billing');
  });

  it('shows the excluded features under their own "Not included" heading, not in the ticked list', async () => {
    await mount();
    const starter = ctaButtons()[0]!.closest('.card')!;
    const headings = [...starter.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toContain('Not included');
    const notIncluded = [...starter.querySelectorAll('h3')].find((h) => h.textContent === 'Not included')!;
    const excludedList = notIncluded.nextElementSibling as HTMLElement;
    expect(excludedList.textContent).toContain('Scope 3 workflows');
    const firstList = starter.querySelector('ul')!;
    expect(firstList.textContent).not.toContain('Scope 3 workflows');
    expect(firstList.textContent).toContain('Scope 1 & 2 workflows');
  });

  it('marks unavailable comparison cells for screen readers, not only with a faint dash', async () => {
    await mount();
    const showTable = [...container.querySelectorAll('button')].find((b) => /full feature comparison/i.test(b.textContent ?? ''))!;
    await act(async () => showTable.click());
    const cells = [...container.querySelectorAll('td')].filter((td) => td.textContent?.includes('—'));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.querySelector('.sr-only')?.textContent, cell.textContent ?? '').toBe('Not included');
    }
  });
});
