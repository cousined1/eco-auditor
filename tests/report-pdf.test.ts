/**
 * F-G-04 (d) — createSimplePdf had no test at all, yet every report download
 * (/api/reports/:id/download) and the sample report are produced by it.
 *
 * These tests parse the bytes the way a PDF reader does (startxref -> xref
 * table -> objects -> page tree -> content streams) instead of pinning source
 * text, so they fail if the generator stops producing a readable document:
 * wrong byte offsets, a wrong /Length, a broken object graph, or text that
 * escapes its string literal. The last one matters beyond rendering: company,
 * facility and period text reach the content stream, so an unescaped ")" would
 * let it inject PDF operators.
 *
 * K3 (F-E-16): the generator now paginates and writes WinAnsiEncoding, so the
 * reader walks every page and decodes WinAnsi. It decodes with its own table
 * (PDF 1.7 Annex D), not the generator's, so the two cannot share a mistake.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReportText, createSimplePdf, LINES_PER_PAGE } = require('../src/lib/reports/report-generator.cjs') as {
  buildReportText: (summary: Record<string, unknown>, period?: string | null) => string;
  createSimplePdf: (text: string, info?: Record<string, unknown>) => Buffer;
  LINES_PER_PAGE: number;
};

interface ParsedPdf {
  objects: Map<number, string>;
  root: number;
  trailer: string;
  /** Decoded content stream of each page, in page order. */
  pages: string[];
}

function fail(message: string): never {
  throw new Error(`invalid PDF: ${message}`);
}

// WinAnsiEncoding bytes 0x80-0x9F that differ from Latin-1 (PDF 1.7, Annex D).
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodeWinAnsi(latin1: string): string {
  return [...latin1].map((ch) => WIN_ANSI_HIGH[ch.charCodeAt(0)] ?? ch).join('');
}

/** Minimal reader for the uncompressed files createSimplePdf writes. */
function parsePdf(pdf: Buffer): ParsedPdf {
  const text = pdf.toString('latin1'); // 1 char per byte, so indexes are byte offsets
  if (!text.startsWith('%PDF-1.')) fail('missing %PDF-1.x header');
  if (!text.trimEnd().endsWith('%%EOF')) fail('missing %%EOF trailer');

  const startxrefAt = text.lastIndexOf('startxref');
  if (startxrefAt === -1) fail('no startxref');
  const xrefOffset = Number(/^startxref\s+(\d+)/.exec(text.slice(startxrefAt))?.[1]);
  if (text.slice(xrefOffset, xrefOffset + 4) !== 'xref') fail(`startxref ${xrefOffset} does not point at the xref table`);

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset));
  if (!header) fail('malformed xref subsection header');
  const count = Number(header[1]);
  const entriesAt = xrefOffset + header[0].length;
  const objects = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const entry = text.slice(entriesAt + i * 20, entriesAt + (i + 1) * 20); // entries are exactly 20 bytes
    const parts = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(entry);
    if (!parts) fail(`xref entry ${i} is not a 20-byte entry`);
    if (i === 0) {
      if (parts[3] !== 'f') fail('xref entry 0 must be the free-list head');
      continue;
    }
    const offset = Number(parts[1]);
    if (!text.startsWith(`${i} 0 obj\n`, offset)) fail(`xref offset ${offset} does not point at object ${i}`);
    const end = text.indexOf('\nendobj', offset);
    if (end === -1) fail(`object ${i} has no endobj`);
    objects.set(i, text.slice(offset + `${i} 0 obj\n`.length, end));
  }

  const trailer = text.slice(entriesAt + count * 20, startxrefAt);
  if (Number(/\/Size (\d+)/.exec(trailer)?.[1]) !== count) fail('trailer /Size disagrees with the xref table');
  const root = Number(/\/Root (\d+) 0 R/.exec(trailer)?.[1]);
  const ref = (body: string | undefined, key: string): number => {
    const found = new RegExp(`/${key} (\\d+) 0 R`).exec(body ?? '');
    if (!found) fail(`missing /${key} reference`);
    return Number(found[1]);
  };

  const catalog = objects.get(root);
  if (!catalog?.includes('/Type /Catalog')) fail('/Root is not a catalog');
  const tree = objects.get(ref(catalog, 'Pages'));
  if (!tree?.includes('/Type /Pages')) fail('/Pages is not a page tree');
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  if (kids.length === 0) fail('page tree has no pages');
  if (Number(/\/Count (\d+)/.exec(tree)?.[1]) !== kids.length) fail('page tree /Count disagrees with /Kids');

  const pages = kids.map((kid) => {
    const page = objects.get(kid);
    if (!page?.includes('/Type /Page ')) fail(`/Kids entry ${kid} is not a page`);
    const font = objects.get(ref(page, 'F1'));
    if (!font?.includes('/Type /Font')) fail('page font resource is not a font');
    if (!font.includes('/Encoding /WinAnsiEncoding')) fail('font does not declare WinAnsiEncoding');
    const stream = objects.get(ref(page, 'Contents'));
    const streamHead = /^<< \/Length (\d+) >>\nstream\n/.exec(stream ?? '');
    if (!stream || !streamHead) fail('content stream has no /Length header');
    const length = Number(streamHead[1]);
    const body = stream.slice(streamHead[0].length);
    if (body.slice(length) !== '\nendstream') fail(`/Length ${length} does not match the stream bytes`);
    return decodeWinAnsi(body.slice(0, length));
  });
  return { objects, root, trailer, pages };
}

/**
 * Tokenizes one content stream: every string literal must be followed by the
 * Tj operator, and the only other tokens allowed are the text operators
 * createSimplePdf writes (BT, ET, Tf, Td) with numeric operands and the /F1
 * font name. Returns the decoded text of each literal.
 */
function shownLines(stream: string): string[] {
  const lines: string[] = [];
  const operators: string[] = [];
  let i = 0;
  while (i < stream.length) {
    const ch = stream[i]!;
    if (ch === '(') {
      let value = '';
      i++;
      for (;;) {
        if (i >= stream.length) fail('unterminated string literal');
        const c = stream[i]!;
        if (c === '\\') { value += stream[i + 1] ?? ''; i += 2; continue; }
        if (c === '(') fail('unescaped "(" inside a string literal');
        if (c === ')') { i++; break; }
        value += c;
        i++;
      }
      lines.push(value);
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    const token = /^[^\s()]+/.exec(stream.slice(i))![0];
    operators.push(token);
    i += token.length;
  }
  const unexpected = operators.filter((token) => !['BT', 'ET', '/F1', 'Tf', 'Td', 'Tj'].includes(token) && !/^-?\d+$/.test(token));
  if (unexpected.length) fail(`unexpected operators in the content stream: ${unexpected.join(' ')}`);
  if (operators.filter((token) => token === 'Tj').length !== lines.length) fail('a string literal is not shown with Tj');
  return lines;
}

const allLines = (parsed: ParsedPdf) => parsed.pages.flatMap(shownLines);

const summary = {
  total_emissions_tCO2e: 436.2,
  by_scope: { scope1: 91.8, scope2: 44.1, scope3: 300.3 },
  confidence_score: 59,
  methodology: 'GHG Protocol - Operational Control',
};

describe('F-G-04 — createSimplePdf produces a document a PDF reader can open', () => {
  it('a real report renders to a structurally valid, non-empty PDF', () => {
    const text = buildReportText(summary, 'FY 2026');
    const pdf = createSimplePdf(text);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(300);
    const parsed = parsePdf(pdf); // throws on any structural defect
    expect(parsed.pages.join('').length).toBeGreaterThan(text.length);
  });

  it('every report line is shown, in order, with the totals', () => {
    const text = buildReportText(summary, 'FY 2026');
    const lines = allLines(parsePdf(createSimplePdf(text)));
    expect(lines).toEqual(text.split('\n'));
    expect(lines).toContain('Total: 436.2 tCO2e');
    expect(lines).toContain('Scope 3: 300.3 tCO2e');
    expect(lines).toContain('Reporting period: FY 2026');
  });

  it('caller-controlled text cannot break out of its string literal', () => {
    // An unbalanced ")" would end the literal early and turn the rest of the
    // line into PDF operators; "\" would escape the closing parenthesis.
    const hostile = ['2026) Tj ET BT /F1 72 Tf (injected', 'C:\\ledger\\', '(unclosed', 'balanced (ok)'];
    const text = buildReportText(summary, hostile.join(' | '));
    const lines = allLines(parsePdf(createSimplePdf(text)));
    expect(lines).toEqual(text.split('\n'));
    // The report text wraps long lines at word boundaries; rejoined, the period is intact.
    expect(lines.join(' ').replace(/ {2,}/g, ' ')).toContain(`Reporting period: ${hostile.join(' | ')}`);
  });

  it('byte offsets and /Length stay exact, and non-ASCII text prints as itself (F-E-16)', () => {
    // WinAnsi covers Latin-1 plus the dashes and quotes; "₂" is outside it and
    // prints as its compatibility form "2", never as mojibake.
    const text = 'Emissions CO₂e — Zürich site\nSecond line: 5 µg · São Paulo · Müller “Ltd”';
    const parsed = parsePdf(createSimplePdf(text)); // parsePdf checks offsets and /Length in bytes
    expect(allLines(parsed)).toEqual(['Emissions CO2e — Zürich site', 'Second line: 5 µg · São Paulo · Müller “Ltd”']);
  });

  it('repeated calls are independent: same input, same bytes; different input, its own content only', () => {
    const first = buildReportText(summary, 'FY 2025');
    const second = buildReportText({ ...summary, total_emissions_tCO2e: 12.5 }, 'FY 2026');
    const a1 = createSimplePdf(first);
    const b = createSimplePdf(second);
    const a2 = createSimplePdf(first);
    expect(a2.equals(a1)).toBe(true);
    expect(b.equals(a1)).toBe(false);
    const bLines = allLines(parsePdf(b));
    expect(bLines).toEqual(second.split('\n'));
    expect(bLines).not.toContain('Reporting period: FY 2025');
  });

  it('text longer than a page continues on further pages, in order (F-E-16)', () => {
    const lines = Array.from({ length: LINES_PER_PAGE * 2 + 5 }, (_, i) => `Line ${i + 1}`);
    const parsed = parsePdf(createSimplePdf(lines.join('\n')));
    expect(parsed.pages).toHaveLength(3);
    expect(parsed.pages.map((page) => shownLines(page).length)).toEqual([LINES_PER_PAGE, LINES_PER_PAGE, 5]);
    expect(allLines(parsed)).toEqual(lines);
  });

  it('writes document metadata when asked, and a footer with page numbers (F-E-16)', () => {
    const lines = Array.from({ length: LINES_PER_PAGE + 1 }, (_, i) => `Line ${i + 1}`);
    const parsed = parsePdf(createSimplePdf(lines.join('\n'), {
      title: 'Emissions report - Müller GmbH',
      creationDate: '2026-09-30T14:22:05.123Z',
      footer: 'Müller GmbH',
    }));
    const info = parsed.objects.get(Number(/\/Info (\d+) 0 R/.exec(parsed.trailer)?.[1]));
    expect(info).toBeDefined();
    const title = /\/Title <FEFF([0-9A-F]+)>/.exec(info ?? '')?.[1] ?? '';
    expect(Buffer.from(title, 'hex').swap16().toString('utf16le')).toBe('Emissions report - Müller GmbH');
    expect(info).toContain('/CreationDate (D:20260930142205Z)');
    // Body lines first, then the footer, on every page.
    expect(shownLines(parsed.pages[0]!).at(-1)).toBe('Müller GmbH · Page 1 of 2');
    expect(shownLines(parsed.pages[1]!)).toEqual([`Line ${LINES_PER_PAGE + 1}`, 'Müller GmbH · Page 2 of 2']);
  });
});
