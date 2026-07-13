import { describe, it, expect } from 'vitest';
// @ts-expect-error -- importing a Node ESM .mjs module with no type declarations
import { scanLegalPlaceholders, BANNED_PHRASES } from '../scripts/check-legal-placeholders.mjs';

describe('legal placeholder guardrail (P0-02)', () => {
  it('flags a banned bracketed placeholder token in a sample string', () => {
    const matches = scanLegalPlaceholders([
      { path: 'TermsOfService.tsx', content: 'Last updated: [Date to be set upon legal review]' },
    ]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toContain('TermsOfService.tsx:1');
    expect(matches[0]).toContain('[Date to be set');
  });

  it('passes (no matches) when no banned phrases are present', () => {
    const matches = scanLegalPlaceholders([
      {
        path: 'TermsOfService.tsx',
        content:
          'This page is provided as a business draft for review and should be reviewed by qualified legal counsel before publication.',
      },
    ]);
    expect(matches).toEqual([]);
  });

  it('flags every banned phrase at least once across sample strings', () => {
    for (const phrase of BANNED_PHRASES) {
      const matches = scanLegalPlaceholders([
        { path: 'sample.tsx', content: `token ${phrase} appears here` },
      ]);
      expect(matches.length, `expected phrase "${phrase}" to be flagged`).toBeGreaterThan(0);
    }
  });
});