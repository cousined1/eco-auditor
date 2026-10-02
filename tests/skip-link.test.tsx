// WCAG 2.4.1 bypass block: every shell offers "Skip to main content" as its first
// tab stop, and it lands focus in the main landmark without touching the URL.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkipLink from '../src/components/SkipLink';

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
  window.history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
});

const link = () => container.querySelector<HTMLAnchorElement>('a[href="#main-content"]')!;
const click = (target: HTMLElement) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('SkipLink', () => {
  it('is named for what it does and points at the main landmark', async () => {
    await act(async () => root.render(<SkipLink />));
    expect(link().textContent).toBe('Skip to main content');
    expect(link().getAttribute('href')).toBe('#main-content');
  });

  it('is visually hidden until it has focus', async () => {
    await act(async () => root.render(<SkipLink />));
    expect(link().classList.contains('sr-only')).toBe(true);
    expect(link().classList.contains('focus:not-sr-only')).toBe(true);
  });

  it('moves focus into <main> and leaves the URL alone', async () => {
    await act(async () =>
      root.render(
        <>
          <SkipLink />
          <nav>
            <a href="/pricing">Pricing</a>
          </nav>
          <main id="main-content" tabIndex={-1}>
            <h1>Page</h1>
          </main>
        </>,
      ),
    );
    await act(async () => link().focus());

    let event!: MouseEvent;
    await act(async () => {
      event = click(link());
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('main'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('falls back to the plain anchor when the page has no main landmark', async () => {
    await act(async () => root.render(<SkipLink />));
    let event!: MouseEvent;
    await act(async () => {
      event = click(link());
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
