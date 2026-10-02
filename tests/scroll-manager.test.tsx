// F-C-26: in the app shell <main> is the scroller (`overflow-y-auto` inside an
// `h-screen overflow-hidden` frame), so `window.scrollTo(0, 0)` did nothing and a
// route change opened the next page mid-scroll with focus still on the sidebar
// link. ScrollManager resets the element that actually scrolls and moves focus
// into the main landmark, on a change of pathname only.
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScrollManager from '../src/components/ScrollManager';

let container: HTMLDivElement;
let root: Root;
let go: (to: string) => void;
let scrollTo: ReturnType<typeof vi.fn>;
let scrollIntoView: ReturnType<typeof vi.fn>;

function Navigator() {
  const navigate = useNavigate();
  useEffect(() => {
    go = (to) => navigate(to);
  }, [navigate]);
  return null;
}

// The app shell: a sidebar link outside <main>, a scrolling <main>, a heading and
// an anchor target inside it.
function Shell({ mainId = 'main-content' }: { mainId?: string | undefined }) {
  return (
    <>
      <a href="/sidebar" data-testid="sidebar-link">
        Pricing
      </a>
      {mainId ? (
        <main id={mainId} tabIndex={-1} style={{ overflowY: 'auto' }}>
          <h1>Page</h1>
          <section id="details">Details</section>
        </main>
      ) : (
        <main style={{ overflowY: 'auto' }}>
          <h1>Page</h1>
        </main>
      )}
    </>
  );
}

async function mount(initialEntry: string, shell = <Shell />) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Navigator />
        {shell}
        <ScrollManager />
      </MemoryRouter>,
    ),
  );
}

const main = () => container.querySelector<HTMLElement>('main')!;
const sidebarLink = () => container.querySelector<HTMLAnchorElement>('[data-testid="sidebar-link"]')!;

// The user has scrolled the page and is holding focus on the sidebar link they
// just used.
async function scrollAndFocusSidebar() {
  await act(async () => {
    main().scrollTop = 600;
    sidebarLink().focus();
  });
  scrollTo.mockClear();
  scrollIntoView.mockClear();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
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

describe('ScrollManager', () => {
  it('starts a new pathname at the top and moves focus off the link into <main>', async () => {
    await mount('/app/calculator');
    await scrollAndFocusSidebar();
    expect(main().scrollTop).toBe(600);
    expect(document.activeElement).toBe(sidebarLink());

    await act(async () => go('/app/pricing'));

    expect(main().scrollTop).toBe(0);
    expect(document.activeElement).toBe(main());
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('resets the scroller even when the landmark has no id', async () => {
    await mount('/app/calculator', <Shell mainId={undefined} />);
    await act(async () => {
      main().scrollTop = 450;
    });

    await act(async () => go('/app/pricing'));

    expect(main().scrollTop).toBe(0);
  });

  it('does nothing for a query-only change', async () => {
    await mount('/app/pricing');
    await scrollAndFocusSidebar();

    await act(async () => go('/app/pricing?checkout=starter_monthly'));

    expect(main().scrollTop).toBe(600);
    expect(document.activeElement).toBe(sidebarLink());
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls a hash target into view without resetting the page or stealing focus', async () => {
    await mount('/app/pricing');
    await scrollAndFocusSidebar();

    await act(async () => go('/app/pricing#details'));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('#details'));
    expect(main().scrollTop).toBe(600);
    expect(document.activeElement).toBe(sidebarLink());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('honours the hash when it arrives together with a new pathname', async () => {
    await mount('/app/calculator');
    await scrollAndFocusSidebar();

    await act(async () => go('/app/pricing#details'));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(main().scrollTop).toBe(600);
  });

  it('returns to the top, without moving focus, when only the hash is dropped', async () => {
    await mount('/app/pricing#details');
    await scrollAndFocusSidebar();

    await act(async () => go('/app/pricing'));

    expect(main().scrollTop).toBe(0);
    expect(document.activeElement).toBe(sidebarLink());
  });

  // D-6: a hard load is not a page change. Moving focus into <main> there made the
  // first Tab skip everything before it (the cookie banner on a first visit, the
  // skip link and the header after it), so "Skip to main content" was never the
  // first tab stop of a real load. With nothing focused, the browser's first Tab
  // goes to the first control in document order. jsdom has no Tab key, so the
  // test pins the thing that decides it: where focus is after the first render.
  it('leaves focus alone on first load, so the first Tab starts at the top of the document', async () => {
    await mount('/pricing');
    expect(document.activeElement).toBe(document.body);
  });

  it('still starts the first view at the top', async () => {
    await mount('/pricing');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('moves focus into <main> on the first page change after that load, and on every one after it', async () => {
    await mount('/app/calculator');
    expect(document.activeElement).toBe(document.body);

    await act(async () => go('/app/pricing'));
    expect(document.activeElement).toBe(main());

    await act(async () => sidebarLink().focus());
    await act(async () => go('/app/settings'));
    expect(document.activeElement).toBe(main());
  });

  it('does not steal focus on first load when the visitor arrived on an anchor', async () => {
    await mount('/app/pricing#details');
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
