import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Signup from '../src/pages/Signup';
import { destinationFor, readIntentFromCheckout, readIntentFromParams, saveAuthIntent, takeAuthIntent } from '../src/lib/authIntent';

const auth = vi.hoisted(() => ({
  signUp: vi.fn(), verifyEmail: vi.fn(), resendVerificationEmail: vi.fn(),
  getCurrentUser: vi.fn(), signInWithOAuth: vi.fn(),
}));
vi.mock('../src/lib/insforge', () => ({ insforge: { auth }, isInsForgeConfigured: true }));

let root: Root;
let container: HTMLDivElement;
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}
async function mount(query: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={[`/signup${query}`]}><Routes><Route path="/signup" element={<Signup />} /><Route path="/app" element={<div>Checkout destination</div>} /></Routes><LocationProbe /></MemoryRouter>));
}
async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
async function createAccount() {
  await type('signup-email', 'buyer@example.com');
  await type('signup-password', 'buyerPassword9');
  await submit();
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.getCurrentUser.mockResolvedValue({ data: { user: null }, error: null });
  auth.signUp.mockResolvedValue({ data: { accessToken: 'session-fixture' }, error: null });
  auth.verifyEmail.mockResolvedValue({ data: { accessToken: 'verified-session-fixture' }, error: null });
  auth.resendVerificationEmail.mockResolvedValue({ data: {}, error: null });
  auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('P2-6 signup retains the buyer’s selected plan and billing', () => {
  it.each(['starter', 'growth', 'pro'])('resumes %s annual checkout after immediate signup', async (plan) => {
    await mount(`?plan=${plan}&billing=annual`);
    expect(container.textContent).toContain('billed annually');
    expect(container.querySelector('h1')?.textContent).toBe('Create your account');
    await createAccount();
    expect(container.querySelector('output')?.textContent).toBe(`/app?checkout=${plan}_annual`);
    expect(auth.signUp.mock.calls[0][0]).not.toHaveProperty('redirectTo');
  });
  it('defaults a valid selected plan to monthly billing and shows the selected price', async () => {
    await mount('?plan=growth');
    expect(container.textContent).toContain('Growth · $399/month, billed monthly');
    await createAccount();
    expect(container.querySelector('output')?.textContent).toBe('/app?checkout=growth_monthly');
  });
  it.each(['', '?plan=enterprise&billing=annual'])('does not start checkout for an absent or invalid plan (%s)', async (query) => {
    await mount(query);
    await createAccount();
    expect(container.querySelector('output')?.textContent).toBe('/app');
  });
  it('retains the exact choice for already authenticated visitors', async () => {
    auth.getCurrentUser.mockResolvedValue({ data: { user: { id: 'buyer' } }, error: null });
    await mount('?plan=pro&billing=annual');
    expect(container.querySelector('output')?.textContent).toBe('/app?checkout=pro_annual');
  });
  it('completes code verification and resumes annual Growth checkout', async () => {
    auth.signUp.mockResolvedValue({ data: { accessToken: null, requireEmailVerification: true }, error: null });
    await mount('?plan=growth&billing=annual');
    await createAccount();
    expect(container.textContent).toContain('six-digit code');
    expect(container.textContent).toContain('Growth, billed annually');
    await type('signup-code', '123456');
    await submit();
    expect(auth.verifyEmail).toHaveBeenCalledWith({ email: 'buyer@example.com', otp: '123456' });
    expect(container.querySelector('output')?.textContent).toBe('/app?checkout=growth_annual');
  });
  it('keeps the selected plan while retrying an expired code or resending', async () => {
    auth.signUp.mockResolvedValue({ data: { accessToken: null }, error: null });
    auth.verifyEmail.mockResolvedValue({ data: null, error: { message: 'Code expired' } });
    await mount('?plan=starter&billing=monthly');
    await createAccount();
    await type('signup-code', '123456');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Code expired');
    expect(container.querySelector('output')?.textContent).toBe('/signup?plan=starter&billing=monthly&verify=1');
    const resend = [...container.querySelectorAll('button')].find(b => b.textContent === 'Resend verification code')!;
    await act(async () => resend.click());
    expect(auth.resendVerificationEmail).toHaveBeenCalledWith({ email: 'buyer@example.com' });
    expect(container.textContent).toContain('A new verification code has been sent.');
  });
  it('does not verify malformed codes', async () => {
    auth.signUp.mockResolvedValue({ data: { accessToken: null }, error: null });
    await mount('?plan=pro&billing=annual');
    await createAccount();
    await type('signup-code', '12abcd');
    await submit();
    expect(auth.verifyEmail).not.toHaveBeenCalled();
  });
  it('allows verification after refresh without storing email or password in the URL', async () => {
    await mount('?plan=growth&billing=annual&verify=1');
    await type('verification-email', 'buyer@example.com');
    await type('signup-code', '123456');
    await submit();
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.verifyEmail).toHaveBeenCalledWith({ email: 'buyer@example.com', otp: '123456' });
    expect(container.querySelector('output')?.textContent).toBe('/app?checkout=growth_annual');
  });
  it('stores the selected choice for the OAuth callback and blocks concurrent email signup', async () => {
    await mount('?plan=growth&billing=annual');
    await type('signup-email', 'buyer@example.com');
    await type('signup-password', 'buyerPassword9');
    const google = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Continue with Google'))!;
    await act(async () => google.click());
    expect(takeAuthIntent()).toEqual({ plan: 'growth', billing: 'annual' });
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await submit();
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});

describe('checkout intent validation', () => {
  it.each(['growth_annual_extra', 'enterprise_monthly', 'growth_weekly', '', null])('rejects malformed app checkout %s', value => {
    expect(readIntentFromCheckout(value)).toBeNull();
  });
  it('round-trips valid query and stored intents to the receiving checkout trigger', () => {
    const intent = readIntentFromParams(new URLSearchParams('plan=starter&billing=annual'));
    saveAuthIntent(intent);
    expect(destinationFor(takeAuthIntent())).toBe('/app?checkout=starter_annual');
    expect(takeAuthIntent()).toBeNull();
    expect(readIntentFromCheckout('starter_annual')).toEqual(intent);
  });
});
