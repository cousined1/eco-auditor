/**
 * Regression tests for audit run AUDIT-RUN-20260917-050519-a520.
 *
 * Every test here FAILS against the pre-fix code and passes after the fix.
 * Each one names the finding it pins (lane prefixes FE / INFRA-R).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── FE-01: getAuthToken() returned the SDK's public anon key for signed-out
// visitors, so Pricing's "not signed in -> /signup" guard never fired and the
// anonymous checkout funnel died on a raw 401 "Invalid or expired token".
const insforgeState = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock('../src/lib/insforge', () => ({
  insforge: {
    getHttpClient: () => ({
      getHeaders: () => insforgeState.headers,
    }),
  },
  isInsForgeConfigured: true,
}));

const { getAuthToken } = await import('../src/lib/stripe.ts');

describe('FE-01 getAuthToken treats the anon key as signed-out', () => {
  beforeEach(() => {
    insforgeState.headers = {};
    vi.unstubAllEnvs();
  });

  it('returns null when the SDK hands back the public anon key', async () => {
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'anon-key-fix-0000');
    insforgeState.headers = { Authorization: 'Bearer anon-key-fix-0000' };
    await expect(getAuthToken()).resolves.toBeNull();
  });

  it('returns the token for a real signed-in session', async () => {
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'anon-key-fix-0000');
    insforgeState.headers = { Authorization: 'Bearer eyJhbGciOi.session.token' };
    await expect(getAuthToken()).resolves.toBe('eyJhbGciOi.session.token');
  });

  it('returns null when no Authorization header is present', async () => {
    insforgeState.headers = {};
    await expect(getAuthToken()).resolves.toBeNull();
  });

  it('reads a lowercase authorization header too', async () => {
    vi.stubEnv('VITE_INSFORGE_ANON_KEY', 'anon-key-fix-0000');
    insforgeState.headers = { authorization: 'Bearer eyJhbGciOi.lower.token' };
    await expect(getAuthToken()).resolves.toBe('eyJhbGciOi.lower.token');
  });
});

// ── Source-level pins (hermetic, no React mount — same pattern as
// contact-page.test.tsx / legal-placeholders.test.ts).

const stripeSrc = readFileSync(resolve('src/lib/stripe.ts'), 'utf8');
const themeSrc = readFileSync(resolve('src/hooks/useTheme.tsx'), 'utf8');
const methodologySrc = readFileSync(resolve('src/pages/MethodologyPublic.tsx'), 'utf8');
const dpaSrc = readFileSync(resolve('src/pages/DataProcessingAddendum.tsx'), 'utf8');
const indexSrc = readFileSync(resolve('index.html'), 'utf8');
const landingSrc = readFileSync(resolve('src/pages/LandingPage.tsx'), 'utf8');
const securityYml = readFileSync(resolve('.github/workflows/security.yml'), 'utf8');
const eslintCfg = readFileSync(resolve('eslint.config.js'), 'utf8');

describe('FE-01 pin: getAuthToken compares the resolved token against the anon key', () => {
  it('contains the anon-key gate', () => {
    expect(stripeSrc).toContain('token === anonKey');
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

  it('describes the implemented JSON data export instead', () => {
    expect(indexSrc).toMatch(/machine-readable JSON data export/);
  });
});

describe('FE-06 landing page drops the unverified setup-time absolute', () => {
  it('no longer asserts "Most teams are up and running quickly"', () => {
    expect(landingSrc).not.toContain('up and running quickly');
  });

  it('keeps a qualified, action-based answer instead', () => {
    expect(landingSrc).toContain('confidence scoring');
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
// existence oracle). The fix resolves the caller's company first.
describe('SC-04 tenant check precedes resource resolution', () => {
  const serverSrc = readFileSync(resolve('server.cjs'), 'utf8');

  it('resolves the caller company before the ingest job lookup', () => {
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/ingest/status/:job_id'"));
    const body = route.slice(0, route.indexOf('app.get', 1));
    const resolveAt = body.indexOf("await requireCompanyAccess(req, res, null)");
    const jobAt = body.indexOf('ingestJobs.get(req.params.job_id)');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(jobAt).toBeGreaterThan(resolveAt);
  });

  it('returns an identical 404 for unknown and foreign ingest jobs', () => {
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/ingest/status/:job_id'"));
    const body = route.slice(0, route.indexOf('app.get', 1));
    expect(body).toContain("!job || String(job.company_id) !== String(companyId)");
  });

  it('dev report download resolves the tenant before the map lookup', () => {
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/reports/:id/download'"));
    const devBranch = route.slice(route.indexOf('Dev / no-DB fallback'));
    const resolveAt = devBranch.indexOf('await requireCompanyAccess(req, res, null)');
    const lookupAt = devBranch.indexOf('generatedReports.get(req.params.id)');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(lookupAt).toBeGreaterThan(resolveAt);
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

  it('caps the dev-only generatedReports map (PERF-003 residual)', () => {
    expect(serverSrc).toMatch(/while \(generatedReports\.size > 50\)/);
  });
});
