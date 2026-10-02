// The claims gate (audit F-A-15, K6, K13). The claims register, the regulatory
// module and a denylist of the statements the audit found false are checked
// against every public surface this pass owns: pages, index.html, llms.txt,
// route meta and FAQ data. A false phrase that is reintroduced, or an
// unverified claim that creeps back in new words, fails here.
//
// The denylist asserts ABSENCE of statements the audit called false; it never
// pins marketing copy that is allowed to change.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLAIMS, getClaim } from '../src/content/claims';
import {
  PLANS,
  ROADMAP,
  ADD_ONS,
  FEATURE_COMPARISON,
  PLAN_LIMITS,
  TRIAL_DAYS,
  trialHeadline,
  trialLimitsLabel,
} from '../src/content/pricing';
import { FEATURES } from '../src/content/features';
import { contactDetails } from '../src/content/trust-facts';
import faq from '../src/content/faq.json';
import routeMeta from '../src/content/route-meta.json';
import { REGULATORY_AS_OF } from '../src/content/regulatory';

const read = (rel: string) => readFileSync(resolve(rel), 'utf8');

// Every public surface owned by the claims/copy pass. Files owned by other work
// items (legal pages, Header, chat widget, auth pages, sample report, server.cjs)
// are not scanned here. The Security page and the Footer are (F-C-18): the
// "Enterprise-grade" pill and the "Eco-Auditor suite" links sat on them.
const SURFACE_FILES = [
  'index.html',
  'public/llms.txt',
  'public/humans.txt',
  'public/manifest.webmanifest',
  'src/content/faq.json',
  'src/content/route-meta.json',
  'src/content/pricing.ts',
  'src/content/features.ts',
  'src/content/methodology.ts',
  'src/content/regulatory.ts',
  'src/content/trust-facts.ts',
  'src/pages/LandingPage.tsx',
  'src/pages/Pricing.tsx',
  'src/pages/MethodologyPublic.tsx',
  'src/pages/Demo.tsx',
  'src/pages/ContactUs.tsx',
  'src/pages/Security.tsx',
  'src/pages/BlogList.tsx',
  'src/pages/BlogPost.tsx',
  'src/pages/Ledger.tsx',
  'src/pages/Reports.tsx',
  'src/pages/Suppliers.tsx',
  'src/pages/AIAssistant.tsx',
  'src/components/ComingSoon.tsx',
  'src/components/Footer.tsx',
];
const surfaces = SURFACE_FILES.map((file) => ({ file, text: read(file) }));
// The legal pages are public surfaces too. Their wording belongs to counsel's review (and to
// tests/legal-evidence-coupling.test.tsx), so only a claim's `forbidden_patterns` are held to them here.
const LEGAL_PAGE_FILES = ['src/pages/PrivacyPolicy.tsx', 'src/pages/TermsOfService.tsx', 'src/pages/DataProcessingAddendum.tsx'];

/** Files in which `pattern` matches. */
const hits = (pattern: RegExp) => surfaces.filter((s) => pattern.test(s.text)).map((s) => s.file);

const today = new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

describe('claims register governance (F-A-15)', () => {
  it('every claim has real dates, is reviewed before it is due, and is due within a quarter', () => {
    for (const claim of CLAIMS) {
      expect(claim.reviewed_at, claim.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(claim.review_due, claim.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(claim.review_due >= claim.reviewed_at, `${claim.id}: review_due before reviewed_at`).toBe(true);
      expect(daysBetween(claim.reviewed_at, claim.review_due), `${claim.id}: review cadence`).toBeLessThanOrEqual(100);
    }
  });

  it('no claim is past its review date (re-verify the evidence, then bump review_due)', () => {
    const overdue = CLAIMS.filter((c) => c.review_due < today).map((c) => `${c.id} (due ${c.review_due})`);
    expect(overdue, 'claims past review_due in src/content/claims.ts').toEqual([]);
  });

  it('an unverified claim is unpublished: no approved surface, and a pattern that catches its wording', () => {
    for (const claim of CLAIMS.filter((c) => c.status === 'unverified')) {
      expect(claim.approved_surfaces, claim.id).toEqual([]);
      expect(claim.patterns?.length ?? 0, `${claim.id} needs patterns`).toBeGreaterThan(0);
    }
  });

  it('no unverified claim is live on a public surface, in its old words or new ones', () => {
    const live: string[] = [];
    for (const claim of CLAIMS.filter((c) => c.status === 'unverified')) {
      for (const source of claim.patterns ?? []) {
        for (const file of hits(new RegExp(source, 'i'))) live.push(`${claim.id}: /${source}/ in ${file}`);
      }
    }
    expect(live).toEqual([]);
  });

  // `forbidden_patterns` is wording a claim may not be stretched into on ANY public surface,
  // whatever the claim's status: a qualified claim still has sentences it must not become
  // (ghg-protocol-aligned is "aligned with", never "follows"; VF-1).
  it('no claim\'s forbidden wording is live on a public surface, whatever the claim\'s status (VF-1)', () => {
    const live: string[] = [];
    for (const claim of CLAIMS) {
      for (const source of claim.forbidden_patterns ?? []) {
        const pattern = new RegExp(source, 'i');
        for (const file of [...hits(pattern), ...LEGAL_PAGE_FILES.filter((legal) => pattern.test(read(legal)))]) live.push(`${claim.id}: /${source}/ in ${file}`);
      }
    }
    expect(live).toEqual([]);
  });

  it('ghg-protocol-aligned forbids "follows the GHG ...", and the pattern catches the sentence the verifier found on the Security page (VF-1)', () => {
    const patterns = (getClaim('ghg-protocol-aligned')?.forbidden_patterns ?? []).map((source) => new RegExp(source, 'i'));
    expect(patterns.length).toBeGreaterThan(0);
    expect(SURFACE_FILES, 'the register only protects a surface it scans').toContain('src/pages/Security.tsx');
    expect(patterns.some((pattern) => pattern.test('Carbon accounting methodology follows the GHG Protocol Corporate Standard and Scope 3 Standard'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('Calculations are aligned with the GHG Protocol Corporate Standard and Scope 3 Standard (see Methodology)'))).toBe(false);
  });

  it('the two claims that were overdue and still live are now unpublished', () => {
    for (const id of ['consultant-cost-comparison', 'setup-time']) {
      expect(getClaim(id)?.status, id).toBe('unverified');
      expect(getClaim(id)?.approved_surfaces, id).toEqual([]);
    }
  });

  it('the "audit-ready" and "traceable" claims were withdrawn, not left qualified (F-A-01, F-A-03)', () => {
    for (const id of ['audit-ready', 'every-number-traceable']) {
      expect(getClaim(id)?.status, id).toBe('unverified');
    }
  });

  it('"enterprise-grade" is withdrawn and kept off the Security page it sat on (F-C-18)', () => {
    const claim = getClaim('enterprise-grade');
    expect(claim?.status).toBe('unverified');
    expect(claim?.approved_surfaces).toEqual([]);
    expect(SURFACE_FILES, 'the register only protects a surface it scans').toContain('src/pages/Security.tsx');
    expect(hits(new RegExp(claim?.patterns?.[0] ?? '$^', 'i'))).toEqual([]);
  });

  it('a claim that names no surface list may not be approved (register stays enforceable)', () => {
    for (const claim of CLAIMS.filter((c) => c.status !== 'unverified')) {
      expect(claim.approved_surfaces.length, claim.id).toBeGreaterThan(0);
    }
  });
});

describe('statements the audit found false stay out of every public surface', () => {
  const FALSE_STATEMENTS: [RegExp, string][] = [
    // K13 — regulatory
    [/August 10, 2026/, 'the SB 253 deadline that never took effect (F-A-05)'],
    [/SEC Climate Disclosure readiness/i, 'positioning for an SEC rule that is stayed (F-A-05)'],
    [/SB 261 climate disclosure rules/i, 'positioning for an enjoined law (F-A-05)'],
    [/SB 253\s*\/\s*SB 261/, 'a card titled for SB 261 with no status (F-A-05)'],
    [/withdrawn in 2025/i, 'the SEC rule described as withdrawn (F-A-05)'],
    [/subject to SB 253/i, 'the $10M-$500M audience described as subject to SB 253 (F-R5-03)'],
    // K6 — claims that outrun the product
    [/Yes\. Eco-Auditor produces/, 'the audit-readiness FAQ answer (F-A-01)'],
    [/supports reporting packages/i, 'reporting packages the app does not deliver (F-A-02)'],
    [/Reviewable ledger/i, 'a ledger that is badged Coming soon (F-A-02)'],
    [/dollars at risk/i, 'a metric that is not implemented (F-A-02)'],
    [/per-entry confidence score/i, 'a per-entry score the app never shows (F-A-02)'],
    [/Now live — open for business/, 'launch-status pill (F-C-19)'],
    [/Additional supplier requests/i, 'an add-on priced for the roadmap supplier hub (F-A-10)'],
    [/Premium report templates/i, 'an add-on priced for report templates that do not exist (F-A-10)'],
    [/Most popular/i, 'a popularity badge with no customer base behind it (F-C-18)'],
    [/GLEC|EXIOBASE|DEFRA/, 'factor libraries that are not wired into the calculator (F-A-12, F-F-09)'],
    // F-A-06 — compliance status that a DPA or a control list cannot confer
    [/GDPR[- ]aligned|GDPR compliance|SOC 2[- ]aligned/i, 'a compliance status no evidence backs (F-A-06)'],
    [/SOC 2[^.\n]{0,40}(in progress|Q[1-4] 20\d\d)/i, 'a dated SOC 2 programme with no engagement on file (F-A-06)'],
    // F-A-17 — unverified location
    [/San Francisco|37\.7749/, 'an unverified headquarters location (F-A-17)'],
  ];

  for (const [pattern, why] of FALSE_STATEMENTS) {
    it(`does not contain ${why}`, () => {
      expect(hits(pattern), String(pattern)).toEqual([]);
    });
  }
});

describe('regulatory statements on the surfaces that carry them (F-A-05, F-R5-03)', () => {
  const llms = read('public/llms.txt');

  it('llms.txt dates its regulatory status and gives the current SB 253 position', () => {
    expect(llms).toContain(`as of ${REGULATORY_AS_OF}`);
    expect(llms).toContain('November 10, 2026');
    expect(llms).toMatch(/Office of Administrative Law/);
    expect(llms).toMatch(/SB 261[^.\n]*(on hold|enjoined)/);
    expect(llms).toMatch(/SEC[^.\n]*stayed/i);
  });

  it('llms.txt says the summary is source material, not a filing, audit trail or assurance (F-A-01, F-F-09)', () => {
    expect(llms).toMatch(/not (an )?assurance, audit, or regulatory filing tool/i);
    expect(llms).toMatch(/does not produce filing packages/i);
    expect(llms).toMatch(/Roadmap \(not yet available\):[^\n]*audit trail/i);
  });

  it('llms.txt prices and trial wording follow pricing.ts and plan-limits.json (F-A-09)', () => {
    for (const id of ['starter', 'growth', 'pro'] as const) {
      expect(llms).toContain(`$${PLANS[id].monthly}/mo`);
    }
    expect(llms).toContain(trialHeadline());
    expect(llms).toContain(`${PLAN_LIMITS.starter.csvImportsPerMonth} CSV imports per month`);
    expect(llms).toContain(`${PLAN_LIMITS.starter.facilities} facility`);
  });
});

describe('the card-free trial is named as a Starter trial (F-A-09)', () => {
  it('builds its wording from the plan limits the server enforces', () => {
    expect(trialHeadline()).toBe(`${TRIAL_DAYS}-day free Starter trial`);
    expect(PLAN_LIMITS.starter.scope3, 'trial copy says "Scope 1 & 2 only"').toBe(false);
    expect(trialLimitsLabel()).toBe(
      `Scope 1 & 2 only, ${PLAN_LIMITS.starter.facilities} facility, ${PLAN_LIMITS.starter.csvImportsPerMonth} CSV imports per month`,
    );
  });

  it('the FAQ answer and the signup meta state the same limits', () => {
    const answer = faq.home.find((item) => item.q === 'What does the free trial include?')?.a ?? '';
    expect(answer).toContain(`${TRIAL_DAYS}-day`);
    expect(answer).toContain('Starter');
    expect(answer).toContain(`${PLAN_LIMITS.starter.facilities} facility`);
    expect(answer).toContain(`${PLAN_LIMITS.starter.csvImportsPerMonth} CSV imports per month`);
    expect(answer).toMatch(/Scope 3 workflows need the Growth plan/);
    expect(routeMeta['/signup'].description).toContain('Starter');
  });

  it('says the trial is offered once per company, where it is promised (F-B-18, K16 follow-up)', () => {
    expect(getClaim('no-card-trial')?.caveat).toMatch(/offered once per company/);
    // The pricing caption shown to a company that can still start a trial carries the same words as the caveat.
    expect(read('src/pages/Pricing.tsx')).toMatch(/free trial, once per company · a card is required to start it/);
  });

  it('the pages that mention the trial build the line from pricing.ts', () => {
    for (const file of ['src/pages/LandingPage.tsx', 'src/pages/MethodologyPublic.tsx']) {
      const src = read(file);
      expect(src, file).toContain('trialHeadline()');
      expect(src, file).toContain('trialLimitsLabel()');
      expect(src, file).not.toMatch(/14-day free trial/);
    }
  });
});

describe('plan cards and comparison table read one roadmap list (F-A-10, F-C-11)', () => {
  it('every roadmap bullet on a card is a "Roadmap" cell for that plan, and vice versa', () => {
    for (const id of ['starter', 'growth', 'pro'] as const) {
      const cells = FEATURE_COMPARISON.filter((row) => row[id] === 'Roadmap').map((row) => row.feature);
      expect(PLANS[id].roadmap, id).toEqual(cells);
    }
  });

  it('a plan never lists a roadmap item that the table shows as "—" for it', () => {
    for (const item of ROADMAP) {
      const row = FEATURE_COMPARISON.find((r) => r.feature === item.feature);
      for (const id of ['starter', 'growth', 'pro'] as const) {
        expect(row?.[id], `${item.feature} / ${id}`).toBe(item.tiers.includes(id) ? 'Roadmap' : '—');
      }
    }
  });

  it('no add-on is priced for a feature that is not built', () => {
    expect(ADD_ONS.map((a) => a.name)).toContain('Extra facility');
    for (const addon of ADD_ONS) {
      expect(addon.name, addon.id).not.toMatch(/supplier|template|assistant|audit|quickbooks|xero|\bapi\b|integration|connector/i);
    }
  });

  it('the limits on the cards and the table come from plan-limits.json', () => {
    const facilities = FEATURE_COMPARISON.find((r) => r.feature === 'Facilities');
    expect(facilities?.starter).toBe(String(PLAN_LIMITS.starter.facilities));
    expect(facilities?.growth).toBe(String(PLAN_LIMITS.growth.facilities));
    expect(facilities?.pro).toBe('Unlimited');
    const scope3 = FEATURE_COMPARISON.find((r) => r.feature === 'Scope 3 workflows');
    expect(scope3?.starter).toBe(PLAN_LIMITS.starter.scope3 ? '✓' : '—');
    expect(scope3?.growth).toBe('✓');
  });
});

describe('landing features come from one list that the app sidebar must agree with (F-A-02)', () => {
  const app = read('src/App.tsx');
  const navBlock = app.slice(app.indexOf('const NAV_ITEMS'), app.indexOf('];', app.indexOf('const NAV_ITEMS')));
  const nav = [...navBlock.matchAll(/\{\s*to:\s*'([^']+)'([^}]*)\}/g)].map((m) => ({
    to: m[1] ?? '',
    soon: /soon:\s*true/.test(m[2] ?? ''),
  }));

  it('finds the sidebar items it compares against', () => {
    expect(nav.length).toBeGreaterThan(5);
  });

  it('a roadmap feature is flagged `soon` in the sidebar and a live feature is not', () => {
    for (const feature of FEATURES) {
      const item = nav.find((n) => n.to === feature.appRoute);
      expect(item, `${feature.name}: no sidebar item for ${feature.appRoute}`).toBeTruthy();
      expect(item?.soon, `${feature.name}: sidebar flag disagrees with status ${feature.status}`).toBe(feature.status === 'roadmap');
    }
  });
});

describe('page structure that regressed before', () => {
  const OWNED_PAGES = [
    'src/pages/LandingPage.tsx',
    'src/pages/Pricing.tsx',
    'src/pages/MethodologyPublic.tsx',
    'src/pages/Demo.tsx',
    'src/pages/ContactUs.tsx',
    'src/pages/BlogList.tsx',
    'src/pages/BlogPost.tsx',
  ];

  it('a headline line break that is hidden on phones is preceded by an explicit space (F-C-08, F-F-19)', () => {
    // JSX drops whitespace that contains a newline, so "text\n<br/>" runs the
    // words together whenever the <br> is display:none.
    for (const file of OWNED_PAGES) {
      const src = read(file);
      for (const match of src.matchAll(/<br className="hidden/g)) {
        const before = src.slice(0, match.index).trimEnd();
        expect(before.endsWith("{' '}"), `${file}: <br> at offset ${match.index} needs {' '} before it`).toBe(true);
      }
    }
  });

  it('pages take title and description from route-meta.json rather than typing them (F-A-12)', () => {
    for (const file of OWNED_PAGES) {
      expect(read(file), file).not.toMatch(/document\.title\s*=\s*['"`]/);
    }
  });

  it('pages that show an FAQ render faq.json and inject no FAQ JSON-LD of their own (F-F-10)', () => {
    for (const file of ['src/pages/LandingPage.tsx', 'src/pages/MethodologyPublic.tsx']) {
      const src = read(file);
      expect(src, file).toContain('@/content/faq.json');
      // A quoted "FAQPage" would be schema.org markup; comments may mention the word.
      expect(src, file).not.toMatch(/["']FAQPage["']/);
    }
  });

  it('contact details on Contact and Demo come from trust-facts, not retyped (F-A-17)', () => {
    for (const file of ['src/pages/ContactUs.tsx', 'src/pages/Demo.tsx']) {
      const src = read(file);
      expect(src, file).toContain('contactDetails');
      expect(src, file).not.toMatch(/developer312\.com/);
    }
  });

  it('the address in the site-wide JSON-LD and llms.txt is the one in trust-facts (F-A-17)', () => {
    expect(read('index.html')).toContain(`"email": "${contactDetails.email}"`);
    expect(read('public/llms.txt')).toContain(contactDetails.email);
  });
});
