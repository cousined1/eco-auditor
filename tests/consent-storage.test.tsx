// FEW-01 regression: ConsentProvider must never throw when localStorage is
// blocked (SecurityError, e.g. "Block all cookies" / private modes). It mounts
// above the app ErrorBoundary (src/main.tsx), so an unguarded storage write in
// its mount effect or a consent handler unmounts the React root and blanks the
// whole site. Same guard convention as src/hooks/useTheme.tsx (FE-03): storage
// failures degrade to in-memory consent state for the session.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentProvider, useConsent, type ConsentContextType } from '../src/lib/consent-context';

// Every storage method throws, simulating blocked browser storage.
function makeBlockedStorage(): Storage {
  const boom = (): never => {
    throw new DOMException('Storage is blocked for this origin', 'SecurityError');
  };
  return {
    get length(): number {
      return 0;
    },
    clear: boom,
    getItem: boom,
    key: (): string | null => {
      throw new DOMException('Storage is blocked for this origin', 'SecurityError');
    },
    removeItem: boom,
    setItem: boom,
  };
}

let captured: ConsentContextType | null = null;

// Renders nothing visible but records the live consent API as it updates.
function Probe() {
  const api = useConsent();
  useEffect(() => {
    captured = api;
  }, [api]);
  return <div>consent probe</div>;
}

async function mountProvider() {
  captured = null;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  // A throw inside ConsentProvider's mount effect propagates through act and
  // fails the test — this is the "no white-screen above the ErrorBoundary" assert.
  await act(async () => {
    root.render(
      <ConsentProvider>
        <Probe />
      </ConsentProvider>,
    );
  });
  return { container, root };
}

describe('ConsentProvider with blocked localStorage (FEW-01)', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // /api/consent-audit is fire-and-forget; stub it so tests stay hermetic.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    vi.stubGlobal('localStorage', makeBlockedStorage());
    // Global Privacy Control on: this is the repro path where the mount
    // effect auto-rejects and writes the consent record on mount.
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
  });

  afterEach(async () => {
    delete (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
    vi.unstubAllGlobals();
  });

  it('mounts (GPC auto-reject write path) without crashing and keeps children rendered', async () => {
    const { container, root } = await mountProvider();
    expect(container.textContent).toContain('consent probe');
    // The privacy-signal rejection is still honored from memory.
    expect(captured?.consentState.hasConsented).toBe(true);
    expect(captured?.consentState.consent.marketing).toBe(false);
    await act(async () => root.unmount());
    container.remove();
  });

  it('acceptAll keeps working in memory when the persist write throws', async () => {
    const { root } = await mountProvider();
    await act(async () => captured?.acceptAll());
    expect(captured?.consentState.hasConsented).toBe(true);
    expect(captured?.consentState.consent.analytics).toBe(true);
    await act(async () => root.unmount());
  });

  it('resetConsent still resets in-memory state when removeItem throws', async () => {
    const { root } = await mountProvider();
    await act(async () => captured?.acceptAll());
    await act(async () => captured?.resetConsent());
    expect(captured?.consentState.hasConsented).toBe(false);
    expect(captured?.consentState.consent.analytics).toBe(false);
    await act(async () => root.unmount());
  });
});
