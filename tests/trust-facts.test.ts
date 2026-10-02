import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { trustFacts, renderFact, contactDetails } from '../src/content/trust-facts';

describe('trustFacts (P0-06)', () => {
  it('every scalar field has a `verified` boolean', () => {
    const scalarKeys = [
      'encryptionInTransitMinimum',
      'preferredTransport',
      'encryptionAtRest',
      'accountDeletionRequestWindowDays',
      'contentUsedForModelTraining',
      'soc2Status',
    ] as const;
    for (const k of scalarKeys) {
      const f = trustFacts[k] as { verified: unknown };
      expect(typeof f.verified, `${k}.verified must be boolean`).toBe('boolean');
    }
  });

  it('a verified:false fact does NOT expose a fabricated concrete value', () => {
    // 'VERIFY' is the sentinel (not fabricated); any other concrete value on a
    // verified:false fact would be an invented claim. No fact is unverified today
    // (the hosting and subprocessor entries that were are gone: the legal pages
    // list the evidenced providers), so this holds the line for the next one.
    for (const [key, { value, verified }] of Object.entries(trustFacts)) {
      if (!verified) expect(value, `${key} must use the VERIFY sentinel`).toBe('VERIFY');
    }
  });

  it('renderFact returns "(verify before publication)" for verified:false and the string value for verified:true', () => {
    expect(renderFact({ value: 'VERIFY', verified: false })).toBe('(verify before publication)');
    expect(renderFact(trustFacts.encryptionAtRest)).toBe('AES-256');
    expect(renderFact(trustFacts.accountDeletionRequestWindowDays)).toBe('30');
  });

  // F-A-06: encryption at rest is inherited from the database provider, so the
  // register keeps the provider's own document as the evidence.
  it('encryptionAtRest keeps the provider document that backs it', () => {
    expect(trustFacts.encryptionAtRest.note).toMatch(/https:\/\/insforge\.dev\/privacy/);
  });

  // F-A-06: a dated SOC 2 programme claim ("in progress (Q3 2026)") had no evidence
  // and lapsed on 2026-09-30. Whatever this fact says must be a plain status: no
  // programme, no date, no audit type, no "aligned" wording.
  it('soc2Status states no programme, date or audit type', () => {
    expect(renderFact(trustFacts.soc2Status)).not.toMatch(/in progress|underway|planned|q[1-4]|\b20\d\d\b|type\s*(i|1|ii|2)\b|aligned|compliant|certified|audited/i);
  });

  // VF-14: the TLS minimum is set at the edge (Cloudflare), not in this repo, so nothing here can
  // show it. The fact stays verified:true because verified:false would print "(verify before
  // publication)" in the middle of the Security page's encryption list; what it keeps instead is a
  // note that says where the value comes from and what the owner has to check.
  it('encryptionInTransitMinimum keeps a note naming the edge setting the owner must check, and is rendered on the Security page', () => {
    const note = trustFacts.encryptionInTransitMinimum.note ?? '';
    expect(note).toMatch(/Cloudflare/);
    expect(note).toMatch(/SSL\/TLS, Edge Certificates, Minimum TLS Version/);
    expect(note).toMatch(/not evidenced in this repo/i);
    expect(readFileSync(resolve('src/pages/Security.tsx'), 'utf8')).toMatch(/renderFact\(trustFacts\.encryptionInTransitMinimum\)/);
    expect(renderFact({ ...trustFacts.encryptionInTransitMinimum, verified: false }), 'verified:false would print a placeholder on a public page').toBe('(verify before publication)');
  });
});

// VF-16: humans.txt named no host ("to be confirmed") and carried the date of an earlier revision
// while the legal pages name Railway and were revised on 2026-09-30.
describe('humans.txt agrees with the legal pages (VF-16)', () => {
  const humans = readFileSync(resolve('public/humans.txt'), 'utf8');

  it('names the host the legal pages name, and holds no placeholder', () => {
    expect(humans).not.toMatch(/to be confirmed|\bTBD\b|\bTODO\b/i);
    expect(humans).toMatch(/^Hosting: .*Railway/m);
  });

  it('is dated no earlier than the revision of the legal pages', () => {
    const date = /^Last update: (\d{4}-\d{2}-\d{2})$/m.exec(humans)?.[1] ?? '';
    expect(date >= '2026-09-30', `Last update is ${date}`).toBe(true);
  });
});

// F-A-17: customer-facing contact details are defined once. Which mailbox is
// correct is an owner decision (there is no @ecoauditor.io mailbox today); these
// tests keep the definition internally consistent, whatever the owner decides.
describe('contactDetails (F-A-17)', () => {
  it('has one well-formed mailbox', () => {
    expect(contactDetails.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it('shows a phone number whose tel: link dials the same digits', () => {
    const shown = contactDetails.phone.replace(/\D/g, '');
    const dialled = contactDetails.phoneHref.replace(/^tel:/, '').replace(/\D/g, '');
    expect(contactDetails.phoneHref.startsWith('tel:+')).toBe(true);
    expect(dialled.endsWith(shown)).toBe(true);
  });

  it('names the operator', () => {
    expect(contactDetails.operator).toMatch(/^Developer312/);
  });
});

// F-A-17: the mailbox and phone number were typed in the Footer, Privacy, Terms, DPA,
// Security, server.cjs (the chat copy) and four static files, so changing the owner's
// answer to "which mailbox?" meant editing every one of them. Pages and components read
// contactDetails; what cannot import it is held to it here, so a retyped address, or a
// file that falls out of step, fails instead of shipping a second answer.
describe('contactDetails is the one place the contact details are typed (F-A-17)', () => {
  // The phone number in any spacing: "(510) 591-0163", "510.591.0163", "tel:+15105910163", "+1-510-591-0163".
  // The digits must sit next to each other (a few separator characters between them), so digits
  // that merely appear far apart in a long file cannot match.
  const PHONE = new RegExp(contactDetails.phone.replace(/\D/g, '').split('').join('[\\s().+-]{0,3}'));

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
    });
  }

  it('no page or component retypes the mailbox or the phone number', () => {
    const offenders = sourceFiles(resolve('src'))
      .filter((file) => !/[\\/]trust-facts\.ts$/.test(file))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return text.includes(contactDetails.email) || PHONE.test(text);
      });
    expect(offenders, 'import contactDetails from @/content/trust-facts instead of typing these').toEqual([]);
  });

  it('the static files that cannot import it carry the same mailbox and phone number', () => {
    for (const file of ['index.html', 'public/llms.txt', 'public/humans.txt', 'public/.well-known/security.txt']) {
      const text = readFileSync(resolve(file), 'utf8');
      expect(text, file).toContain(contactDetails.email);
      expect(text, file).toMatch(PHONE);
    }
  });

  it('every address in the server files (the chat copy) is this mailbox, and the chat lists this phone number', () => {
    const serverFiles = readdirSync(resolve('.')).filter((name) => /^server.*\.cjs$/.test(name));
    expect(serverFiles).toContain('server.cjs');
    const addresses = new Set<string>();
    for (const name of serverFiles) {
      for (const match of readFileSync(resolve(name), 'utf8').matchAll(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z.]+/g)) {
        // server.cjs names dev@example.com as a local-development default, and
        // server-blog-render.cjs quotes "https://ecoauditor.io@evil.example/" (a URL that only
        // looks like an address) in a comment: neither is a contact address. Reserved example
        // domains (example.com, the .example TLD) never are.
        if (!/@(?:example\.com|[A-Za-z0-9-]+\.example)$/.test(match[0])) addresses.add(match[0]);
      }
    }
    expect([...addresses]).toEqual([contactDetails.email]);
    expect(readFileSync(resolve('server.cjs'), 'utf8')).toContain(contactDetails.phone);
  });
});