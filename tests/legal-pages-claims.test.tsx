import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Security from '../src/pages/Security';
import PrivacyPolicy from '../src/pages/PrivacyPolicy';
import TermsOfService from '../src/pages/TermsOfService';
import DataProcessingAddendum from '../src/pages/DataProcessingAddendum';
import { ConsentProvider } from '../src/lib/consent-context';
import { dataFacts } from '../src/content/data-facts';

// K14 (F-A-06, F-R4-01, F-A-13, F-A-20, F-D-06): the Security page, DPA, Privacy
// Policy and Terms are representations customers rely on. These tests render
// each page and assert what a reader sees, so a claim the company cannot
// evidence fails here instead of shipping. When a removed claim is restored
// because evidence now exists, update the matching assertion in the same change.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Block-level closings become " | " so list items and cells never run together
// into one "sentence".
function htmlToText(html: string): string {
  return html
    .replace(/<\/(?:li|p|h[1-6]|td|tr|div|section|summary)>/g, ' | ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function renderHtml(page: ReactElement): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ConsentProvider>{page}</ConsentProvider>
    </MemoryRouter>,
  );
}

const securityHtml = renderHtml(<Security />);
const privacyHtml = renderHtml(<PrivacyPolicy />);
const termsHtml = renderHtml(<TermsOfService />);
const dpaHtml = renderHtml(<DataProcessingAddendum />);

const security = htmlToText(securityHtml);
const privacy = htmlToText(privacyHtml);
const terms = htmlToText(termsHtml);
const dpa = htmlToText(dpaHtml);

type Section = { id: string; title: string; text: string };

// Every legal page renders <section id="..."><h2>title</h2>...</section>.
function sectionsOf(html: string): Section[] {
  const found: Section[] = [];
  const pattern = /<section id="([^"]+)"[^>]*>\s*<h2[^>]*>([^<]*)<\/h2>([\s\S]*?)<\/section>/g;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    found.push({ id: m[1] ?? '', title: htmlToText(m[2] ?? ''), text: htmlToText(m[3] ?? '') });
  }
  return found;
}

// Sentences (split on ". " and on list-item boundaries) of `text` that mention `topic`.
function sentencesAbout(text: string, topic: RegExp): string[] {
  return text.split(/(?<=\.)\s+|\s*\|\s*/).filter((s) => topic.test(s));
}

// The vendors that are evidenced in the repo (see the Annex III comment in the
// DPA and tests/legal-evidence-coupling.test.tsx for the evidence).
const NAMED_PROVIDERS = ['Railway', 'InsForge', 'Cloudflare', 'Stripe', 'Google'];

describe('Security page (F-A-06)', () => {
  it('does not present a SOC 2 programme; any mention of SOC 2 is a plain negative', () => {
    expect(security).not.toMatch(/SOC 2[^.]*in progress/i);
    expect(security).not.toMatch(/\bQ[1-4] 20\d\d\b/);
    const mentions = sentencesAbout(security, /SOC 2/);
    for (const sentence of mentions) {
      expect(sentence, 'SOC 2 may only be mentioned to say no audit exists, until an engagement letter is on file').toMatch(/\b(no|not)\b/i);
    }
  });

  it('does not claim controls the repo cannot evidence', () => {
    expect(security).not.toMatch(/multi-factor/i);
    expect(security).not.toMatch(/audited monthly/i);
    expect(security).not.toMatch(/QuickBooks|Xero/);
    expect(security).not.toMatch(/AES-256/);
  });

  it('keeps the evidenced controls', () => {
    expect(security).toContain('HTTPS enforced');
    expect(security).toContain('Security headers (CSP, HSTS)');
    expect(security).toContain('Rate limiting');
    expect(security).toContain('we never store card details');
  });

  it('names the hosting providers instead of a generic "infrastructure providers" line', () => {
    for (const name of ['Railway', 'InsForge', 'Cloudflare']) {
      expect(security).toContain(name);
    }
    expect(security).not.toContain('Infrastructure providers host our application and data');
  });

  it('says nothing is deleted automatically and what the delete control leaves behind', () => {
    const faq = sentencesAbout(security, /deleted automatically|Delete my audit data/).join(' ');
    expect(faq).toMatch(/Nothing is deleted automatically/);
    expect(faq).toMatch(/account record[^.]*stay/i);
  });
});

describe('Data Processing Addendum (F-A-06, F-R4-01, F-A-13, F-A-20)', () => {
  it('no longer promises tested restores, a staging environment, pen tests, MFA or intrusion detection', () => {
    const removed: Array<[RegExp, string]> = [
      [/tested restore/i, 'restore has never been exercised (LAUNCH_AUDIT gate 11)'],
      [/staging/i, 'every recorded deployment targets one production environment (F-R4-01)'],
      [/penetration test/i, 'no penetration test has been performed'],
      [/multi-factor/i, 'the product has no customer MFA and admin MFA is unevidenced'],
      [/intrusion detection/i, 'no intrusion detection is evidenced'],
    ];
    for (const [pattern, why] of removed) {
      expect(dpa, `restore this claim only with evidence: ${why}`).not.toMatch(pattern);
    }
  });

  it('only mentions restores to say they are not tested', () => {
    for (const sentence of sentencesAbout(dpa, /restore/i)) {
      expect(sentence).toMatch(/\bnot\b/i);
    }
  });

  it('cites Section 11 (Return and Deletion) from Section 4, never the Audit Rights section', () => {
    const sections = sectionsOf(dpaHtml);
    const numbered = new Map<number, string>();
    for (const s of sections) {
      const m = /^(\d+)\.\s+(.*)$/.exec(s.title);
      if (m) numbered.set(Number(m[1]), m[2] ?? '');
    }
    expect(numbered.size).toBeGreaterThanOrEqual(18);

    // Every "Section N" reference in the document points at a real numbered section.
    let references = 0;
    for (const s of sections) {
      for (const m of s.text.matchAll(/Section (\d+)/g)) {
        references += 1;
        expect(numbered.has(Number(m[1])), `"${s.title}" cites Section ${m[1]}, which does not exist`).toBe(true);
      }
    }
    expect(references).toBeGreaterThan(0);

    const duration = sections.find((s) => /^4\./.test(s.title));
    expect(duration, 'DPA Section 4 (Subject Matter and Duration) is missing').toBeTruthy();
    const cited = [...(duration?.text ?? '').matchAll(/Section (\d+)/g)].map((m) => numbered.get(Number(m[1])) ?? '');
    expect(cited.some((title) => /Return and Deletion/i.test(title))).toBe(true);
    expect(cited.some((title) => /Audit/i.test(title))).toBe(false);
  });

  it('does not rely on a post-termination period that the Terms never define', () => {
    expect(dpa).not.toMatch(/as specified in the Terms/i);
    expect(dpa).toMatch(/does not delete workspace data automatically/i);
    expect(dpa).toContain('within 30 days of the request');
  });

  it('lists named subprocessors in Annex III, none of them a generic category', () => {
    const annex = sectionsOf(dpaHtml).find((s) => s.id === 'annex-iii');
    expect(annex, 'Annex III is missing').toBeTruthy();
    const rows = [...dpaHtml.matchAll(/<tr[^>]*><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><\/tr>/g)].map(
      (m) => ({ name: htmlToText(m[1] ?? ''), purpose: htmlToText(m[2] ?? '') }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const { name, purpose } of rows) {
      expect(name, `"${name}" reads as a category, not a named entity`).not.toMatch(/provider|platform/i);
      expect(purpose.length).toBeGreaterThan(0);
    }
    const names = rows.map((r) => r.name).join(' | ');
    for (const provider of NAMED_PROVIDERS) {
      expect(names).toContain(provider);
    }
  });

  it('states what the export contains and what deletion leaves behind', () => {
    // VF-4: the list is rendered from src/content/data-facts.ts (tests/legal-evidence-coupling.test.tsx ties it to the code).
    expect(dpa).toContain(`machine-readable JSON download of its ${dataFacts.export.contents}`);
    expect(dpa).toMatch(/company profile, import history, and billing linkage remain/);
    expect(dpa).toMatch(/cookie-consent records \(kept as proof of consent\)/);
  });
});

describe('Privacy Policy (F-A-13, F-A-20, F-D-06)', () => {
  it('no longer describes uploads, integrations or an AI assistant the product does not have', () => {
    for (const pattern of [/Utility bills/i, /supplier spreadsheets/i, /QuickBooks|Xero/, /\bUPS\b|\bFedEx\b/, /Carbon Assistant/i, /Configuration choices/i]) {
      expect(privacy).not.toMatch(pattern);
    }
    expect(privacy).toMatch(/does not currently connect to accounting, shipping, or cloud-service accounts/);
  });

  it('lists the personal data that leads and consent records actually create', () => {
    expect(privacy).toMatch(/Demo, contact, and chat requests:[^.]*name, email address, company, message/i);
    expect(privacy).toMatch(/Consent records:[^.]*keyed hash of your IP address \(not the address itself\)/i);
  });

  it('says nothing is deleted automatically and explains why consent records are kept', () => {
    expect(privacy).toMatch(/Nothing is deleted automatically/);
    expect(privacy).toMatch(/Consent records: We keep records of your cookie choices as proof of consent/);
    expect(privacy).toMatch(/not removed when you use “Delete my audit data\.”/);
    expect(privacy).toContain(`${dataFacts.deleteAuditData.leaves} are not affected`);
  });

  it('names the same providers as the DPA instead of generic categories', () => {
    for (const provider of NAMED_PROVIDERS) {
      expect(privacy, `Privacy Section 8 must name ${provider}`).toContain(provider);
    }
    expect(privacy).not.toMatch(/Customer support platforms that process support communications/);
    expect(privacy).not.toMatch(/Infrastructure providers that host our application and data/);
    expect(privacy).toContain('Microsoft Entra External ID');
  });

  it('no longer says encryption at rest, security assessments or incident response are first-party controls', () => {
    expect(privacy).not.toMatch(/Regular security assessments/i);
    expect(privacy).not.toMatch(/Incident response procedures/i);
    expect(privacy).toContain('Encryption of data at rest by our database provider (InsForge)');
  });
});

describe('Terms of Service (F-A-20, F-D-06)', () => {
  const afterTermination = sentencesAbout(terms, /Data after termination|deleted automatically|account record|30 days/).join(' ');

  it('says cancelling or terminating deletes nothing and that nothing is deleted automatically', () => {
    expect(afterTermination).toMatch(/does not delete your data, and nothing is deleted automatically/);
  });

  it('invents no post-termination period: the only figure is the existing 30-day request window', () => {
    const figures = [...afterTermination.matchAll(/(\d+)\s+days/g)].map((m) => Number(m[1]));
    expect(figures.length).toBeGreaterThan(0);
    expect(new Set(figures)).toEqual(new Set([30]));
    expect(terms).toContain('full account deletion is available via support');
  });
});
