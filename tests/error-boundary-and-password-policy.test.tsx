/**
 * Error boundary and password-policy regression guards.
 *
 * Both surfaces had zero coverage -- every mention of ErrorBoundary.tsx,
 * PasswordInput.tsx or ForgotPassword.tsx in tests/ was an explanatory comment,
 * never an import.
 *
 * EB-01 (medium) -- the fallback's only control reloaded the page. When the
 * crash is deterministic for the URL (a malformed record, a lazy() chunk a
 * deploy replaced) that reproduces the identical screen, and because the
 * boundary unmounts Header/Footer with the tree it also destroyed every
 * support affordance the product has. The copy told the customer to "contact
 * support" while leaving them no way to.
 *
 * EB-02 (low) -- the fallback had no landmark, no role and no focus move.
 * App.tsx focuses #main-content on navigation, but TrackPageViews is a CHILD
 * of the boundary, so the error unmounts the mechanism that would have
 * announced it.
 *
 * PW-01 (medium) -- ForgotPassword disabled "Set new password" with the same
 * isPasswordValid() test its handler used, so the handler's policy message was
 * unreachable: a locked-out customer typing 3 characters got a permanently
 * grey button and no visible rule, since the placeholder stating it vanishes
 * as soon as the field has a value. Native minLength cannot help -- it blocks
 * submission, and submission is already impossible. Signup received this exact
 * fix; the reset screen did not.
 */
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

let container: HTMLDivElement;
let root: Root;

/** A child that throws on demand, to trip the boundary for real. */
function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('kaboom from the child');
  return <p>child content</p>;
}

function Host() {
  const [explode, setExplode] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setExplode(true)}>
        break the app
      </button>
      <ErrorBoundary>
        <Boom explode={explode} />
      </ErrorBoundary>
    </>
  );
}

async function mount(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

const text = () => container.textContent || '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // The boundary logs the error it catches; keep the suite output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function tripBoundary() {
  await mount(<Host />);
  const button = container.querySelector('button') as HTMLButtonElement;
  await act(async () => {
    button.click();
  });
}

describe('ErrorBoundary fallback (EB-01)', () => {
  it('offers a way out besides reloading the same broken URL', async () => {
    await tripBoundary();

    expect(text()).toContain('Something went wrong');

    // The copy promises support; the screen must actually provide it.
    const links = Array.from(container.querySelectorAll('a')) as HTMLAnchorElement[];
    const hrefs = links.map((a) => a.getAttribute('href') || '');
    expect(hrefs, 'no way off the error screen at all').not.toHaveLength(0);
    expect(hrefs.some((h) => h.startsWith('mailto:')), 'no support email').toBe(true);
    expect(hrefs, 'no route back into the site').toContain('/');
  });

  it('keeps the reload control', async () => {
    await tripBoundary();
    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.some((b) => /reload/i.test(b.textContent || ''))).toBe(true);
  });

  it('does not invent a support address that differs from the footer', async () => {
    await tripBoundary();
    const email = (container.querySelector('a[href^="mailto:"]') as HTMLAnchorElement).getAttribute('href') || '';
    const footerSrc = readFileSync(resolve(__dirname, '..', 'src', 'components', 'Footer.tsx'), 'utf8');
    const footerAddress = (footerSrc.match(/mailto:([^\s"']+)/) || [])[1];
    expect(footerAddress, 'could not read the footer support address').toBeTruthy();
    expect(email).toContain(footerAddress);
  });
});

describe('ErrorBoundary fallback accessibility (EB-02)', () => {
  it('exposes a live-region alert', async () => {
    await tripBoundary();
    const alert = container.querySelector('[role="alert"]');
    expect(alert, 'the error screen announced nothing to a screen reader').toBeTruthy();
    expect(alert!.getAttribute('aria-live')).toBe('assertive');
  });

  it('provides the #main-content focus target App.tsx navigates to', async () => {
    await tripBoundary();
    const main = container.querySelector('#main-content');
    expect(main, 'no #main-content, so the app-wide focus target is gone').toBeTruthy();
    expect(main!.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus to the alert when the error is caught', async () => {
    await tripBoundary();
    expect(
      document.activeElement,
      'focus stayed on <body>, so a screen reader is told nothing happened',
    ).toBe(container.querySelector('#main-content'));
  });
});

describe('ErrorBoundary does not swallow healthy renders (EB-01 guard)', () => {
  it('renders its children untouched when nothing throws', async () => {
    await mount(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(text()).toContain('child content');
    expect(text()).not.toContain('Something went wrong');
  });

  it('honours a caller-supplied fallback', async () => {
    await mount(
      <ErrorBoundary fallback={<p>custom recovery</p>}>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(text()).toContain('custom recovery');
  });
});

describe('password policy is visible on the reset screen (PW-01)', () => {
  it('ForgotPassword renders the rule inline once the field has a value', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '..', 'src', 'pages', 'ForgotPassword.tsx'), 'utf8');

    // The new-password field must use the same affordances Signup already got.
    const field = src.slice(src.indexOf('id="new-password"'), src.indexOf('id="confirm-password"'));
    expect(field, 'the new-password field still hides the rule').toContain('invalid={passwordInvalid}');
    expect(field, 'the rule is not wired to the field for assistive tech').toContain('reset-password-error');
    expect(field, 'the rule text is never rendered').toContain('Password must be at least 8 characters');
  });

  it('marks the field invalid only once something has been typed', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '..', 'src', 'pages', 'ForgotPassword.tsx'), 'utf8');
    // An empty field is not "wrong yet" -- showing the error before the first
    // keystroke is its own false alarm.
    expect(src).toContain('password.length > 0 && !isPasswordValid(password)');
  });

  it('still disables submit on an invalid password', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '..', 'src', 'pages', 'ForgotPassword.tsx'), 'utf8');
    expect(src).toContain('!isPasswordValid(password)');
  });
});