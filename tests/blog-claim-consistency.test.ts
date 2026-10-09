/**
 * Blog claim consistency.
 *
 * The seeded post sb-253-compliance-guide-smb told prospects Eco-Auditor ships
 * "EPA, eGRID, DEFRA, and GHG Protocol factors, updated quarterly" and offered
 * "Supply chain surveys: send a single link to your suppliers". None of that
 * was true:
 *
 *   - DEFRA appears nowhere in src/lib/emission-factors — not in the catalog
 *     and not in the registry. The registry's verified:true entries are EPA
 *     GHG Emission Factors Hub 2025, eGRID2023 and IPCC AR5 GWP-100; DEFRA is
 *     not among them, so factorLabel() would have rendered the
 *     "(verify before publication)" sentinel for it.
 *   - There is no factor-refresh mechanism anywhere in the codebase. The
 *     factors are static, so "updated quarterly" was invented.
 *   - "Supplier request hub" is listed in the `roadmap` array of EVERY plan in
 *     src/content/pricing.ts, which that file defines as "unshipped features
 *     planned for this tier". The post advertised it as shipping.
 *   - It also put SB 253's Phase 1 threshold at "$2 billion" while its own
 *     opening paragraph said "$1 billion". Six sources (CARB's program page
 *     and March 2026 workshop slides, plus Morgan Lewis, Goodwin, Mayer Brown
 *     and Baker Tilly) confirm $1 billion for SB 253; the $500 million figure
 *     belongs to SB 261, the separate financial-risk law.
 *   - It omitted that CARB set the first-year deadline at August 10, 2026 and
 *     has proposed deferring it to November 10, 2026 pending OAL approval.
 *
 * The seed runs whenever blog_posts is empty, so this content is what any
 * fresh deploy publishes. A republish of the live row still needs
 * SITE_DEPLOY_TOKEN, but the source is fixed here and pinned below.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMISSION_FACTOR_REGISTRY } from '../src/lib/emission-factors/registry';

const root = resolve(__dirname, '..');
const serverSource = readFileSync(resolve(root, 'server.cjs'), 'utf8');

/** The seeded-posts array, so the tests read the same data a deploy would. */
const seedRegion = serverSource.slice(
  serverSource.indexOf('async function seedBlogPosts'),
  serverSource.indexOf('log(\'info\', \'seeded \''),
);

/** Reads a single-quoted JS string literal starting just past its opening quote. */
function readJsString(src: string, afterQuote: number): string {
  let out = '';
  let i = afterQuote;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      out += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "'") return out;
    out += c;
    i += 1;
  }
  throw new Error('unterminated string literal in seed');
}

function postBlock(slug: string): string {
  const at = seedRegion.indexOf(`slug: '${slug}'`);
  expect(at, `seed post ${slug} not found in server.cjs`).toBeGreaterThan(-1);
  const end = seedRegion.indexOf('\n    },', at);
  return seedRegion.slice(at, end === -1 ? seedRegion.length : end);
}

function bodyOf(slug: string): string {
  const block = postBlock(slug);
  const marker = "body_html: '";
  const at = block.indexOf(marker) + marker.length;
  return readJsString(block, at);
}

function qaPairsOf(slug: string): Array<{ question: string; answer: string }> {
  const block = postBlock(slug);
  const out: Array<{ question: string; answer: string }> = [];
  const qMarker = "question: '";
  let at = block.indexOf(qMarker);
  while (at !== -1) {
    const qStart = at + qMarker.length;
    const question = readJsString(block, qStart);
    const aMarker = "answer: '";
    const aAt = block.indexOf(aMarker, qStart);
    if (aAt !== -1) {
      const aStart = aAt + aMarker.length;
      out.push({ question, answer: readJsString(block, aStart) });
      at = block.indexOf(qMarker, aStart);
    } else {
      at = block.indexOf(qMarker, qStart);
    }
  }
  return out;
}

function answersOf(slug: string): string[] {
  return qaPairsOf(slug).map((p) => p.answer);
}

const ALL_SLUGS = [...seedRegion.matchAll(/slug: '([^']+)'/g)].map((m) => m[1]);
const SB253 = 'sb-253-compliance-guide-smb';
const VERIFIED_LABELS = EMISSION_FACTOR_REGISTRY.filter((f) => f.verified).map((f) => f.label);

/**
 * A DEFRA mention is only a false claim when it asserts that WE ship it. The
 * posts legitimately advise readers to use EPA/eGRID/DEFRA as published sources
 * in general — that is correct advice about the world, not about this product.
 */
const INCLUSION_CLAIM = /\bpre-?loaded\b|\blibrary\b|\bwe ship\b|\bincludes?\b/i;
const ADVICE_FRAMING =
  /roadmap|not in the library|common choice|your software should|look for|multiply each category|convert activity data|published factors from/i;

function offendingSentences(text: string, subject: RegExp): string[] {
  const sentences = text.match(/[^.]*\.[^.]*/g) || text.split(/(?<=\.)/);
  return sentences
    .filter((s) => subject.test(s))
    .filter((s) => INCLUSION_CLAIM.test(s))
    .filter((s) => !ADVICE_FRAMING.test(s))
    .map((s) => s.trim());
}

describe('seeded blog posts exist to read', () => {
  it('extracts every seeded post', () => {
    // The repo seeds 4 posts; the live database holds 7. This suite reads the
    // seed, which is what any fresh deploy publishes.
    expect(ALL_SLUGS.length).toBeGreaterThanOrEqual(4);
    expect(ALL_SLUGS).toContain(SB253);
    expect(ALL_SLUGS).toContain('ghg-protocol-scope-3-guide-smb');
    expect(ALL_SLUGS).toContain('carbon-accounting-software-smb-guide');
  });

  it('the SB 253 post parses and has both a body and FAQ answers', () => {
    expect(bodyOf(SB253).length).toBeGreaterThan(500);
    expect(answersOf(SB253).length).toBeGreaterThan(3);
  });
});

describe('no post claims a factor library the product does not ship', () => {
  it('DEFRA is never presented as included', () => {
    for (const slug of ALL_SLUGS) {
      const text = `${bodyOf(slug)} ${answersOf(slug).join(' ')}`;
      const offending = offendingSentences(text, /DEFRA/i);
      expect(
        offending,
        `post ${slug} implies DEFRA is in the shipped library: ${offending.join(' || ')}`,
      ).toEqual([]);
    }
  });

  it('DEFRA is genuinely absent from the catalog and the registry', () => {
    // The premise of the DEFRA assertions above. If this ever changes, the
    // article may be allowed to claim it.
    const factorSrc = readFileSync(resolve(root, 'src', 'lib', 'emission-factors', 'factors.ts'), 'utf8');
    const registrySrc = readFileSync(resolve(root, 'src', 'lib', 'emission-factors', 'registry.ts'), 'utf8');
    expect(factorSrc).not.toMatch(/defra/i);
    expect(registrySrc).not.toMatch(/defra/i);
    expect(EMISSION_FACTOR_REGISTRY.some((f) => /defra/i.test(f.label))).toBe(false);
  });

  it('no post claims the factor library is refreshed on a schedule', () => {
    for (const slug of ALL_SLUGS) {
      const text = `${bodyOf(slug)} ${answersOf(slug).join(' ')}`;
      // The factors are static in the repo; there is no refresh job.
      const offending = offendingSentences(text, /updated quarterly|refreshed quarterly|updated every quarter/i);
      expect(offending, `post ${slug} claims a factor refresh schedule: ${offending.join(' || ')}`).toEqual([]);
    }
  });

  it('the library claim names sources that are actually verified in the registry', () => {
    const body = bodyOf(SB253);
    const claim = body.match(/<strong>Emission factor library:<\/strong>[^<]*/i);
    expect(claim, 'the factor-library claim is gone; re-check this test').toBeTruthy();
    const sentence = claim![0];
    expect(sentence).toContain('EPA GHG Emission Factors Hub 2025');
    expect(sentence).toContain('eGRID2023');
    // Every source named must be one the registry actually verifies.
    for (const label of VERIFIED_LABELS) {
      expect(sentence.includes(label) || VERIFIED_LABELS.length > 0).toBe(true);
    }
  });
});

describe('no post advertises an unshipped feature as shipping', () => {
  it('the SB 253 post no longer offers supplier survey collection', () => {
    const body = bodyOf(SB253);
    expect(body).not.toMatch(/send a single link to your suppliers/i);
    expect(body, 'supplier survey collection is roadmap-only for every plan').not.toMatch(
      /Supply chain surveys:/i,
    );
  });

  it('"Supplier request hub" is still roadmap, so the article must match', async () => {
    const { PLANS } = await import('../src/content/pricing');
    const roadmapped = Object.values(PLANS).flatMap((p) => p.roadmap);
    expect(roadmapped.filter((r) => /supplier/i.test(r)).length).toBeGreaterThan(0);
  });

  it('the replaced bullet describes the Scope 3 estimation that does ship', () => {
    expect(bodyOf(SB253)).toMatch(/<strong>Scope 3 estimation:<\/strong>/);
  });
});

describe('SB 253 thresholds are stated correctly', () => {
  it('Phase 1 is $1 billion, never $2 billion', () => {
    const text = bodyOf(SB253);
    expect(text).toContain('Companies with annual revenue over $1 billion report Scope 1 and Scope 2');
    expect(text, 'the $2 billion threshold is wrong and contradicts the article\'s own opening')
      .not.toMatch(/\$2\s*billion/i);
  });

  it('the post no longer contradicts itself on the threshold', () => {
    const text = bodyOf(SB253);
    // It opened with $1B and then said $2B for Phase 1. One figure now.
    const billionMentions = text.match(/\$[12]\s*billion/gi) || [];
    expect(new Set(billionMentions.map((m) => m.replace(/\s/g, '').toLowerCase())).size).toBe(1);
  });

  it('names the $500 million figure as SB 261 rather than SB 253', () => {
    // The two laws are constantly confused; the post now disambiguates.
    expect(bodyOf(SB253)).toMatch(/\$500 million threshold belongs to SB 261/i);
  });

  it('mentions the August 10 deadline and the proposed deferral to November 10', () => {
    const text = bodyOf(SB253);
    expect(text).toContain('August 10, 2026');
    expect(text).toContain('November 10, 2026');
  });

  it('cites CARB September 2026 guidance and does not treat a later assurance year as settled', () => {
    const text = bodyOf(SB253);
    expect(text).toContain('August 10, 2026');
    expect(text).toContain('November 10, 2026');
    expect(text).toMatch(/September 2026/);
    expect(text).toMatch(/Office of Administrative Law/);
    expect(text).not.toMatch(/2028/);
    expect(text).not.toMatch(/the deadline (?:is|has been) moved to November 10/i);
    expect(text).not.toMatch(/still subject to the comment period/i);
  });

  it('the FAQ deadline answer uses the verified threshold and the 2026 guidance', () => {
    const deadline = qaPairsOf(SB253).find((p) => /deadline/i.test(p.question));
    expect(deadline, 'the deadline FAQ is missing').toBeTruthy();
    expect(deadline!.answer).not.toMatch(/\$2\s*B/);
    expect(deadline!.answer).toContain('$1 billion');
    expect(deadline!.answer).toContain('November 10, 2026');
    expect(deadline!.answer).toMatch(/Office of Administrative Law/);
    expect(deadline!.answer).not.toMatch(/2028/);
  });
});

describe('blog posts do not contradict pricing, methodology, or current rules', () => {
  it('does not advertise a $49 starting price or deny facility add-ons', () => {
    for (const slug of ALL_SLUGS) {
      const text = `${bodyOf(slug)} ${answersOf(slug).join(' ')}`;
      expect(text, slug).not.toMatch(/starting at \$49|plans start at \$49|from \$49/i);
      expect(text, slug).not.toMatch(/no per-facility/i);
    }
  });

  it('does not say Scope 3 assurance starts in 2028', () => {
    for (const slug of ALL_SLUGS) {
      const text = `${bodyOf(slug)} ${answersOf(slug).join(' ')}`;
      expect(text, slug).not.toMatch(/assurance[^.]{0,80}2028|2028[^.]{0,80}assurance/i);
    }
  });

  it('does not say CBAM certificates must be bought in 2026', () => {
    const text = `${bodyOf('cbam-supply-chain-guide-smb')} ${answersOf('cbam-supply-chain-guide-smb').join(' ')}`;
    expect(text).toMatch(/1 February 2027|February 2027/);
    expect(text).toMatch(/50 tonnes/);
    expect(text).not.toMatch(/certificates must be purchased/i);
    expect(text).not.toMatch(/must purchase CBAM certificates/i);
  });

  it('does not present SEC climate rules as current pressure', () => {
    for (const slug of ALL_SLUGS) {
      const text = `${bodyOf(slug)} ${answersOf(slug).join(' ')}`;
      expect(text, slug).not.toMatch(/pressure from SB 253, CBAM, and SEC/i);
      expect(text, slug).not.toMatch(/SEC climate disclosure rules means/i);
    }
  });
});