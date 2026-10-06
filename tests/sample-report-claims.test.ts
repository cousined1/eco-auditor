/**
 * The sample-report page makes specific, checkable claims about downloadable
 * files — row counts and a file size — on the primary sales surface. Those
 * claims are verifiable, so they should be verified.
 *
 * PROV-03 (earlier in this audit) cleared fabricated checksums and an
 * un-shipped DEFRA library out of the sample report. This closes the same class
 * from the other direction: rather than auditing each number by hand, assert
 * that the page and the assets cannot disagree.
 *
 * TRUTH-01: the page stated the sample PDF was "~3 KB". The file is 920 bytes
 * (0.9 KB) — off by more than 3x, on the page a prospect downloads from to
 * decide whether to trust the product. The three CSV counts were accurate, which
 * is exactly why nobody would have thought to check the fourth.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');
const pageSource = readFileSync(resolve(repoRoot, 'src', 'pages', 'SampleReport.tsx'), 'utf8');

/** Every `href="/sample-report/..."` the page links to, with its caption. */
function downloadLinks(): { href: string; caption: string }[] {
  const out: { href: string; caption: string }[] = [];
  const anchor = /<a\s[\s\S]*?href="(\/sample-report\/[^"]+)"[\s\S]*?<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(pageSource)) !== null) {
    // The caption is the first text-2xs paragraph inside the anchor.
    const caption = match[0].match(/text-2xs text-surface-500">([^<]+)</)?.[1]?.trim() ?? '';
    out.push({ href: match[1], caption });
  }
  return out;
}

const dataRows = (csv: string): number => {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  // Subtract the header row; the last line must be a real record, not a newline.
  return Math.max(lines.length - 1, 0);
};

describe('every advertised download resolves to a real file', () => {
  const links = downloadLinks();

  it('the page actually advertises downloads', () => {
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  for (const { href } of links) {
    it(`${href} exists in public/`, () => {
      const file = resolve(repoRoot, 'public', href.replace(/^\//, ''));
      expect(existsSync(file), `${href} is advertised but not shipped`).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(0);
    });
  }

  it('every shipped sample file is reachable from the page', () => {
    // A file that exists but is never linked is dead weight; a linked file that
    // does not exist is a broken download. Both directions matter.
    const advertised = new Set(links.map((l) => l.href.replace(/^\//, '')));
    for (const name of [
      'sample-report/pacific-freight-fy2026.pdf',
      'sample-report/pacific-freight-activity-data.csv',
      'sample-report/pacific-freight-factor-register.csv',
      'sample-report/pacific-freight-evidence-index.csv',
    ]) {
      expect(advertised.has(name), `${name} is shipped but not linked from the page`).toBe(true);
    }
  });
});

describe('TRUTH-01 the stated row counts match the shipped CSVs', () => {
  const cases: { file: string; stated: RegExp }[] = [
    { file: 'sample-report/pacific-freight-activity-data.csv', stated: /\b(\d+)\s+rows\b/ },
    { file: 'sample-report/pacific-freight-factor-register.csv', stated: /\b(\d+)\s+factors\b/ },
    { file: 'sample-report/pacific-freight-evidence-index.csv', stated: /\b(\d+)\s+entries\b/ },
  ];

  for (const { file, stated } of cases) {
    it(`${file} states its true row count`, () => {
      const link = downloadLinks().find((l) => l.href === `/${file}`);
      expect(link, `${file} is not linked from the page`).toBeDefined();

      const claimed = Number(link!.caption.match(stated)?.[1]);
      expect(claimed, `no row count stated for ${file}`).toBeGreaterThan(0);

      const actual = dataRows(readFileSync(resolve(repoRoot, 'public', file), 'utf8'));
      expect(
        claimed,
        `page says ${claimed} but ${file} has ${actual} data rows`
      ).toBe(actual);
    });
  }
});

describe('TRUTH-01 the stated file size matches the shipped file', () => {
  it('does not overstate the sample PDF size', () => {
    const link = downloadLinks().find((l) => l.href.endsWith('.pdf'));
    expect(link).toBeDefined();

    const bytes = statSync(
      resolve(repoRoot, 'public', link!.href.replace(/^\//, ''))
    ).size;
    const kb = bytes / 1024;

    const statedKb = Number(link!.caption.match(/~\s*([\d.]+)\s*KB/)?.[1]);
    // Number(undefined) is NaN, not undefined — guard on finiteness, not on the
    // match being absent, or the original "~3 KB" claim slips past unnoticed.
    if (Number.isFinite(statedKb)) {
      // A "~N KB" claim on a sub-2 KB file is the shape of the original defect:
      // ~3 KB against a 0.9 KB file. Tolerate rounding, not inflation.
      expect(
        Math.abs(statedKb - kb),
        `page claims ~${statedKb} KB but the file is ${kb.toFixed(2)} KB (${bytes} bytes)`
      ).toBeLessThan(1);
    }

    // And the page states the band it actually falls in.
    const ceiling = Number(link!.caption.match(/Under\s+(\d+)\s*KB/)?.[1]);
    if (Number.isFinite(ceiling)) {
      expect(kb, `file is ${kb.toFixed(2)} KB, page says "Under ${ceiling} KB"`).toBeLessThan(ceiling);
    }
  });

  it('states a size band at all, so the claim cannot simply disappear', () => {
    const link = downloadLinks().find((l) => l.href.endsWith('.pdf'))!;
    const statesASize = /(~\s*[\d.]+\s*KB)|(Under\s+\d+\s*KB)/.test(link.caption);
    expect(statesASize, `PDF caption states no size: "${link.caption}"`).toBe(true);
  });

  it('is a structurally valid PDF, not a renamed placeholder', () => {
    const buf = readFileSync(resolve(repoRoot, 'public', 'sample-report', 'pacific-freight-fy2026.pdf'));
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buf.subarray(-6).toString('ascii').trim()).toContain('%%EOF');
  });
});

describe('the page keeps labelling sample data as illustrative', () => {
  it('states the data is fictional in more than one place', () => {
    expect(pageSource).toContain('Every figure on this page is fictional');
    expect(pageSource).toContain('All sample data is fictional');
    expect(pageSource).toContain('Sample output — illustrative data');
  });

  it('separates what ships today from what is on the roadmap', () => {
    // The roadmap labelling was added when the detail-ledger claims were
    // corrected; it must not quietly regress into implying all four exports
    // exist in the product.
    expect(pageSource).toContain('available today');
    expect(pageSource).toContain('Roadmap');
    expect(pageSource).toContain('on the roadmap');
  });
});