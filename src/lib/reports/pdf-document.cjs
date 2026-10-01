'use strict';

// A hand-built PDF 1.4 file for the report generator (audit K3, F-E-16): one
// standard font (Helvetica, WinAnsiEncoding, so accented Latin names print
// correctly instead of as mojibake), as many letter-size pages as the text
// needs, and an /Info dictionary. Output is a pure function of the input: the
// same text and info always give the same bytes, which is what lets a stored
// report be compared byte for byte.

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const FONT_SIZE = 10;
const LEADING = 14;
const LEFT = 56;
const TOP = 740;
const LINES_PER_PAGE = 48;
const FOOTER_SIZE = 8;
const FOOTER_Y = 40;
const TEXT_WIDTH = PAGE_WIDTH - 2 * LEFT;

function cleanText(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

// Helvetica advance widths (Adobe AFM, 1/1000 em) in WinAnsiEncoding: codes
// 32-126, then 128-255. Codes WinAnsi leaves undefined count as a full em, so a
// wrapped line can only come out narrower than the page, never wider.
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];
const HELVETICA_HIGH = [
  556, 1000, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 1000, 611, 1000,
  1000, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 1000, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

// WinAnsiEncoding (PDF 1.7, Annex D) is Latin-1 plus these code points in 0x80-0x9F.
const WIN_ANSI_EXTRA = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function winAnsiByte(codePoint) {
  if ((codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff)) return codePoint;
  return WIN_ANSI_EXTRA[codePoint];
}

// One byte per character. A character WinAnsi lacks falls back to its
// compatibility decomposition without accents (subscript 2 -> 2, o with double
// acute -> o), else '?'.
function toWinAnsi(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const direct = winAnsiByte(code);
    if (direct !== undefined) {
      out += String.fromCharCode(direct);
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += ' ';
      continue;
    }
    let fallback = '';
    for (const part of ch.normalize('NFKD')) {
      const byte = winAnsiByte(part.codePointAt(0));
      if (byte !== undefined) fallback += String.fromCharCode(byte);
    }
    out += fallback || '?';
  }
  return out;
}

// Width in points of a line set at FONT_SIZE.
function textWidth(text) {
  const bytes = toWinAnsi(text);
  let units = 0;
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes.charCodeAt(i);
    units += code >= 32 && code <= 126 ? HELVETICA_ASCII[code - 32] : code >= 128 ? HELVETICA_HIGH[code - 128] : 1000;
  }
  return (units * FONT_SIZE) / 1000;
}

// A PDF literal string: "(", ")" and "\" escaped so caller text can never end
// the string early and run as PDF operators.
function pdfLiteral(text) {
  return '(' + toWinAnsi(text).replace(/[()\\]/g, '\\$&') + ')';
}

// A PDF text string for /Info: UTF-16BE with a byte-order mark, so any name reads correctly.
function pdfTextString(text) {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return '<' + hex + '>';
}

function pdfDate(value) {
  const time = Date.parse(cleanText(value));
  if (!Number.isFinite(time)) return null;
  return '(D:' + new Date(time).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z)';
}

function infoDictionary(info) {
  const entries = [];
  if (cleanText(info.title)) entries.push('/Title ' + pdfTextString(cleanText(info.title)));
  if (cleanText(info.author)) entries.push('/Author ' + pdfTextString(cleanText(info.author)));
  if (cleanText(info.subject)) entries.push('/Subject ' + pdfTextString(cleanText(info.subject)));
  const created = info.creationDate ? pdfDate(info.creationDate) : null;
  if (created) entries.push('/CreationDate ' + created);
  if (!entries.length) return null;
  entries.push('/Creator (Eco-Auditor)', '/Producer (Eco-Auditor report generator)');
  return '<< ' + entries.join(' ') + ' >>';
}

function pageContent(lines, pageIndex, pageCount, footer) {
  let stream = 'BT /F1 ' + FONT_SIZE + ' Tf ' + LEFT + ' ' + TOP + ' Td';
  lines.forEach(function (line, i) {
    stream += (i ? '\n0 -' + LEADING + ' Td' : '') + '\n' + pdfLiteral(line) + ' Tj';
  });
  stream += '\nET';
  if (footer) {
    stream += '\nBT /F1 ' + FOOTER_SIZE + ' Tf ' + LEFT + ' ' + FOOTER_Y + ' Td\n' +
      pdfLiteral(footer + ' \u00b7 Page ' + (pageIndex + 1) + ' of ' + pageCount) + ' Tj\nET';
  }
  return stream;
}

/**
 * Text -> PDF bytes. Each "\n"-separated line is one line on the page, in
 * order; LINES_PER_PAGE lines per page. `info` is optional: { title, author,
 * subject, creationDate, footer } (footer adds "<footer> · Page n of N").
 */
function createSimplePdf(text, info) {
  const options = info || {};
  const lines = String(text).split('\n');
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));

  // Objects 1-3 are fixed: catalog, page tree, font. Pages and the /Info
  // dictionary follow. Strings hold one byte per character (latin1).
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  pages.forEach(function (pageLines, index) {
    const stream = pageContent(pageLines, index, pages.length, cleanText(options.footer));
    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    const contents = objects.length;
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT + '] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + contents + ' 0 R >>');
    kids.push(objects.length);
  });
  objects[1] = '<< /Type /Pages /Kids [' + kids.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
  const infoObject = infoDictionary(options);
  if (infoObject) objects.push(infoObject);

  // The comment line after the header marks the file as binary (bytes > 127).
  let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets = [0];
  objects.forEach(function (object, index) {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer << /Size ' + (objects.length + 1) + ' /Root 1 0 R' + (infoObject ? ' /Info ' + objects.length + ' 0 R' : '') + ' >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}

module.exports = {
  LINES_PER_PAGE,
  TEXT_WIDTH,
  cleanText,
  textWidth,
  toWinAnsi,
  createSimplePdf,
};
