// Email verification, code method. insforge.toml runs the project with
// require_email_verification = true and verify_email_method = "code": a new
// email/password account is emailed a 6-digit code and cannot sign in until
// the app submits it through insforge.auth.verifyEmail(), which also returns
// the session. Signup (after sign-up), Login (sign-in refused as unverified)
// and the verification page all route through these helpers, so the three
// cannot drift apart again. A module that exports both components and helpers
// breaks React Fast Refresh, hence a separate .ts file (see authHelpers.ts).

/**
 * Lives under /auth/ on purpose: server.cjs only serves the SPA shell for
 * /app, /auth and /blog, so any other new path returns a 404 on reload.
 */
export const VERIFY_EMAIL_PATH = '/auth/verify-email';

export const VERIFICATION_CODE_LENGTH = 6;

/**
 * Seconds before another code can be requested. A resend replaces the code
 * the user may already be holding, so rapid repeat sends mostly produce
 * "invalid code" errors for a code that was valid a moment ago.
 */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Error codes for a password sign-in refused because the address is not
 * verified yet. EMAIL_NOT_VERIFIED is InsForge's documented production code
 * (403 "Please verify your email before signing in",
 * docs.insforge.dev/sdks/rest/auth). AUTH_NEED_VERIFICATION is what the local
 * e2e mock returns; accepting it keeps the local stack on the production code
 * path instead of a mock-only one.
 */
export const EMAIL_NOT_VERIFIED_CODES: readonly string[] = ['EMAIL_NOT_VERIFIED', 'AUTH_NEED_VERIFICATION'];

type AuthErrorLike = { readonly statusCode?: number; readonly error?: string };

export function isEmailNotVerifiedError(error: AuthErrorLike | null | undefined): boolean {
  if (!error || error.statusCode !== 403) return false;
  return typeof error.error === 'string' && EMAIL_NOT_VERIFIED_CODES.includes(error.error);
}

/**
 * Router state handed to the verification page. The address travels in
 * history state, never in the URL: page views are reported to analytics with
 * their query string. Neither the password nor the code is ever stored here.
 */
export type VerifyEmailState = {
  readonly email: string;
  /** True right after sign-up, when a code has just been sent. */
  readonly codeSent: boolean;
};

export function readVerifyEmailState(state: unknown): VerifyEmailState | null {
  if (!state || typeof state !== 'object') return null;
  const { email, codeSent } = state as Record<string, unknown>;
  if (typeof email !== 'string' || !email.trim()) return null;
  return { email: email.trim(), codeSent: codeSent === true };
}

/** The verification page, keeping the query string (plan intent, ?redirect=). */
export function verifyEmailHref(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${VERIFY_EMAIL_PATH}?${query}` : VERIFY_EMAIL_PATH;
}

/** Digits only, capped at the code length, so a pasted "123 456" or "123-456" still works. */
export function normalizeVerificationCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, VERIFICATION_CODE_LENGTH);
}
