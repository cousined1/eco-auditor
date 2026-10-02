import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyPolicy from '../src/pages/PrivacyPolicy';
import DataProcessingAddendum from '../src/pages/DataProcessingAddendum';
import Security from '../src/pages/Security';
import TermsOfService from '../src/pages/TermsOfService';
import { ConsentProvider } from '../src/lib/consent-context';
import { ThemeProvider } from '../src/hooks/useTheme';

// The legal pages describe what the code does. These tests tie those
// descriptions to the code they describe, so the wording and the behaviour
// cannot drift apart silently (F-A-13 subprocessors, F-A-20/F-D-06 retention,
// F-F-16 consent and storage, and the sweep-2a additions at the end of the file:
// the draft-report pruning, the lead notifier, the reporting basis and edit
// record, the consent queue, the browser error report, the trial rule).
// The additions of the final web verification (the export, import-history and
// delete facts, plan changes, tenant isolation, the features the Terms name and
// the sentences that carry a counsel marker) are in
// tests/legal-evidence-coupling-web.test.tsx.
// When one of these fails, change the wording and the code together and re-check
// the evidence; do not just edit the test.

const require = createRequire(import.meta.url);
const read = (path: string): string => readFileSync(resolve(path), 'utf8');

function pageText(page: ReactElement): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ConsentProvider>{page}</ConsentProvider>
    </MemoryRouter>,
  )
    .replace(/<\/(?:li|p|h[1-6]|td|tr|div|section)>/g, ' | ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const privacy = pageText(<PrivacyPolicy />);
const dpa = pageText(<DataProcessingAddendum />);
const security = pageText(<Security />);
const terms = pageText(<TermsOfService />);

// What the migrations install, without their comments (a rollback note is not behaviour).
const migrationFiles = readdirSync(resolve('migrations'))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({ name, sql: read(`migrations/${name}`).replace(/--.*$/gm, '') }));
const serverSources = readdirSync(resolve('.'))
  .filter((name) => /^server.*\.cjs$/.test(name))
  .map((name) => read(name))
  .join('\n');
// A source file without its comments: a header comment that names `credentials: 'omit'` is not behaviour.
const code = (path: string): string => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('subprocessors are evidenced, and every third-party host the site talks to is disclosed (F-A-13)', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

  // vendor as named in DPA Annex III / Privacy Section 8 -> evidence in the repo
  const EVIDENCE: Record<string, () => boolean> = {
    'Railway Corporation': () => existsSync(resolve('railway.toml')),
    'InsForge, Inc.': () => '@insforge/sdk' in dependencies,
    'Cloudflare, Inc.': () => /Cloudflare/.test(read('server.cjs')),
    'Stripe, Inc.': () => 'stripe' in dependencies,
    'Google LLC': () => /googletagmanager\.com/.test(read('src/lib/gtm.ts')),
  };

  it('every vendor with evidence in the repo is named in both the DPA and the Privacy Policy', () => {
    for (const [vendor, hasEvidence] of Object.entries(EVIDENCE)) {
      expect(hasEvidence(), `no evidence in the repo for ${vendor}: remove it from the legal pages or restore the evidence`).toBe(true);
      expect(dpa, `DPA Annex III must name ${vendor}`).toContain(vendor);
      expect(privacy, `Privacy Section 8 must name ${vendor}`).toContain(vendor);
    }
  });

  it('the DPA lists no vendor that is not in the evidence table', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DataProcessingAddendum />
      </MemoryRouter>,
    );
    const names = [...html.matchAll(/<tr[^>]*><td[^>]*>([^<]+)<\/td><td[^>]*>[^<]+<\/td><td[^>]*>[^<]+<\/td><\/tr>/g)].map((m) => (m[1] ?? '').replace(/&amp;/g, '&'));
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) {
      expect(Object.keys(EVIDENCE), `"${name}" is listed in Annex III without evidence in this test`).toContain(name);
    }
  });

  it('every third-party host allowed by the CSP belongs to a disclosed vendor', () => {
    const { buildSecurityHeaders } = require('../server-security.cjs') as {
      buildSecurityHeaders: (options?: { hsts?: boolean }) => Record<string, string>;
    };
    const csp = buildSecurityHeaders({ hsts: true })['Content-Security-Policy'] ?? '';
    const hosts = [...csp.matchAll(/https:\/\/([^\s;]+)/g)].map((m) => (m[1] ?? '').replace(/^\*\./, ''));
    expect(hosts.length).toBeGreaterThan(0);

    const VENDOR_BY_HOST: Array<[RegExp, string]> = [
      [/(^|\.)(google|googleapis|gstatic|googletagmanager|google-analytics|doubleclick)\.(com|net)$/, 'Google LLC'],
      [/(^|\.)insforge\.(app|co)$/, 'InsForge, Inc.'],
    ];
    for (const host of hosts) {
      const vendor = VENDOR_BY_HOST.find(([pattern]) => pattern.test(host))?.[1];
      expect(vendor, `the CSP allows ${host}, but no disclosed vendor covers it: add the vendor to DPA Annex III, Privacy Section 8 and this table`).toBeTruthy();
      expect(dpa).toContain(vendor ?? '');
      expect(privacy).toContain(vendor ?? '');
    }
  });

  // Two-way (F-F-06): the legal pages name Google Fonts exactly while the code loads
  // fonts from Google, through the page, the stylesheet or an allowance in the CSP.
  // Fonts are self-hosted now, so the pages must not say a Google font service
  // receives visitor data; bring a Google font link back and they must say so again.
  it('the legal pages name Google Fonts exactly while the code loads fonts from Google', () => {
    const { buildSecurityHeaders } = require('../server-security.cjs') as {
      buildSecurityHeaders: (options?: { hsts?: boolean }) => Record<string, string>;
    };
    const sources = [read('index.html'), read('src/index.css'), buildSecurityHeaders({ hsts: true })['Content-Security-Policy'] ?? ''];
    const loadsFromGoogle = sources.some((source) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(source));

    if (loadsFromGoogle) {
      expect(privacy, 'fonts load from Google: the Privacy Policy must name Google Fonts').toContain('Google Fonts');
      expect(dpa, 'fonts load from Google: DPA Annex III must name Google Fonts').toContain('Google Fonts');
    } else {
      expect(privacy, 'fonts are self-hosted: the Privacy Policy must not say Google Fonts receives visitor data').not.toContain('Google Fonts');
      expect(dpa, 'fonts are self-hosted: DPA Annex III must not list Google Fonts').not.toContain('Google Fonts');
    }
  });

  it('Google Tag Manager is loaded only after analytics consent, as the legal pages say', () => {
    expect(read('src/components/GTMInitializer.tsx')).toMatch(/if \(consentState\.consent\.analytics\)/);
    expect(privacy).toMatch(/loaded only if you accept analytics cookies/);
    expect(dpa).toMatch(/loaded only if the user accepts analytics cookies/);
  });
});

describe('the "nothing is deleted automatically" wording matches the server code (F-A-20, F-D-06)', () => {
  it('no server code or migration deletes account, lead, consent or billing data, or schedules a database job', () => {
    const files = ['server.cjs', 'server-billing.cjs', 'server-publish.cjs', 'server-security.cjs', 'server-http-utils.cjs'];
    const migrations = readdirSync(resolve('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => `migrations/${name}`);
    const source = [...files, ...migrations].map(read).join('\n');

    const deletedTables = [...source.matchAll(/DELETE\s+FROM\s+(?:public\.)?(\w+)/gi)].map((m) => (m[1] ?? '').toLowerCase());
    const retained = new Set(['companies', 'users', 'leads', 'consent_records', 'csv_import_events']);
    expect(
      deletedTables.filter((table) => retained.has(table)),
      'a deletion path now exists for data the legal pages say is kept until requested: update Privacy Section 9, DPA Section 11, Terms Section 9 and the Security FAQ',
    ).toEqual([]);
    expect(source).not.toMatch(/cron\.schedule|pg_cron/i);
  });

  it('every legal page that describes retention says nothing is deleted automatically', () => {
    expect(privacy).toMatch(/Nothing is deleted automatically/);
    expect(dpa).toMatch(/does not delete workspace data automatically/);
  });
});

describe('consent records described in the Privacy Policy match what the server stores (F-D-06, F-F-16)', () => {
  it('stores the described fields and a keyed hash of the IP, never the raw address', () => {
    const server = read('server.cjs');
    const insert = /INSERT INTO public\.consent_records \(([^)]+)\)/.exec(server);
    expect(insert, 'could not find the consent_records INSERT in server.cjs').toBeTruthy();
    const columns = (insert?.[1] ?? '').split(',').map((c) => c.trim());
    for (const column of ['visitor_id', 'consent', 'policy_version', 'method', 'gpc', 'dnt', 'user_agent', 'ip_hash']) {
      expect(columns, `Privacy Section 5 describes ${column} as stored`).toContain(column);
    }
    expect(columns.filter((c) => /^ip(_address)?$/.test(c))).toEqual([]);
    expect(server).toMatch(/createHmac\('sha256', CONSENT_IP_PEPPER\)/);
    expect(privacy).toMatch(/keyed hash of your IP address \(not the address itself\)/);
  });

  it('names both times the record holds, the receipt time and the decision time the browser reports, for as long as the table has both columns (sweep-2b, F-X1-02)', () => {
    const consentTable = migrationFiles.map((file) => file.sql).join('\n');
    const hasDecidedAt = /ALTER TABLE public\.consent_records[\s\S]*?ADD COLUMN IF NOT EXISTS decided_at/i.test(consentTable)
      && /decided_at/.test(read('server.cjs')) && /created_at/.test(read('server.cjs'));
    if (hasDecidedAt) {
      expect(privacy).toMatch(/two times: the time our servers received the record and, when your browser reports it, the time you made the choice/);
    } else {
      expect(privacy, 'no decided_at column any more: the record holds one time, say so').not.toMatch(/the time you made the choice/);
    }
  });
});

describe('cookie withdrawal wording matches the code (F-F-16)', () => {
  it('says already-set cookies are not deleted on withdrawal only while no source file removes them', () => {
    const sources = (readdirSync(resolve('src'), { recursive: true }) as string[])
      .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name))
      .map((name) => read(`src/${name}`));
    const removesCookies = sources.some((source) => /document\.cookie\s*=/.test(source));
    const sentence = /does not automatically delete cookies that were already set/;
    if (removesCookies) {
      expect(privacy, 'some code now removes cookies on withdrawal: update Privacy Section 15').not.toMatch(sentence);
    } else {
      expect(privacy, 'no code removes cookies on withdrawal, so the Privacy Policy must not imply that it does').toMatch(sentence);
    }
  });
});

describe('theme storage wording matches ThemeProvider behaviour (F-F-16)', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    // jsdom has no matchMedia; ThemeProvider reads it when no theme is stored.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('says the theme is saved whether or not you consent if it is written before any consent decision, and only with consent if it is gated', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ConsentProvider>
          <ThemeProvider>
            <span>probe</span>
          </ThemeProvider>
        </ConsentProvider>,
      );
    });
    // No consent decision has been made: the banner is still unanswered.
    const savedBeforeAnyConsent = localStorage.getItem('eco-theme') !== null;
    await act(async () => root.unmount());
    container.remove();

    if (savedBeforeAnyConsent) {
      expect(privacy, 'the theme is saved without consent, so the Privacy Policy must say so').toMatch(/theme[^.|]{0,200}?whether or not you (?:accept|consent)/i);
    } else {
      expect(privacy, 'the theme write is gated on consent, so the Privacy Policy must say so').toMatch(/theme[^.|]{0,200}?only if you (?:accept|consent)/i);
    }
  });
});

// ── K3 follow-up: the one automatic deletion ──────────────────────────────────────────
// "Nothing is deleted automatically" stopped being true when the reports_prune_drafts trigger
// landed (migrations/20260930110000): storing a new draft report deletes the company's older
// drafts beyond the newest 25. Every page that says nothing is deleted automatically carves
// that out, in the number the database keeps, and stops doing so if the trigger goes.
describe('the draft-report pruning is disclosed wherever "nothing is deleted automatically" is said (K3, F-A-20)', () => {
  const { MAX_DRAFT_REPORTS } = require('../src/lib/reports/report-limits.cjs') as { MAX_DRAFT_REPORTS: number };
  // A DELETE inside a migration runs with nobody asking: it is in a trigger function.
  const automaticDeletes = migrationFiles.flatMap(({ sql }) => [...sql.matchAll(/DELETE\s+FROM\s+(?:public\.)?(\w+)/gi)].map((m) => (m[1] ?? '').toLowerCase()));
  const pruneSql = migrationFiles.find(({ sql }) => /reports_prune_drafts/.test(sql))?.sql ?? '';
  const prunes = automaticDeletes.includes('reports');
  const carveOut = new RegExp(
    `(?:we keep|it keeps) only the ${MAX_DRAFT_REPORTS} most recent unsigned draft reports per workspace and (?:delete|deletes) older drafts when a new report is generated; signed-off reports are not deleted this way`,
  );
  const pages: Array<[string, string]> = [['Privacy Policy', privacy], ['Security page', security], ['Terms of Service', terms], ['DPA', dpa]];

  it('public.reports is the only table a migration deletes from by itself, and the trigger keeps MAX_DRAFT_REPORTS drafts', () => {
    expect([...new Set(automaticDeletes)], 'a new automatic deletion needs the same disclosure: extend this list and the four pages together').toEqual(['reports']);
    expect(pruneSql).toMatch(/AFTER INSERT ON public\.reports/);
    expect(Number(/LIMIT\s+(\d+)\s*\)/.exec(pruneSql)?.[1]), 'the LIMIT in reports_prune_drafts').toBe(MAX_DRAFT_REPORTS);
  });

  it.each(pages)('%s says "nothing is deleted automatically" and carves the draft pruning out of it', (_name, text) => {
    expect(text).toMatch(/nothing is deleted automatically|does not delete workspace data automatically/i);
    if (prunes) {
      expect(text, 'a migration deletes draft reports by itself: say so, with the number it keeps').toMatch(carveOut);
    } else {
      expect(text, 'no migration deletes reports any more: remove the carve-out').not.toMatch(/most recent unsigned draft reports/i);
    }
  });
});

// ── D-3: the lead notifier ────────────────────────────────────────────────────────────
// server-notify.cjs posts each demo, contact and chat request to the operator's messaging
// workspace (LEAD_NOTIFY_WEBHOOK_URL). Privacy Section 8 says its provider list is the one in
// DPA Annex III, so both carry the disclosure while the notifier is wired into the server.
describe('the lead notifier is disclosed in Privacy Section 8 and DPA Annex III (D-3, F-A-07)', () => {
  const { formatLeadMessage } = require('../server-notify.cjs') as { formatLeadMessage: (lead: Record<string, string>) => string };
  const wired = /createLeadNotifierFromEnv\(process\.env/.test(read('server.cjs')) && /leadNotifier\.notify\(lead\)/.test(read('server.cjs'));
  // The fields it posts, read from the real formatter: the first line is the lead's type and source.
  const posted = [
    ...formatLeadMessage({ type: 'demo', source: 'demo', name: 'N', email: 'e@x.test', company: 'C', preferredDate: 'D', preferredTime: 'T', message: 'M' }).matchAll(/^([A-Z][A-Za-z ]+): /gm),
  ].map((m) => m[1] ?? '');
  const DISCLOSED_AS: Record<string, RegExp> = {
    Name: /\bname\b/, Email: /email address/, Company: /\bcompany\b/, 'Preferred date': /preferred date/, 'Preferred time': /\btime\b/, Message: /\bmessage\b/,
  };

  it('the fields it posts are the ones the disclosure below can list (a new field needs new wording)', () => {
    expect(posted).toEqual(Object.keys(DISCLOSED_AS));
  });

  it.each([
    ['Privacy Section 8', privacy, /Team messaging workspace/],
    ['DPA Annex III', dpa, /Lead notifications/],
  ] as Array<[string, string, RegExp]>)('%s names the messaging workspace and every field posted, while the notifier is wired in', (_name, text, anchor) => {
    const at = text.search(anchor);
    if (!wired) {
      expect(text, 'the notifier is not wired into server.cjs any more: remove the disclosure').not.toMatch(/team messaging workspace/i);
      return;
    }
    expect(at, `${_name} must carry the disclosure`).toBeGreaterThanOrEqual(0);
    const snippet = text.slice(at, at + 700);
    expect(snippet).toMatch(/team messaging workspace/i);
    for (const label of posted) expect(snippet, `the notifier posts "${label}"`).toMatch(DISCLOSED_AS[label] ?? /^$/);
  });
});

// ── K5: the reporting basis and the entry edit record ─────────────────────────────────
describe('the reporting basis and the entry edit record are in the Privacy Policy (K5, F-E-08, F-B-17)', () => {
  const sql = migrationFiles.filter(({ name }) => /company-onboarding/.test(name)).map(({ sql: body }) => body).join('\n');
  const history = /CREATE TABLE IF NOT EXISTS public\.entry_history \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';

  it('finds the onboarding migration and what it adds', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS consolidation_approach/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS base_year/);
    expect(history.length).toBeGreaterThan(0);
  });

  it('names the reporting basis the migration adds, and that reports print it', () => {
    expect(privacy).toMatch(/your reporting basis \(the consolidation approach and base year you choose\), which also appears in the reports you generate/);
    expect(read('src/lib/reports/report-generator.cjs')).toMatch(/Consolidation approach: /);
    expect(read('src/lib/reports/report-generator.cjs')).toMatch(/Base year: /);
  });

  it('names what an edit record holds, in the columns that hold it, and is written by the edit route', () => {
    for (const column of ['changed_by', 'changed_at', 'old_values', 'new_values']) expect(history, column).toContain(column);
    expect(privacy).toMatch(/we keep a record of the change: the account ID of the person who made it, the time, and the previous and new values/);
    expect(serverSources).toMatch(/INSERT INTO public\.entry_history \(entry_id, company_id, changed_by, old_values, new_values\)/);
    expect(serverSources, 'changed_by is the signed-in user id').toMatch(/String\(req\.user\.id\),\s*JSON\.stringify\(entryHistoryValues/);
  });

  it('says the record is deleted with its entry only while the table cascades from the entry', () => {
    expect(history).toMatch(/entry_id BIGINT NOT NULL REFERENCES public\.emission_entries\(id\) ON DELETE CASCADE/);
    expect(privacy).toMatch(/The record is deleted together with the entry, including when you use “Delete my audit data”/);
  });
});

// ── K10 follow-up: the consent queue and Consent Mode ─────────────────────────────────
describe('the browser-side consent queue and Google Consent Mode are in the Privacy Policy (K10, F-X1-02, F-F-05)', () => {
  it('names the localStorage key the consent outbox uses, for as long as the code queues a record there', () => {
    const audit = code('src/lib/consent-audit.ts');
    const key = /const OUTBOX_KEY = '([^']+)'/.exec(audit)?.[1] ?? '';
    expect(key, 'OUTBOX_KEY in src/lib/consent-audit.ts').not.toBe('');
    const queues = /localStorage\.setItem\(OUTBOX_KEY/.test(audit);
    if (queues) {
      // VF-6: "retries until our servers accept it" left out that a refused record is dropped and the queue is capped.
      expect(privacy).toContain(`your browser keeps it in its local storage (under the name ${key}) and retries until our servers accept or refuse it`);
      expect(privacy).toMatch(/the copy in your browser is removed once the record is accepted or refused/);
      expect(audit, 'the queued copy really is removed').toMatch(/localStorage\.removeItem\(OUTBOX_KEY\)/);
    } else {
      expect(privacy, 'nothing is queued in localStorage any more: remove the sentence').not.toContain(key);
    }
  });

  it('says withdrawal reaches Google\'s tags on the page through Consent Mode, for as long as the code sends that update', () => {
    const sendsUpdate = /gtag\('consent', 'update'/.test(code('src/lib/consent-mode.ts')) && /syncConsentMode\(/.test(code('src/lib/consent-context.tsx'));
    if (sendsUpdate) {
      expect(privacy).toMatch(/tells Google’s tags that are already running on the page \(through Google Consent Mode\)/);
      expect(privacy, 'the sentence it sits beside is unchanged').toMatch(/does not automatically delete cookies that were already set/);
    } else {
      expect(privacy, 'no Consent Mode update is sent any more: remove the sentence').not.toMatch(/Google Consent Mode/);
    }
  });
});

// ── obs-a: the automatic browser error report ─────────────────────────────────────────
describe('the browser error report is in the Privacy Policy, clause by clause (obs-a, F-G-08)', () => {
  const report = code('src/lib/client-error-report.ts');
  const sends = /const ENDPOINT = '\/api\/client-error'/.test(report) && /fetch\(ENDPOINT/.test(report);
  const sentence =
    /If a page fails, your browser sends us a technical error report \(the error message, a technical stack trace and the page address without its parameters\)\. It carries no cookies and is not used to identify you/;

  it('states it while the browser sends one, and only then', () => {
    if (sends) expect(privacy).toMatch(sentence);
    else expect(privacy, 'the browser sends no error report any more: remove the sentence').not.toMatch(/technical error report/);
  });

  it('each clause is something the code does', () => {
    expect(report, 'the error message').toMatch(/message: message\.slice\(/);
    expect(report, 'a technical stack trace').toMatch(/body\.stack = stack\.slice\(/);
    expect(report, 'the page address without its parameters').toMatch(/route: window\.location\.pathname/);
    expect(report).not.toMatch(/location\.(?:search|hash|href)/);
    expect(report, 'carries no cookies').toMatch(/credentials: 'omit'/);
  });

  it('the server logs it without the address, agent or cookie that could identify the sender', () => {
    const observability = read('server-observability.cjs');
    const handler = observability.slice(observability.indexOf('function createClientErrorHandler'));
    expect(handler.length).toBeGreaterThan(100);
    expect(handler).not.toMatch(/req\.(?:ip|headers|cookies|socket|connection)|x-forwarded-for|user-agent/i);
  });
});

// ── K16 follow-up: one free trial per company ─────────────────────────────────────────
// checkoutTrialDecision (server-billing.cjs) is the rule POST /api/checkout applies. The Terms
// state it while it refuses a second trial, and the claims register and the in-app pricing
// caption carry the same words.
describe('the once-per-company trial rule is in the Terms, the register and the pricing caption (K16, F-B-18)', () => {
  const { billingStateFromCompany, checkoutTrialDecision } = require('../server-billing.cjs') as {
    billingStateFromCompany: (company: Record<string, unknown>, now: Date) => unknown;
    checkoutTrialDecision: (state: unknown, hadPriorStripeSubscription: boolean) => { eligible: boolean };
  };
  const now = new Date('2026-09-30T12:00:00.000Z');
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const row = (overrides: Record<string, unknown>) => ({
    trial_ends_at: at(9), subscription_status: null, subscription_plan: null, subscription_current_period_end: null,
    stripe_customer_id: null, stripe_subscription_id: null, ...overrides,
  });
  const offered = (company: Record<string, unknown> | null, priorStripe = false) =>
    checkoutTrialDecision(company === null ? null : billingStateFromCompany(company, now), priorStripe).eligible;

  it('the rule: a new company is offered a trial; one whose trial ran out, that subscribed before, or that Stripe knows is not', () => {
    expect(offered(null)).toBe(true);
    expect(offered(row({}))).toBe(true);
    expect(offered(row({ trial_ends_at: at(-2) }))).toBe(false);
    expect(offered(row({ stripe_customer_id: 'cus_1', subscription_status: 'canceled', subscription_plan: 'starter' }))).toBe(false);
    expect(offered(row({}), true)).toBe(false);
  });

  it('the Terms state it while the server refuses a second trial, and the register and the caption say the same', () => {
    const refuses = !offered(row({ trial_ends_at: at(-2) }));
    // VF-13: "A free trial is offered once per company" was not literally true. A company still inside its card-free
    // trial is offered a checkout trial too (the rule above), so the Terms speak of the trial started at checkout.
    const sentence = /A trial started at checkout is offered once per company: it is not offered if your company's free trial has already ended or if your company has already had a subscription, and billing then begins when you subscribe/;
    if (refuses) {
      expect(terms).toMatch(sentence);
      expect(read('src/content/claims.ts')).toMatch(/The free trial is offered once per company/);
      expect(read('src/pages/Pricing.tsx')).toMatch(/day free trial, once per company/);
    } else {
      expect(terms, 'the server offers a second trial: remove the sentence').not.toMatch(/offered once per company/);
    }
  });

  it('the Terms do not promise one free trial in all while a company inside its card-free trial can still start one at checkout (VF-13)', () => {
    expect(offered(row({}))).toBe(true);
    expect(terms).not.toMatch(/A free trial is offered once per company/);
  });
});
