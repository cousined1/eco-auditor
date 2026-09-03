import { describe, expect, it, vi } from 'vitest';
import {
  SOCIAL_AUTH_PROVIDERS,
  buildOAuthRedirectTo,
  startSocialSignIn,
} from '../src/lib/socialAuth';

describe('social auth helpers', () => {
  it('offers Google, work account, and Apple providers for EcoAuditor login', () => {
    expect(SOCIAL_AUTH_PROVIDERS.map((provider) => provider.id)).toEqual(['google', 'entra', 'apple']);
    expect(SOCIAL_AUTH_PROVIDERS[0]).toMatchObject({ label: 'Continue with Google' });
    expect(SOCIAL_AUTH_PROVIDERS[1]).toMatchObject({ label: 'Continue with work account' });
    expect(SOCIAL_AUTH_PROVIDERS[2]).toMatchObject({ label: 'Continue with Apple' });
  });

  it('never labels the entra provider as a personal Microsoft account', () => {
    // An external (CIAM) tenant cannot federate MSA. A label promising it is a
    // dead end for every user who does not have a federated work account.
    const entra = SOCIAL_AUTH_PROVIDERS.find((provider) => provider.id === 'entra');
    expect(entra?.label).not.toMatch(/Microsoft/i);
  });

  it('builds an app callback URL from the browser origin', () => {
    const redirectTo = buildOAuthRedirectTo('https://ecoauditor.io', '/auth/callback');
    expect(redirectTo).toBe('https://ecoauditor.io/auth/callback');
  });

  it('starts InsForge OAuth with provider and redirect target', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: null, error: null });
    const result = await startSocialSignIn({
      provider: 'google',
      redirectTo: 'https://ecoauditor.io/auth/callback',
      auth: { signInWithOAuth },
    });

    expect(result.ok).toBe(true);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      redirectTo: 'https://ecoauditor.io/auth/callback',
    });
  });

  it('returns a readable error when InsForge rejects OAuth start', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Apple OAuth is not configured' },
    });
    const result = await startSocialSignIn({
      provider: 'apple',
      redirectTo: 'https://ecoauditor.io/auth/callback',
      auth: { signInWithOAuth },
    });

    expect(result).toEqual({ ok: false, error: 'Apple OAuth is not configured' });
  });
});
