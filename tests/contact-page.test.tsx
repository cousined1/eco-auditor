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
const DEMO_PATH = resolve('src/pages/Demo.tsx');
const HEADER_PATH = resolve('src/components/Header.tsx');
const CHAT_PATH = resolve('src/components/ChatbotWidget.tsx');
const contactSrc = readFileSync(CONTACT_PATH, 'utf8');
const footerSrc = readFileSync(FOOTER_PATH, 'utf8');
const demoSrc = readFileSync(DEMO_PATH, 'utf8');
const headerSrc = readFileSync(HEADER_PATH, 'utf8');
const chatSrc = readFileSync(CHAT_PATH, 'utf8');

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

  it('uses only the operational mailbox for customer-facing email links', () => {
    expect(contactSrc).toContain('hello@developer312.com');
    expect(contactSrc).not.toContain('@ecoauditor.io');
  });

  it('routes security and privacy requests with useful subjects', () => {
    expect(contactSrc).toContain('subject=Security%20report');
    expect(contactSrc).toContain('subject=Privacy%20and%20DPA%20request');
  });

  it('submits public forms through the protected server endpoint instead of anonymous table writes', () => {
    expect(contactSrc).toContain('submitLead');
    expect(demoSrc).toContain('submitLead');
    expect(contactSrc).not.toContain("database.from('leads')");
    expect(demoSrc).not.toContain("database.from('leads')");
  });
});

describe('marketing conversion routes', () => {
  it('sends the shared Book a Demo CTA to the dedicated demo form', () => {
    expect(headerSrc).toContain("{ label: 'Book a Demo', href: '/demo', variant: 'secondary' }");
    expect(headerSrc).not.toContain("{ label: 'Book a Demo', href: '/contact', variant: 'secondary' }");
  });

  it('keeps the chat launcher hidden while cookie consent is unresolved', () => {
    expect(chatSrc).toContain('useConsent');
    expect(chatSrc).toContain('if (!consentState.hasConsented) return null;');
  });
});

describe('Footer brand identity (P1-13)', () => {
  it('does not advertise unrouteable Eco-Auditor mailboxes', () => {
    expect(footerSrc).toContain('hello@developer312.com');
    expect(footerSrc).not.toContain('@ecoauditor.io');
    expect(footerSrc).toContain('subject=Security%20report');
    expect(footerSrc).toContain('subject=Privacy%20and%20DPA%20request');
  });

  it('names the operator consistently (Developer312 / NIGHT LITE USA LLC)', () => {
    expect(footerSrc).toContain('Developer312');
    expect(footerSrc).toContain('NIGHT LITE USA LLC');
  });
});
