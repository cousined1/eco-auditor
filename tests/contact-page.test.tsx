import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// P1-06 + P1-13 regression: the July 11 UI/UX audit found (a) an orphan
// copyright card duplicating the global Footer on /contact and (b) only a
// developer312.com email as the customer-facing identity. Both are fixed in
// ContactUs.tsx; these tests guard against regression without rendering React.
//
// Reading source directly keeps the test hermetic (no jsdom DOM mount of the
// router-aware page) and matches the convention in legal-placeholders.test.ts.

const CONTACT_PATH = resolve('src/pages/ContactUs.tsx');
const FOOTER_PATH = resolve('src/components/Footer.tsx');
const contactSrc = readFileSync(CONTACT_PATH, 'utf8');
const footerSrc = readFileSync(FOOTER_PATH, 'utf8');

describe('ContactUs /contact page (P1-06, P1-13)', () => {
  it('does not render a standalone copyright card in the right column (P1-06)', () => {
    // The orphan card was: <div className="p-4 rounded-lg border ...">© ... Eco-Auditor. All rights reserved.</div>
    // The global Footer already renders the copyright once; a second copy duplicated
    // the accessibility tree and appeared as a stray node in rendered text.
    const orphanCardPattern = /©\s*\$\{new Date\(\)\.getFullYear\(\)\}\s*Eco-Auditor\.?\s*All rights reserved\./;
    expect(
      orphanCardPattern.test(contactSrc),
      'ContactUs must not duplicate the Footer copyright — the global Footer renders it once',
    ).toBe(false);
  });

  it('surfaces Eco-Auditor-domain customer-facing email addresses (P1-13)', () => {
    expect(contactSrc).toContain('support@ecoauditor.io');
    expect(contactSrc).toContain('security@ecoauditor.io');
    expect(contactSrc).toContain('privacy@ecoauditor.io');
  });

  it('keeps the operational developer312 address as a backstop, not the primary identity', () => {
    // The developer312 address still routes mail; it's just no longer the
    // first/only customer-facing identity.
    expect(contactSrc).toContain('hello@developer312.com');
  });
});

describe('Footer brand identity (P1-13)', () => {
  it('surfaces Eco-Auditor-domain emails as the primary contact identities', () => {
    expect(footerSrc).toContain('support@ecoauditor.io');
    expect(footerSrc).toContain('security@ecoauditor.io');
    expect(footerSrc).toContain('privacy@ecoauditor.io');
  });

  it('names the operator consistently (Developer312 / NIGHT LITE USA LLC)', () => {
    expect(footerSrc).toContain('Developer312');
    expect(footerSrc).toContain('NIGHT LITE USA LLC');
  });
});