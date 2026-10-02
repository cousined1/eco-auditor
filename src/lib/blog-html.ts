// F-C-21 — a published post rendered its title as an <h1> twice: once in the page
// header and once as the first line of body_html, so the article repeated its
// title and the page had two H1s. Fixing it at render time also corrects the
// posts already stored in the database.

const LEADING_H1 = /^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/i;

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Returns `bodyHtml` with no <h1> left: a leading <h1> that repeats the page
 * title is dropped, and any other <h1> is demoted to <h2>. The page header owns
 * the single H1.
 */
export function singleH1Body(bodyHtml: string, pageTitle: string): string {
  let html = bodyHtml;
  const leading = LEADING_H1.exec(html);
  if (leading && plainText(leading[1] ?? '') === plainText(pageTitle)) {
    html = html.slice(leading[0].length);
  }
  return html.replace(/<h1\b/gi, '<h2').replace(/<\/h1>/gi, '</h2>');
}

/**
 * D-W2A-5 — a link target from a stored post is either a root-relative path or an
 * https URL; anything else (javascript:, data:, //host, http:) is refused and
 * yields null. This is the allowlist server-blog-render.cjs applies when it makes a
 * post public (safeHref there; tests/blog-render.test.ts keeps the two equal), applied
 * again here because the post the page renders is data: embedded in the page, or
 * returned by the API.
 *
 * No whitespace or control character is allowed anywhere in it: a browser drops tabs
 * and newlines from a URL before it reads it, so "/<TAB>/host" would pass as a path
 * and be followed as "//host". An https URL carries no credentials either
 * ("https://ecoauditor.io@evil.example/" goes to evil.example): a call to action has
 * no use for them, and the look of a trusted host in front of an @ is what a phishing
 * link is made of.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (/[\s\p{Cc}]/u.test(value)) return null;
  if (/^\/(?![/\\])/u.test(value)) return value;
  if (/^https:\/\/[^/?#@\s]+(?:[/?#]\S*)?$/iu.test(value)) return value;
  return null;
}
