import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePostAuthRedirect } from '../src/lib/authIntent';
import {
  EMAIL_NOT_VERIFIED_CODES,
  isEmailNotVerifiedError,
  normalizeVerificationCode,
  readVerifyEmailState,
  verifyEmailHref,
} from '../src/components/auth/emailVerification';

const ORIGIN = 'https://ecoauditor.io';
const params = (query: string) => new URLSearchParams(query);

describe('resolvePostAuthRedirect (shared by /login and the verification step)', () => {
  it('falls back to the purchase intent, or /app', () => {
    expect(resolvePostAuthRedirect(params(''), ORIGIN)).toBe('/app');
    expect(resolvePostAuthRedirect(params('plan=growth&billing=annual'), ORIGIN)).toBe('/app?checkout=growth_annual');
    expect(resolvePostAuthRedirect(params('plan=pro'), ORIGIN)).toBe('/app?checkout=pro_monthly');
  });

  it('honours a same-origin redirect path', () => {
    expect(resolvePostAuthRedirect(params('redirect=%2Fapp%2Fsettings%3Ftab%3Dbilling'), ORIGIN)).toBe('/app/settings?tab=billing');
  });

  it.each([
    '//evil.example/phish',
    '/\\evil.example',
    'https://evil.example/app',
    'javascript:alert(1)',
    'app/settings',
  ])('never redirects off-site or to a non-path: %s', (redirect) => {
    const query = new URLSearchParams({ redirect, plan: 'starter' });
    expect(resolvePostAuthRedirect(query, ORIGIN)).toBe('/app?checkout=starter_monthly');
  });

  it('defaults to the current page origin', () => {
    expect(resolvePostAuthRedirect(params('redirect=%2Fapp%2Fintake'))).toBe('/app/intake');
    expect(resolvePostAuthRedirect(params('plan=starter'))).toBe('/app?checkout=starter_monthly');
  });
});

describe('isEmailNotVerifiedError', () => {
  it('matches the production refusal: 403 EMAIL_NOT_VERIFIED', () => {
    expect(isEmailNotVerifiedError({ statusCode: 403, error: 'EMAIL_NOT_VERIFIED' })).toBe(true);
  });

  it('also matches the local e2e mock code, through the same constant', () => {
    expect(EMAIL_NOT_VERIFIED_CODES).toContain('AUTH_NEED_VERIFICATION');
    expect(isEmailNotVerifiedError({ statusCode: 403, error: 'AUTH_NEED_VERIFICATION' })).toBe(true);
  });

  it('ignores every other failure', () => {
    expect(isEmailNotVerifiedError(null)).toBe(false);
    expect(isEmailNotVerifiedError({ statusCode: 401, error: 'INVALID_CREDENTIALS' })).toBe(false);
    expect(isEmailNotVerifiedError({ statusCode: 403, error: 'AUTH_UNAUTHORIZED' })).toBe(false);
    expect(isEmailNotVerifiedError({ statusCode: 400, error: 'EMAIL_NOT_VERIFIED' })).toBe(false);
  });
});

describe('verification helpers', () => {
  it('keeps digits only, capped at six, so pasted codes work', () => {
    expect(normalizeVerificationCode('123 456')).toBe('123456');
    expect(normalizeVerificationCode('12-34-56')).toBe('123456');
    expect(normalizeVerificationCode('code: 1234567')).toBe('123456');
    expect(normalizeVerificationCode('abc')).toBe('');
  });

  it('reads only a well-formed router state', () => {
    expect(readVerifyEmailState({ email: ' a@example.test ', codeSent: true })).toEqual({ email: 'a@example.test', codeSent: true });
    expect(readVerifyEmailState({ email: 'a@example.test', codeSent: 'yes' })).toEqual({ email: 'a@example.test', codeSent: false });
    expect(readVerifyEmailState({ email: '' })).toBeNull();
    expect(readVerifyEmailState(null)).toBeNull();
    expect(readVerifyEmailState('a@example.test')).toBeNull();
  });

  it('keeps the query string (plan intent, redirect) but never puts the address in the URL', () => {
    expect(verifyEmailHref(params(''))).toBe('/auth/verify-email');
    expect(verifyEmailHref(params('plan=growth&billing=annual'))).toBe('/auth/verify-email?plan=growth&billing=annual');
  });
});

describe('auth config contract', () => {
  // The verification page accepts a 6-digit code. Switching the project to
  // link verification (or turning verification off) changes what users
  // receive and must come with a matching UI change: the dead end this page
  // fixes came from exactly that kind of mismatch.
  it('the project verifies email addresses with a code', () => {
    const toml = readFileSync(resolve('insforge.toml'), 'utf8');
    expect(toml).toMatch(/^require_email_verification\s*=\s*true\s*$/m);
    expect(toml).toMatch(/^verify_email_method\s*=\s*"code"\s*$/m);
  });
});
