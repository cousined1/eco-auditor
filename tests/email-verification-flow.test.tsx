// K1 (F-C-01 / F-B-01, F-R1-01, F-R1-02): email/password sign-up must be
// completable. The project verifies email with a 6-digit code
// (insforge.toml), but the app told users to "click the link", had no screen
// that accepts the code, and a sign-in refused as unverified dead-ended on a
// raw error. These tests drive the real pages against a fake SDK.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('../src/lib/insforge', () => ({
  insforge: { auth },
  isInsForgeConfigured: true,
}));

import {
  buttonByText,
  byId,
  click,
  currentLocation,
  renderAuthRoutes,
  submitButton,
  typeInto,
  unmountAll,
} from './auth-test-utils';
import { RESEND_COOLDOWN_SECONDS } from '../src/components/auth/emailVerification';

const NEW_USER = 'new.user@example.test';
const TEST_PASSWORD = 'not-a-real-pw1';
// Shape of InsForge's documented refusal for an unverified address
// (docs.insforge.dev/sdks/rest/auth), which production returns.
const EMAIL_NOT_VERIFIED = {
  statusCode: 403,
  error: 'EMAIL_NOT_VERIFIED',
  message: 'Please verify your email before signing in',
};
const SESSION = { accessToken: 'session-token', csrfToken: 'csrf', user: { id: 'u1', email: NEW_USER } };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const fn of Object.values(auth)) fn.mockReset();
  auth.getCurrentUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function codeInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
  if (!input) throw new Error('no verification-code field');
  return input;
}

async function signUpAs(container: HTMLElement, email: string) {
  await typeInto(byId(container, 'signup-email'), email);
  await typeInto(byId(container, 'signup-password'), TEST_PASSWORD);
  await click(submitButton(container));
}

describe('sign-up with email verification required', () => {
  beforeEach(() => {
    auth.signUp.mockResolvedValue({
      data: { user: { id: 'u1', email: NEW_USER }, accessToken: null, requireEmailVerification: true },
      error: null,
    });
  });

  it('asks for the emailed code instead of a link, and sends no redirectTo', async () => {
    const container = await renderAuthRoutes('/signup');
    await signUpAs(container, NEW_USER);

    expect(currentLocation(container)).toBe('/auth/verify-email');
    expect(codeInput(container).getAttribute('inputmode')).toBe('numeric');
    expect(container.textContent).toContain(NEW_USER);
    expect(container.textContent).not.toMatch(/click the link/i);
    // redirectTo only applies to link verification and /login is not
    // allow-listed: the call must carry exactly the account fields.
    expect(auth.signUp).toHaveBeenCalledWith({ email: NEW_USER, password: TEST_PASSWORD });
  });

  it('signs the user in with the code and resumes the plan they picked', async () => {
    auth.verifyEmail.mockResolvedValue({ data: SESSION, error: null });
    const container = await renderAuthRoutes('/signup?plan=growth&billing=annual');
    await signUpAs(container, NEW_USER);

    await typeInto(codeInput(container), '123 456');
    await click(submitButton(container));

    expect(auth.verifyEmail).toHaveBeenCalledWith({ email: NEW_USER, otp: '123456' });
    expect(currentLocation(container)).toBe('/app?checkout=growth_annual');
  });

  it('lands a verified user without a plan on /app', async () => {
    auth.verifyEmail.mockResolvedValue({ data: SESSION, error: null });
    const container = await renderAuthRoutes('/signup');
    await signUpAs(container, NEW_USER);

    await typeInto(codeInput(container), '654321');
    await click(submitButton(container));

    expect(currentLocation(container)).toBe('/app');
  });

  it('holds the resend button for the cooldown right after a code was sent', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const container = await renderAuthRoutes({
      pathname: '/auth/verify-email',
      state: { email: NEW_USER, codeSent: true },
    });
    const resend = buttonByText(container, /send a new code/i);
    expect(resend.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTime((RESEND_COOLDOWN_SECONDS - 1) * 1000));
    expect(resend.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(resend.disabled).toBe(false);
  });
});

describe('sign-in refused because the email is not verified (production 403 EMAIL_NOT_VERIFIED)', () => {
  const STUCK_USER = 'stuck.user@example.test';

  beforeEach(() => {
    auth.signInWithPassword.mockResolvedValue({ data: null, error: EMAIL_NOT_VERIFIED });
  });

  async function signInAs(container: HTMLElement) {
    await typeInto(byId(container, 'login-email'), STUCK_USER);
    await typeInto(byId(container, 'login-password'), TEST_PASSWORD);
    await click(submitButton(container));
  }

  it('opens the code screen with a working resend instead of a dead-end error', async () => {
    auth.resendVerificationEmail.mockResolvedValue({ data: { success: true, message: 'sent' }, error: null });
    const container = await renderAuthRoutes('/login');
    await signInAs(container);

    expect(currentLocation(container)).toBe('/auth/verify-email');
    expect(byId(container, 'verify-email').value).toBe(STUCK_USER);
    codeInput(container);

    const resend = buttonByText(container, /send a new code/i);
    expect(resend.disabled).toBe(false);
    await click(resend);

    // No redirectTo: it is link-mode only and must be allow-listed.
    expect(auth.resendVerificationEmail).toHaveBeenCalledWith({ email: STUCK_USER });
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/new code is on its way/i);
    expect(buttonByText(container, /send a new code/i).disabled).toBe(true);
  });

  it('keeps the redirect target through verification', async () => {
    auth.verifyEmail.mockResolvedValue({ data: SESSION, error: null });
    const container = await renderAuthRoutes('/login?redirect=%2Fapp%2Fsettings');
    await signInAs(container);
    expect(currentLocation(container)).toBe('/auth/verify-email?redirect=%2Fapp%2Fsettings');

    await typeInto(codeInput(container), '112233');
    await click(submitButton(container));

    expect(currentLocation(container)).toBe('/app/settings');
  });

  it('still shows other sign-in errors on the form', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { statusCode: 401, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    const container = await renderAuthRoutes('/login');
    await signInAs(container);

    expect(currentLocation(container)).toBe('/login');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid email or password');
  });
});

describe('verification page', () => {
  it('shows a rejected code next to the field, and stays put', async () => {
    auth.verifyEmail.mockResolvedValue({
      data: null,
      error: { statusCode: 400, error: 'AUTH_UNAUTHORIZED', message: 'Invalid or expired verification code' },
    });
    const container = await renderAuthRoutes({ pathname: '/auth/verify-email', state: { email: NEW_USER, codeSent: true } });

    await typeInto(codeInput(container), '000000');
    await click(submitButton(container));

    const field = codeInput(container);
    const alert = container.querySelector('#verify-code-error');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('verify-code-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(currentLocation(container)).toBe('/auth/verify-email');
  });

  it('never follows an off-site redirect after verification', async () => {
    auth.verifyEmail.mockResolvedValue({ data: SESSION, error: null });
    const container = await renderAuthRoutes({
      pathname: '/auth/verify-email',
      search: '?redirect=%2F%2Fevil.example%2Fphish',
      state: { email: NEW_USER, codeSent: true },
    });

    await typeInto(codeInput(container), '123456');
    await click(submitButton(container));

    expect(currentLocation(container)).toBe('/app');
  });

  it('works when opened directly (no state): the address can be typed in', async () => {
    auth.verifyEmail.mockResolvedValue({ data: SESSION, error: null });
    const container = await renderAuthRoutes('/auth/verify-email');

    expect(byId(container, 'verify-email').value).toBe('');
    await typeInto(byId(container, 'verify-email'), NEW_USER);
    await typeInto(codeInput(container), '123456');
    await click(submitButton(container));

    expect(auth.verifyEmail).toHaveBeenCalledWith({ email: NEW_USER, otp: '123456' });
    expect(currentLocation(container)).toBe('/app');
  });

  it('is reachable from the sign-in page without first failing a sign-in', async () => {
    const container = await renderAuthRoutes('/login?plan=starter');
    const link = Array.from(container.querySelectorAll('a')).find((a) => /enter your code/i.test(a.textContent ?? ''));
    expect(link?.getAttribute('href')).toBe('/auth/verify-email?plan=starter');
  });
});
