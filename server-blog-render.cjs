'use strict';

/**
 * Server-side HTML for the blog: one page per published post, the /blog index,
 * and sitemap.xml. Pure string functions with no I/O, so tests/blog-render.test.ts
 * can run them against the real index.html template.
 *
 * Why this exists (audit F-F-01): every /blog/* URL used to be answered with the
 * homepage, so a crawler that does not run JavaScript (GPTBot, ClaudeBot,
 * PerplexityBot) saw the homepage on every post, Google was told by
 * `rel=canonical` that each post WAS the homepage, and posts published at runtime
 * (POST /api/publish) cannot be prerendered at build time.
 *
 * Every value that comes from a stored post is escaped for the context it lands
 * in: HTML text, an HTML attribute, JSON inside a <script>, or XML. The one raw
 * insertion is the post body, which goes through sanitizeBlogHtml (the publish
 * boundary's own allowlist), and the renderers apply it again so they stay safe
 * whatever the caller passes.
 *
 * The page is the neutral shell (scripts/prerender-head.mjs applyShellHead) with
 * the head rewritten and #root filled. The client still mounts over #root with
 * createRoot (no hydration); it reads the same post back from the embedded JSON,
 * so the swap does not flash a loading state.
 */

const { sanitizeBlogHtml } = require('./server-publish.cjs');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_SLUG_LENGTH = 200;
const MAX_FAQ_ITEMS = 20;

// ─── Escaping ───

function escapeText(value) {
  return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'gu');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'gu');

/** JSON for a <script>: "<" can never close the element, U+2028/9 never end a JS line. */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');
}

// ─── Post data ───

function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function blogListReadMinutes(html) {
  const bounded = String(html || '').slice(0, 100000);
  const text = bounded.replace(/<[^\n>]*>/gu, ' ');
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function blogListExcerpt(row) {
  const meta = row.meta_description && String(row.meta_description).trim();
  if (meta) return meta;
  const text = String(row.body_html || '').slice(0, 100000).replace(/<[^\n>]*>/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (text.length <= 160) return text;
  const sliced = text.slice(0, 160);
  const lastSpace = sliced.lastIndexOf(' ');
  return sliced.slice(0, lastSpace > 80 ? lastSpace : 160) + '…';
}

/**
 * The read path's post: what GET /api/blog-posts/:slug returns and what the page
 * embeds. body_html is sanitised HERE, at read, as well as at publish, and so are
 * the call to action and the link lists: each carries only targets that are a
 * root-relative path or an https URL (safeHref). The publish API stores none today
 * (an empty CTA and empty lists), so this is what keeps a value written any other
 * way, or a later publish API that accepts them, from reaching an <a href> (D-W2A-5).
 */
function toPublicPost(row) {
  return {
    ...row,
    body_html: sanitizeBlogHtml(row.body_html),
    cta: publicCta(row.cta),
    internal_links: publicLinks(row.internal_links),
    external_links: publicLinks(row.external_links),
    published_at: toIso(row.published_at),
  };
}

/** A card of the /blog index: the fields GET /api/blog-posts returns per post. */
function toListItem(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    meta_description: row.meta_description,
    excerpt: blogListExcerpt(row),
    read_minutes: blogListReadMinutes(row.body_html),
    primary_keyword: row.primary_keyword,
    content_score: row.content_score,
    geo_score: row.geo_score,
    published_at: toIso(row.published_at),
  };
}

// ─── Body normalisation (port of src/lib/blog-html.ts; tests/blog-render.test.ts keeps them equal) ───

const LEADING_H1 = /^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/iu;

function plainText(html) {
  return html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&(?:#39|apos);/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&nbsp;/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** The page header owns the single H1: drop a leading one that repeats the title, demote the rest. */
function singleH1Body(bodyHtml, pageTitle) {
  let html = bodyHtml;
  const leading = LEADING_H1.exec(html);
  if (leading && plainText(leading[1] || '') === plainText(pageTitle)) {
    html = html.slice(leading[0].length);
  }
  return html.replace(/<h1\b/giu, '<h2').replace(/<\/h1>/giu, '</h2>');
}

function faqItems(post) {
  if (!Array.isArray(post.faq)) return [];
  return post.faq
    .filter((item) => item && typeof item.question === 'string' && typeof item.answer === 'string' && item.question && item.answer)
    .slice(0, MAX_FAQ_ITEMS);
}

/**
 * A link target is either a root-relative path or an https URL; anything else
 * (javascript:, data:, //host, http:) is dropped. src/lib/blog-html.ts has the same
 * rule for the client, and tests/blog-render.test.ts keeps the two equal.
 *
 * No whitespace or control character is allowed anywhere in it: a browser drops tabs
 * and newlines from a URL before it reads it, so "/<TAB>/host" would be checked here
 * as a path and followed as "//host". An https URL carries no credentials either
 * ("https://ecoauditor.io@evil.example/" goes to evil.example): a call to action has
 * no use for them, and the look of a trusted host in front of an @ is what a phishing
 * link is made of.
 */
function safeHref(href) {
  if (typeof href !== 'string') return null;
  const value = href.trim();
  if (/[\s\p{Cc}]/u.test(value)) return null;
  if (/^\/(?![/\\])/u.test(value)) return value;
  if (/^https:\/\/[^/?#@\s]+(?:[/?#]\S*)?$/iu.test(value)) return value;
  return null;
}

/** A stored CTA as the public post carries it: its label and its checked target, or `{}` (what a post without one stores). */
function publicCta(cta) {
  if (!cta || typeof cta !== 'object' || Array.isArray(cta)) return {};
  const href = safeHref(cta.href);
  if (!href) return {};
  const label = typeof cta.label === 'string' ? cta.label.trim() : '';
  return label ? { label, href } : { href };
}

const LINK_TARGET_KEYS = ['url', 'href'];

/**
 * Stored internal or external links as the public post carries them. The seeded posts
 * name the target `href` and the client's type says `url`, so either is a target: an
 * entry keeps the ones it has and is dropped unless every one passes safeHref (and it
 * has at least one).
 */
function publicLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) => {
    if (!link || typeof link !== 'object') return [];
    const present = LINK_TARGET_KEYS.filter((key) => link[key] !== undefined);
    const checked = present.map((key) => safeHref(link[key]));
    if (present.length === 0 || checked.includes(null)) return [];
    const entry = {};
    present.forEach((key, index) => {
      entry[key] = checked[index];
    });
    entry.anchor = typeof link.anchor === 'string' ? link.anchor : '';
    return [entry];
  });
}

// ─── Head ───

const META_DESCRIPTION_MAX = 160;

/**
 * The description for the <meta>, og and twitter tags: at most 160 characters, cut at
 * a word boundary with an ellipsis, because search results cut a longer one wherever
 * they like (D-W2A-3). One of 160 or fewer is returned exactly as it is. The page's
 * own lead paragraph and the JSON-LD keep the author's full text.
 */
function clampDescription(text) {
  if (text.length <= META_DESCRIPTION_MAX) return text;
  const flat = text.replace(/\s+/gu, ' ');
  if (flat.length <= META_DESCRIPTION_MAX) return flat;
  const room = META_DESCRIPTION_MAX - 1; // the ellipsis takes one character
  let end = room;
  if (!/\s/u.test(flat.charAt(room))) {
    // The cut would fall inside a word: back up to the space before it, unless that
    // leaves under half of what fits (one very long word), when a hard cut is kinder.
    const partialWord = /\s\S*$/u.exec(flat.slice(0, room));
    if (partialWord && partialWord.index > META_DESCRIPTION_MAX / 2) end = partialWord.index;
  }
  const kept = flat
    .slice(0, end)
    .replace(/[\uD800-\uDBFF]$/u, '') // never half of a character that takes two code units
    .replace(/[\s,;:.\-–—]+$/u, ''); // and nothing that reads badly in front of an ellipsis
  return `${kept}…`;
}

/** Title, description and canonical of a post. The page head, the API and the client all use THIS. */
function postHead(post, origin) {
  const title = String(post.meta_title || '').trim() || `${post.title} — Eco-Auditor Blog`;
  return {
    title,
    description: clampDescription(String(post.meta_description || '').trim()),
    canonical: `${origin}/blog/${post.slug}/`,
  };
}

function breadcrumbNode(url, crumbs) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: crumbs.map(([name, item], index) => ({ '@type': 'ListItem', position: index + 1, name, item })),
  };
}

function buildPostJsonLd(post, head, origin) {
  const url = head.canonical;
  const published = toIso(post.published_at);
  const graph = [
    {
      '@type': 'Article',
      '@id': `${url}#article`,
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      headline: post.title,
      // The author's full text: only the meta, og and twitter tags are cut to 160.
      description: String(post.meta_description || '').trim(),
      ...(published ? { datePublished: published, dateModified: published } : {}),
      image: `${origin}/og-image.png`,
      author: { '@id': `${origin}/#organization` },
      publisher: { '@id': `${origin}/#organization` },
      isPartOf: { '@id': `${origin}/#website` },
      ...(post.primary_keyword ? { keywords: post.primary_keyword } : {}),
    },
    breadcrumbNode(url, [['Home', `${origin}/`], ['Blog', `${origin}/blog/`], [post.title, url]]),
  ];
  const faq = faqItems(post);
  if (faq.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faq.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

function buildIndexJsonLd(head, origin) {
  const url = head.canonical;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: head.title,
        description: head.description,
        isPartOf: { '@id': `${origin}/#website` },
      },
      breadcrumbNode(url, [['Home', `${origin}/`], [head.title.split(' — ')[0], url]]),
    ],
  };
}

// The shell's tags, as applyShellHead writes them. A template that stops matching
// throws, so a reformatted index.html fails the build's self-check (prerender.mjs)
// instead of shipping a blog page with the wrong head.
function swap(html, pattern, replacement, what) {
  if (!pattern.test(html)) throw new Error(`blog page: the shell has no ${what}`);
  return html.replace(pattern, replacement);
}

/** Turns the noindex shell into an indexable page head. */
function applyIndexableHead(shell, { title, description, canonical, ogType, extraHead }) {
  let out = swap(shell, /<meta name="robots" content="noindex,nofollow" \/>/u, '<meta name="robots" content="index, follow" />', 'robots meta');
  out = swap(out, /<title>[^<]*<\/title>/u, () => `<title>${escapeText(title)}</title>`, '<title>');
  out = swap(out, /(<meta name="description" content=")[^"]*(")/u, (_, open, close) => `${open}${escapeAttr(description)}${close}`, 'description meta');
  out = swap(out, /<meta property="og:title" content="[^"]*" \/>/u, () => `<meta property="og:title" content="${escapeAttr(title)}" />`, 'og:title meta');
  out = swap(out, /<meta name="twitter:title" content="[^"]*" \/>/u, () => `<meta name="twitter:title" content="${escapeAttr(title)}" />`, 'twitter:title meta');
  out = swap(out, /<meta property="og:description" content="[^"]*" \/>/u, () => `<meta property="og:description" content="${escapeAttr(description)}" />`, 'og:description meta');
  out = swap(out, /<meta name="twitter:description" content="[^"]*" \/>/u, () => `<meta name="twitter:description" content="${escapeAttr(description)}" />`, 'twitter:description meta');
  out = swap(out, /<meta property="og:type" content="website" \/>/u, () => `<meta property="og:type" content="${escapeAttr(ogType)}" />`, 'og:type meta');
  const tags = [
    `<link rel="canonical" href="${escapeAttr(canonical)}" />`,
    `<meta property="og:url" content="${escapeAttr(canonical)}" />`,
    `<meta name="twitter:url" content="${escapeAttr(canonical)}" />`,
    ...extraHead,
  ];
  return swap(out, /<\/head>/u, () => `${tags.join('\n    ')}\n  </head>`, '</head>');
}

const ROOT_PLACEHOLDER = '<div id="root"></div>';

function fillRoot(html, markup, dataScript) {
  if (!html.includes(ROOT_PLACEHOLDER)) throw new Error('blog page: the shell has no empty #root');
  return html.replace(ROOT_PLACEHOLDER, () => `<div id="root">${markup}</div>\n    ${dataScript}`);
}

function ldScript(graph) {
  return `<script type="application/ld+json">${jsonForScript(graph)}</script>`;
}

function dataScript(id, value) {
  return `<script type="application/json" id="${id}">${jsonForScript(value)}</script>`;
}

// ─── Markup ───
// The class strings below are copied from Header.tsx, Footer.tsx, BlogPost.tsx and
// BlogList.tsx on purpose: Tailwind only generates the classes it finds in src, so
// a class used only here would ship unstyled. tests/blog-render.test.ts checks that
// every token still exists there.

const SEPARATOR = '<span aria-hidden="true">·</span>';
const ARROW_LEFT = '<svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" /></svg>';
const ARROW_RIGHT = '<svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>';
const BRAND_MARK = '<svg class="w-7 h-7" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="28" height="28" rx="7" fill="currentColor" class="text-brand-600" /><path d="M8 20V8l6 4 6-4v12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>';
const SKIP_LINK = '<a href="#main-content" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-lg dark:focus:bg-surface-900 dark:focus:text-brand-300">Skip to main content</a>';
const NAV_LINK = 'inline-flex items-center no-underline text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white transition-colors';
const FOOTER_LINK = 'text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors';
const POST_BODY_CLASS = 'max-w-none [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-surface-900 dark:[&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-surface-900 dark:[&_h3]:text-white [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-surface-700 dark:[&_p]:text-surface-300 [&_p]:leading-relaxed [&_p]:my-4 [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:no-underline hover:[&_a]:underline [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li]:text-surface-700 dark:[&_li]:text-surface-300 [&_strong]:text-surface-900 dark:[&_strong]:text-white [&_blockquote]:border-l-4 [&_blockquote]:border-brand-400 [&_blockquote]:pl-4 [&_blockquote]:text-surface-600 dark:[&_blockquote]:text-surface-400 [&_blockquote]:italic';

// The same routes as MARKETING_NAV / MARKETING_CTA in Header.tsx, in canonical (slash) form.
const NAV = [['Features', '/#features'], ['Pricing', '/pricing/'], ['Methodology', '/methodology/'], ['Sample Report', '/sample-report/'], ['Security', '/security/']];
const FOOTER_LINKS = [['Pricing', '/pricing/'], ['Methodology', '/methodology/'], ['Blog', '/blog/'], ['Privacy Policy', '/privacy/'], ['Terms of Service', '/terms/'], ['Contact Us', '/contact/']];

const CHROME_HEADER =
  '<header class="sticky top-0 z-50 border-b border-surface-200/80 dark:border-surface-800/80 bg-white/90 dark:bg-surface-900/90 backdrop-blur-md">' +
  SKIP_LINK +
  '<div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">' +
  `<a href="/" class="flex items-center gap-2.5">${BRAND_MARK}<span class="font-semibold text-sm text-surface-900 dark:text-white tracking-tight">Eco-Auditor</span></a>` +
  '<nav class="hidden md:flex items-center gap-6 text-sm" aria-label="Main navigation">' +
  NAV.map(([label, href]) => `<a href="${href}" class="${NAV_LINK}">${label}</a>`).join('') +
  '</nav>' +
  // Reserves the height of the menu button and theme toggle the client header adds.
  '<div class="flex items-center gap-3"><span class="md:hidden w-8 h-8" aria-hidden="true"></span>' +
  '<a href="/demo/" class="hidden sm:inline-flex btn-secondary text-sm !py-2 !px-5">Book a Demo</a>' +
  '<a href="/signup/" class="hidden sm:inline-flex btn-primary text-sm !py-2 !px-5">Start Free Trial</a></div>' +
  '</div></header>';

const CHROME_FOOTER =
  '<footer aria-label="Site footer" class="border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900">' +
  '<div class="max-w-7xl mx-auto px-6 py-8"><nav aria-label="Footer links" class="flex flex-wrap items-center gap-x-8 gap-y-3">' +
  FOOTER_LINKS.map(([label, href]) => `<a href="${href}" class="${FOOTER_LINK}">${label}</a>`).join('') +
  '</nav></div></footer>';

function page(main) {
  return `<div class="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">${CHROME_HEADER}${main}${CHROME_FOOTER}</div>`;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return String(iso);
  }
}

function metaLine(iso, minutes, keyword, spacing) {
  const parts = [`<time datetime="${escapeAttr(iso || '')}">${escapeText(formatDate(iso))}</time>`, `<span>${minutes} min read</span>`];
  if (keyword) parts.push(`<span class="capitalize">${escapeText(keyword)}</span>`);
  return `<div class="flex items-center gap-3 text-xs text-surface-500 ${spacing}">${parts.join(SEPARATOR)}</div>`;
}

function renderFaq(items) {
  if (items.length === 0) return '';
  const rows = items
    .map(
      (item) =>
        `<div><h3 class="text-lg font-medium text-surface-900 dark:text-white mb-2">${escapeText(item.question)}</h3>` +
        `<p class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">${escapeText(item.answer)}</p></div>`,
    )
    .join('');
  return (
    '<section class="mt-12 pt-8 border-t border-surface-200 dark:border-surface-800">' +
    '<h2 class="text-2xl font-semibold text-surface-900 dark:text-white mb-6">Frequently Asked Questions</h2>' +
    `<div class="space-y-6">${rows}</div></section>`
  );
}

function renderCta(cta) {
  const href = cta && safeHref(cta.href);
  if (!href) return '';
  const label = typeof cta.label === 'string' && cta.label.trim() ? cta.label.trim() : 'Get started';
  return (
    '<section class="mt-12 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-8 text-center">' +
    `<a href="${escapeAttr(href)}" class="btn-primary text-sm !py-3 !px-8 inline-flex">${escapeText(label)}</a></section>`
  );
}

function renderPostMain(post) {
  const body = singleH1Body(post.body_html, post.title);
  return (
    '<main id="main-content" tabindex="-1" class="flex-1"><article>' +
    '<header class="border-b border-surface-200 dark:border-surface-800 bg-gradient-to-b from-brand-50/40 to-surface-50 dark:from-brand-950/20 dark:to-surface-950">' +
    '<div class="max-w-3xl mx-auto px-6 py-12">' +
    `<a href="/blog/" class="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors mb-6">${ARROW_LEFT}All posts</a>` +
    metaLine(post.published_at, blogListReadMinutes(post.body_html), post.primary_keyword, 'mb-4') +
    `<h1 class="text-3xl md:text-4xl font-bold text-surface-900 dark:text-white tracking-tight leading-tight">${escapeText(post.title)}</h1>` +
    `<p class="mt-4 text-lg text-surface-600 dark:text-surface-400 leading-relaxed">${escapeText(post.meta_description || '')}</p>` +
    '</div></header>' +
    '<div class="max-w-3xl mx-auto px-6 py-12">' +
    `<div class="${POST_BODY_CLASS}">${body}</div>` +
    renderFaq(faqItems(post)) +
    renderCta(post.cta) +
    '<div class="mt-12 pt-8 border-t border-surface-200 dark:border-surface-800">' +
    `<a href="/blog/" class="inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">${ARROW_LEFT}Back to all posts</a>` +
    '</div></div></article></main>'
  );
}

// Hero copy of BlogList.tsx (tests/blog-render.test.ts checks it is still there).
const INDEX_HEADING = 'Eco-Auditor Blog';
const INDEX_LEAD = 'Carbon accounting insights, compliance updates, and practical guides for SMBs navigating SB 253, CBAM, and supply chain emissions reporting.';
const INDEX_EMPTY = 'No posts yet. Check back soon for carbon accounting insights.';

function renderCard(item) {
  const href = `/blog/${item.slug}/`;
  return (
    '<article class="group rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 hover:border-brand-300 dark:hover:border-brand-700 transition-colors">' +
    metaLine(item.published_at, item.read_minutes, item.primary_keyword, 'mb-3') +
    '<h2 class="text-xl font-semibold text-surface-900 dark:text-white mb-2 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">' +
    `<a href="${escapeAttr(href)}" class="no-underline">${escapeText(item.title)}</a></h2>` +
    `<p class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">${escapeText(item.excerpt)}</p>` +
    `<a href="${escapeAttr(href)}" class="inline-flex items-center gap-1 mt-4 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors">Read more${ARROW_RIGHT}</a>` +
    '</article>'
  );
}

function renderIndexMain(items) {
  const list =
    items.length === 0
      ? `<div class="text-center py-20"><p class="text-sm text-surface-500">${INDEX_EMPTY}</p></div>`
      : `<div class="space-y-8">${items.map(renderCard).join('')}</div>`;
  return (
    '<main id="main-content" tabindex="-1" class="flex-1">' +
    '<section class="border-b border-surface-200 dark:border-surface-800 bg-gradient-to-b from-brand-50/40 to-surface-50 dark:from-brand-950/20 dark:to-surface-950">' +
    `<div class="max-w-4xl mx-auto px-6 py-16"><h1 class="text-4xl font-bold text-surface-900 dark:text-white tracking-tight">${INDEX_HEADING}</h1>` +
    `<p class="mt-3 text-lg text-surface-600 dark:text-surface-400 max-w-2xl">${INDEX_LEAD}</p></div></section>` +
    `<section class="max-w-4xl mx-auto px-6 py-12">${list}</section></main>`
  );
}

// ─── Pages ───

/**
 * Full HTML of /blog/<slug>/: `shell` is the contents of static/app-shell.html, `row` a
 * blog_posts row or a toPublicPost() result. The body is sanitised here whichever it
 * is, because the same post is embedded for the client to render as HTML.
 */
function renderPostPage(shell, row, origin) {
  const post = toPublicPost(row);
  const head = postHead(post, origin);
  const extraHead = [ldScript(buildPostJsonLd(post, head, origin))];
  if (post.published_at) extraHead.unshift(`<meta property="article:published_time" content="${escapeAttr(post.published_at)}" />`);
  const html = applyIndexableHead(shell, { ...head, ogType: 'article', extraHead });
  return fillRoot(html, page(renderPostMain(post)), dataScript('blog-post-data', { post, head }));
}

/** Full HTML of /blog/: `meta` is routeMeta['/blog'], `items` the toListItem() cards. */
function renderIndexPage(shell, items, meta, origin) {
  const head = { title: meta.title, description: meta.description, canonical: `${origin}/blog/` };
  const html = applyIndexableHead(shell, { ...head, ogType: 'website', extraHead: [ldScript(buildIndexJsonLd(head, origin))] });
  return fillRoot(html, page(renderIndexMain(items)), dataScript('blog-list-data', { posts: items }));
}

// ─── sitemap.xml ───

function xml(value) {
  return escapeText(value).replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

/** W3C datetime for <lastmod>, never later than `now` (a scheduled post must not advertise the future). */
function lastmodOf(value, now) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(Math.min(time, now)).toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

/**
 * sitemap.xml. `paths` are the indexable prerendered routes (static/sitemap-routes.json),
 * `posts` the published posts as { slug, published_at }. A post's lastmod is its
 * published_at, which /api/publish rewrites on every republish (blog_posts has no
 * updated_at column). Static routes carry none: nothing records when they changed,
 * and the old hand-written dates were all stale (F-F-13); the blog index takes the
 * newest post's.
 */
function renderSitemapXml({ origin, paths, posts, now = Date.now() }) {
  const listed = posts.filter((post) => isValidSlug(post.slug));
  const newest = listed.reduce((latest, post) => Math.max(latest, Date.parse(toIso(post.published_at) || '') || 0), 0);
  const entry = (loc, lastmod) => `  <url>\n    <loc>${xml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`;
  const urls = [
    ...paths.map((path) => entry(`${origin}${path}`, path === '/blog/' && newest ? lastmodOf(new Date(newest).toISOString(), now) : null)),
    ...listed.map((post) => entry(`${origin}/blog/${post.slug}/`, lastmodOf(toIso(post.published_at), now))),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

module.exports = {
  isValidSlug,
  escapeText,
  escapeAttr,
  jsonForScript,
  singleH1Body,
  blogListExcerpt,
  blogListReadMinutes,
  publicCta,
  publicLinks,
  toPublicPost,
  toListItem,
  postHead,
  renderPostPage,
  renderIndexPage,
  renderSitemapXml,
  __testing: { applyIndexableHead, safeHref, faqItems, CHROME_HEADER, CHROME_FOOTER, POST_BODY_CLASS, INDEX_HEADING, INDEX_LEAD },
};
