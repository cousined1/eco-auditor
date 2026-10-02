// F-B-19 (chunk-load failures) and F-C-25 (the boundary's "contact support" had no link).
import { Suspense, act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { lazyRoute, retryChunkLoads } from '../src/lib/chunkRecovery';

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://ecoauditor.example/assets/DataIntake-DCvs-0VE.js');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // React and the boundary both log every caught render error.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

function goOffline() {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no "${name}" button in: ${container.textContent}`);
  return found;
}

function Throws({ error }: { error: Error }): never {
  throw error;
}

describe('ErrorBoundary: generic errors', () => {
  it('keeps the generic message for an ordinary error and now links to support', async () => {
    await render(
      <ErrorBoundary>
        <Throws error={new Error('boom')} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('Something went wrong');
    const link = container.querySelector('a');
    expect(link?.textContent).toBe('contact support');
    expect(link?.getAttribute('href')).toBe('/contact/');
    expect(button('Reload page')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('does not describe an ordinary error as an offline or new-version problem', async () => {
    goOffline();
    await render(
      <ErrorBoundary>
        <Throws error={new TypeError("Cannot read properties of undefined (reading 'map')")} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).not.toContain('offline');
    expect(container.textContent).not.toContain('needs a reload');
    expect(container.textContent).not.toContain('updated');
  });

  it('renders a supplied fallback instead of its own message', async () => {
    await render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <Throws error={new Error('boom')} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toBe('custom fallback');
  });
});

describe('ErrorBoundary: chunk-load errors', () => {
  it('online: says a reload is needed (not "contact support") and offers Reload', async () => {
    await render(
      <ErrorBoundary>
        <Throws error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('This page needs a reload');
    expect(container.textContent).toContain('updated');
    expect(container.textContent).not.toContain('Something went wrong');
    expect(container.textContent).not.toContain('contact support');
    expect(button('Reload page')).toBeTruthy();
  });

  it('offline: says so and offers an in-place Try again, not a reload', async () => {
    goOffline();
    await render(
      <ErrorBoundary>
        <Throws error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('You appear to be offline');
    expect(button('Try again')).toBeTruthy();
    expect(container.textContent).not.toContain('Reload page');
  });

  it('inShell: the failure is contained to the page area, so the sidebar and navigation survive', async () => {
    await render(
      <div>
        <nav aria-label="Main navigation">Sidebar: Dashboard, Data Intake, Settings</nav>
        <main>
          <ErrorBoundary inShell>
            <Throws error={chunkError()} />
          </ErrorBoundary>
        </main>
      </div>,
    );

    expect(container.querySelector('nav')?.textContent).toContain('Data Intake');
    expect(container.querySelector('main')?.textContent).toContain('This page needs a reload');
    // The full-screen variant would cover the whole viewport.
    expect(container.innerHTML).not.toContain('min-h-screen');
  });
});

describe('ErrorBoundary: recovering without a reload', () => {
  it('Try again re-renders the children and runs onReset first', async () => {
    goOffline();
    const calls: string[] = [];
    let broken = true;
    function Page() {
      if (broken) throw chunkError();
      return <p>Data Intake page</p>;
    }
    await render(
      <ErrorBoundary onReset={() => calls.push('reset')}>
        <Page />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('You appear to be offline');

    broken = false;
    await act(async () => button('Try again').click());

    expect(calls).toEqual(['reset']);
    expect(container.textContent).toContain('Data Intake page');
    expect(container.textContent).not.toContain('offline');
  });

  it('navigating (a new resetKey) clears a shown error and retries the new route', async () => {
    const onReset = vi.fn();
    await render(
      <ErrorBoundary resetKey="key-1" onReset={onReset}>
        <Throws error={chunkError()} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('This page needs a reload');

    await render(
      <ErrorBoundary resetKey="key-2" onReset={onReset}>
        <p>Dashboard</p>
      </ErrorBoundary>,
    );

    expect(container.textContent).toBe('Dashboard');
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('a re-render with the same resetKey does not retry a failing page', async () => {
    const onReset = vi.fn();
    const tree = () => (
      <ErrorBoundary resetKey="key-1" onReset={onReset}>
        <Throws error={chunkError()} />
      </ErrorBoundary>
    );
    await render(tree());
    await render(tree());

    expect(container.textContent).toContain('This page needs a reload');
    expect(onReset).not.toHaveBeenCalled();
  });

  it('a resetKey change with nothing wrong does nothing', async () => {
    const onReset = vi.fn();
    await render(
      <ErrorBoundary resetKey="key-1" onReset={onReset}>
        <p>fine</p>
      </ErrorBoundary>,
    );
    await render(
      <ErrorBoundary resetKey="key-2" onReset={onReset}>
        <p>fine</p>
      </ErrorBoundary>,
    );

    expect(onReset).not.toHaveBeenCalled();
  });
});

describe('lazyRoute inside the in-shell boundary (the offline reproduction from the audit)', () => {
  type Module = { default: ComponentType };

  it('offline: shows the in-shell message, then loads the page after reconnecting, with no reload', async () => {
    goOffline();
    const load = vi.fn<() => Promise<Module>>().mockRejectedValueOnce(chunkError());
    const DataIntake = lazyRoute(load, 'IntegrationDataIntake');

    await render(
      <div>
        <nav>Sidebar</nav>
        <ErrorBoundary inShell onReset={retryChunkLoads}>
          <Suspense fallback={<p>Loading…</p>}>
            <DataIntake />
          </Suspense>
        </ErrorBoundary>
      </div>,
    );

    expect(container.textContent).toContain('Sidebar');
    expect(container.textContent).toContain('You appear to be offline');
    expect(load).toHaveBeenCalledTimes(1);

    // Connection back: the next import goes out fresh instead of replaying React's cached rejection.
    load.mockResolvedValueOnce({ default: () => <h1>Data Intake</h1> });
    await act(async () => button('Try again').click());

    expect(load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Data Intake');
    expect(container.textContent).not.toContain('offline');
    expect(container.textContent).toContain('Sidebar');
  });

  it('navigating to the same failed page again retries it (resetKey), instead of replaying the old failure', async () => {
    goOffline();
    const load = vi.fn<() => Promise<Module>>().mockRejectedValueOnce(chunkError());
    const Settings = lazyRoute(load, 'IntegrationSettings');
    const tree = (key: string) => (
      <ErrorBoundary inShell resetKey={key} onReset={retryChunkLoads}>
        <Suspense fallback={<p>Loading…</p>}>
          <Settings />
        </Suspense>
      </ErrorBoundary>
    );

    await render(tree('nav-1'));
    expect(container.textContent).toContain('You appear to be offline');

    load.mockResolvedValueOnce({ default: () => <h1>Settings</h1> });
    await render(tree('nav-2'));

    expect(container.textContent).toContain('Settings');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('an ordinary page error inside a lazy route is still the generic message, not a chunk message', async () => {
    const load = vi.fn<() => Promise<Module>>().mockResolvedValue({
      default: () => {
        throw new Error('render bug');
      },
    });
    const Broken = lazyRoute(load, 'IntegrationBroken');

    await render(
      <ErrorBoundary inShell>
        <Suspense fallback={<p>Loading…</p>}>
          <Broken />
        </Suspense>
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('Something went wrong');
  });

  it('a page that loaded fine is not re-imported by an unrelated retry', async () => {
    const load = vi.fn<() => Promise<Module>>().mockResolvedValue({ default: () => <h1>Ledger</h1> });
    const Ledger = lazyRoute(load, 'IntegrationLedger');
    const tree = () => (
      <Suspense fallback={<p>Loading…</p>}>
        <Ledger />
      </Suspense>
    );

    await render(tree());
    retryChunkLoads();
    await render(tree());

    expect(container.textContent).toContain('Ledger');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
