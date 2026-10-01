// Runs the prerender head logic (scripts/prerender-head.mjs) over the REAL
// index.html template for every prerendered route. No build output is needed,
// so unlike routes-prerender.test.ts this always runs.
//
// Guards audit F-A-01 (false audit-readiness answer in site-wide JSON-LD),
// F-A-12 (meta advertising unbuilt features; raw vs JS meta drifting),
// F-F-09 (machine-readable claims) and F-F-10 (one JSON-LD copied onto every
// route, FAQPage on pages with no FAQ, a search action that does not exist).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error -- importing a Node ESM .mjs module with no type declarations
import { ROUTES, NOINDEX_ROUTES, FAQ_KEY_BY_ROUTE, SITE_URL, applyRouteHead, loadRouteData, canonicalFor } from '../scripts/prerender-head.mjs';
import { PLANS } from '../src/content/pricing';

type Meta = { title: string; description: string };
type Faq = { q: string; a: string }[];
type RouteData = { routeMeta: Record<string, Meta>; faq: Record<string, Faq> };
type LdNode = { '@type': string; '@id'?: string; url?: string; name?: string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[]; itemListElement?: { position: number; item: string }[] };

const template = readFileSync(resolve('index.html'), 'utf8');
const data = loadRouteData() as RouteData;
const routes = ROUTES as string[];
const noindex = NOINDEX_ROUTES as Set<string>;
const faqKeys = FAQ_KEY_BY_ROUTE as Record<string, string>;

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const head = (route: string) => applyRouteHead(template, route, data) as string;
const between = (html: string, re: RegExp) => {
  const m = re.exec(html);
  return m ? decode(m[1] ?? '') : null;
};
const attr = (html: string, tag: RegExp) => between(html, tag);
const jsonLdNodes = (html: string): LdNode[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const parsed = JSON.parse(m[1] ?? '{}') as { '@graph': LdNode[] };
    return parsed['@graph'];
  });
const headOf = (html: string) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

describe('route meta covers exactly the prerendered routes', () => {
  it('has an entry per route and no orphans', () => {
    expect(Object.keys(data.routeMeta).sort()).toEqual([...routes].sort());
  });

  it('keeps every description short enough for a search snippet', () => {
    for (const route of routes) {
      expect((data.routeMeta[route] as Meta).description.length, route).toBeLessThanOrEqual(160);
    }
  });

  it('index.html carries the homepage entry as its defaults (dev server, fallback)', () => {
    const home = data.routeMeta['/'] as Meta;
    expect(between(template, /<title>([^<]*)<\/title>/)).toBe(home.title);
    expect(attr(template, /<meta name="description" content="([^"]*)"/)).toBe(home.description);
    expect(attr(template, /<meta property="og:description" content="([^"]*)"/)).toBe(home.description);
    expect(attr(template, /<meta name="twitter:description" content="([^"]*)"/)).toBe(home.description);
  });

  it('/pricing meta quotes the prices from pricing.ts (no hard-coded drift)', () => {
    const d = (data.routeMeta['/pricing'] as Meta).description;
    expect(d).toContain(`Starter $${PLANS.starter.monthly}/mo`);
    expect(d).toContain(`Growth $${PLANS.growth.monthly}/mo`);
    expect(d).toContain(`Pro $${PLANS.pro.monthly}/mo`);
    expect(d).toContain(`$${Math.round(PLANS.starter.annual / 12)}/mo billed annually`);
  });
});

describe.each(routes)('prerendered head for %s', (route) => {
  const html = head(route);
  const meta = data.routeMeta[route] as Meta;

  it('has exactly one title and description, equal to route-meta.json', () => {
    expect((html.match(/<title>/g) ?? []).length).toBe(1);
    expect((html.match(/<meta name="description"/g) ?? []).length).toBe(1);
    expect(between(html, /<title>([^<]*)<\/title>/)).toBe(meta.title);
    expect(attr(html, /<meta name="description" content="([^"]*)"/)).toBe(meta.description);
    expect(attr(html, /<meta property="og:title" content="([^"]*)"/)).toBe(meta.title);
    expect(attr(html, /<meta property="og:description" content="([^"]*)"/)).toBe(meta.description);
    expect(attr(html, /<meta name="twitter:description" content="([^"]*)"/)).toBe(meta.description);
  });

  it(noindex.has(route) ? 'is noindex with no canonical and no page-level structured data' : 'has its own canonical and og:url', () => {
    if (noindex.has(route)) {
      expect(html).toContain('<meta name="robots" content="noindex,nofollow" />');
      expect(html).not.toContain('rel="canonical"');
      expect(html).not.toContain('property="og:url"');
      expect(jsonLdNodes(html).map((n) => n['@type']).sort()).toEqual(['Organization', 'SoftwareApplication', 'WebSite']);
    } else {
      expect(html).toContain('<meta name="robots" content="index, follow" />');
      expect(attr(html, /<link rel="canonical" href="([^"]*)"/)).toBe(canonicalFor(route));
      expect(attr(html, /<meta property="og:url" content="([^"]*)"/)).toBe(canonicalFor(route));
    }
  });

  it('carries the site-wide entities once and its own WebPage and breadcrumb', () => {
    if (noindex.has(route)) return;
    const nodes = jsonLdNodes(html);
    const count = (type: string) => nodes.filter((n) => n['@type'] === type).length;
    expect(count('Organization')).toBe(1);
    expect(count('WebSite')).toBe(1);
    expect(count('SoftwareApplication')).toBe(1);

    const page = nodes.filter((n) => n['@type'] === 'WebPage' || n['@type'] === 'ContactPage');
    expect(page).toHaveLength(1);
    expect(page[0]?.url).toBe(canonicalFor(route));
    expect(page[0]?.name).toBe(meta.title);

    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList');
    const items = crumbs?.itemListElement ?? [];
    expect(items[0]?.item).toBe(`${SITE_URL}/`);
    expect(items.at(-1)?.item).toBe(route === '/' ? `${SITE_URL}/` : canonicalFor(route));
  });

  it('emits FAQPage only where that FAQ is rendered, from faq.json', () => {
    const faqPages = jsonLdNodes(html).filter((n) => n['@type'] === 'FAQPage');
    const key = faqKeys[route];
    if (!key) {
      expect(faqPages).toHaveLength(0);
      return;
    }
    expect(faqPages).toHaveLength(1);
    const items = (data.faq[key] as Faq);
    expect(faqPages[0]?.mainEntity?.map((e) => e.name)).toEqual(items.map((i) => i.q));
    expect(faqPages[0]?.mainEntity?.map((e) => e.acceptedAnswer.text)).toEqual(items.map((i) => i.a));
  });

  it('says nothing the product cannot back and has no site search (head incl. JSON-LD)', () => {
    const h = headOf(html);
    const banned: [RegExp, string][] = [
      [/audit[- ]ready/i, 'audit-ready answer (F-A-01)'],
      [/verifiable audit trails?/i, 'audit trails (F-A-01)'],
      [/versioned calculation logs?/i, 'versioned logs (F-A-01)'],
      [/suitable for third-party assurance/i, 'assurance suitability (F-A-01)'],
      [/Yes\. Eco-Auditor produces/, 'the old FAQ answer (F-A-01)'],
      [/supports reporting packages/i, 'reporting packages (F-A-02)'],
      [/reviewable ledger|emissions ledger/i, 'ledger (F-A-12)'],
      [/compliance dashboard/i, 'compliance dashboard (F-A-12)'],
      [/GLEC|EXIOBASE|DEFRA/, 'factor libraries that are not wired in (F-A-12, F-F-09)'],
      [/SOC 2|AES-256/, 'unevidenced security claims in meta (F-A-06)'],
      [/GDPR[- ]aligned|GDPR compliance/i, 'a GDPR status no evidence backs (F-A-06)'],
      [/QuickBooks|Xero|FedEx|\bUPS\b/, 'integrations that do not exist (F-A-12)'],
      [/SearchAction|search_term_string/, 'a site search that does not exist (F-F-10)'],
      [/San Francisco|37\.7749|geo\.position|ICBM/, 'an unverified HQ location (F-A-17)'],
      [/August 10/, 'a superseded regulatory date (F-A-05)'],
      [/subject to SB 253/i, 'wrong SB 253 applicability (F-R5-03)'],
      [/"screenshot"/, 'a favicon presented as a screenshot (F-F-10)'],
    ];
    for (const [pattern, why] of banned) {
      expect(h, why).not.toMatch(pattern);
    }
  });
});

describe('the prerender step refuses to ship a head it could not write', () => {
  it('throws when the template has lost a tag it rewrites', () => {
    const broken = template.replace(/<meta name="description"[^>]*>/, '');
    expect(() => applyRouteHead(broken, '/pricing', data)).toThrow(/template has no description meta/);
  });

  it('throws for a route with no entry in route-meta.json', () => {
    expect(() => applyRouteHead(template, '/not-a-route', data)).toThrow(/no entry for \/not-a-route/);
  });

  it('escapes "<" in JSON-LD so FAQ text cannot close the script element', () => {
    const hostile: RouteData = {
      routeMeta: data.routeMeta,
      faq: { ...data.faq, home: [{ q: 'q', a: '</script><script>alert(1)</script>' }] },
    };
    const html = applyRouteHead(template, '/', hostile) as string;
    expect((html.match(/<script type="application\/ld\+json">/g) ?? []).length).toBe(2);
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
