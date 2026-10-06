/**
 * Auth-flow regressions, 2026-10-05 audit.
 *
 * AUTH-01 — the InsForge SDK deletes `?error=` from the URL itself, before
 * React Router ever reads it. Its Auth constructor calls detectAuthCallback(),
 * which calls cleanUrlParams("error") before its first await — synchronously,
 * when createClient() is evaluated at module import. `src/App.tsx` statically
 * imports `src/lib/insforge`, so the strip wins the race against the router
 * snapshot every time (OAuth callbacks are always full document loads).
 *
 * Consequences that were live:
 *   - `searchParams.get('error')` in AuthCallback was dead code, so a denied
 *     consent or an IdP fault showed the generic "we could not finish signing
 *     you in" instead of the reason. `error_description`, which the SDK does
 *     NOT strip, was present in the URL and ignored.
 *   - Worse: with `error` gone, the effect fell through to getCurrentUser(),
 *     which in browser mode answers from any session in local storage. A failed
 *     OAuth round trip with a stale session navigated to /app as if sign-in had
 *     succeeded, and the user never saw the failure.
 *
 * AUTH-02 — the OAuth failure recovery link was a bare /login, so the stashed
 * purchase intent was dropped by the next startProviderSignIn call. A prospect
 * who picked Growth/annual, failed one Google attempt and retried lost the sale.
 *
 * AUTH-03 — Signup ignored `?redirect=`. App.tsx sends anonymous visitors on a
 * protected route to /login?redirect=<path+search>, and Login forwards every
 * param to /signup, so a deep link was silently dropped.
 *
 * AUTH-05 — the "I already have a code" button set the reset step without an
 * email, and the subtitle interpolated it, rendering "If an account exists for
 * , we've emailed a reset code." on exactly the path the button exists to serve.
 *
 * AUTH-08 — that same step reset cleared the code but left the new password in
 * state, so a later step forward showed a stale password from a previous code.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  peekAuthIntent,
  readIntentFromCheckout,
  readIntentFromParams,
  safeRedirectPath,
  takeAuthIntent,
} from '../src/lib/authIntent';

const readRepoFile = (...segments: string[]) =>
  readFileSync(resolve(__dirname, '..', ...segments), 'utf8');

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('safeRedirectPath accepts only same-origin paths', () => {
  const intent = { plan: 'growth', billing: 'annual' as const };
  const fallback = '/app?checkout=growth_annual';

  it('passes a same-origin absolute path through', () => {
    expect(safeRedirectPath('/app/calculator', null)).toBe('/app/calculator');
    expect(safeRedirectPath('/app/reports?year=2026', null)).toBe('/app/reports?year=2026');
  });

  it.each([
    ['//evil.com', 'protocol-relative host'],
    ['/\\evil.com', 'backslash host'],
    ['https://evil.com/x', 'cross-origin absolute'],
    ['/\\evil.com/path', 'backslash host with path'],
  ])('rejects %s (%s)', (candidate) => {
    // Falls back to the intent destination rather than navigating off-origin.
    expect(safeRedirectPath(candidate, intent)).toBe(fallback);
  });

  it('falls back to the intent when no redirect is given', () => {
    expect(safeRedirectPath(null, intent)).toBe(fallback);
    expect(safeRedirectPath('', intent)).toBe(fallback);
    expect(safeRedirectPath(null, null)).toBe('/app');
  });

  it('prefers an explicit same-origin redirect over the intent', () => {
    expect(safeRedirectPath('/app/calculator', intent)).toBe('/app/calculator');
  });
});

describe('intent readers stay strict', () => {
  it('accepts only known plans', () => {
    expect(readIntentFromParams(new URLSearchParams('plan=pro&billing=annual'))).toEqual({
      plan: 'pro',
      billing: 'annual',
    });
    expect(readIntentFromParams(new URLSearchParams('plan=enterprise'))).toBeNull();
    expect(readIntentFromParams(new URLSearchParams('plan='))).toBeNull();
    // Defaults to monthly when billing is absent or unrecognised.
    expect(readIntentFromParams(new URLSearchParams('plan=growth&billing=weekly'))).toEqual({
      plan: 'growth',
      billing: 'monthly',
    });
  });

  it('rejects a malformed checkout trigger', () => {
    expect(readIntentFromCheckout('growth_annual')).toEqual({ plan: 'growth', billing: 'annual' });
    expect(readIntentFromCheckout('growth')).toBeNull();
    expect(readIntentFromCheckout('growth_annual_extra')).toBeNull();
    expect(readIntentFromCheckout('admin_monthly')).toBeNull();
  });
});

// ── sessionStorage-backed intent lifecycle ───────────────────────────────────

describe('peekAuthIntent reads without destroying', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('returns null when nothing is stashed', () => {
    expect(peekAuthIntent()).toBeNull();
  });

  it('does not consume the intent, so a retry link can pass it on', () => {
    // AUTH-02: the OAuth failure screen needs to read the intent and leave it
    // in place. takeAuthIntent() is destructive by design and would delete the
    // very thing the recovery link is trying to carry.
    sessionStorage.setItem('ecoauditor.auth.intent', JSON.stringify({ plan: 'growth', billing: 'annual' }));

    expect(peekAuthIntent()).toEqual({ plan: 'growth', billing: 'annual' });
    expect(peekAuthIntent()).toEqual({ plan: 'growth', billing: 'annual' });

    // The destructive read still consumes it afterwards.
    expect(takeAuthIntent()).toEqual({ plan: 'growth', billing: 'annual' });
    expect(takeAuthIntent()).toBeNull();
  });

  it('ignores a corrupted or unknown stored intent', () => {
    sessionStorage.setItem('ecoauditor.auth.intent', 'not json');
    expect(peekAuthIntent()).toBeNull();

    sessionStorage.setItem('ecoauditor.auth.intent', JSON.stringify({ plan: 'enterprise', billing: 'monthly' }));
    expect(peekAuthIntent()).toBeNull();
  });
});

// ── Source guards for the SDK race and the copy defect ───────────────────────

describe('AuthCallback does not depend on the SDK-stripped param', () => {
  const source = readRepoFile('src', 'pages', 'AuthCallback.tsx');

  it('treats error_description as a provider error in its own right', () => {
    // The strip only removes `error`. If the short-circuit does not also key
    // off `error_description`, the effect falls through to getCurrentUser() and
    // a stale local session signs the user in after a failed round trip.
    expect(source).toContain("searchParams.get('error_description')");
    expect(source).toMatch(/get\('error'\)\s*\|\|\s*providerErrorDescription/);
  });

  it('carries the stashed intent on the recovery link', () => {
    expect(source).toContain('peekAuthIntent');
    expect(source).toMatch(/retryHref[\s\S]{0,200}plan=/);
    expect(source).not.toMatch(/<Link to="\/login"/);
  });

  it('never navigates to /app on the provider-error path', () => {
    const shortCircuit = source.indexOf('if (providerError) return;');
    const navigate = source.indexOf('navigate(destinationFor(takeAuthIntent())');
    expect(shortCircuit).toBeGreaterThan(-1);
    expect(shortCircuit).toBeLessThan(navigate);
  });
});

describe('Signup honours the redirect it is forwarded', () => {
  const source = readRepoFile('src', 'pages', 'Signup.tsx');

  it('resolves its destination through the shared same-origin helper', () => {
    expect(source).toContain('safeRedirectPath(searchParams.get(\'redirect\'), intent)');
    // No hardcoded destination may survive on a post-signup navigation.
    expect(source).not.toContain('navigate(destinationFor(');
  });

  it('does not carry its own copy of the redirect validation', () => {
    // One reader for the same-origin rule; Login imports the same helper.
    expect(source).not.toMatch(/startsWith\('\/\/'\)/);
  });
});

describe('ForgotPassword never renders an empty address', () => {
  const source = readRepoFile('src', 'pages', 'ForgotPassword.tsx');

  it('guards the interpolation instead of printing the raw value', () => {
    expect(source).not.toMatch(/subtitle=\{`If an account exists for \$\{email\}/);
    expect(source).toMatch(/email\.trim\(\)\s*\?/);
  });

  it('clears the password fields when leaving the reset step', () => {
    // AUTH-08: clearing only the code left a stale new password bound to a
    // code the customer no longer holds.
    const handler = source.match(/setStep\('request'\);[^\n]*/)?.[0] ?? '';
    expect(handler).toContain("setCode('')");
    expect(handler).toContain("setPassword('')");
    expect(handler).toContain("setConfirm('')");
  });
});