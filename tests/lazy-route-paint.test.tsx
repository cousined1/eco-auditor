// F-F-14 makes most public pages lazy in the production build (src/routePages.lazy.ts)
// and deliberately wraps them in NO <Suspense>. That only works if React keeps what is
// on screen while a lazy page loads: the prerendered HTML on a hard load, the old page
// on a client-side navigation. A boundary-less lazy page that instead showed a
// fallback, or an empty root, would flash blank on every first visit of a page.
// This pins that behaviour against the React and react-router versions in use.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyRoute } from '../src/lib/chunkRecovery';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function deferredPage(label: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const Page = lazyRoute(() => gate.then(() => ({ default: () => <main id="lazy-page">{label}</main> })), `Test${label}`);
  return { Page, release: () => act(async () => { release(); await gate; }) };
}

describe('a lazy public page with no Suspense boundary above it', () => {
  it('leaves the prerendered HTML on screen until the chunk is ready, then swaps it in one commit', async () => {
    container.innerHTML = '<main id="prerendered">Prerendered legal page</main>';
    const { Page, release } = deferredPage('Client page');

    await act(async () =>
      root.render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>,
      ),
    );
    expect(container.querySelector('#prerendered')?.textContent).toBe('Prerendered legal page');
    expect(container.querySelector('#lazy-page')).toBeNull();
    expect(container.textContent).not.toContain('Loading');

    await release();
    expect(container.querySelector('#lazy-page')?.textContent).toBe('Client page');
    expect(container.querySelector('#prerendered')).toBeNull();
  });

  it('keeps the page the visitor is on while the next one loads, on a client-side navigation', async () => {
    const next = deferredPage('Next page');
    const tree: ReactNode = (
      <MemoryRouter initialEntries={['/a']}>
        <Routes>
          <Route path="/a" element={<main id="current">Current page <Link to="/b">go</Link></main>} />
          <Route path="/b" element={<next.Page />} />
        </Routes>
      </MemoryRouter>
    );
    await act(async () => root.render(tree));
    expect(container.querySelector('#current')).not.toBeNull();

    await act(async () => container.querySelector('a')!.click());
    // The chunk has not arrived: still the old page, not a spinner and not a blank.
    expect(container.querySelector('#current')).not.toBeNull();
    expect(container.querySelector('#lazy-page')).toBeNull();

    await next.release();
    expect(container.querySelector('#lazy-page')?.textContent).toBe('Next page');
    expect(container.querySelector('#current')).toBeNull();
  });
});
