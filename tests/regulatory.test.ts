// F-A-05 — the regulatory module is the only place a regulatory date or status
// may be typed. These tests keep its facts dated, sourced, and honest about
// what is final and what is not.
import { describe, it, expect } from 'vitest';
import { REGULATORY, REGULATORY_AS_OF } from '../src/content/regulatory';

const facts = Object.values(REGULATORY);
const today = new Date().toISOString().slice(0, 10);
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

describe('regulatory facts', () => {
  it('each carries a primary-source URL, an as-of date and a review date after it', () => {
    for (const fact of facts) {
      expect(fact.source_url, fact.id).toMatch(/^https:\/\//);
      expect(fact.as_of, fact.id).toBe(REGULATORY_AS_OF);
      expect(fact.review_due > fact.as_of, `${fact.id}: review_due must follow as_of`).toBe(true);
    }
  });

  it('every statement shows the same as-of date its fact records', () => {
    for (const fact of facts) {
      expect(fact.statement, fact.id).toContain(`as of ${longDate(fact.as_of)}`);
    }
  });

  it('SB 253 is presented as awaiting approval, with the November date, never as final', () => {
    const sb253 = REGULATORY.sb253;
    expect(sb253.status).toBe('pending-approval');
    expect(sb253.statement).toContain('November 10, 2026');
    expect(sb253.statement).toContain('awaiting approval');
    expect(sb253.statement).toContain('Office of Administrative Law');
    expect(sb253.statement).toContain('$1 billion');
    expect(sb253.statement).toMatch(/Scope 3 reporting is not required for 2026/);
    expect(sb253.statement).not.toMatch(/August/);
  });

  it('SB 261 is enjoined and the SEC rules are stayed with rescission only proposed', () => {
    expect(REGULATORY.sb261.status).toBe('enjoined');
    expect(REGULATORY.sb261.statement).toMatch(/on hold/);
    expect(REGULATORY['sec-climate'].status).toBe('stayed');
    expect(REGULATORY['sec-climate'].statement).toMatch(/proposed rescinding/);
    expect(REGULATORY['sec-climate'].statement).toMatch(/has not issued a final rule/);
    expect(REGULATORY['sec-climate'].statement).not.toMatch(/withdrawn/i);
  });

  it('CBAM statement puts the obligation on EU importers and dates the first annual declaration', () => {
    const cbam = REGULATORY['eu-cbam'].statement;
    expect(cbam).toContain('EU importers');
    expect(cbam).toContain('September 30, 2027');
    expect(cbam).not.toMatch(/quarterly/i);
  });

  it('no fact is past its review date (re-read the primary sources, then update and bump review_due)', () => {
    const overdue = facts.filter((f) => f.review_due < today).map((f) => `${f.id} (due ${f.review_due})`);
    expect(overdue, 'regulatory facts past review_due in src/content/regulatory.ts').toEqual([]);
  });
});
