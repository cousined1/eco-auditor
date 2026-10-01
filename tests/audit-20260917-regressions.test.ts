/**
 * Regression tests for audit run AUDIT-RUN-20260917-050519-a520.
 *
 * Every test here FAILS against the pre-fix code and passes after the fix.
 * Each one names the finding it pins (lane prefixes FE / INFRA-R).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── FE-01: the signed-in check returned the SDK's public anon key for signed-out
// visitors, so Pricing's "not signed in -> /signup" guard never fired and the
// anonymous checkout funnel died on a raw 401 "Invalid or expired token". The
// check is hasSession() in src/lib/api.ts since D-5 (it answers true or false and
// never hands the token out; it was stripe.ts getAuthToken, which returned it).
const insforgeState = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock('../src/lib/insforge', () => ({
  insforge: {
    getHttpClient: () => ({
      getHeaders: () => insforgeState.headers,
    }),
  },
  isInsForgeConfigured: true,
}));

const { hasSession } = await import('../src/lib/api.ts');

describe('FE-01 hasSession treats the anon key as signed-out', () => {
  beforeEach(() => {
    insforgeState.headers = {};
    vi.unstubAllEnvs();
  });

  it('is false when the SDK hands back the public anon key', () => {
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'anon-key-fix-0000');
    insforgeState.headers = { Authorization: 'Bearer anon-key-fix-0000' };
    expect(hasSession()).toBe(false);
  });

  it('is true for a real signed-in session', () => {
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'anon-key-fix-0000');
    insforgeState.headers = { Authorization: 'Bearer eyJhbGciOi.session.token' };
    expect(hasSession()).toBe(true);
  });

  it('is false when no Authorization header is present', () => {
    insforgeState.headers = {};
    expect(hasSession()).toBe(false);
  });

  it('reads a lowercase authorization header too', () => {
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'anon-key-fix-0000');
    insforgeState.headers = { authorization: 'Bearer eyJhbGciOi.lower.token' };
    expect(hasSession()).toBe(true);
  });

  it('is false for an empty bearer value, and when reading the headers throws', () => {
    insforgeState.headers = { Authorization: 'Bearer ' };
    expect(hasSession()).toBe(false);
    expect(hasSession({ getHttpClient: () => { throw new Error('no client'); } })).toBe(false);
  });

  it('never hands the token out: it answers with a boolean', () => {
    insforgeState.headers = { Authorization: 'Bearer eyJhbGciOi.session.token' };
    expect(typeof hasSession()).toBe('boolean');
  });
});

// ── Source-level pins (hermetic, no React mount — same pattern as
// contact-page.test.tsx / legal-placeholders.test.ts).

const apiSrc = readFileSync(resolve('src/lib/api.ts'), 'utf8');
const themeSrc = readFileSync(resolve('src/hooks/useTheme.tsx'), 'utf8');
const methodologySrc = readFileSync(resolve('src/pages/MethodologyPublic.tsx'), 'utf8');
const dpaSrc = readFileSync(resolve('src/pages/DataProcessingAddendum.tsx'), 'utf8');
const indexSrc = readFileSync(resolve('index.html'), 'utf8');
const landingSrc = readFileSync(resolve('src/pages/LandingPage.tsx'), 'utf8');
const securityYml = readFileSync(resolve('.github/workflows/security.yml'), 'utf8');
const eslintCfg = readFileSync(resolve('eslint.config.js'), 'utf8');

describe('FE-01 pin: hasSession compares the resolved token against the anon key', () => {
  it('contains the anon-key gate', () => {
    expect(apiSrc).toContain('token === anonKey');
  });
});

describe('FE-03 ThemeProvider guards localStorage access', () => {
  it('wraps the initial read in try/catch', () => {
    expect(themeSrc).toMatch(/try\s*\{\s*stored\s*=\s*localStorage\.getItem\('eco-theme'\)/s);
  });

  it('wraps the persisting write in try/catch', () => {
    expect(themeSrc).toMatch(/try\s*\{\s*localStorage\.setItem\('eco-theme', theme\);/s);
  });
});

describe('FE-02 methodology copy no longer claims all Scope 1/2 factors are citation-tracked', () => {
  it('drops the "Core Scope 1/2 factors are citation-tracked" sentence', () => {
    expect(methodologySrc).not.toMatch(/Core Scope 1\/2 factors/);
    expect(methodologySrc).not.toMatch(/are citation-tracked to their source documents/);
  });

  it('cites the data-driven Scope 1/2 provisional count', () => {
    expect(methodologySrc).toContain('PROVISIONAL_SCOPE12');
    expect(methodologySrc).toContain('factorProvenanceSummary');
  });
});

describe('FE-04 DPA Annex III does not assert unverified processing locations', () => {
  const rows = dpaSrc
    .split('\n')
    .filter((l) => l.trim().startsWith("{ name: '") && l.includes('location:'));

  it('found the Annex III subprocessor rows', () => {
    expect(rows.length).toBe(5);
  });

  it('keeps the concrete region only for the verified subprocessor (Stripe)', () => {
    const stripe = rows.find((r) => r.includes("'Stripe, Inc.'"));
    expect(stripe).toBeTruthy();
    expect(stripe).toContain("'United States'");
  });

  it('renders pending-verification wording for unverified subprocessors', () => {
    const unverified = rows.filter((r) => !r.includes("'Stripe, Inc.'"));
    expect(unverified.length).toBe(4);
    for (const row of unverified) {
      expect(row).toContain('pending verification');
    }
  });
});

describe('FE-05 root JSON-LD no longer claims CSV export', () => {
  it('removes the PDF/CSV claim', () => {
    expect(indexSrc).not.toContain('PDF/CSV');
  });

  // Audit F-A-01: this block used to pin "machine-readable JSON data export",
  // a phrase from the FAQ answer that also claimed verifiable audit trails,
  // versioned calculation logs and suitability for third-party assurance. That
  // sentence was false, so pinning it kept it live. The false phrases are
  // denied instead; the fuller per-route denylist is tests/prerender-head.test.ts.
  it('does not claim audit trails, versioned logs, audit-readiness or assurance suitability (F-A-01)', () => {
    expect(indexSrc).not.toMatch(/verifiable audit trails?/i);
    expect(indexSrc).not.toMatch(/versioned calculation logs?/i);
    expect(indexSrc).not.toMatch(/suitable for third-party assurance/i);
    expect(indexSrc).not.toMatch(/audit[- ]ready/i);
  });

  it('keeps page-level FAQ markup out of the site-wide template (F-F-10)', () => {
    expect(indexSrc).not.toContain('"FAQPage"');
  });
});

const faqSrc = readFileSync(resolve('src/content/faq.json'), 'utf8');

describe('FE-06 landing page drops the unverified setup-time absolute', () => {
  it('no longer asserts "Most teams are up and running quickly"', () => {
    expect(landingSrc).not.toContain('up and running quickly');
    expect(faqSrc).not.toContain('up and running quickly');
  });

  it('keeps a qualified, action-based answer instead, with no time-to-value promise', () => {
    const answer = (JSON.parse(faqSrc) as { home: { q: string; a: string }[] }).home.find(
      (item) => item.q === 'How long does it take to get started?',
    )?.a ?? '';
    expect(answer).toContain('confidence scoring');
    expect(answer).not.toMatch(/\bweeks?\b|\bmonths?\b/i);
  });
});

describe('INFRA-R1 CI history scan runs on a full clone', () => {
  it('checks out with fetch-depth: 0 so gitleaks can see history', () => {
    expect(securityYml).toMatch(/fetch-depth:\s*0/);
  });
});

describe('INFRA-R2 eslint actually lints scripts/*.mjs', () => {
  it('declares a config block for scripts/**/*.mjs', () => {
    expect(eslintCfg).toContain("files: ['scripts/**/*.mjs']");
  });

  it('gives that block node globals (not browser globals)', () => {
    const block = eslintCfg.slice(eslintCfg.indexOf('scripts/**/*.mjs'));
    expect(block).toContain('globals.node');
  });
});


// ── SC-04: /api/ingest/status resolved the job before the tenant check, so a
// foreign-but-real job id returned 403 while unknown ids returned 404 (an
// existence oracle). The fix resolved the caller's company first; F-G-16 then
// removed the route and its in-memory job registry, which nothing called (the
// import history, GET /api/ingest/imports, is the record of an import).
describe('SC-04 tenant check precedes resource resolution', () => {
  const serverSrc = readFileSync(resolve('server.cjs'), 'utf8');

  it('the ingest job registry and its status route are gone, so no job id can be probed', () => {
    expect(serverSrc).not.toContain('/api/ingest/status');
    expect(serverSrc).not.toMatch(/ingestJobs|recordIngestJob/);
  });

  // K3 removed the in-memory dev report store (audit review R2: "delete it or
  // align it"); every report path now reads public.reports scoped to the
  // caller's company, and tests/report-snapshots-route.test.ts proves the 404s.
  it('report download and sign-off resolve the tenant before the report lookup', () => {
    for (const marker of ["app.get('/api/reports/:id/download'", "app.post('/api/reports/:id/signoff'"]) {
      const route = serverSrc.slice(serverSrc.indexOf(marker));
      const body = route.slice(0, route.indexOf('\napp.', 10));
      const resolveAt = body.indexOf('await requireCompanyAccess(req, res, null)');
      const lookupAt = body.indexOf('WHERE id = $1 AND company_id = $2');
      expect(resolveAt, marker).toBeGreaterThan(-1);
      expect(lookupAt, marker).toBeGreaterThan(resolveAt);
    }
  });
});

// ── SC-05: planned Tier-2 performance remediations (PERF-004/006/011, PERF-003 residual).
describe('SC-05 Tier-2 performance fixes are applied', () => {
  const serverSrc = readFileSync(resolve('server.cjs'), 'utf8');

  it('bounds the emission_entries read with a LIMIT (PERF-004)', () => {
    expect(serverSrc).toMatch(/ORDER BY created_at ASC LIMIT \d+/);
  });

  it('caches the trend per company/period/year (PERF-004)', () => {
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/emissions/trend'"));
    const body = route.slice(0, route.indexOf('app.get', 1));
    expect(body).toContain('const cacheKey = `trend:${companyId}:${period}:${year}`');
    expect(body).toContain('cacheSet(cacheKey');
  });

  it('ships a blog-list excerpt instead of full body_html (PERF-006)', () => {
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/blog-posts'"));
    const body = route.slice(0, route.indexOf("app.get('/api/blog-posts/:slug'"));
    expect(body).toContain('excerpt: blogListExcerpt(row)');
    expect(body).toContain('read_minutes: blogListReadMinutes(row.body_html)');
    expect(body).not.toMatch(/body_html: sanitizeBlogHtml/);
  });

  it('caches the resolved intro-video path (PERF-011)', () => {
    expect(serverSrc).toMatch(/let resolvedVideoPath;/);
    const fn = serverSrc.slice(serverSrc.indexOf('function findVideoPath()'));
    expect(fn.slice(0, fn.indexOf('\n}', 1))).toContain('if (resolvedVideoPath !== undefined)');
  });

  // PERF-003 residual pinned a cap on the dev-only generatedReports map. K3
  // removed that map (reports live in public.reports only), so pin its absence
  // and the bound on the report list that replaced it.
  it('keeps no in-memory report store, and bounds the report list', () => {
    expect(serverSrc).not.toMatch(/generatedReports/);
    expect(serverSrc).toMatch(/const REPORT_LIST_LIMIT = \d+;/);
    expect(serverSrc).toContain('LIMIT ${REPORT_LIST_LIMIT}');
  });
});
