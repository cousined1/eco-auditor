// P0-06 — single source of truth for security/compliance facts shown on the
// site. A `verified: false` fact MUST render as "(verify before publication)"
// via renderFact(); it never exposes a fabricated concrete value. The sentinel
// 'VERIFY' (string) is the only allowed non-verified surface value.
export type TrustFact<T> = { value: T; verified: boolean; note?: string };

export const trustFacts = {
  encryptionInTransitMinimum: { value: 'TLS 1.2', verified: true } as TrustFact<string>,
  preferredTransport: { value: 'TLS 1.3', verified: true } as TrustFact<string>,
  encryptionAtRest: { value: 'AES-256', verified: true } as TrustFact<string>,
  accountDeletionRequestWindowDays: { value: 30, verified: true } as TrustFact<number>,
  contentUsedForModelTraining: { value: false, verified: true } as TrustFact<boolean>,
  soc2Status: { value: 'in progress (Q3 2026)', verified: true } as TrustFact<string>,
  // ponytail: 'VERIFY' sentinel — do not assert a hosting provider; code says AWS, DPA says generic; resolve before launch.
  cloudHosting: {
    value: 'VERIFY',
    verified: false,
    note: 'Deploy target unverified; code says AWS, DPA says generic. Confirm provider identity before publication.',
  } as TrustFact<string>,
  subprocessors: [
    { name: 'Stripe, Inc.', purpose: 'Payment processing', processingRegion: 'United States', dpaUrl: null, verified: true },
    { name: 'Cloud hosting provider', purpose: 'Application hosting', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
    { name: 'Analytics provider', purpose: 'Service monitoring', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
    { name: 'Email/communications provider', purpose: 'Transactional email', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
    { name: 'Customer support platform', purpose: 'Support ticketing', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
  ],
};

export function renderFact<T>(f: TrustFact<T>): string {
  return f.verified ? String(f.value) : '(verify before publication)';
}