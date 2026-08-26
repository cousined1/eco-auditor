export type SocialAuthProvider = 'google' | 'apple' | 'microsoft';

export type SocialAuthProviderConfig = {
  id: SocialAuthProvider;
  label: string;
  shortLabel: string;
};

export const SOCIAL_AUTH_PROVIDERS: SocialAuthProviderConfig[] = [
  { id: 'google', label: 'Continue with Google', shortLabel: 'Google' },
  // 'microsoft' is an InsForge CUSTOM OIDC provider (Entra External ID tenant
  // ecoauditor.ciamlogin.com); the SDK routes non-built-in keys to
  // /api/auth/oauth/custom/<key> automatically.
  { id: 'microsoft', label: 'Continue with Microsoft', shortLabel: 'Microsoft' },
  { id: 'apple', label: 'Continue with Apple', shortLabel: 'Apple' },
];

type OAuthError = {
  message?: string;
};

type OAuthAuthClient = {
  signInWithOAuth: (args: {
    provider: SocialAuthProvider;
    redirectTo: string;
  }) => Promise<{ data: unknown; error: OAuthError | null }>;
};

export type SocialSignInResult = { ok: true } | { ok: false; error: string };

export function buildOAuthRedirectTo(origin: string, path = '/auth/callback'): string {
  const normalizedOrigin = origin.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedOrigin}${normalizedPath}`;
}

export async function startSocialSignIn({
  provider,
  redirectTo,
  auth,
}: {
  provider: SocialAuthProvider;
  redirectTo: string;
  auth: OAuthAuthClient;
}): Promise<SocialSignInResult> {
  // Contract: always resolves to a SocialSignInResult, never throws. The SDK
  // normally reports failures via {data, error}, but can also THROW (network
  // failure, misconfigured client) — an escaping throw bypassed every caller's
  // error handling and left the provider button pending with no feedback.
  try {
    const { error } = await auth.signInWithOAuth({ provider, redirectTo });
    if (error) {
      return { ok: false, error: error.message || `Unable to start ${provider} sign in.` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : `Unable to start ${provider} sign in.`,
    };
  }
}
