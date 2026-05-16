export type SocialAuthProvider = 'google' | 'apple';

export type SocialAuthProviderConfig = {
  id: SocialAuthProvider;
  label: string;
  shortLabel: string;
};

export const SOCIAL_AUTH_PROVIDERS: SocialAuthProviderConfig[] = [
  { id: 'google', label: 'Continue with Google', shortLabel: 'Google' },
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
  const { error } = await auth.signInWithOAuth({ provider, redirectTo });
  if (error) {
    return { ok: false, error: error.message || `Unable to start ${provider} sign in.` };
  }
  return { ok: true };
}
