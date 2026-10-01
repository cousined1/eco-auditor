import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contactDetails } from '../src/content/trust-facts';

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
    // F-A-17: the mailbox is defined once, in trust-facts.ts; the page imports it.
    expect(contactSrc).toContain('contactDetails.email');
    expect(demoSrc).toContain('contactDetails.email');
    expect(contactSrc).not.toContain('@ecoauditor.io');
    expect(contactDetails.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    expect(contactDetails.email).not.toContain('@ecoauditor.io');
  });

  it('sends each form\'s own source so leads can be told apart (F-B-21)', () => {
    expect(contactSrc).toContain("source: 'contact'");
    expect(demoSrc).toContain("source: 'demo'");
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
    expect(headerSrc).toContain("{ label: 'Book a Demo', href: '/demo/', variant: 'secondary' }");
    expect(headerSrc).not.toContain("{ label: 'Book a Demo', href: '/contact', variant: 'secondary' }");
  });

  it('keeps the chat launcher hidden while cookie consent is unresolved', () => {
    expect(chatSrc).toContain('useConsent');
    expect(chatSrc).toContain('if (!consentState.hasConsented) return null;');
  });
});

describe('Footer brand identity (P1-13, F-A-17)', () => {
  it('does not advertise unrouteable Eco-Auditor mailboxes, and reads the mailbox and phone from trust-facts', () => {
    expect(footerSrc).toContain('contactDetails.email');
    expect(footerSrc).toContain('contactDetails.phone');
    expect(footerSrc).not.toContain('@ecoauditor.io');
    expect(footerSrc).toContain('subject=Security%20report');
    expect(footerSrc).toContain('subject=Privacy%20and%20DPA%20request');
  });

  it('names the operator consistently (Developer312 / NIGHT LITE USA LLC), from the one definition', () => {
    expect(footerSrc).toContain('contactDetails.operator');
    expect(contactDetails.operator).toContain('Developer312');
    expect(contactDetails.operator).toContain('NIGHT LITE USA LLC');
  });
});

// F-A-07 / D-2: Demo, Contact and the chatbot each promised something different
// ("within one business day", "within 1-2 business days", "within 24 hours"), while the
// lead notifier stays silent until the owner sets LEAD_NOTIFY_WEBHOOK_URL. The pages now
// share contactDetails.followUp, and the chat copy is held to the same words in
// tests/chat-kb.test.ts. What the pages SAY is asserted in tests/sweep-copy-render.test.ts.
describe('the follow-up promise is one constant (F-A-07, D-2)', () => {
  const TIME_PROMISE = /business days?|within (?:one|1|2|two|24|48|a few|the same)|typically (?:respond|reply)|we.ll (?:reply|respond|get back)|same[- ]day|next[- ](?:business )?day/i;

  it('names a follow-up by email and makes no promise about when', () => {
    expect(contactDetails.followUp).toMatch(/follow up by email/i);
    // A time bound needs the owner's word that the notifier is live and staffed: change it
    // in trust-facts.ts and here together, never on one surface.
    expect(contactDetails.followUp).not.toMatch(/\d|hour|day|week|minute|within|same|next|soon|prompt|quick|immediate|shortly|asap/i);
  });

  it('Demo and Contact print it in every state that promises a follow-up, and retype none of it', () => {
    // Demo: before submit and after. Contact: intro, sent, and the failed-send fallback.
    expect(demoSrc.split('contactDetails.followUp').length - 1).toBe(2);
    expect(contactSrc.split('contactDetails.followUp').length - 1).toBe(3);
    for (const [file, src] of [['Demo.tsx', demoSrc], ['ContactUs.tsx', contactSrc]] as const) {
      expect(src, `${file} retypes a time promise`).not.toMatch(TIME_PROMISE);
    }
  });
});
