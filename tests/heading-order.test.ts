// @vitest-environment node
// Node, not jsdom: scripts/prerender.mjs renders in Node, and this reads what it writes.
//
// F-C-21: screen-reader users move through a page by heading level, and axe's
// `heading-order` rule failed on five pages: /security (h1 -> h3: the five trust cards),
// /privacy and /dpa (h2 -> h4: the sub-headings inside a section and inside Annexes II and
// IV), and /pricing and /contact (card titles). The pricing and contact fixes have their own
// checks in marketing-pages-render.test.ts; this holds all five to one rule, on the same
// entry-server render the prerender step uses, header and footer included.
import { describe, expect, it } from 'vitest';
import { render } from '../src/entry-server';

const PAGES = ['/pricing', '/contact', '/security', '/privacy', '/dpa'] as const;

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

type Heading = { level: number; text: string };

/** Every heading in document order, with its visible text. */
function headingsOf(html: string): Heading[] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    text: decode((m[2] ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
  }));
}

/** Each heading that is more than one level deeper than the heading before it. */
function skips(list: Heading[]): string[] {
  return list.flatMap((heading, i) => {
    const before = list[i - 1];
    return before && heading.level > before.level + 1
      ? [`h${before.level} "${before.text}" -> h${heading.level} "${heading.text}"`]
      : [];
  });
}

describe('heading order on the five pages F-C-21 names', () => {
  it('the scan itself works: it reads levels and finds a skip', () => {
    expect(headingsOf('<h1>A</h1><h2 class="x">B <!-- -->&amp; C</h2><h4>D</h4>')).toEqual([
      { level: 1, text: 'A' },
      { level: 2, text: 'B & C' },
      { level: 4, text: 'D' },
    ]);
    expect(skips(headingsOf('<h1>A</h1><h2>B</h2><h4>D</h4><h2>E</h2><h3>F</h3>'))).toEqual(['h2 "B" -> h4 "D"']);
  });

  it.each(PAGES)('%s has one h1 and never goes deeper by more than one level', (route) => {
    const list = headingsOf(render(route));
    expect(list.length, `${route} rendered no headings`).toBeGreaterThan(3);
    expect(list.filter((heading) => heading.level === 1)).toHaveLength(1);
    expect(skips(list)).toEqual([]);
  });

  it('the legal pages keep their sub-headings one level under the section title', () => {
    const privacy = headingsOf(render('/privacy'));
    expect(privacy).toContainEqual({ level: 3, text: 'Service Providers and Subprocessors' });
    expect(privacy).toContainEqual({ level: 3, text: 'Compliance and Legal Requirements' });
    const dpa = headingsOf(render('/dpa'));
    for (const text of ['Access Control', 'Subprocessor Management', 'SCC Module Applicability', 'Transfer Mechanism', 'Supplementary Measures']) {
      expect(dpa, text).toContainEqual({ level: 3, text });
    }
  });

  it('the security page puts its five trust cards directly under the h1 as h2', () => {
    const security = headingsOf(render('/security'));
    for (const text of ['Encryption', 'Infrastructure', 'Access Control', 'Data Handling', 'Compliance']) {
      expect(security, text).toContainEqual({ level: 2, text });
    }
  });
});
