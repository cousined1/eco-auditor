// @vitest-environment node
/**
 * F-A-04 / F-R5-01 / F-R5-02: the four seeded blog posts.
 *
 * The seed used to sell features that do not exist (supplier surveys, CBAM data
 * packs, CDP/GRI/TCFD exports, DEFRA factors), misstate SB 253 and CBAM, and
 * quote a $49 Starter price. This pins the corrected content, and checks it
 * against the sources of truth (plan-limits.json, src/content/pricing.ts) and
 * against the corrections runbook the owner applies to production.
 *
 * The seed only runs against an empty table, so production is NOT changed by
 * these rows; docs/runbooks/blog-rows-update.md is the path that changes it, and
 * docs/runbooks/blog-rows-update.sql must carry exactly what is asserted here.
 * Both go away with seedBlogPosts once the production rows are fixed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import planLimitsFile from '../plan-limits.json';
import { PLANS } from '../src/content/pricing';

const require = createRequire(import.meta.url);
const { sanitizeBlogHtml, __testing } = require('../server-publish.cjs');

const ROOT = resolve(__dirname, '..');
const source = readFileSync(resolve(ROOT, 'server.cjs'), 'utf8');
const START = 'async function seedBlogPosts(pool) {';
const END = 'const emissionsSummaryCache = new Map();';

interface SeedRow {
  id: string;
  slug: string;
  title: string;
  meta_title: string;
  meta_description: string;
  body_html: string;
  faq: string;
  internal_links: string;
  external_links: string;
  cta: string;
}

/** Runs the real seedBlogPosts against a recording pool and returns the rows it would insert. */
async function seededRows(): Promise<SeedRow[]> {
  const rows: SeedRow[] = [];
  const pool = {
    query: async (_sql: string, p: string[]) => {
      rows.push({
        id: p[0]!, slug: p[1]!, title: p[4]!, meta_title: p[5]!, meta_description: p[6]!,
        body_html: p[7]!, faq: p[9]!, internal_links: p[10]!, external_links: p[11]!, cta: p[12]!,
      });
      return { rows: [] };
    },
  };
  const seed = runInNewContext(`${source.slice(source.indexOf(START), source.indexOf(END))}\nseedBlogPosts`, {
    log: () => {},
  }) as (p: typeof pool) => Promise<void>;
  await seed(pool);
  return rows;
}

const SLUGS = [
  'sb-253-compliance-guide-smb',
  'ghg-protocol-scope-3-guide-smb',
  'carbon-accounting-software-smb-guide',
  'cbam-supply-chain-guide-smb',
];

const rows = await seededRows();
const bySlug = (slug: string) => rows.find((row) => row.slug === slug)!;
/** Every reader-visible or crawler-visible string of a row, in one blob. */
const everything = (row: SeedRow) =>
  [row.title, row.meta_title, row.meta_description, row.body_html, row.faq, row.internal_links, row.external_links, row.cta].join('\n');
const plainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the seed', () => {
  it('still seeds the four live slugs, and nothing else', () => {
    expect(rows.map((row) => row.slug)).toEqual(SLUGS);
  });

  it('is plain formatting only, so a publish round trip through the sanitizer changes nothing', () => {
    for (const row of rows) {
      expect(sanitizeBlogHtml(row.body_html), row.slug).toBe(row.body_html);
    }
  });

  it('has an FAQ that /api/publish would accept as is', () => {
    for (const row of rows) {
      const faq = JSON.parse(row.faq) as unknown;
      expect(__testing.validateFaq(faq, row.slug), row.slug).toBeNull();
      expect((faq as unknown[]).length, row.slug).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('F-A-04 / F-R5-01 / F-R5-02: claims the audit found false are gone', () => {
  // The audit's acceptance lists (F-A-04 and REVIEW-R5), plus the specific
  // sentences it quoted. Matched case-sensitively as written.
  const forbidden = [
    'DEFRA', 'quarterly', '$49', '2028', '$2 billion', '$2B',
    'Supply chain surveys', 'CBAM data pack', 'CDP, GRI, TCFD',
    'you are in scope', 'plus the emissions from electricity', 'must purchase CBAM certificates',
    'electricity consumption (Scope 2)', 'Upstream Scope 3 emissions from purchased goods',
    'SEC climate disclosure', 'no per-facility', 'per-user penalties',
    'EU Member State grid factors', 'Sub-metering support', 'Product-level emission allocation',
    'Freight emission estimator', 'SB 253-ready', 'Customer-ready exports', 'factor version',
    'Eco-Auditor includes all of these', 'pays for itself', 'will pay for itself',
    // R5: the live CARB link returned 404.
    'climate-corporate-data-accountability',
  ];

  it.each(SLUGS)('%s carries none of them', (slug) => {
    const text = everything(bySlug(slug));
    for (const phrase of forbidden) {
      expect(text, `${slug} still says "${phrase}"`).not.toContain(phrase);
    }
  });

  it('says every unbuilt feature only as roadmap or as something Eco-Auditor does not do', () => {
    const unbuilt = [
      /supplier (survey|data request|request)/i, /screening template/i, /audit trail/i, /\bCDP\b|\bGRI\b|\bTCFD\b/,
      /integrations?/i, /report templates?|filing templates?/i, /data pack/i, /EU grid/i, /\bassurance\b/i,
      /attribute emissions to products/i,
    ];
    let checked = 0;
    for (const row of rows) {
      const sections = row.body_html.split('<h2>').slice(1);
      for (const section of sections) {
        const [heading = '', ...rest] = section.split('</h2>');
        if (!/Eco-Auditor/i.test(heading)) continue; // buyer-guide criteria elsewhere are educational
        const blocks = rest.join('').split(/<\/(?:p|li)>/).map(plainText).filter((block) => block.trim());
        for (const block of blocks) {
          if (!unbuilt.some((pattern) => pattern.test(block))) continue;
          checked += 1;
          expect(block, `${row.slug} > "${heading}": "${block.trim().slice(0, 90)}"`).toMatch(/roadmap|not available yet|does not|is not\b|not a\b/i);
        }
      }
    }
    // Guards the guard: the loop above must actually reach the "how Eco-Auditor
    // helps" sections, or it would pass on any content.
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('quotes no dollar amount except the plan prices and the SB 253 revenue threshold', () => {
    const allowed = new Set([...(['starter', 'growth', 'pro'] as const).map((id) => `$${PLANS[id].monthly}`), '$1']);
    for (const row of rows) {
      for (const amount of plainText(everything(row)).match(/\$\d[\d,]*/g) ?? []) {
        expect(allowed, `${row.slug} quotes ${amount}`).toContain(amount);
      }
    }
  });
});

describe('the owner runbook carries exactly the corrected seed', () => {
  const sql = readFileSync(resolve(ROOT, 'docs', 'runbooks', 'blog-rows-update.sql'), 'utf8');
  const runbook = readFileSync(resolve(ROOT, 'docs', 'runbooks', 'blog-rows-update.md'), 'utf8');
  const chunks = sql.split(/^UPDATE blog_posts SET$/m).slice(1);
  const grab = (tag: string, from: string) => new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(from)?.[1];

  it('has one UPDATE per seeded slug, in seed order, each pinned by WHERE slug', () => {
    expect(chunks).toHaveLength(SLUGS.length);
    chunks.forEach((chunk, i) => {
      expect(chunk).toContain(`WHERE slug = '${SLUGS[i]}'`);
    });
  });

  it.each(SLUGS)('%s: the SQL sets meta_description, body_html, faq and external_links to the seed values', (slug) => {
    const chunk = chunks.find((c) => c.includes(`WHERE slug = '${slug}'`))!;
    const row = bySlug(slug);
    expect(grab('blog_meta', chunk)).toBe(row.meta_description);
    expect(grab('blog_body', chunk)).toBe(row.body_html);
    expect(grab('blog_faq', chunk)).toBe(row.faq);
    expect(grab('blog_links', chunk)).toBe(row.external_links);
  });

  it('runs all-or-nothing: an explicit transaction, stop on error, and a check that raises before COMMIT', () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).toContain('-v ON_ERROR_STOP=1');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeGreaterThan(sql.lastIndexOf('RETURNING slug;'));
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
    // The row-level fields the audit did not flag are left alone.
    expect(sql).not.toMatch(/published_at\s*=|title\s*=|meta_title\s*=|slug\s*=\s*\$/);
  });

  it('names every slug and the safe order (export first) in the runbook, and holds no secret', () => {
    for (const slug of SLUGS) expect(runbook).toContain(slug);
    expect(runbook.indexOf('Export')).toBeGreaterThan(-1);
    expect(runbook.indexOf('Export')).toBeLessThan(runbook.indexOf('blog-rows-update.sql'));
    for (const text of [runbook, sql]) {
      expect(text).not.toMatch(/postgres(ql)?:\/\/[^\s<$]*:[^\s<$]*@/i); // a connection string with credentials
      expect(text).not.toMatch(/Bearer\s+(?!\$|<)[A-Za-z0-9._-]{16,}/); // a literal token
      expect(text).not.toMatch(/\b(sk_live|whsec|ik_)[A-Za-z0-9_]{6,}/);
    }
  });
});

describe('the corrected content is right', () => {
  it('prices the software post from src/content/pricing.ts, in the body and in the FAQ that feeds the JSON-LD', () => {
    const row = bySlug('carbon-accounting-software-smb-guide');
    for (const id of ['starter', 'growth', 'pro'] as const) {
      expect(row.body_html).toContain(`$${PLANS[id].monthly}/month`);
      expect(row.faq).toContain(`$${PLANS[id].monthly}/month`);
    }
  });

  it('states the plan limits the server enforces (plan-limits.json)', () => {
    const { starter, growth, pro } = planLimitsFile.plans;
    const text = plainText(bySlug('carbon-accounting-software-smb-guide').body_html);
    expect(starter.facilities).toBe(1);
    expect(text).toContain('1 facility');
    expect(text).toContain(`${starter.csvImportsPerMonth} CSV imports a month`);
    expect(text).toContain(`up to ${growth.facilities} facilities`);
    expect(growth.csvImportsPerMonth).toBeNull();
    expect(text).toContain('unlimited CSV imports');
    expect(pro.facilities).toBeNull();
    expect(text).toContain('unlimited facilities');
    expect(starter.scope3).toBe(false);
    expect(text).toContain('Scope 1 and 2 only');
    expect(growth.scope3 && pro.scope3).toBe(true);
  });

  it('SB 253: $1 billion threshold, Scope 3 from 2027, assurance 2030, and a dated, hedged status for the 10 November deadline', () => {
    const row = bySlug('sb-253-compliance-guide-smb');
    const text = plainText(row.body_html);
    expect(text).toContain('more than $1 billion in annual revenue');
    expect(text).toContain('November 10, 2026');
    expect(text).toContain('as of September 29, 2026');
    expect(text).toContain('Office of Administrative Law');
    expect(text).toMatch(/Scope 3 is not required for 2026/);
    expect(text).toMatch(/Scope 3 reporting starts in 2027 on a schedule CARB has not yet set/);
    expect(text).toMatch(/reasonable assurance beginning in 2030, and limited assurance on Scope 3 beginning in 2030/);
    expect(text).toMatch(/whether or not assurance has been obtained/);
    const faq = JSON.parse(row.faq) as Array<{ question: string; answer: string }>;
    const deadline = faq.find((item) => /deadline/i.test(item.question))!;
    expect(deadline.answer).toContain('November 10, 2026');
    expect(deadline.answer).toContain('Office of Administrative Law');
    expect(deadline.answer).not.toMatch(/2028|\$2/);
    // The link the audit found dead is replaced by CARB's current program page.
    const links = JSON.parse(row.external_links) as Array<{ href: string }>;
    expect(links.map((link) => link.href)).toContain(
      'https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk',
    );
  });

  it('Scope 3 guide: assurance for Scope 3 begins in 2030, not 2028', () => {
    const row = bySlug('ghg-protocol-scope-3-guide-smb');
    const faq = JSON.parse(row.faq) as Array<{ question: string; answer: string }>;
    const assurance = faq.find((item) => /assurance/i.test(item.question))!;
    expect(assurance.answer).toContain('2030');
    expect(assurance.answer).not.toContain('2028');
  });

  it('CBAM: direct emissions only for iron/steel, aluminium and hydrogen; annual declaration; 50 t; certificates from 1 Feb 2027', () => {
    const row = bySlug('cbam-supply-chain-guide-smb');
    const text = plainText(row.body_html);
    // F-R5-02: the post used to add electricity to every sector and to say Scope 3 is excluded.
    expect(text).toContain('For iron and steel, aluminium, and hydrogen, only direct emissions count');
    expect(text).toContain('count only for cement and fertilisers');
    expect(text).toMatch(/precursor materials/);
    // Obligations sit with importers; a non-EU supplier is not "in scope".
    expect(text).toContain('CBAM obligations fall on the importer');
    expect(text).toContain('you are not directly subject to CBAM');
    expect(text).toContain('less than 50 tonnes');
    // Timeline: annual, not quarterly; sales from 1 Feb 2027; first declaration 30 Sep 2027.
    expect(text).toContain('annual CBAM declaration');
    expect(text).toContain('From 1 February 2027');
    expect(text).toContain('30 September 2027');
    expect(text).toContain('October 2023 to December 2025');
    // The product does not do CBAM.
    expect(text).toContain('Eco-Auditor is not a CBAM tool');
    const faq = JSON.parse(row.faq) as Array<{ question: string; answer: string }>;
    const charging = faq.find((item) => /charging/i.test(item.question))!;
    expect(charging.answer).toContain('1 February 2027');
    expect(charging.answer).toContain('30 September 2027');
    const applies = faq.find((item) => /small businesses/i.test(item.question))!;
    expect(applies.answer).toMatch(/EU importers/);
    expect(applies.answer).not.toMatch(/must provide/);
  });
});
