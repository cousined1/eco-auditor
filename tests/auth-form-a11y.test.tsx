// F-C-13: the auth forms used placeholder text as the only visible label,
// raised the password-rule alert on the first keystroke, and printed server
// errors below three OAuth buttons, far from the form that caused them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  getCurrentUser: vi.fn(),
  sendResetPasswordEmail: vi.fn(),
}));

vi.mock('../src/lib/insforge', () => ({
  insforge: { auth },
  isInsForgeConfigured: true,
}));

import {
  blurField,
  buttonByText,
  byId,
  click,
  renderAuthRoutes,
  submitButton,
  typeInto,
  unmountAll,
} from './auth-test-utils';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const fn of Object.values(auth)) fn.mockReset();
  auth.getCurrentUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

function expectVisibleLabel(container: HTMLElement, inputId: string) {
  const label = container.querySelector(`label[for="${inputId}"]`);
  expect(label, `#${inputId} has a label`).not.toBeNull();
  expect(label?.classList.contains('sr-only'), `#${inputId} label is visible`).toBe(false);
  expect(label?.textContent?.trim()).not.toBe('');
}

/** True when `first` comes before `second` in document order. */
function precedes(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('visible labels on every auth form', () => {
  it('signup', async () => {
    const container = await renderAuthRoutes('/signup');
    for (const id of ['signup-name', 'signup-email', 'signup-password']) expectVisibleLabel(container, id);
  });

  it('login', async () => {
    const container = await renderAuthRoutes('/login');
    for (const id of ['login-email', 'login-password']) expectVisibleLabel(container, id);
  });

  it('forgot password, both steps', async () => {
    const container = await renderAuthRoutes('/forgot-password');
    expectVisibleLabel(container, 'reset-email');
    await click(buttonByText(container, /already have a code/i));
    for (const id of ['reset-step-email', 'reset-code', 'new-password', 'confirm-password']) {
      expectVisibleLabel(container, id);
    }
  });

  it('email verification', async () => {
    const container = await renderAuthRoutes('/auth/verify-email');
    for (const id of ['verify-email', 'verify-code']) expectVisibleLabel(container, id);
  });
});

describe('signup password rule', () => {
  it('is shown as helper text before anything is typed', async () => {
    const container = await renderAuthRoutes('/signup');
    const field = byId(container, 'signup-password');
    const hintIds = (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(hintIds).toContain('signup-password-hint');
    expect(byId<HTMLElement>(container, 'signup-password-hint').textContent).toMatch(/8 characters/);
  });

  it('raises no alert while typing, and a linked error once the field is left invalid', async () => {
    const container = await renderAuthRoutes('/signup');
    const field = byId(container, 'signup-password');

    await typeInto(field, 'a');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBe('false');

    await blurField(field);
    const error = container.querySelector('#signup-password-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('signup-password-error');

    await typeInto(field, 'abcdefg1');
    expect(container.querySelector('#signup-password-error')).toBeNull();
  });
});

describe('server errors appear with the form, above its submit button', () => {
  it('signup', async () => {
    auth.signUp.mockResolvedValue({ data: null, error: { statusCode: 409, error: 'USER_EXISTS', message: 'User already exists' } });
    const container = await renderAuthRoutes('/signup');
    await typeInto(byId(container, 'signup-email'), 'someone@example.test');
    await typeInto(byId(container, 'signup-password'), 'not-a-real-pw1');
    await click(submitButton(container));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('User already exists');
    expect(alert?.closest('form')).not.toBeNull();
    expect(precedes(alert as Element, submitButton(container))).toBe(true);
  });

  it('login', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { statusCode: 401, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
    const container = await renderAuthRoutes('/login');
    await typeInto(byId(container, 'login-email'), 'someone@example.test');
    await typeInto(byId(container, 'login-password'), 'not-a-real-pw1');
    await click(submitButton(container));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.closest('form')).not.toBeNull();
    expect(precedes(alert as Element, submitButton(container))).toBe(true);
  });
});

describe('forgot-password confirmation', () => {
  it('does not report a mismatch on the first keystroke, only after leaving the field', async () => {
    const container = await renderAuthRoutes('/forgot-password');
    await click(buttonByText(container, /already have a code/i));
    await typeInto(byId(container, 'new-password'), 'abcdefg1');
    const confirm = byId(container, 'confirm-password');

    await typeInto(confirm, 'a');
    expect(container.querySelector('#confirm-password-error')).toBeNull();

    await blurField(confirm);
    expect(container.querySelector('#confirm-password-error')?.getAttribute('role')).toBe('alert');
    expect(confirm.getAttribute('aria-describedby')).toContain('confirm-password-error');
  });
});

describe('session-expired notice', () => {
  it('tells a user who was signed out mid-session why they are on the sign-in page', async () => {
    const container = await renderAuthRoutes({
      pathname: '/login',
      search: '?redirect=%2Fapp',
      state: { authNotice: 'session-expired' },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/session expired/i);
  });

  it('shows nothing on a normal visit', async () => {
    const container = await renderAuthRoutes('/login');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
