// F-C-21 — a published post rendered its title as an H1 twice (page header plus
// the first line of body_html). singleH1Body() runs at render time, so posts
// already stored in the database are fixed too.
import { describe, it, expect } from 'vitest';
import { safeHref, singleH1Body } from '../src/lib/blog-html';

const TITLE = 'Carbon Accounting Software for SMBs (2026 Guide)';

// D-W2A-5: a link target from a stored post is either a root-relative path or an
// https URL. The server applies this when it makes a post public (toPublicPost);
// the client applies it again before it renders one, so a later <a href> or a
// publish API that accepts a CTA cannot turn a stored value into a script.
describe('safeHref', () => {
  it.each([
    '/signup/',
    '/pricing/?plan=growth#compare',
    'https://example.com/x?y=1',
    'HTTPS://example.com/',
    'https://example.com/account@home', // an @ after the host is part of the path
    'https://example.com/?email=a@b.co',
    'https://example.com:8443/x',
  ])('keeps %s', (href) => {
    expect(safeHref(href)).toBe(href);
  });

  it('trims the value it keeps', () => {
    expect(safeHref('  /signup/  ')).toBe('/signup/');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example',
    '/\\evil.example',
    'http://example.com',
    'ftp://example.com/x',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/ /evil.example',
    '/ /evil.example',
    '/\u0000/evil.example',
    'https://exa mple.com',
    'https://',
    'https://ecoauditor.io@evil.example/login', // the host is what follows the @
    'https://user:secret@example.com/',
    'https://@example.com/',
    'mailto:someone@example.com',
    'relative/path',
    '#fragment',
    '',
    '   ',
  ])('refuses %j', (href) => {
    expect(safeHref(href)).toBeNull();
  });

  it.each([[null], [undefined], [42], [true], [{}], [['/x/']]])('refuses a value that is not text: %j', (href) => {
    expect(safeHref(href)).toBeNull();
  });
});

describe('singleH1Body', () => {
  it('drops a leading H1 that repeats the page title', () => {
    const html = singleH1Body(`<h1>${TITLE}</h1>\n<p>Intro</p><h2>Why</h2>`, TITLE);
    expect(html).toBe('<p>Intro</p><h2>Why</h2>');
  });

  it('matches the title ignoring case, attributes, inner tags, entities and whitespace', () => {
    const body = '  \n<h1 id="t" class="x">carbon  accounting <em>software</em> for SMBs &amp; more</h1><p>Body</p>';
    expect(singleH1Body(body, 'Carbon Accounting Software for SMBs & More')).toBe('<p>Body</p>');
  });

  it('demotes a leading H1 that is NOT the title instead of deleting content', () => {
    expect(singleH1Body('<h1>A different heading</h1><p>Body</p>', TITLE)).toBe('<h2>A different heading</h2><p>Body</p>');
  });

  it('demotes any other H1 in the body, so the page header owns the only H1', () => {
    const html = singleH1Body(`<h1>${TITLE}</h1><p>a</p><h1 class="late">Second</h1><p>b</p>`, TITLE);
    expect(html).toBe('<p>a</p><h2 class="late">Second</h2><p>b</p>');
    expect(html).not.toMatch(/<h1/i);
    expect(html).not.toMatch(/<\/h1>/i);
  });

  it('leaves a body with no H1 untouched, including other heading levels', () => {
    const body = '<p>Intro</p><h2>Two</h2><h3>Three</h3><h10>not a heading</h10>';
    expect(singleH1Body(body, TITLE)).toBe(body);
  });

  it('never adds markup: only h1 tags are renamed or removed', () => {
    const body = `<h1>${TITLE}</h1><p onclick="x()">kept as sanitized upstream</p>`;
    expect(singleH1Body(body, TITLE)).toBe('<p onclick="x()">kept as sanitized upstream</p>');
  });

  it('copes with an unterminated H1 without hanging', () => {
    const body = `<h1>${'x'.repeat(50_000)}`;
    const started = Date.now();
    expect(singleH1Body(body, TITLE)).toContain('<h2');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
