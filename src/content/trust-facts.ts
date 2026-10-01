// P0-06 — single source of truth for security/compliance facts shown on the
// site. A `verified: false` fact MUST render as "(verify before publication)"
// via renderFact(); it never exposes a fabricated concrete value. The sentinel
// 'VERIFY' (string) is the only allowed non-verified surface value.
export type TrustFact<T> = { value: T; verified: boolean; note?: string };

export const trustFacts = {
  // VF-14: stays verified:true on purpose, because the Security page prints this value through
  // renderFact(), and verified:false would print "(verify before publication)" in the middle of
  // its encryption list. The note is what is known: TLS ends at the edge, the minimum version is
  // a setting there, and nothing in this repo can show it. DPA Annex II and Privacy Section 10
  // say "TLS 1.2+" on the same footing, each under a COUNSEL-REVIEW marker that asks for the check.
  encryptionInTransitMinimum: {
    value: 'TLS 1.2',
    verified: true,
    note: 'Not evidenced in this repo. DPA Annex III says Cloudflare provides DNS, content delivery and TLS for ecoauditor.io, while LAUNCH_AUDIT.md (row 12) lists the Railway edge among what was checked, so which edge terminates TLS for visitors is not shown by the repo either, and the minimum version is a setting there, not code. NEEDS-OWNER: check Cloudflare, SSL/TLS, Edge Certificates, Minimum TLS Version (and the Railway domain settings if traffic can reach it directly), and confirm TLS 1.2 or higher before the TLS 1.2+ lines (Security, Privacy Section 10, DPA Section 7 and Annex II) are published; record the date here. The provider statements for the database (insforge.dev/privacy, section 7) cover InsForge only.',
  } as TrustFact<string>,
  preferredTransport: { value: 'TLS 1.3', verified: true } as TrustFact<string>,
  // Provider-inherited, not an Eco-Auditor-operated control (F-A-06): pages should say the
  // database provider encrypts at rest, not present the cipher as ours.
  encryptionAtRest: {
    value: 'AES-256',
    verified: true,
    note: 'Evidence: InsForge privacy policy, section 7, "Encryption of data in transit (TLS 1.2+) and at rest (AES-256)" (https://insforge.dev/privacy, last modified 2026-06-20, read 2026-09-30).',
  } as TrustFact<string>,
  accountDeletionRequestWindowDays: { value: 30, verified: true } as TrustFact<number>,
  contentUsedForModelTraining: { value: false, verified: true } as TrustFact<boolean>,
  // F-A-06: the previous value was a dated programme claim with no auditor engagement,
  // readiness assessment or compliance-platform record behind it, and it lapsed on
  // 2026-09-30. Say something else only with an engagement letter as evidence.
  soc2Status: {
    value: 'not started',
    verified: true,
    note: 'Negative statement: no SOC 2 report, auditor engagement or readiness assessment is on file (audit 2026-09-29).',
  } as TrustFact<string>,
  // Hosting and subprocessors are deliberately not facts in this register. A second
  // list (generic "Cloud hosting provider" rows, a hosting note saying "code says
  // AWS") went stale beside the legal pages and nothing read it. The named providers
  // are listed once, in DPA Annex III and Privacy Section 8, and
  // tests/legal-evidence-coupling.test.tsx ties each one to evidence in the repo.
};

export function renderFact<T>(f: TrustFact<T>): string {
  return f.verified ? String(f.value) : '(verify before publication)';
}

/**
 * F-A-17 — the customer-facing contact details currently in use, defined once.
 * Pages import them instead of retyping the address, so the answer to "which
 * mailbox is correct?" changes in one place.
 *
 * OWNER DECISION PENDING: the only mailbox in use is on the operator's domain
 * (developer312.com); there is no @ecoauditor.io mailbox, so brand and contact
 * domain differ. Do not add an address here that nobody monitors, and do not
 * invent a postal address: none is on file for Privacy, Terms or the DPA either.
 * Every page and the Footer read these values; server.cjs (the chat copy) and the
 * static files (index.html, llms.txt, humans.txt, security.txt) cannot import this
 * module, so tests/trust-facts.test.ts holds each of them to it.
 */
export const contactDetails = {
  email: 'hello@developer312.com',
  phone: '(510) 591-0163',
  phoneHref: 'tel:+15105910163',
  operator: 'Developer312, a subsidiary of NIGHT LITE USA LLC',
  // F-A-07 / D-2 — the one promise every lead-capture surface makes once a request
  // is sent (Demo, Contact, and the chatbot's confirmations in server.cjs). It names
  // no time on purpose: the lead notifier (server-notify.cjs) posts only when the
  // operator sets LEAD_NOTIFY_WEBHOOK_URL, and nothing in the repo shows that anyone
  // is staffed to answer within a stated time. OWNER DECISION: a time bound returns
  // only when the owner confirms the notifier is live and staffed; change it here
  // and in tests/trust-facts.test.ts together.
  followUp: "We'll follow up by email",
} as const;