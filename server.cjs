const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const {
  summarizeEntries,
  buildTrend,
  toDashboardSummary,
  buildFacilityEmissions,
  normalizeScope,
} = require('./emissions-engine.cjs');
const {
  billingFailureStatus,
  buildSecurityHeaders,
  canUseDevAuth,
  classifyApiFailure,
  resolveAuthorizedCompanyId,
  sanitizeChatState,
  sanitizeConsentDecidedAt,
  sanitizeLeadPayload,
  summarizeCspReports,
} = require('./server-security.cjs');
const {
  billingStateFromCompany,
  checkoutTrialDecision,
  CHECKOUT_TRIAL_DAYS,
  planAccessDecision,
  planFromPriceId,
  priceIdFromEnv,
  resolvePlanPriceId,
  shouldRetryWebhook,
  planLimits,
  canUseScope3,
  subscriptionRecordFromStripe,
  trialEligiblePriceIds,
} = require('./server-billing.cjs');
const { renderReportPdf } = require('./src/lib/reports/report-generator.cjs');
const {
  buildReportSnapshot,
  defaultReportingYear,
  parseReportPeriod,
  reportingPeriodBounds,
} = require('./src/lib/reports/report-snapshot.cjs');
const { createPublishHandler } = require('./server-publish.cjs');
const { blogListExcerpt, blogListReadMinutes, isValidSlug, publicCta, publicLinks } = require('./server-blog-render.cjs');
const { createPages } = require('./server-pages.cjs');
const blogRouteMeta = require('./src/content/route-meta.json');
const { parseRange, getStaticCacheHeaders } = require('./server-http-utils.cjs');
const { createLeadNotifierFromEnv } = require('./server-notify.cjs');
const { toDateOnly } = require('./server-entries.cjs');
const { CATALOG_VERSION } = require('./emission-factors.cjs');
const { DB_ID, createEntryHandlers, insertFacilityWithinCap } = require('./server-entry-routes.cjs');
const { createCsvImportHandlers } = require('./server-csv-import-routes.cjs');
const { prepareCalculatorEntry } = require('./units.cjs');
const { loadServerConfig } = require('./server-config.cjs');
const {
  installAsyncErrorForwarding,
  createErrorHandler,
  createProcessGuards,
  toLogValue,
} = require('./server-errors.cjs');
const { createAccessLog, createClientErrorHandler } = require('./server-observability.cjs');
const { createCompression } = require('./server-compression.cjs');

// The environment, read and checked once (F-G-13): typed values with documented
// defaults, the reported version, and the warnings logged at boot.
const serverConfig = loadServerConfig(process.env);
const { createCompanyHandlers } = require('./server-company-routes.cjs');
const { FACILITY_FIELD_MAX, FACILITY_TYPE_LIST, defaultCompanyName } = require('./server-company.cjs');

// Per-request context for structured logging (INFRA-007): the request-ID
// middleware below runs every handler inside this store, so log() can attach
// the current request id without each call site threading it through. stdlib
// only — no new dependency.
const requestIdStore = new AsyncLocalStorage();

// ─── Version 2.0.1 - Added Cache-Control: no-transform for Cloudflare fix ───

// ─── Public base URL ───
// Every Stripe redirect (checkout success/cancel, billing portal return) is
// built from this. If it is wrong, a customer who has just paid is bounced to a
// dead URL and /api/checkout/verify — the reconciliation that rescues a late
// webhook — never runs. Production boot refuses to start without it rather than
// silently shipping localhost redirects to real buyers.
// See ecoauditor-mvp-readiness-audit-2026-08-20.md ("Config gaps").
const APP_BASE_URL = serverConfig.get('APP_URL');

// ─── Stripe SDK (lazy init) ───
let stripe = null;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    // INFRA-005: bound external calls — 10s timeout per request, up to 2 network
    // retries with exponential backoff (stripe-node built-ins). Prevents
    // unbounded hangs on Stripe API slowness and rides out transient blips.
    stripe = new Stripe(STRIPE_SECRET_KEY, {
      timeout: 10_000,
      maxNetworkRetries: 2,
    });
  } catch (err) {
    // Billing routes then answer 503 "Billing not configured", which reads like a
    // missing key: say why instead of swallowing it (F-G-13).
    log('error', 'Stripe SDK failed to initialise: billing routes answer 503', { error: err });
  }
}

// ─── InsForge auth backend (used by authGuard) ───
const INSFORGE_BASE_URL =
  process.env.INSFORGE_BASE_URL || process.env.VITE_INSFORGE_BASE_URL;

// ─── Postgres: the one data layer (F-G-07) ───
// Every read and write goes to Postgres; there is no in-memory stand-in. Without
// a usable pool (no DATABASE_URL, or one that could not be built), pgPool refuses
// every call the way an unreachable database does, so each route answers the 503
// it gives during an outage, in every environment, and none needs a "no database"
// branch of its own. databaseConfigured only lets /health and /ready tell "not
// configured" apart from "configured but down".
function unconfiguredPool() {
  function refuse() {
    // SQLSTATE 08001: the client could not establish a connection.
    return Promise.reject(Object.assign(new Error('Data store unavailable: no database is configured'), { code: '08001' }));
  }
  return { query: refuse, connect: refuse };
}

// 503 ("retry later") when the data store failed, 500 for anything else. Every
// route that reads or writes the store answers with it, in every environment;
// the routes that also call Stripe use billingFailureStatus (server-security.cjs).
function failureStatus(err) {
  return classifyApiFailure(err).status === 503 ? 503 : 500;
}

let pgPool = unconfiguredPool();
let databaseConfigured = false;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
      // INFRA-D5: stop running on library defaults — bounded size + idle
      // reaping so a leaked client cannot starve the pool, and a server-side
      // statement backstop alongside the client-side query_timeout.
      max: 10,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
    });
    databaseConfigured = true;
    // pg-pool emits 'error' on the pool when an IDLE client fails (DB restart,
    // maintenance, idle timeout). An unhandled EventEmitter 'error' throws,
    // reaches the uncaughtException handler below, and exits the process — so a
    // dropped idle connection would take down the whole server. Log and carry on;
    // the pool discards the broken client and opens a new one on next use.
    pgPool.on('error', function (err) {
      log('error', 'Idle Postgres client error', { error: err });
    });
    // Auto-migrate Railway-owned runtime tables, then seed public blog content.
    pgPool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        target      TEXT NOT NULL,
        topic_id    TEXT NOT NULL,
        title       TEXT NOT NULL,
        meta_title  TEXT NOT NULL,
        meta_description TEXT NOT NULL,
        body_html   TEXT NOT NULL,
        primary_keyword TEXT NOT NULL,
        faq         JSONB NOT NULL DEFAULT '[]'::jsonb,
        internal_links JSONB NOT NULL DEFAULT '[]'::jsonb,
        external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
        cta         JSONB NOT NULL,
        content_score INT,
        geo_score   INT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS blog_posts_target_idx ON blog_posts(target);
      CREATE INDEX IF NOT EXISTS blog_posts_published_at_idx ON blog_posts(published_at DESC);
      -- Same deny-by-default RLS model as every other table (see
      -- initial-schema.sql). blog_posts is the only public-content table with
      -- none, so its exposure depended entirely on the PostgREST role grants
      -- of the moment. No policies: reads/writes go through the Express
      -- server, which connects as the table owner (exempt from non-FORCE RLS)
      -- and authenticates /api/publish with the deploy token.
      ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

      CREATE TABLE IF NOT EXISTS public.consent_records (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        visitor_id TEXT,
        consent JSONB NOT NULL,
        policy_version TEXT NOT NULL,
        method TEXT NOT NULL CHECK (char_length(method) BETWEEN 1 AND 40),
        gpc BOOLEAN NOT NULL DEFAULT false,
        dnt BOOLEAN NOT NULL DEFAULT false,
        user_agent TEXT,
        ip_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        decided_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_consent_records_visitor_id
        ON public.consent_records(visitor_id);
      ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
    `).then(() => pgPool.query('SELECT count(*) FROM blog_posts'))
    .then((r) => {
      if (parseInt(r.rows[0].count) === 0) {
        log('info', 'blog_posts table empty — seeding initial posts');
        return seedBlogPosts(pgPool);
      }
      log('info', 'blog_posts table already has ' + r.rows[0].count + ' rows');
    })
    .then(() => { log('info', 'Runtime table migration + blog seed complete'); })
    .catch((migErr) => {
      log('error', 'Runtime table migration/blog seed failed', { error: migErr });
    });
  } catch (err) {
    // When the constructor throws, the server runs as if no database were
    // configured (/health says ok, every data route 503): say why instead of
    // swallowing it (F-G-13).
    log('error', 'Postgres pool setup failed', { error: err });
  }
}

// ─── Blog seed data (inline so it ships inside the Docker image) ───
// Corrected content (F-A-04, F-R5-01, F-R5-02): the four seed posts used to sell
// features that do not exist (supplier surveys, CBAM data packs, CDP/GRI/TCFD
// exports, DEFRA factors), misstate SB 253 and CBAM, and quote a $49 price.
//
// Editing this does NOT change production. The seed only runs against an EMPTY
// blog_posts table and inserts with ON CONFLICT (slug) DO NOTHING, so the live
// rows keep whatever they were seeded with (that is how the $49 to $149 fix of
// 2026-08-22 never reached the live post). Production is corrected by the owner,
// see docs/runbooks/blog-rows-update.md. Once those rows are fixed, delete this
// function: it is a second source of truth that has already diverged from the
// database once, and tests/blog-seed-claims.test.ts only holds it in line until then.
async function seedBlogPosts(pool) {
  const posts = [
    {
      id: 'eco-sb253-compliance-guide-2026',
      slug: 'sb-253-compliance-guide-smb',
      target: 'ecoauditor',
      topic_id: 'sb253-compliance',
      title: 'SB 253 Compliance Guide for SMBs: A Practical Roadmap',
      meta_title: 'SB 253 Compliance Guide for SMBs | Eco-Auditor',
      meta_description: 'A step-by-step SB 253 compliance roadmap for small and mid-sized businesses. Learn reporting thresholds, scope boundaries, and how to build a defensible GHG inventory.',
      primary_keyword: 'SB 253 compliance SMB',
      body_html: [
        `<h2>What SB 253 Means for Small and Mid-Sized Businesses</h2>`,
        `<p>California's Climate Corporate Data Accountability Act (SB 253) requires companies with more than $1 billion in annual revenue that do business in California to report their greenhouse gas (GHG) emissions. The direct reporting duty sits with those large companies. Its effects reach small and mid-sized businesses (SMBs) through their supply chains.</p>`,
        `<p>If your SMB supplies goods or services to a covered company, you may be asked for emissions data to support that company's own reporting. Building a defensible GHG inventory now puts you ahead of that request, before it becomes a contract requirement.</p>`,
        `<h2>Understanding the Reporting Timeline</h2>`,
        `<p>SB 253 phases in its requirements. The dates below reflect the statute and the California Air Resources Board (CARB) rulemaking as of September 29, 2026, and they are still moving. Check CARB's program page, linked below, for the current dates before you rely on them.</p>`,
        `<ul>`,
        `<li><strong>2026, Scope 1 and Scope 2:</strong> Covered companies report their Scope 1 and Scope 2 emissions. CARB's Initial Regulation sets November 10, 2026 as the first deadline. CARB has adopted that regulation, but as of September 29, 2026 it was still awaiting approval from California's Office of Administrative Law. Scope 3 is not required for 2026 reporting.</li>`,
        `<li><strong>2027 onward, Scope 3:</strong> Scope 3 reporting starts in 2027 on a schedule CARB has not yet set. CARB is developing the requirements for 2027 and later years in a second rulemaking.</li>`,
        `<li><strong>Assurance:</strong> The statute requires limited assurance on Scope 1 and Scope 2 reports beginning in 2026 and reasonable assurance beginning in 2030, and limited assurance on Scope 3 beginning in 2030. For the 2026 cycle, CARB has said it will accept reports whether or not assurance has been obtained.</li>`,
        `</ul>`,
        `<p>As an SMB, you are not directly covered by SB 253. Your larger customers may be, and they may ask for your emissions data through procurement surveys, supplier portals, and ESG questionnaires.</p>`,
        `<h2>Building a Defensible GHG Inventory</h2>`,
        `<p>A defensible GHG inventory is one that can withstand scrutiny from customers, assurance providers, and regulators. The GHG Protocol Corporate Standard provides the accounting framework:</p>`,
        `<ol>`,
        `<li><strong>Define organizational and operational boundaries.</strong> Decide which facilities, vehicles, and activities are included. Use either the equity share or control approach.</li>`,
        `<li><strong>Collect activity data.</strong> Gather utility bills, fuel receipts, purchase records, and freight invoices. The more granular, the better.</li>`,
        `<li><strong>Apply emission factors.</strong> Convert activity data (therms, kWh, gallons, dollars) into CO2e using published factors, such as those from the U.S. EPA (including eGRID for electricity).</li>`,
        `<li><strong>Document your methodology.</strong> Record which factors you used, where the data came from, and any assumptions. Reviewers and assurance providers will ask for this.</li>`,
        `</ol>`,
        `<h2>Scope 3: The Supply Chain Challenge</h2>`,
        `<p>Scope 3 emissions, those in your value chain, are often the largest part of a company's footprint, although the share varies widely by sector. For SMBs, the most relevant Scope 3 categories are usually:</p>`,
        `<ul>`,
        `<li><strong>Category 1: Purchased goods and services.</strong> The emissions embedded in everything you buy, from raw materials to office supplies.</li>`,
        `<li><strong>Category 4: Upstream transportation and distribution.</strong> Freight, shipping, and logistics.</li>`,
        `<li><strong>Category 11: Use of sold products.</strong> Relevant if your products consume energy during their lifetime.</li>`,
        `</ul>`,
        `<p>Start with a spend-based approach for Category 1: multiply purchase dollar amounts by industry-average emission factors. It is less precise than supplier-specific data, but it is a common starting point that you can refine over time.</p>`,
        `<h2>How Eco-Auditor Fits In</h2>`,
        `<p>Eco-Auditor is an emissions calculator for small and mid-sized businesses. It does not file anything with CARB and it does not provide assurance. Today it offers:</p>`,
        `<ul>`,
        `<li><strong>CSV import</strong> of activity data such as fuel, electricity, and spend records.</li>`,
        `<li><strong>Scope 1 and Scope 2 calculations</strong> on every plan, and <strong>Scope 3 calculations</strong> on the Growth and Pro plans. Factors come from the U.S. EPA (including eGRID) with IPCC AR5 global-warming potentials. Some factors, mostly for Scope 3, are Eco-Auditor internal estimates or provisional values, and the Methodology page explains which.</li>`,
        `<li><strong>A PDF emissions summary and a JSON data export</strong> that you can share with a customer who asks for your numbers.</li>`,
        `</ul>`,
        `<p>Not available yet (on the roadmap): supplier data requests, an audit trail of changes, framework-specific report templates, and accounting-software integrations.</p>`,
        `<h2>Key Takeaways</h2>`,
        `<ul>`,
        `<li>SB 253 applies directly to companies with more than $1 billion in revenue that do business in California, not to most SMBs.</li>`,
        `<li>Supply chain requests are the more likely way an SMB will feel SB 253. Start with Scope 1 and Scope 2, which are the easiest to measure and the first thing customers ask about.</li>`,
        `<li>Use spend-based methods for Scope 3 until you can collect supplier-specific data.</li>`,
        `<li>Document everything: a clear methodology matters more than false precision.</li>`,
        `</ul>`,
      ].join(''),
      faq: JSON.stringify([
        { question: 'Does SB 253 apply to small businesses?', answer: `SB 253 directly applies to companies with more than $1 billion in annual revenue that do business in California. Smaller businesses are not directly covered, but customers that are covered may ask them for emissions data to support Scope 3 reporting.` },
        { question: 'What is the deadline for SB 253 reporting?', answer: `CARB's Initial Regulation sets November 10, 2026 as the first deadline, for Scope 1 and Scope 2 emissions. As of September 29, 2026 that regulation was still awaiting approval from California's Office of Administrative Law. Scope 3 reporting is not required for 2026 and starts in 2027 on a schedule CARB has not yet set. Check CARB's program page for current dates.` },
        { question: 'How do I calculate Scope 3 emissions as an SMB?', answer: `Start with a spend-based approach: multiply purchase dollar amounts by industry-average emission factors. This gives you an estimate without requiring supplier-specific data, and you can refine it over time.` },
        { question: 'What emission factors should I use?', answer: `Use recognized published factors, for example U.S. EPA factors for US fuel and activity data and eGRID for electricity. Eco-Auditor uses EPA and eGRID factors with IPCC AR5 global-warming potentials; some factors, mostly for Scope 3, are internal estimates or provisional values, which its Methodology page explains.` },
      ]),
      internal_links: JSON.stringify([
        { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
        { href: 'https://ecoauditor.io/methodology', anchor: 'GHG methodology' },
      ]),
      external_links: JSON.stringify([
        { href: 'https://ghgprotocol.org/corporate-standard', anchor: 'GHG Protocol Corporate Standard' },
        { href: 'https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk', anchor: 'CARB SB 253 program page' },
      ]),
      cta: JSON.stringify({ label: 'Start your free trial', href: '/signup' }),
      content_score: 82,
      geo_score: 74,
    },
    {
      id: 'eco-ghg-protocol-scope3-smb',
      slug: 'ghg-protocol-scope-3-guide-smb',
      target: 'ecoauditor',
      topic_id: 'ghg-scope3-smb',
      title: 'GHG Protocol Scope 3 for SMBs: Where to Start and What to Measure',
      meta_title: 'GHG Protocol Scope 3 Guide for SMBs | Eco-Auditor',
      meta_description: 'A practical guide to GHG Protocol Scope 3 emissions for small and mid-sized businesses. Learn which categories matter, how to measure them, and how to build a defensible inventory.',
      primary_keyword: 'GHG Protocol Scope 3 SMB',
      body_html: [
        `<h2>Why Scope 3 Matters for SMBs</h2>`,
        `<p>Scope 3 emissions, the indirect emissions in your value chain, are often the largest part of a company's total carbon footprint, although the share varies widely by sector. For small and mid-sized businesses, Scope 3 can feel overwhelming because it covers everything from purchased goods to employee commuting. But ignoring it is getting harder.</p>`,
        `<p>Your larger customers may need your emissions data for their own Scope 3 disclosures. California's SB 253, for example, starts requiring Scope 3 reporting from large companies in 2027, on a schedule CARB has not yet set. Investors also increasingly factor carbon exposure into risk assessments. The good news: you do not need to measure all 15 Scope 3 categories to be defensible. You need to measure the ones that matter.</p>`,
        `<h2>The 15 Scope 3 Categories, Ranked for SMBs</h2>`,
        `<p>The GHG Protocol defines 15 Scope 3 categories. For most SMBs, only a handful are material:</p>`,
        `<h3>High priority (measure first)</h3>`,
        `<ul>`,
        `<li><strong>Category 1, Purchased goods and services:</strong> The emissions embedded in everything you buy. Usually the largest Scope 3 category for product-based businesses.</li>`,
        `<li><strong>Category 4, Upstream transportation and distribution:</strong> Freight, shipping, and logistics emissions from moving your inputs.</li>`,
        `<li><strong>Category 11, Use of sold products:</strong> If your products consume energy during use, this can dwarf everything else.</li>`,
        `</ul>`,
        `<h3>Medium priority (estimate when feasible)</h3>`,
        `<ul>`,
        `<li><strong>Category 5, Waste generated in operations:</strong> Use waste contractor data or estimate by waste type and volume.</li>`,
        `<li><strong>Category 6, Business travel:</strong> Flight and hotel data from expense systems.</li>`,
        `<li><strong>Category 7, Employee commuting:</strong> Survey-based or estimated by office size and region.</li>`,
        `</ul>`,
        `<h3>Low priority (screen and skip if immaterial)</h3>`,
        `<ul>`,
        `<li><strong>Categories 2, 3, 8, 9, 10, 12, 13, 14, 15:</strong> For most SMBs, these are either zero, negligible, or not applicable. Document that you screened them and explain why they are immaterial.</li>`,
        `</ul>`,
        `<h2>How to Measure Scope 3 Without a Sustainability Team</h2>`,
        `<p>You do not need a dedicated sustainability team to build a credible Scope 3 inventory. Here is the practical path:</p>`,
        `<ol>`,
        `<li><strong>Start with spend data.</strong> Export your accounts payable ledger and categorize purchases by industry sector. Multiply each category by a spend-based emission factor, such as the U.S. EPA's supply chain emission factors.</li>`,
        `<li><strong>Pull freight records.</strong> Your shipping invoices contain mode, distance, and weight. Apply the EPA SmartWay factors to estimate Category 4.</li>`,
        `<li><strong>Estimate product use.</strong> If you sell physical products that consume energy, estimate lifetime energy consumption and multiply by the grid emission factor.</li>`,
        `<li><strong>Document what you skipped and why.</strong> A screening explanation for the categories you did not measure is itself part of a defensible inventory.</li>`,
        `</ol>`,
        `<h2>Building a Defensible Methodology</h2>`,
        `<p>Defensibility means your numbers can survive external review. Three principles:</p>`,
        `<ul>`,
        `<li><strong>Traceability:</strong> Every number should link back to a source document.</li>`,
        `<li><strong>Consistency:</strong> Use the same emission factors and boundary definitions year over year.</li>`,
        `<li><strong>Transparency:</strong> Document your assumptions, exclusions, and estimation methods.</li>`,
        `</ul>`,
        `<h2>What Eco-Auditor Does for Scope 3 Today</h2>`,
        `<p>Scope 3 workflows are included on the Growth and Pro plans. The Starter plan covers Scope 1 and Scope 2 only. Today they offer:</p>`,
        `<ul>`,
        `<li><strong>Spend-based estimates:</strong> import purchase spend by category through a CSV file and get CO2e estimates for purchased goods and services.</li>`,
        `<li><strong>Activity-based estimates for some other categories,</strong> such as transportation, business travel, employee commuting, and waste.</li>`,
        `<li><strong>Clear labels on estimates:</strong> some Scope 3 factors are Eco-Auditor internal estimates rather than published datasets, and the Methodology page explains which.</li>`,
        `</ul>`,
        `<p>Not available yet (on the roadmap): supplier data requests, Scope 3 screening templates, framework-specific export formats, and accounting-software integrations.</p>`,
        `<h2>Key Takeaways</h2>`,
        `<ul>`,
        `<li>You do not need to measure all 15 Scope 3 categories. Focus on the 3-5 that are material to your business.</li>`,
        `<li>Spend-based methods are a common starting point for Category 1. Refine with supplier-specific data over time.</li>`,
        `<li>Documentation and screening explanations are part of a defensible inventory, not optional extras.</li>`,
        `<li>Start now. Your larger customers may already be asking for this data.</li>`,
        `</ul>`,
      ].join(''),
      faq: JSON.stringify([
        { question: 'Which Scope 3 categories should an SMB measure first?', answer: `Start with Category 1 (purchased goods and services), Category 4 (upstream transportation), and Category 11 (use of sold products). These typically represent the largest share of Scope 3 emissions for SMBs.` },
        { question: 'Is spend-based Scope 3 reporting defensible?', answer: `Yes, as an estimate. The GHG Protocol's Scope 3 guidance describes spend-based methods as an accepted way to estimate Category 1. They are less precise than supplier-specific data, so document your data sources, emission factors, and assumptions, and refine them over time.` },
        { question: 'How do I screen Scope 3 categories I decide not to measure?', answer: `Document which categories you assessed, why they are immaterial, and keep this screening explanation as part of your inventory. This is standard GHG Protocol practice.` },
        { question: 'Do I need third-party assurance for Scope 3?', answer: `Under SB 253, limited assurance on Scope 3 reporting begins in 2030 for covered companies, meaning those with more than $1 billion in revenue that do business in California. Smaller businesses are not directly subject to it, but clear documentation makes any customer's review easier.` },
      ]),
      internal_links: JSON.stringify([
        { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
        { href: 'https://ecoauditor.io/pricing', anchor: 'Eco-Auditor pricing' },
      ]),
      external_links: JSON.stringify([
        { href: 'https://ghgprotocol.org/corporate-value-chain-scope-3-standard', anchor: 'GHG Protocol Scope 3 Standard' },
        { href: 'https://www.epa.gov/climateleadership/scope-3-inventory-guidance', anchor: 'EPA Scope 3 guidance' },
      ]),
      cta: JSON.stringify({ label: 'Start your free trial', href: '/signup' }),
      content_score: 84,
      geo_score: 76,
    },
    {
      id: 'eco-carbon-accounting-software-smb',
      slug: 'carbon-accounting-software-smb-guide',
      target: 'ecoauditor',
      topic_id: 'carbon-accounting-smb',
      title: 'Carbon Accounting Software for SMBs: What to Look For in 2026',
      meta_title: 'Carbon Accounting Software for SMBs (2026 Guide) | Eco-Auditor',
      meta_description: 'A buyer\'s guide to carbon accounting software for small and mid-sized businesses. Compare features, pricing models, and must-have capabilities for 2026 compliance.',
      primary_keyword: 'carbon accounting software SMB',
      body_html: [
        `<h2>Why SMBs Need Carbon Accounting Software Now</h2>`,
        `<p>Carbon accounting used to be a spreadsheet exercise managed by an external consultant once a year. In 2026, that approach is harder to justify. Larger customers covered by California's SB 253, and importers subject to the EU's CBAM, may ask their suppliers for emissions data, and they expect numbers that are documented and repeatable.</p>`,
        `<p>For SMBs, the challenge is finding software that fits your budget and team size without sacrificing the rigor that customers expect. Here is what to look for.</p>`,
        `<h2>Must-Have Features for SMB Carbon Accounting</h2>`,
        `<h3>1. Published emission factor libraries</h3>`,
        `<p>Your software should ship with emission factors from recognized sources such as the U.S. EPA and eGRID, so you do not have to research and enter them manually. Factors should be versioned and sourced, with the year shown for every number, and reviewed on a regular schedule.</p>`,
        `<h3>2. Scope 1, 2, and 3 support</h3>`,
        `<p>Many tools handle Scope 1 and 2 well but treat Scope 3 as an afterthought. For SMBs in the supply chains of large companies, Scope 3 is where the scrutiny is. Look for spend-based Category 1 calculation and clear labeling of which factors are estimates.</p>`,
        `<h3>3. Audit-ready documentation</h3>`,
        `<p>Every calculation should be traceable to its source data and emission factor. Look for audit trails that record who entered data, when it was modified, and which factors were applied.</p>`,
        `<h3>4. Customer-ready reporting</h3>`,
        `<p>Can the tool export what your customers ask for? Some ask for a simple PDF or spreadsheet, others for CDP responses or custom supplier questionnaires. Check which formats the tool actually supports before you buy.</p>`,
        `<h3>5. Supply chain survey tools</h3>`,
        `<p>The best way to improve Scope 3 data quality is to collect primary data from your suppliers. Some tools let you send suppliers a survey link and calculate their contributions. Check whether the feature is available today or only planned.</p>`,
        `<h2>Pricing Models: What Makes Sense for SMBs</h2>`,
        `<ul>`,
        `<li><strong>Per-facility pricing:</strong> Charged based on the number of facilities. Gets expensive for distributed operations.</li>`,
        `<li><strong>Per-user pricing:</strong> Charged per seat. Best for teams where only a few people need access.</li>`,
        `<li><strong>Tiered plans:</strong> Fixed monthly or annual price with feature gates. Best for SMBs: predictable cost, no surprises.</li>`,
        `</ul>`,
        `<p>Eco-Auditor uses tiered plans, billed monthly: Starter at $149/month (Scope 1 and 2 only, 1 facility, 10 CSV imports a month), Growth at $399/month (adds Scope 3, up to 5 facilities, unlimited CSV imports), and Pro at $999/month (unlimited facilities). Annual billing is also available. Compare plans on their limits as well as their price.</p>`,
        `<h2>Red Flags to Watch For</h2>`,
        `<ul>`,
        `<li><strong>"AI-generated" emission estimates with no methodology:</strong> If a tool gives you a carbon number without showing the underlying factors, it is not defensible.</li>`,
        `<li><strong>No Scope 3 support:</strong> Tools that only cover Scope 1 and 2 leave you unprepared for supply chain reporting requests.</li>`,
        `<li><strong>Unversioned or undated factors:</strong> If a tool does not show which factor set and year it used, you cannot reproduce or defend the number.</li>`,
        `<li><strong>No data export:</strong> If you cannot export your raw data, you are locked in.</li>`,
        `</ul>`,
        `<h2>The Spreadsheet Question</h2>`,
        `<p>Many SMBs start with Excel. That is fine for a first-pass estimate, but spreadsheets break down fast: no version control on emission factors, no audit trail, no validation, no factor updates. If you are spending more than two hours a month maintaining a carbon spreadsheet, it is worth evaluating dedicated software.</p>`,
        `<h2>How Eco-Auditor Compares</h2>`,
        `<p>Use the checklist above on us too. Here is where Eco-Auditor stands today:</p>`,
        `<ul>`,
        `<li><strong>Emission factors:</strong> U.S. EPA factors (including eGRID) with IPCC AR5 global-warming potentials. Some factors, mostly for Scope 3, are internal estimates or provisional values, and the Methodology page explains which.</li>`,
        `<li><strong>Scopes:</strong> Scope 1 and 2 on every plan, Scope 3 on Growth and Pro.</li>`,
        `<li><strong>Outputs:</strong> A PDF emissions summary and a JSON data export.</li>`,
        `<li><strong>Pricing:</strong> Starter at $149/month, Growth at $399/month, Pro at $999/month, with plans capped at 1 facility, 5 facilities, and unlimited facilities.</li>`,
        `<li><strong>Not available yet (on the roadmap):</strong> an audit trail, supplier surveys, framework-specific exports such as CDP or GRI, and accounting-software integrations.</li>`,
        `</ul>`,
        `<h2>Key Takeaways</h2>`,
        `<ul>`,
        `<li>Carbon accounting software is worth evaluating for SMBs in supply chains where customers ask for emissions data.</li>`,
        `<li>Look for published emission factors, Scope 3 support, an audit trail, and the reporting formats your customers actually ask for.</li>`,
        `<li>Avoid tools with opaque estimates, no Scope 3, or no data export.</li>`,
        `<li>Compare plans on their limits (facilities, scopes, imports) as well as their monthly price.</li>`,
        `</ul>`,
      ].join(''),
      faq: JSON.stringify([
        { question: 'How much does carbon accounting software cost for an SMB?', answer: `Prices vary widely between vendors and depend on how many facilities and scopes you need, so compare limits as well as price. Eco-Auditor plans are Starter at $149/month, Growth at $399/month, and Pro at $999/month, billed monthly, with plans capped at 1 facility, 5 facilities, and unlimited facilities.` },
        { question: 'Can I use Excel for carbon accounting?', answer: `Excel works for a first-pass estimate but breaks down due to lack of version control, audit trails, emission factor updates, and validation. Dedicated software saves time and reduces errors.` },
        { question: 'What emission factors should carbon accounting software include?', answer: `Look for factors from recognized sources such as the U.S. EPA and eGRID. They should be versioned and sourced, with the year shown for every number.` },
        { question: 'Do SMBs need Scope 3 reporting software?', answer: `Often, yes. Customers in regulated supply chains increasingly ask their suppliers for Scope 3 data. Look for software with spend-based Category 1 calculation and clear labeling of which factors are estimates.` },
      ]),
      internal_links: JSON.stringify([
        { href: 'https://ecoauditor.io/pricing', anchor: 'Eco-Auditor pricing' },
        { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
      ]),
      external_links: JSON.stringify([
        { href: 'https://ghgprotocol.org/', anchor: 'GHG Protocol' },
        { href: 'https://www.epa.gov/climateleadership', anchor: 'EPA Climate Leadership' },
      ]),
      cta: JSON.stringify({ label: 'Start your free trial', href: '/signup' }),
      content_score: 80,
      geo_score: 72,
    },
    {
      id: 'eco-cbam-supply-chain-smb',
      slug: 'cbam-supply-chain-guide-smb',
      target: 'ecoauditor',
      topic_id: 'cbam-smb',
      title: 'CBAM and Supply Chain Emissions: What SMBs Need to Know',
      meta_title: 'CBAM Supply Chain Emissions Guide for SMBs | Eco-Auditor',
      meta_description: 'How the EU Carbon Border Adjustment Mechanism affects SMBs in US supply chains. Learn CBAM reporting requirements, embedded emissions, and how to prepare.',
      primary_keyword: 'CBAM supply chain emissions SMB',
      body_html: [
        `<h2>What Is CBAM and Why Should SMBs Care?</h2>`,
        `<p>The EU Carbon Border Adjustment Mechanism (CBAM) puts a carbon price on certain goods imported into the European Union. It covers six sectors: cement, iron and steel, aluminium, fertilisers, hydrogen, and electricity. EU importers of those goods must report the emissions embedded in them and, from 2027, buy CBAM certificates to cover those emissions.</p>`,
        `<p>CBAM obligations fall on the importer. Importers must be authorised CBAM declarants, although importers bringing in less than 50 tonnes of CBAM goods a year (other than hydrogen and electricity) are exempt. If your SMB is a non-EU producer, you are not directly subject to CBAM. If you supply CBAM goods to EU customers, though, they may ask you for emissions data so that they can declare actual values instead of default values.</p>`,
        `<h2>CBAM Timeline: What Is Happening and When</h2>`,
        `<ul>`,
        `<li><strong>October 2023 to December 2025 (transitional period):</strong> Importers filed periodic reports of embedded emissions, with no financial obligation.</li>`,
        `<li><strong>From 1 January 2026 (definitive period):</strong> Importers must be authorised CBAM declarants, and the financial obligation applies to goods imported from this date.</li>`,
        `<li><strong>From 1 February 2027:</strong> CBAM certificate sales begin. The first annual CBAM declaration, together with the surrender of certificates for 2026 imports, is due by 30 September 2027.</li>`,
        `<li><strong>2026 to 2034:</strong> Free EU ETS allowances are phased out, so the CBAM adjustment applies to a growing share of embedded emissions.</li>`,
        `</ul>`,
        `<p>For SMB suppliers, the practical impact is that EU customers will want data they can rely on. The Commission's default values include a mark-up, so using verified actual data is usually more advantageous for them than falling back on defaults.</p>`,
        `<h2>Understanding Embedded Emissions</h2>`,
        `<p>CBAM focuses on embedded emissions, the greenhouse gases released while producing a good. What counts depends on the sector:</p>`,
        `<ul>`,
        `<li><strong>Direct emissions</strong> from the production process, including the production of heating and cooling, count for every CBAM good.</li>`,
        `<li><strong>Indirect emissions</strong> from the electricity consumed in production count only for cement and fertilisers (and agglomerated iron ore). For iron and steel, aluminium, and hydrogen, only direct emissions count.</li>`,
        `<li><strong>Precursors:</strong> For complex goods, the embedded emissions of relevant precursor materials, for example cement clinker in cement, are included.</li>`,
        `</ul>`,
        `<p>CBAM's boundary is specific to an installation and a product, so it is narrower than a full GHG inventory. It does not cover company-wide items such as employee commuting or business travel. CBAM also has its own calculation rules: for example, emission factors from life-cycle-assessment databases are not accepted for calculating embedded emissions.</p>`,
        `<h2>How to Calculate Embedded Emissions for CBAM</h2>`,
        `<ol>`,
        `<li><strong>Identify CBAM goods.</strong> Determine which of your products fall under the CBAM sectors. Customs (CN) codes and product descriptions determine coverage.</li>`,
        `<li><strong>Map your installation.</strong> Document which processes, equipment, and emission sources belong to the production of each CBAM good.</li>`,
        `<li><strong>Attribute emissions to production processes.</strong> If an installation runs several production processes, the EU sets rules for attributing shared inputs and emissions to each one (Annex III to Implementing Regulation (EU) 2025/2547). Follow those rules rather than choosing your own allocation method.</li>`,
        `<li><strong>Calculate the specific embedded emissions.</strong> Express the emissions per tonne of product using the methodology in the EU implementing rules, and keep the data ready for review by an accredited verifier.</li>`,
        `</ol>`,
        `<h2>What Your EU Customers Will Ask For</h2>`,
        `<p>EU importers submit an annual CBAM declaration. To complete it with actual values, they typically need from you:</p>`,
        `<ul>`,
        `<li>The total quantity of goods supplied (in tonnes)</li>`,
        `<li>The specific embedded emissions per tonne</li>`,
        `<li>The production installation's name, address, and country</li>`,
        `<li>The electricity emission factor used in production, where it is relevant to the goods (cement and fertilisers)</li>`,
        `<li>A description of the production process and system boundary</li>`,
        `</ul>`,
        `<p>If you cannot provide this data, your EU customer has to use the Commission's default values, which include a mark-up and are usually less favourable than verified actual data.</p>`,
        `<h2>How to Prepare as an SMB</h2>`,
        `<ol>`,
        `<li><strong>Audit your product portfolio.</strong> Identify any products in CBAM sectors and check their customs codes.</li>`,
        `<li><strong>Map your installation boundary.</strong> Document which processes and equipment produce CBAM goods.</li>`,
        `<li><strong>Start tracking production-specific energy use.</strong> Record electricity and fuel use for the lines that make CBAM goods.</li>`,
        `<li><strong>Ask your EU customers what they need.</strong> They must follow the EU rules when they declare, so ask which format and method they require.</li>`,
        `<li><strong>Prepare a standard data sheet.</strong> Keep one document you can send to any EU customer.</li>`,
        `</ol>`,
        `<h2>What Eco-Auditor Does and Does Not Do for CBAM</h2>`,
        `<p>Eco-Auditor is not a CBAM tool. It does not calculate CBAM embedded emissions, attribute emissions to products, or produce CBAM declarations or reports, and its emission factors are U.S. EPA based, with no EU grid factors. For CBAM data, use your customer's template or a CBAM-specific tool.</p>`,
        `<p>What it can do is help you keep a company-level GHG inventory from fuel, electricity, and spend records: CSV import, Scope 1 and Scope 2 calculations on every plan, and Scope 3 on the Growth and Pro plans, plus a PDF emissions summary.</p>`,
        `<h2>Key Takeaways</h2>`,
        `<ul>`,
        `<li>CBAM obligations sit with EU importers. Non-EU suppliers are not directly subject to CBAM, but their EU customers may ask them for installation-level emissions data.</li>`,
        `<li>CBAM's boundary is set by its own rules: direct emissions for every good, electricity only for cement and fertilisers, and including relevant precursors.</li>`,
        `<li>Without verified actual data, your customers must use default values that include a mark-up.</li>`,
        `<li>Start early: mapping an installation and collecting production-specific data takes time.</li>`,
        `</ul>`,
      ].join(''),
      faq: JSON.stringify([
        { question: 'Does CBAM apply to small businesses?', answer: `CBAM obligations fall on EU importers of covered goods, who must be authorised CBAM declarants. Importers bringing in less than 50 tonnes a year of covered goods (other than hydrogen and electricity) are exempt. A small non-EU supplier is not directly subject to CBAM, but its EU customers may ask it for emissions data for the goods it supplies.` },
        { question: 'What is the difference between CBAM embedded emissions and Scope 3 emissions?', answer: `CBAM embedded emissions are the emissions from producing a specific good: direct emissions for every CBAM good, plus indirect emissions from electricity for cement and fertilisers, including the embedded emissions of relevant precursor materials. Scope 3 covers value chain emissions for a whole company. CBAM's boundary is specific to an installation and a product.` },
        { question: 'When does CBAM start charging for emissions?', answer: `The transitional period (reporting only) ran from October 2023 to December 2025. The definitive period began on 1 January 2026, so importers' financial obligation applies to goods imported from that date. CBAM certificates go on sale from 1 February 2027, and the first annual declaration and certificate surrender is due by 30 September 2027.` },
        { question: 'How are emissions attributed to products?', answer: `If an installation has several production processes, CBAM sets rules for attributing shared inputs and emissions to each process and product (Annex III to Implementing Regulation (EU) 2025/2547). Follow those rules and your customer's template rather than choosing your own allocation method, and document how you applied them.` },
      ]),
      internal_links: JSON.stringify([
        { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
        { href: 'https://ecoauditor.io/methodology', anchor: 'GHG methodology' },
      ]),
      external_links: JSON.stringify([
        { href: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en', anchor: 'EU CBAM official page' },
        { href: 'https://ghgprotocol.org/corporate-standard', anchor: 'GHG Protocol Corporate Standard' },
      ]),
      cta: JSON.stringify({ label: 'Start your free trial', href: '/signup' }),
      content_score: 81,
      geo_score: 73,
    },
  ];

  for (const p of posts) {
    await pool.query(
      `INSERT INTO blog_posts (id, slug, target, topic_id, title, meta_title, meta_description, body_html, primary_keyword, faq, internal_links, external_links, cta, content_score, geo_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (slug) DO NOTHING`,
      [p.id, p.slug, p.target, p.topic_id, p.title, p.meta_title, p.meta_description, p.body_html, p.primary_keyword, p.faq, p.internal_links, p.external_links, p.cta, p.content_score, p.geo_score]
    );
  }
  log('info', 'seeded ' + posts.length + ' blog posts');
}

const emissionsSummaryCache = new Map();

// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage app APIs use bearer Authorization headers, not ambient cookie auth.
const app = express();
// Before any handler is registered (F-G-06): from here on every handler added
// through app.get/post/put/patch/delete/all/use or app.route() has a rejected
// promise passed to next(err), and so to the terminal error handler at the end
// of this file. A new async route needs no try/catch to keep the process alive.
installAsyncErrorForwarding(app);
// Express advertises itself in an X-Powered-By header on every response,
// including errors and static files. It helps nobody but someone fingerprinting
// the framework (F-D-02).
app.disable('x-powered-by');
const PORT = process.env.PORT;

if (!PORT) {
  console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), message: 'PORT environment variable is required' }));
  process.exit(1);
}

if (canUseDevAuth(process.env)) {
  log('warn', 'Dev auth is enabled. This must NEVER be used in production.');
}

// ─── Trust proxy for correct client IP behind Railway/Cloudflare ───
// Railway terminates TLS and forwards X-Forwarded-For; without this,
// req.ip resolves to the proxy IP and rate limiting collapses all users.
//
// A fixed hop count of 1 was not enough: Cloudflare fronts the Railway edge,
// and Railway can add a second hop from its private 100.64.0.0/10 range. With
// hop-count 1 req.ip then resolved to that internal hop, collapsing every rate
// limiter and the consent IP hash onto one shared key for all visitors. Trust
// hop 0 (the socket peer — exactly what `1` did) plus any further hop inside
// 100.64.0.0/10; a public client can never legitimately present such an
// address, so this only ever adds hops, never trusts a client-supplied one.
// Cloudflare's own egress hop is deliberately NOT trusted: the Railway origin
// is reachable directly, so honouring CF ranges would let a direct client forge
// its address. Behind CF, req.ip is therefore the CF colo egress (per-colo
// rate-limit keys), which is the same as before this change.
const RAILWAY_PRIVATE_HOP = /^(?:::ffff:)?100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./;
app.set('trust proxy', function (addr, hop) {
  return hop === 0 || RAILWAY_PRIVATE_HOP.test(String(addr));
});

// ─── Request IDs (INFRA-007/INFRA-001 minimal) ───
// Every request gets a correlation id, echoed as X-Request-Id and attached to
// the structured log lines emitted while that request is in flight (log()
// reads requestIdStore, so handlers don't have to thread the id through every
// call). Support tickets and Railway log streams can then join one request's
// interleaved JSON lines instead of timestamp-juggling.
app.use(function (req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  requestIdStore.run(req.requestId, function () { next(); });
});

// ─── Access log (F-G-08) ───
// One JSON line per request when it finishes: method, route pattern, status,
// duration, request id, opaque user/company id. Never the URL, query, body, IP,
// user agent or email (the field allowlist is in server-observability.cjs).
app.use(createAccessLog({ log: log }));

// ─── Response compression ───
// gzip for text payloads, stdlib zlib, no dependency. Accept-Encoding q-values,
// backpressure and zlib errors are handled in server-compression.cjs (F-G-18).
app.use(createCompression({ log: log }));

// ─── Security headers ───
// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage app APIs use bearer Authorization headers, not ambient cookie auth.
app.use(function (_req, res, next) {
  const headers = buildSecurityHeaders({
    hsts: serverConfig.isProduction || serverConfig.get('FORCE_HSTS'),
  });
  Object.keys(headers).forEach(function (name) {
    res.setHeader(name, headers[name]);
  });
  next();
});

// ─── Rate limiting (sliding window, in-memory) ───
const rateLimitWindowMs = 60_000;
const rateLimitMax = 120;
const rateLimitStore = new Map();

// Resolves client IP for rate limiting and consent auditing.
// When the immediate TCP peer is a public address (neither loopback, private RFC 1918,
// nor Railway CGNAT 100.64.0.0/10), there is no trusted reverse proxy in the chain, so
// any X-Forwarded-For header is attacker-supplied. In that case we must use the socket's
// actual remoteAddress so direct callers cannot spoof arbitrary rate-limit keys (CWE-345).
const INTERNAL_PEER_PATTERN = /^(?:::ffff:)?(?:127\.|10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|::1$|fe80:)/i;

// ─── Cloudflare egress detection (SC-01/SC-02, audit run 20260917-a520) ───
// The Railway origin (*.up.railway.app) is directly reachable, and on Railway
// the container's TCP peer is ALWAYS the internal edge hop — including for
// direct-to-origin requests that bypass Cloudflare. Client-supplied headers
// (cf-connecting-ip, x-forwarded-for) are therefore forgeable on every
// request. A request may only claim a Cloudflare-resolved client address when
// the proxy chain itself carries a Cloudflare egress address. Ranges are the
// official published list, https://www.cloudflare.com/ips/ (retrieved 2026-09-17).
const CLOUDFLARE_EGRESS_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_EGRESS_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

// Parses an IPv4/IPv6 literal to a BigInt (IPv4-mapped IPv6 collapses to IPv4).
// Self-contained so the resolveClientIp unit tests can evaluate this whole
// block in isolation (tests/server.test.ts runs it through runInNewContext).
function parseIpBigInt(input) {
  let s = String(input || '').trim().toLowerCase();
  if (s.startsWith('::ffff:') && s.indexOf('.') !== -1) s = s.slice(7);
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
    const parts = s.split('.').map(Number);
    if (parts.some(function (p) { return p > 255; })) return null;
    let v = 0n;
    for (const p of parts) v = (v << 8n) | BigInt(p);
    return { family: 4, value: v };
  }
  if (s.indexOf(':') === -1) return null;
  // Expand '::' exactly once; an embedded IPv4 tail becomes two hextets.
  const dblColon = s.indexOf('::');
  if (dblColon !== -1 && s.indexOf('::', dblColon + 1) !== -1) return null;
  let head = s, tail = '';
  if (dblColon !== -1) {
    head = s.slice(0, dblColon);
    tail = s.slice(dblColon + 2);
  }
  let groups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  if (tailGroups.length && tailGroups[tailGroups.length - 1].indexOf('.') !== -1) {
    const v4 = parseIpBigInt(tailGroups.pop());
    if (!v4 || v4.family !== 4) return null;
    const hi = Number((v4.value >> 16n) & 0xffffn);
    const lo = Number(v4.value & 0xffffn);
    tailGroups.splice(tailGroups.length - 1, 1, hi.toString(16), lo.toString(16));
  }
  if (dblColon !== -1) {
    const missing = 8 - (groups.length + tailGroups.length);
    if (missing < 0) return null;
    groups = groups.concat(Array(missing).fill('0'), tailGroups);
  } else {
    groups = groups.concat(tailGroups);
  }
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return { family: 6, value: v };
}

function isPlainIp(addr) {
  return parseIpBigInt(addr) !== null;
}

function isCloudflareEgress(addr) {
  const parsed = parseIpBigInt(addr);
  if (!parsed) return false;
  if (parsed.family === 4) {
    for (const cidr of CLOUDFLARE_EGRESS_V4) {
      const [net, bitsRaw] = cidr.split('/');
      const bits = Number(bitsRaw);
      const base = parseIpBigInt(net);
      if (!base) continue;
      if ((parsed.value >> (32n - BigInt(bits))) === (base.value >> (32n - BigInt(bits)))) return true;
    }
    return false;
  }
  for (const cidr of CLOUDFLARE_EGRESS_V6) {
    const [net, bitsRaw] = cidr.split('/');
    const bits = Number(bitsRaw);
    const base = parseIpBigInt(net);
    if (!base) continue;
    if ((parsed.value >> (128n - BigInt(bits))) === (base.value >> (128n - BigInt(bits)))) return true;
  }
  return false;
}

function resolveClientIp(req) {
  const socketAddr = (req.socket && req.socket.remoteAddress) || '';
  if (socketAddr && !INTERNAL_PEER_PATTERN.test(socketAddr)) {
    if (!isCloudflareEgress(socketAddr)) return socketAddr;
    // A Cloudflare egress address as the socket peer means CF connected
    // directly to the origin, so cf-connecting-ip is authoritative (PERF-001
    // per-client keys). Anything else public is an unproxied caller.
    const cfRaw = (req.headers && typeof req.headers['cf-connecting-ip'] === 'string')
      ? req.headers['cf-connecting-ip']
      : '';
    const candidate = cfRaw ? cfRaw.split(',')[0].trim() : '';
    return candidate && isPlainIp(candidate) ? candidate : socketAddr;
  }
  // The socket peer is INTERNAL (loopback, private, or Railway's 100.64.0.0/10
  // edge hop) — on Railway that is EVERY request, including direct-to-origin
  // hits on the public *.up.railway.app domain. Client-supplied headers are
  // therefore forgeable here and can never be trusted on their own (SC-01).
  const headers = (req && req.headers) || {};
  const xff = typeof headers['x-forwarded-for'] === 'string' ? headers['x-forwarded-for'] : '';
  const entries = xff.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  // The RIGHTMOST XFF entry is the address the nearest proxy (the Railway
  // edge) appended — the only entry in the chain the client cannot choose.
  // An attacker's forged entries always sit to its LEFT (the proxy appends
  // the real connecting address after them) and are never consulted (SC-02).
  const rightmost = entries.length ? entries[entries.length - 1] : '';
  if (rightmost && isCloudflareEgress(rightmost)) {
    // Proven Cloudflare transit: CF sets cf-connecting-ip on every request it
    // proxies, so it carries the real per-client address (PERF-001).
    const cfRaw = typeof headers['cf-connecting-ip'] === 'string' ? headers['cf-connecting-ip'] : '';
    const candidate = cfRaw ? cfRaw.split(',')[0].trim() : '';
    if (candidate && isPlainIp(candidate)) return candidate;
    return rightmost;
  }
  if (rightmost && isPlainIp(rightmost)) {
    // No Cloudflare hop: the appended entry is the direct caller's real
    // address. A forged cf-connecting-ip must never mint a rate-limit key.
    return rightmost;
  }
  // Fail closed: nothing in the chain we can attribute — key on the socket
  // peer so an attacker can at worst share one bucket, never mint new keys.
  return socketAddr || 'unknown';
}

app.use(function (req, res, next) {
  // Only meter the API surface (PERF-001). Static assets and prerendered HTML
  // are served by express.static below and used to drain the same per-IP
  // bucket, so a single marketing page load (10+ asset requests) could burn a
  // visitor's whole budget and 429 their next genuine API call. The catch-all
  // JSON 404 for unknown /api routes is still metered via the prefix.
  if (!req.path.startsWith('/api/')) return next();

  // Stripe delivers every webhook for the account from a small pool of egress
  // IPs, so a burst (>120/min during a billing run or a retry backlog) would
  // trip this shared per-IP limiter and 429 signed, already-authenticated
  // deliveries — which Stripe records as failures and retries, amplifying the
  // backlog. The webhook route verifies its own signature and Stripe paces its
  // own retries, so exempt it.
  if (req.path === '/api/webhook') return next();

  // GET /api/video streams the marketing video in Range chunks: one home page
  // view issues about three 206 requests, so it drained the same per-IP budget
  // that static assets used to (PERF-001). Behind a shared IP, ~40 home views a
  // minute would 429 chat, consent and leads for everyone on that IP (F-X1-05).
  // It serves one public file and reads no visitor data.
  if (req.path === '/api/video') return next();

  // CSP violation reports come from the browser, not from a visitor's action: a
  // policy that blocks something on every page would otherwise spend the same
  // per-IP budget as chat, consent and leads and 429 them. The route has its own,
  // tighter limit (F-F-07).
  if (req.path === '/api/csp-report') return next();

  // Same for browser error reports (F-G-08): a page that crashes must not spend
  // the visitor's API budget and 429 the calls that could still work. The route
  // has its own, tighter limit.
  if (req.path === '/api/client-error') return next();

  // Key on resolveClientIp(req): the real client behind Cloudflare
  // (cf-connecting-ip over the internal proxy hop), the socket address on
  // direct connections, and never a client-supplied header on direct hits.
  const key = resolveClientIp(req);
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > rateLimitWindowMs) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > rateLimitMax) {
    const retryAfter = Math.ceil((rateLimitWindowMs - (now - entry.windowStart)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests', retryAfter });
  }
  next();
});

// Periodically prune stale rate limit entries
setInterval(function () {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > rateLimitWindowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}, 120_000);

// Per-route rate limiter (tighter than the global one) for sensitive public
// endpoints. Keyed on resolveClientIp(req), with its own store pruned on access.
function perRouteRateLimit(max, windowMs, keyOf) {
  const store = new Map();
  return function (req, res, next) {
    const key = keyOf ? keyOf(req) : resolveClientIp(req);
    const now = Date.now();
    const entry = store.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      // Opportunistic prune to bound memory.
      if (store.size > 5000) {
        for (const [k, e] of store) {
          if (now - e.windowStart > windowMs) store.delete(k);
        }
      }
      store.set(key, { windowStart: now, count: 1 });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests', retryAfter });
    }
    return next();
  };
}
const consentRateLimit = perRouteRateLimit(10, 60_000);
const leadsRateLimit = perRouteRateLimit(5, 10 * 60 * 1000);
const chatRateLimit = perRouteRateLimit(10, 60_000);
const reportLimits = require('./src/lib/reports/report-limits.cjs').createReportLimits(perRouteRateLimit);

// package.json's version; APP_VERSION overrides it only when it is valid semver
// and not older (F-O-01: a stale APP_VERSION=1.0.0 on Railway was reported for a
// 2.0.0 build). See server-config.cjs.
const APP_VERSION = serverConfig.appVersion;

// ─── Version endpoint ───
// The version and nothing else (D-10): the build sha is on /api/health, and a
// timestamp told a caller nothing but the server clock.
app.get('/api/version', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ version: APP_VERSION });
});

// ─── Health check: status + build SHA (AF-2) ───
// Build SHA self-report + no-store caching. The SHA is injected by the
// platform at build/deploy time (Railway: RAILWAY_GIT_COMMIT_SHA; generic CI:
// GIT_SHA; read once in server-config.cjs). null is a signal that
// the deploy pipeline isn't wiring the SHA — fix that before trusting
// gate-13 AC-P0-1 (F1) SHA-equality checks.
function buildSha() {
  return serverConfig.buildSha;
}

async function probeDatabase() {
  if (!databaseConfigured) return { ok: false, configured: false };
  try {
    await pgPool.query('SELECT 1');
    return { ok: true, configured: true };
  } catch (err) {
    log('error', 'Database health probe failed', { error: err });
    return { ok: false, configured: true };
  }
}

// Anonymous callers get the status and the build SHA and nothing else (F-D-03).
// The SHA stays: deploy verification compares it with the commit that was meant
// to ship. Uptime (it reveals restart times), the app version and per-dependency
// detail only help someone fingerprinting the service. The database state is
// still visible where it belongs: in the 200/503 status code (the Dockerfile
// HEALTHCHECK and external monitors key on that, not on the body), here and on /ready.
async function healthPayload() {
  const database = await probeDatabase();
  return {
    status: database.configured && !database.ok ? 'degraded' : 'ok',
    sha: buildSha(),
  };
}

// no-store so a cached probe never defeats its purpose (godmythos HR #25).
function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

app.get('/health', async function (_req, res) {
  setNoStore(res);
  // A health probe must never be the thing that kills the process.
  try {
    const payload = await healthPayload();
    res.status(payload.status === 'degraded' ? 503 : 200).json(payload);
  } catch (err) {
    log('error', 'Health payload failed', { error: err });
    res.status(503).json({ status: 'degraded', error: 'health check failed' });
  }
});

// ─── /api/health — godmythos HR #24 §0 mandatory health route (AF-2) ───
// Canonical SHA-self-report endpoint. Same payload as /health; the /api
// prefix aligns with the API surface so uptime monitors and the gate-13
// F1 check can probe a stable, semantically-named URL.
app.get('/api/health', async function (_req, res) {
  setNoStore(res);
  try {
    const payload = await healthPayload();
    res.status(payload.status === 'degraded' ? 503 : 200).json(payload);
  } catch (err) {
    log('error', 'Health payload failed', { error: err });
    res.status(503).json({ status: 'degraded', error: 'health check failed' });
  }
});

// ─── Browser error reports (F-G-08, F-F-08) ───
// ErrorBoundary and the window 'error'/'unhandledrejection' hooks
// (src/lib/client-error-report.ts) post here, without cookies. Public by
// necessity, so it is small: its own per-address limit (and no share of the /api
// budget), an 8 KB body cap, a schema, a cap on logged reports per minute, and a
// log line with the message, a truncated stack, the page path and the build sha,
// scrubbed of emails, query strings and tokens. Needs a human security review
// before launch (see the obs-a report).
app.post(
  '/api/client-error',
  perRouteRateLimit(10, 60_000),
  express.json({ limit: '8kb' }),
  createClientErrorHandler({ log: log, buildSha: buildSha })
);

// ─── InsForge config endpoint (for auth) ───
app.get('/api/insforge-config', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  // Prefer the VITE_ names: they are what the shipped bundle was built with.
  // The unprefixed INSFORGE_ANON_KEY in production holds a truncated
  // placeholder ("ik_fni…hjc6"), so preferring it advertised an unusable key.
  let anonKey = process.env.VITE_INSFORGE_ANON_KEY || process.env.INSFORGE_ANON_KEY || null;
  if (anonKey && /[^\x20-\x7e]/.test(anonKey)) {
    log('warn', 'InsForge anon key contains non-ASCII characters — refusing to advertise it');
    anonKey = null;
  }
  res.json({
    url: process.env.VITE_INSFORGE_BASE_URL || process.env.INSFORGE_BASE_URL || null,
    anonKey,
  });
});

// ─── Blog posts (public, no auth) ───
// PERF-006: the list view never renders full HTML bodies (the detail page has
// its own /api/blog-posts/:slug route), so compute excerpt + read time here
// and ship those instead of up to 50 full body_html payloads. The two helpers
// live in server-blog-render.cjs because the server-rendered /blog/ page uses them too.

// Server-rendered /blog/, /blog/<slug>/, sitemap.xml and the neutral app shell
// (F-F-01, F-F-03). Routes are mounted before express.static, further down. The
// canonical origin is the publisher's too (deployUrl below).
const PUBLIC_ORIGIN = serverConfig.get('PUBLIC_ORIGIN');
const pages = createPages({
  pgPool,
  staticDir: path.join(__dirname, 'static'),
  origin: PUBLIC_ORIGIN,
  routeMeta: blogRouteMeta,
  log,
});

app.get('/api/blog-posts', async function (_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  try {
    const { rows } = await pgPool.query(
      'SELECT id, slug, title, meta_title, meta_description, body_html, primary_keyword, faq, internal_links, external_links, cta, content_score, geo_score, published_at FROM blog_posts ORDER BY published_at DESC LIMIT 50'
    );
    res.json({
      posts: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        meta_title: row.meta_title,
        meta_description: row.meta_description,
        excerpt: blogListExcerpt(row),
        read_minutes: blogListReadMinutes(row.body_html),
        primary_keyword: row.primary_keyword,
        faq: row.faq,
        internal_links: publicLinks(row.internal_links),
        external_links: publicLinks(row.external_links),
        cta: publicCta(row.cta),
        content_score: row.content_score,
        geo_score: row.geo_score,
        published_at: row.published_at,
      })),
    });
  } catch (err) {
    if (err.code === '42P01') { // table does not exist
      return res.json({ posts: [] });
    }
    log('error', 'GET /api/blog-posts:', { error: err });
    res.status(failureStatus(err)).json({ error: 'Failed to fetch blog posts' });
  }
});

app.get('/api/blog-posts/:slug', async function (req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  // The page route refuses a malformed slug before it reads (server-pages.cjs); a NUL
  // byte would otherwise reach Postgres, which rejects it (22021): a 503 and an error
  // log line for any anonymous caller.
  if (!isValidSlug(req.params.slug)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  try {
    // The one read path for a post, shared with the server-rendered page: the
    // body is sanitised at read, and `head` is the title/description/canonical
    // the page was rendered with, so the client never re-derives them.
    const post = await pages.loadPost(req.params.slug);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ post, head: pages.headOf(post) });
  } catch (err) {
    log('error', 'GET /api/blog-posts/:slug:', { error: err });
    res.status(failureStatus(err)).json({ error: 'Failed to fetch post' });
  }
});

// Write side of the two blog routes above. SEO AI Regent posts scored articles
// here with a Bearer SITE_DEPLOY_TOKEN; rows land in the same blog_posts table
// those handlers read, so a published post is live on /blog with no rebuild.
// Body limit is generous because an article is full HTML, not a form payload.
const publishHandler = createPublishHandler({
  pgPool,
  deployToken: process.env.SITE_DEPLOY_TOKEN,
  canonicalOrigin: PUBLIC_ORIGIN,
  log,
});
app.post('/api/publish', express.json({ limit: '1mb' }), async function (req, res, next) {
  try {
    await publishHandler(req, res);
    // The pages cache reads for a minute: drop it so the post is live at once.
    if (res.statusCode === 200) pages.invalidate();
  } catch (err) {
    next(err);
  }
});

// Readiness gates on the data store, not on a marketing video (INFRA-003/
// INFRA-008): a deployment whose DB is unreachable must not be marked ready.
// 200/503 semantics mirror /health: not configured (no DATABASE_URL) counts as
// ready, configured-but-unreachable is degraded 503. The body is the status and
// nothing else (D-10): Railway's healthcheck reads only the status code, nothing
// in the repo read the db/video/timestamp detail, and the probe failure itself is
// logged ("Database health probe failed"); the video path is logged at boot.
app.get('/ready', async function (_req, res) {
  // Railway probes this on every deploy; a cached 200 would mark a broken
  // deployment ready (F-F-17).
  setNoStore(res);
  // Hard 2s ceiling on the probe so a slow pool cannot stall the readiness
  // check itself; the pool's own query_timeout is 3s.
  const dbProbe = await Promise.race([
    probeDatabase(),
    new Promise(function (resolve) {
      const timer = setTimeout(function () {
        resolve({ ok: false, configured: databaseConfigured });
      }, 2000);
      timer.unref();
    }),
  ]);
  const ready = dbProbe.ok || !dbProbe.configured;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded' });
});

// ─── Trial status endpoint (used by frontend after OAuth) ───
app.get('/api/trial-status', authGuard, async function (req, res) {
  try {
    const { rows } = await pgPool.query(
      'SELECT trial_ends_at FROM public.companies WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    if (rows.length === 0) {
      // No company yet — will be auto-provisioned on next API call
      return res.json({ trial: true, trialEndsAt: null, source: 'pending' });
    }
    const trialEndsAt = rows[0].trial_ends_at;
    const isActive = trialEndsAt ? new Date(trialEndsAt) > new Date() : false;
    return res.json({ trial: isActive, trialEndsAt, source: 'db' });
  } catch (err) {
    log('error', 'Trial status check failed', { error: err, userId: req.user.id });
    // Fail closed on the UI hint. Returning trial:true here told an expired
    // user their trial was still active; 503 lets the client retry instead of
    // caching a wrong answer. (Data access is gated separately by requirePlan.)
    return res.status(503).json({ error: 'Trial status unavailable', source: 'error-fallback' });
  }
});

// ─── Billing state endpoint (trial + subscription, synced from Stripe webhooks) ───
app.get('/api/billing', authGuard, async function (req, res) {
  try {
    const state = await loadBillingState(req.user.id);
    if (!state) {
      // Company not provisioned yet — trial starts on first data access.
      return res.json({ active: true, plan: 'starter', status: 'trialing', trialActive: true, trialEndsAt: null, source: 'pending' });
    }
    return res.json({ ...state, source: 'db' });
  } catch (err) {
    log('error', 'Billing state check failed', { error: err, userId: req.user.id });
    return res.status(failureStatus(err)).json({ error: 'Failed to load billing state' });
  }
});

// ─── Account data controls (DATA-005) ───
// Self-serve GDPR Art. 20/17 surface promised by the Security page, Privacy
// Policy, ToS and DPA: a machine-readable JSON export of the caller's own
// workspace, and deletion of the workspace's audit data. Both are
// authenticated and tenant-scoped through the same requireCompanyAccess
// resolution the other protected routes use — the company id is resolved
// server-side from the auth user, never from client input. They are
// deliberately NOT plan-gated: portability and erasure are account-holder
// rights, so they stay available to expired or canceled accounts.

// Export cap: entries are bounded by plan quotas in practice, but a very large
// workspace must not build an unbounded response body. Keep the newest rows
// and say so in the payload.
const EXPORT_MAX_ENTRIES = 10_000;

// The company row for the export payload. Selects only the columns the
// account holder already knows: what they enter in Settings (name, industry,
// reporting basis, base year; COMPANY_FIELDS in server-company.cjs) and the dates.
// No user_id, no billing columns, no onboarding or provisioning state.
async function loadCompanyExportRow(companyId) {
  const { rows } = await pgPool.query(
    'SELECT id, name, industry, consolidation_approach, base_year, created_at, updated_at, trial_ends_at FROM public.companies WHERE id = $1',
    [companyId]
  );
  return rows[0] || null;
}

// The export's own entry query (F-B-08). It used to reuse loadEmissionEntries,
// which selects what the dashboard needs, so a calculator entry's activity
// ("1200 therms"), its CO2e, factor, activity date and notes never reached the
// customer's copy. Every column is exported except idempotency_key, a request
// detail. Newest EXPORT_MAX_ENTRIES + 1 rows, so the caller can tell it capped.
// tests/export-claim-coupling.test.ts ties the claims register to this list.
async function loadEmissionEntriesForExport(companyId) {
  try {
    const { rows } = await pgPool.query(
      'SELECT id, company_id, facility_id, scope, category, source, amount, unit, factor, method, confidence, co2e_kg, activity_date, activity_amount, activity_unit, factor_value, factor_source, catalog_version, notes, import_id, imported_at, created_at, updated_at FROM emission_entries WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
      [companyId, EXPORT_MAX_ENTRIES + 1]
    );
    return rows.reverse().map(function (row) {
      return { ...row, activity_date: toDateOnly(row.activity_date) };
    });
  } catch (err) {
    log('error', 'Emission data store unavailable', { error: err, companyId });
    throw new Error('Emission data store unavailable');
  }
}

// Report records and the CSV import log belong to the customer's workspace too.
// A report's metadata (period dates, sign-off, the SHA-256 of its stored PDF) is
// exported with it; the PDF bytes and snapshot stay downloadable from the Reports page.
async function loadExportHistory(companyId) {
  try {
    const reports = await pgPool.query(
      'SELECT id, title, type, status, period, period_start, period_end, last_updated, completeness, signoff, signed_off_by, signed_off_at, pdf_sha256, created_at FROM public.reports WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1000',
      [companyId]
    );
    // Each entry's import_id points into this list (K4).
    const imports = await pgPool.query(
      'SELECT id, row_count, warning_count, original_filename, file_sha256, status, undone_at, created_at FROM public.csv_import_events WHERE company_id = $1 ORDER BY created_at ASC LIMIT 10000',
      [companyId]
    );
    return { reports: reports.rows, csvImports: imports.rows };
  } catch (err) {
    log('error', 'Export history data store unavailable', { error: err, companyId });
    throw new Error('Export data store unavailable');
  }
}

app.get('/api/account/export', apiAuthGuard, async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    const company = await loadCompanyExportRow(companyId);
    const facilities = await loadFacilities(companyId);
    let entries = await loadEmissionEntriesForExport(companyId);
    const history = await loadExportHistory(companyId);
    const notes = [];
    if (entries.length > EXPORT_MAX_ENTRIES) {
      // Rows are created_at ASC; keep the newest.
      entries = entries.slice(entries.length - EXPORT_MAX_ENTRIES);
      notes.push('Export capped at the ' + EXPORT_MAX_ENTRIES + ' most recent emission entries.');
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      company: company,
      facilities: facilities,
      emissionEntries: entries,
      reports: history.reports,
      csvImports: history.csvImports,
    };
    if (notes.length) payload.notes = notes;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ecoauditor-export-' + companyId + '.json"');
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    // loadEmissionEntries/loadFacilities throw "… data store unavailable" when
    // the DB is down; classifyApiFailure keeps that a generic 503 instead of
    // echoing driver text.
    const failure = classifyApiFailure(err);
    if (failure.status >= 500) {
      log('error', 'Account data export failed', { error: err, userId: req.user && req.user.id });
    }
    return res.status(failure.status).json({ success: false, error: failure.message });
  }
});

app.post('/api/account/delete-data', express.json(), apiAuthGuard, async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, null);
  if (!companyId) return;

  // Deliberately does NOT delete the auth user or the company row itself: the
  // company row carries the audit trail (csv_import_events, reports, sign-offs)
  // and the Stripe billing linkage, and removing it mid-session would log the
  // user out and orphan the subscription mapping. This endpoint is the
  // self-serve "erase my emissions data" control shown in Settings; full
  // account deletion remains a support-mediated request (30-day window — see
  // the Security/Privacy pages).

  // One transaction, parameterized SQL, row_security = off — same shape as the
  // other server-owned writes (reserveCsvImportQuota / ensureCompanyForUser).
  // Entries are deleted before facilities so the ON DELETE SET NULL FK from
  // emission_entries.facility_id never fires needlessly.
  //
  // The connect() acquisition sits INSIDE the try (SVR-01): a rejected
  // connect() — pool exhausted, connectionTimeoutMillis exceeded — used to
  // escape the async handler at the Express 4 boundary as an unhandled
  // rejection and exit the whole process (unhandledRejection at the bottom of
  // this file). Same class of bug the facilities route already guards against.
  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = off');
    const entriesResult = await client.query('DELETE FROM public.emission_entries WHERE company_id = $1', [companyId]);
    const facilitiesResult = await client.query('DELETE FROM public.facilities WHERE company_id = $1', [companyId]);
    await client.query('COMMIT');
    // Cached dashboard summaries for this tenant are now stale.
    invalidateCompanyCache(companyId);
    log('info', 'Account audit data deleted', {
      companyId: companyId,
      deletedEntries: entriesResult.rowCount,
      deletedFacilities: facilitiesResult.rowCount,
    });
    return res.json({
      deleted: true,
      deletedEntries: entriesResult.rowCount,
      deletedFacilities: facilitiesResult.rowCount,
    });
  } catch (err) {
    if (!client) {
      // Connect failed before any client existed: nothing to roll back or
      // release. Answer 503 (data store unavailable) so the endpoint degrades
      // instead of killing the process.
      log('error', 'Delete-data: failed to acquire a database client', { error: err, companyId: companyId });
      return res.status(503).json({ success: false, error: 'Data store unavailable' });
    }
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log('error', 'Delete-data rollback failed', { error: rollbackErr, companyId: companyId });
    }
    log('error', 'Account data deletion failed', { error: err, companyId: companyId });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to delete audit data' });
  } finally {
    // Release only what was actually acquired (SVR-01).
    if (client) client.release();
  }
});

// ─── Stripe API routes ───
function stripeGuard(_req, res, next) {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  next();
}

// Verifies an InsForge bearer token by calling the InsForge auth backend.
// On success, attaches the user payload (with `id`, `email`) to req.user.
async function authGuard(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!INSFORGE_BASE_URL) {
      log('error', 'authGuard: INSFORGE_BASE_URL not configured');
      return res.status(503).json({ error: 'Authentication backend not configured' });
    }
    const token = header.slice('Bearer '.length);
    // InsForge validates a session token at GET /api/auth/sessions/current
    // (this is the endpoint the @insforge/sdk uses for server-mode
    // getCurrentUser). It is NOT the Supabase '/auth/v1/user' route, and the
    // user object is nested under `.user` in the response, not at the top level.
    const userRes = await fetchWithTimeout(
      INSFORGE_BASE_URL.replace(/\/$/, '') + '/api/auth/sessions/current',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const body = await userRes.json();
    // Prefer the nested InsForge shape ({ user: { id, email, ... } }); fall back
    // to a flat body so the guard is resilient to response-shape variation.
    const user = body && body.user ? body.user : body;
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Invalid user payload' });
    }
    req.user = user;
    next();
  } catch (err) {
    log('error', 'authGuard error', { error: err });
    return res.status(500).json({ error: 'Authentication check failed' });
  }
}

function apiAuthGuard(req, res, next) {
  if (!INSFORGE_BASE_URL) {
    if (!canUseDevAuth(process.env)) {
      log('error', 'apiAuthGuard: INSFORGE_BASE_URL not configured');
      return res.status(503).json({ error: 'Authentication backend not configured' });
    }
    const devSecret = process.env.DEV_AUTH_SECRET;
    const expected = devSecret ? 'Bearer ' + devSecret : '';
    if (!devSecret || req.headers.authorization !== expected) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = {
      id: 'dev-user',
      email: 'dev@example.com',
      company_id: process.env.DEV_COMPANY_ID || 'test-company-1',
    };
    return next();
  }
  return authGuard(req, res, next);
}

async function requireCompanyAccess(req, res, requestedCompanyId) {
  const user = req.user;
  if (!user || !user.id) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }

  // Auto-provision a company for first-time users so onboarding never errors.
  let companyId;
  try {
    companyId = await ensureCompanyForUser(user);
  } catch (err) {
    log('error', 'Company provisioning unavailable', { error: err, userId: user.id });
    res.status(503).json({ success: false, error: 'Data store unavailable' });
    return null;
  }
  if (companyId) {
    user.company_id = String(companyId);
  }

  const result = resolveAuthorizedCompanyId(user, requestedCompanyId);
  if (!result.ok) {
    res.status(result.status).json({ success: false, error: result.error });
    return null;
  }
  return result.companyId;
}

// Ensures every authenticated user has a company row. Idempotent.
// Uses pgPool with RLS bypass (row_security = off) inside a transaction so
// the initial insert succeeds even before the user owns any company.
async function ensureCompanyForUser(user) {
  const userId = user.id;
  // The placeholder the customer is asked to replace (server-company.cjs): the
  // row is flagged auto_provisioned so the SPA sends it through onboarding first.
  const defaultName = defaultCompanyName(user.email);
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = off');
    const { rows } = await client.query(
      'SELECT id FROM public.companies WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (rows.length > 0) {
      await client.query('COMMIT');
      return rows[0].id;
    }
    // A new user's first dashboard load fires two requests concurrently; both
    // reach here, both SELECT nothing, and a plain INSERT makes the loser
    // violate companies_user_id_unique — surfacing as 503 'Billing status
    // unavailable' on the very first page. ON CONFLICT waits on the winner, so
    // when it returns no row the committed company is visible to a re-SELECT.
    const insert = await client.query(
      `INSERT INTO public.companies (user_id, name, industry, updated_at, trial_ends_at, auto_provisioned)
       VALUES ($1, $2, 'other', now(), now() + INTERVAL '14 days', true)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id, trial_ends_at`,
      [userId, defaultName]
    );
    if (insert.rows.length === 0) {
      const existing = await client.query(
        'SELECT id FROM public.companies WHERE user_id = $1 LIMIT 1',
        [userId]
      );
      await client.query('COMMIT');
      return existing.rows.length > 0 ? existing.rows[0].id : null;
    }
    await client.query('COMMIT');
    log('info', 'Auto-provisioned company with 14-day trial', { userId, companyId: insert.rows[0].id, trialEndsAt: insert.rows[0].trial_ends_at });
    return insert.rows[0].id;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log('error', 'Company provisioning rollback failed', { error: rollbackErr, userId });
    }
    log('error', 'ensureCompanyForUser failed', { error: err, userId });
    throw err;
  } finally {
    client.release();
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Looks up the Stripe customer ID for an InsForge user, creating one if needed.
// Idempotent: subsequent calls return the same customer ID.
async function ensureStripeCustomer(insforgeUserId, email) {
  if (!stripe) throw new Error('Stripe not configured');

  const { rows } = await pgPool.query(
    'SELECT stripe_customer_id FROM users WHERE insforge_user_id = $1',
    [insforgeUserId]
  );

  if (rows.length && rows[0].stripe_customer_id) {
    return rows[0].stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: email,
    metadata: { insforge_user_id: insforgeUserId },
  });

  if (rows.length) {
    await pgPool.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE insforge_user_id = $2',
      [customer.id, insforgeUserId]
    );
  } else {
    // SVR-02: two concurrent checkouts can both observe "no row" and both
    // mint a Stripe customer. ON CONFLICT DO NOTHING + re-select keeps the
    // mapping single-valued; the race loser adopts the winner's customer id
    // (its own extra Stripe object stays orphaned, which is harmless).
    await pgPool.query(
      'INSERT INTO users (insforge_user_id, stripe_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (insforge_user_id) DO NOTHING',
      [insforgeUserId, customer.id, email]
    );
    const reselect = await pgPool.query(
      'SELECT stripe_customer_id FROM users WHERE insforge_user_id = $1',
      [insforgeUserId]
    );
    if (reselect.rows.length && reselect.rows[0].stripe_customer_id &&
        reselect.rows[0].stripe_customer_id !== customer.id) {
      return reselect.rows[0].stripe_customer_id;
    }
  }

  return customer.id;
}

// Runs a statement with RLS bypassed, matching ensureCompanyForUser's pattern.
async function queryWithRlsBypass(text, params) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = off');
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // If the connection is already dead the ROLLBACK throws too, and an
    // unguarded await here would replace the real failure with a useless
    // "connection terminated" — losing the diagnostic every time it matters.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log('warn', 'ROLLBACK failed after query error', { error: rollbackErr });
    }
    throw err;
  } finally {
    client.release();
  }
}

// Persists a subscription snapshot (from a Stripe webhook or API mutation)
// onto the owning user's company row.
//
// Returns { ok, reason, retryable }. The distinction matters: these used to be
// bare `return false`, and the webhook acked them with 200, so Stripe never
// retried and a paying customer silently lost entitlement. Anything that a
// later delivery could plausibly resolve is marked retryable so the caller can
// fail the webhook and let Stripe redeliver.
//
// `eventCreatedAt` is the Stripe event.created (seconds). When supplied, the
// write is skipped if the row already reflects a newer event — Stripe does not
// guarantee ordering, and a stale "active" arriving after "deleted" would
// otherwise restore access.
async function syncSubscriptionRecord(record, eventCreatedAt) {
  // A record with no customer id is malformed; redelivery cannot fix it.
  if (!record.stripeCustomerId) {
    log('error', 'Subscription sync failed: record has no Stripe customer id');
    return { ok: false, reason: 'no_customer_id', retryable: false };
  }

  if (record.unrecognizedActivePrice) {
    log('error', 'Active subscription has an unrecognized price id — check STRIPE_PRICE_* env vars. Granting starter access.', {
      priceId: record.unrecognizedActivePrice,
      subId: record.stripeSubscriptionId,
    });
  }

  const { rows } = await pgPool.query(
    'SELECT insforge_user_id FROM users WHERE stripe_customer_id = $1',
    [record.stripeCustomerId]
  );
  if (rows.length === 0) {
    // Checkout can complete before the user->customer mapping is written.
    // Retryable: Stripe redelivers for days, by which time it normally exists.
    log('warn', 'Subscription sync deferred: no user for Stripe customer', { customerId: record.stripeCustomerId });
    return { ok: false, reason: 'no_user_mapping', retryable: true };
  }
  const userId = rows[0].insforge_user_id;

  // Companies are normally provisioned on first data access; make sure the
  // row exists so a checkout completed before app usage is not dropped.
  // ensureCompanyForUser throws when the data store is unavailable — treat that
  // as retryable rather than letting it fall through to the UPDATE, which would
  // match nothing and be misread below as a harmless stale event.
  let companyId;
  try {
    companyId = await ensureCompanyForUser({ id: userId });
  } catch (err) {
    log('warn', 'Subscription sync deferred: company provisioning failed', { userId, error: err });
    return { ok: false, reason: 'no_company', retryable: true };
  }
  if (!companyId) {
    log('warn', 'Subscription sync deferred: company row unavailable', { userId });
    return { ok: false, reason: 'no_company', retryable: true };
  }

  const eventAt = eventCreatedAt ? new Date(eventCreatedAt * 1000).toISOString() : null;
  const result = await queryWithRlsBypass(
    `UPDATE public.companies SET
       stripe_customer_id = $2,
       stripe_subscription_id = $3,
       subscription_status = $4,
       subscription_plan = $5,
       subscription_billing_cycle = $6,
       subscription_current_period_end = $7,
       subscription_cancel_at_period_end = $8,
       subscription_event_at = COALESCE($9::timestamptz, now()),
       updated_at = now()
     WHERE user_id = $1
       AND ($9::timestamptz IS NULL
            OR subscription_event_at IS NULL
            OR subscription_event_at < $9::timestamptz
            -- Stripe's event.created has 1-second resolution and one operation
            -- routinely emits several events in the same second (e.g.
            -- subscription.updated + subscription.deleted). A plain <= let the
            -- last-arriving same-second event win, which could overwrite a
            -- 'canceled' status back to 'active' and hand a canceled customer
            -- continued access. Ties may still refresh a row, but never
            -- resurrect a cancellation.
            OR ($9::timestamptz = subscription_event_at
                AND subscription_status IS DISTINCT FROM 'canceled'))`,
    [userId, record.stripeCustomerId, record.stripeSubscriptionId, record.status,
     record.plan, record.billingCycle, record.currentPeriodEnd, record.cancelAtPeriodEnd, eventAt]
  );
  if (result.rowCount === 0) {
    // With no event timestamp the ordering guard passes trivially, so matching
    // nothing cannot mean "stale" — the row must have gone missing between the
    // provision above and this write. Never ack that as success.
    if (!eventAt) {
      log('error', 'Subscription sync matched no row with no ordering guard', { userId });
      return { ok: false, reason: 'company_row_vanished', retryable: true };
    }
    // Otherwise the company row is confirmed to exist, so the only thing that
    // can match nothing is the guard rejecting an out-of-order delivery. That
    // is a correct skip, not a failure — ack it so Stripe stops retrying.
    log('info', 'Subscription sync skipped: event older than last applied', { userId, eventAt });
    return { ok: true, reason: 'stale_event', retryable: false };
  }
  log('info', 'Subscription synced to DB', { userId, status: record.status, plan: record.plan });
  return { ok: true, retryable: false };
}

// Loads the billing state for a user from their company row. Returns null
// when the company has not been provisioned yet.
async function loadBillingState(userId) {
  const { rows } = await pgPool.query(
    `SELECT trial_ends_at, subscription_status, subscription_plan, subscription_billing_cycle,
            subscription_current_period_end, subscription_cancel_at_period_end,
            stripe_customer_id, stripe_subscription_id
       FROM public.companies WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows.length ? billingStateFromCompany(rows[0]) : null;
}

// Plan-tier enforcement: requires an active trial or subscription at or above
// minPlanId. It fails closed: without a database, or when the lookup fails, the
// answer is 503 in every environment (it used to wave every request through
// when no database was configured, F-G-07).
//
// Provisions the company row (and with it the 14-day trial) when the user does
// not have one yet. This MUST happen here rather than in the route handlers:
// every handler that reaches ensureCompanyForUser via requireCompanyAccess sits
// BEHIND this middleware, so deferring provisioning to "first data access" made
// it unreachable — a brand new signup had no company row, planAccessDecision
// denied the null state, and the user was 402'd off their own free trial within
// seconds of signing up. See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-1).
function requirePlan(minPlanId) {
  return async function (req, res, next) {
    try {
      let state = await loadBillingState(req.user.id);
      if (!state) {
        await ensureCompanyForUser(req.user);
        state = await loadBillingState(req.user.id);
      }
      const decision = planAccessDecision(state, minPlanId);
      if (!decision.allowed) return res.status(decision.status).json(decision.body);
      req.billing = state;
      return next();
    } catch (err) {
      log('error', 'requirePlan check failed', { error: err });
      return res.status(503).json({
        success: false,
        error: 'Billing status unavailable, please retry',
        code: 'billing_unavailable',
      });
    }
  };
}

// Finds the customer's current subscription (active first, then trialing).
// Finds the subscription the customer can currently manage. Includes past_due
// and unpaid so a customer whose payment failed can still change or cancel their
// plan (they were previously stuck on a 404 and locked out on the first failure).
async function findActiveSubscription(customerId) {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
    const list = await stripe.subscriptions.list({ customer: customerId, status: status, limit: 1 });
    if (list.data.length) return list.data[0];
  }
  return null;
}

// True if the customer has ever had a subscription (any status), so we don't
// grant a fresh trial to a returning customer who already used one.
async function customerHasPriorSubscription(customerId) {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
  return list.data.length > 0;
}

// JSON body parser for Stripe API routes (NOT webhook)

// Subscription routes need method-specific handling
app.patch('/api/subscription', express.json(), stripeGuard, authGuard, async function (req, res) {
  try {
    const { planId, billing } = req.body || {};
    const priceId = resolvePlanPriceId(process.env, planId, billing);
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid plan selection' });
    }
    const customerId = await ensureStripeCustomer(req.user.id, req.user.email);
    const subscription = await findActiveSubscription(customerId);
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription to change. Start one from the pricing page.' });
    }
    const updateParams = {
      items: [{ id: subscription.items.data[0].id, price: priceId }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    };
    // A trialing customer switching to a trial-ineligible plan (e.g. Pro) would
    // otherwise ride the free trial on the higher tier. End the trial now so the
    // change is billed immediately.
    if (subscription.status === 'trialing' && !TRIAL_ELIGIBLE_PLANS.has(priceId)) {
      updateParams.trial_end = 'now';
    }
    // Watermark from a time taken BEFORE the mutation. Stamping it with the
    // post-write now() overshoots by the Stripe round-trip, and a genuine
    // Stripe event created inside that window would be rejected as stale —
    // e.g. a proration invoice failing and flipping the sub to past_due.
    const mutatedAt = Math.floor(Date.now() / 1000);
    const updated = await stripe.subscriptions.update(subscription.id, updateParams);
    // syncSubscriptionRecord RETURNS {ok:false} for mapping/provisioning
    // failures rather than throwing. Dropping that result reported an
    // unqualified success while the local entitlement still showed the old
    // plan, so the client had no reason to re-poll.
    const syncResult = await syncSubscriptionRecord(subscriptionRecordFromStripe(updated, process.env), mutatedAt);
    if (!syncResult || !syncResult.ok) {
      log('error', 'Plan change not yet reflected locally', {
        reason: syncResult && syncResult.reason, subId: updated.id, userId: req.user.id,
      });
    }
    log('info', 'Subscription changed', { subId: updated.id, planId, billing, userId: req.user.id });
    return res.json({ success: true, plan: planId, billing, synced: Boolean(syncResult && syncResult.ok) });
  } catch (err) {
    log('error', 'Subscription change failed', { error: err });
    return res.status(billingFailureStatus(err)).json({ error: 'Subscription change failed' });
  }
});

app.delete('/api/subscription', express.json(), stripeGuard, authGuard, async function (req, res) {
  try {
    const customerId = await ensureStripeCustomer(req.user.id, req.user.email);
    const subscription = await findActiveSubscription(customerId);
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription to cancel' });
    }
    const canceledAt = Math.floor(Date.now() / 1000);
    const updated = await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
    const syncResult = await syncSubscriptionRecord(subscriptionRecordFromStripe(updated, process.env), canceledAt);
    if (!syncResult || !syncResult.ok) {
      log('error', 'Cancellation not yet reflected locally', {
        reason: syncResult && syncResult.reason, subId: updated.id, userId: req.user.id,
      });
    }
    log('info', 'Subscription set to cancel at period end', { subId: updated.id, userId: req.user.id });
    return res.json({ success: true, cancelAtPeriodEnd: true, synced: Boolean(syncResult && syncResult.ok) });
  } catch (err) {
    log('error', 'Subscription cancel failed', { error: err });
    return res.status(billingFailureStatus(err)).json({ error: 'Cancellation failed' });
  }
});

app.get('/api/checkout', function (_req, res) {
  res.status(404).json({ error: 'Not found' });
});

// Resolve a Stripe price id from env, accepting the VITE_-prefixed alias.
// /api/config/prices used to apply this fallback while ALLOWED_PRICE_IDS and
// planFromPriceId read only the unprefixed names — so a deploy that set only
// VITE_STRIPE_PRICE_* advertised price ids that /api/checkout then rejected
// with "Invalid price selection" on every purchase. One resolver, used by both.
function resolvePriceId(name) {
  return priceIdFromEnv(process.env, name);
}

// ─── Public config endpoint for Stripe price IDs (frontend fetches these at runtime) ───
app.get('/api/config/prices', function (_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min client-side cache
  res.json({
    starter: {
      monthly: resolvePriceId('STRIPE_PRICE_STARTER_MONTHLY'),
      annual:  resolvePriceId('STRIPE_PRICE_STARTER_ANNUAL'),
    },
    growth: {
      monthly: resolvePriceId('STRIPE_PRICE_GROWTH_MONTHLY'),
      annual:  resolvePriceId('STRIPE_PRICE_GROWTH_ANNUAL'),
    },
    pro: {
      monthly: resolvePriceId('STRIPE_PRICE_PRO_MONTHLY'),
      annual:  resolvePriceId('STRIPE_PRICE_PRO_ANNUAL'),
    },
    pk: process.env.VITE_STRIPE_PK || process.env.STRIPE_PK || null,
  });
});

// Allowed Stripe price IDs (prevents client-controlled price injection)
const ALLOWED_PRICE_IDS = new Set([
  resolvePriceId('STRIPE_PRICE_STARTER_MONTHLY'),
  resolvePriceId('STRIPE_PRICE_STARTER_ANNUAL'),
  resolvePriceId('STRIPE_PRICE_GROWTH_MONTHLY'),
  resolvePriceId('STRIPE_PRICE_GROWTH_ANNUAL'),
  resolvePriceId('STRIPE_PRICE_PRO_MONTHLY'),
  resolvePriceId('STRIPE_PRICE_PRO_ANNUAL'),
].filter(Boolean));

// Plans eligible for trial (prevent trial abuse on higher tiers).
// Single source of truth: server-billing.cjs. This used to be a second,
// hand-maintained Set here while `trialEligiblePriceIds` sat imported and
// unused — the two had already drifted (the module included annual prices,
// this Set did not), so the module's own passing test asserted a policy the
// server did not implement.
const TRIAL_ELIGIBLE_PLANS = trialEligiblePriceIds(process.env);

app.post('/api/checkout', express.json(), stripeGuard, authGuard, async function (req, res) {
  try {
    const { priceId, trial } = req.body;
    if (!priceId) return res.status(400).json({ error: 'Missing priceId' });

    // Validate priceId against server-side allowlist
    if (!ALLOWED_PRICE_IDS.has(priceId)) {
      log('warn', 'Rejected checkout with disallowed priceId', { priceId, userId: req.user.id });
      return res.status(400).json({ error: 'Invalid price selection' });
    }

    const customerId = await ensureStripeCustomer(req.user.id, req.user.email);

    // Never open a second subscription for a customer who already has one.
    // Without this, an existing subscriber who revisits /pricing and clicks a
    // plan gets a SECOND concurrent Stripe subscription (e.g. $399 + $999/mo),
    // and because syncSubscriptionRecord keys on the company rather than the
    // subscription id, their entitlement then flaps between the two.
    // Plan changes belong on PATCH /api/subscription.
    // See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-3).
    const existingSubscription = await findActiveSubscription(customerId);
    if (existingSubscription) {
      log('warn', 'Rejected checkout for customer with an existing subscription', {
        userId: req.user.id,
        subscriptionId: existingSubscription.id,
        status: existingSubscription.status,
      });
      return res.status(409).json({
        error: 'You already have an active subscription. Change your plan from Settings instead.',
        code: 'subscription_exists',
      });
    }

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: APP_BASE_URL + '/app?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: APP_BASE_URL + '/pricing',
    };

    // Only allow a trial on eligible plans, and only once per company. The client's
    // `trial` flag asks for one; checkoutTrialDecision decides, from the company's
    // billing record (a card-free trial that has run out counts as used, F-B-18)
    // and from Stripe's history for the customer. A failed lookup throws into the
    // catch below: no session, never a trial by default.
    if (trial && TRIAL_ELIGIBLE_PLANS.has(priceId)) {
      const decision = checkoutTrialDecision(
        await loadBillingState(req.user.id),
        await customerHasPriorSubscription(customerId)
      );
      if (decision.eligible) {
        sessionParams.subscription_data = { trial_period_days: CHECKOUT_TRIAL_DAYS };
      } else {
        log('info', 'Checkout created without a trial', { userId: req.user.id, reason: decision.reason });
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    log('info', 'Checkout session created', { sessionId: session.id, userId: req.user.id });
    return res.json({ url: session.url });
  } catch (err) {
    log('error', 'Checkout session failed', { error: err });
    return res.status(billingFailureStatus(err)).json({ error: 'Checkout session creation failed' });
  }
});

// Reconciliation for the return-from-Stripe hop. The webhook is the primary
// path, but if it has not landed yet (or failed and is still retrying) the
// customer would sit on the paywall with no way out but support. This lets the
// app pull the subscription straight from Stripe once, on return from checkout.
//
// The session's customer must match the caller's own Stripe customer, so a
// guessed or borrowed session_id cannot grant anyone else's subscription.
app.post('/api/checkout/verify', express.json(), stripeGuard, authGuard, async function (req, res) {
  const sessionId = String((req.body && req.body.session_id) || '').trim();
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'A Stripe checkout session id is required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId = await ensureStripeCustomer(req.user.id, req.user.email);
    const sessionCustomer = typeof session.customer === 'string'
      ? session.customer
      : (session.customer && session.customer.id) || null;

    if (!sessionCustomer || sessionCustomer !== customerId) {
      log('warn', 'Checkout verify rejected: session belongs to another customer', { userId: req.user.id });
      return res.status(403).json({ error: 'This checkout session does not belong to your account' });
    }
    if (!session.subscription) {
      return res.json({ verified: false, reason: 'no_subscription_on_session' });
    }

    // Lower bound taken before the read, so the watermark reflects when this
    // state was true rather than when we finished writing it.
    const readAt = Math.floor(Date.now() / 1000);
    const subscription = typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;

    const result = await syncSubscriptionRecord(subscriptionRecordFromStripe(subscription, process.env), readAt);
    if (!result.ok) {
      log('error', 'Checkout verify could not persist subscription', { userId: req.user.id, reason: result.reason });
      return res.status(503).json({ error: 'Could not confirm your subscription yet', reason: result.reason });
    }

    const state = await loadBillingState(req.user.id);
    log('info', 'Checkout verified and subscription reconciled', { userId: req.user.id, subId: subscription.id });
    return res.json({ verified: true, billing: state });
  } catch (err) {
    log('error', 'Checkout verify failed', { error: err });
    return res.status(billingFailureStatus(err)).json({ error: 'Checkout verification failed' });
  }
});

app.post('/api/portal', express.json(), stripeGuard, authGuard, async function (req, res) {
  try {
    const customerId = await ensureStripeCustomer(req.user.id, req.user.email);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: APP_BASE_URL + '/app/settings',
    });
    return res.json({ url: session.url });
  } catch (err) {
    log('error', 'Billing portal failed', { error: err });
    return res.status(billingFailureStatus(err)).json({ error: 'Billing portal session creation failed' });
  }
});

// Webhook uses raw body for signature verification
app.post('/api/webhook', express.raw({ type: 'application/json' }), async function (req, res) {
  if (!stripe) return res.status(503).json({ error: 'Billing not configured' });
  if (!STRIPE_WEBHOOK_SECRET) {
    log('error', 'Webhook rejected: STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'Webhook signature secret not configured' });
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log('error', 'Webhook signature verification failed', { error: err });
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  log('info', 'Stripe webhook received', { type: event.type, id: event.id });

  // Set when a sync could not be persisted but a redelivery might succeed. We
  // answer non-2xx in that case so Stripe retries; acking 200 on a failed sync
  // is how a paying customer ends up with no entitlement and no recovery path.
  let retryableFailure = null;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        log('info', 'Checkout completed', { sessionId: session.id });
        if (session.subscription) {
          const subscription = typeof session.subscription === 'string'
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription;
          const result = await syncSubscriptionRecord(
            subscriptionRecordFromStripe(subscription, process.env), event.created);
          if (!result.ok && result.retryable) retryableFailure = result.reason;
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        log('info', 'Subscription lifecycle event', { subId: subscription.id, status: subscription.status });
        const result = await syncSubscriptionRecord(
          subscriptionRecordFromStripe(subscription, process.env), event.created);
        if (!result.ok && result.retryable) retryableFailure = result.reason;
        break;
      }
      case 'invoice.paid':
        log('info', 'Invoice paid', { invoiceId: event.data.object.id });
        break;
      case 'invoice.payment_failed':
        log('warn', 'Invoice payment failed', { invoiceId: event.data.object.id });
        break;
      default:
        log('info', 'Unhandled webhook event', { type: event.type });
    }
  } catch (err) {
    // Return 500 so Stripe retries the delivery — DB sync failures must not be dropped.
    log('error', 'Webhook processing failed', { type: event.type, id: event.id, error: err });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  if (retryableFailure) {
    if (shouldRetryWebhook({ ok: false, retryable: true }, event.created, Math.floor(Date.now() / 1000))) {
      log('error', 'Webhook sync did not persist — asking Stripe to retry', {
        type: event.type, id: event.id, reason: retryableFailure,
      });
      return res.status(503).json({ error: 'Subscription sync unavailable', reason: retryableFailure });
    }
    // Past the retry window this failure is not going to resolve itself. Keep
    // failing it and Stripe may disable the endpoint for every customer, so
    // ack and leave a loud log for a human to reconcile this one account.
    log('error', 'Webhook sync abandoned after retry window — needs manual reconciliation', {
      type: event.type, id: event.id, reason: retryableFailure, eventCreated: event.created,
    });
  }

  return res.json({ received: true });
});

// ─── Video streaming ───
const VIDEO_FILENAME = 'eco-auditor-intro.mp4';
const VIDEO_PATHS = [
  path.join('/app/videos', VIDEO_FILENAME),
  path.join(__dirname, 'static', VIDEO_FILENAME),
  path.join(__dirname, 'public', VIDEO_FILENAME),
];

// PERF-011: the video volume is mounted at boot and never changes for the
// life of the deployment, so probe the candidate paths once and cache the
// result. findVideoPath() sat on the /ready healthcheck path, costing up to
// three synchronous existsSync calls per Railway probe.
let resolvedVideoPath; // undefined = not probed yet; null = probed, absent
function findVideoPath() {
  if (resolvedVideoPath !== undefined) return resolvedVideoPath;
  for (const p of VIDEO_PATHS) {
    try {
      if (fs.existsSync(p)) {
        resolvedVideoPath = p;
        return p;
      }
    } catch {
      // ignore permission errors
    }
  }
  resolvedVideoPath = null;
  return null;
}

// ─── LEAD NOTIFICATIONS (F-A-07 / F-B-12) ───
// Every lead surface promises a human follow-up, but a lead used to be a row in
// public.leads that nobody was alerted about. Once a lead is stored it is
// posted to LEAD_NOTIFY_WEBHOOK_URL (server-notify.cjs); with no usable URL the
// notifier logs one startup warning and stays off.
const leadNotifier = createLeadNotifierFromEnv(process.env, { log: log });

// Fire-and-forget: the lead is already stored when this runs, so nothing the
// notifier does may delay or fail the request. notify() never rejects; the
// catch is a second guard because an unhandled rejection exits the process.
function announceLead(lead) {
  try {
    leadNotifier.notify(lead).catch(function () {});
  } catch {
    // Deliberately ignored: the lead is stored, the request must still succeed.
  }
}

// A lead is a row in public.leads, or it was not captured: a failed INSERT is
// rethrown so /api/leads answers 503 and the form offers a retry (UXE-001). There
// is no file fallback in any environment (F-G-12): nobody read the JSON file it
// wrote, and a corrupt file was silently replaced by the next write.
async function writeLead(lead) {
  try {
    await pgPool.query(
      `INSERT INTO public.leads (type, name, email, company, message, preferred_date, preferred_time, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        lead.type || 'general',
        lead.name,
        lead.email,
        lead.company || null,
        lead.message || null,
        lead.preferredDate || null,
        lead.preferredTime || null,
        lead.source || 'api',
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    log('error', 'Failed to write lead to Postgres', { error: err });
    throw err;
  }
  announceLead(lead);
}

// The chatbot carries lead fields in client-controlled conversation state, so a
// forged /api/chat request could persist unvalidated data. Run it through the
// same sanitizer /api/leads uses (bounds + email validation) before writing.
async function writeChatLead(raw) {
  const sanitized = sanitizeLeadPayload(raw);
  if (!sanitized.ok) {
    log('warn', 'Rejected chatbot lead payload', { error: sanitized.error });
    return false;
  }
  try {
    await writeLead({ ...sanitized.value, source: 'chatbot' });
    return true;
  } catch (err) {
    log('error', 'Failed to write chatbot lead', { error: err });
    return false;
  }
}

// ─── CONSENT AUDIT TRAIL ───
// Server-side record of consent decisions (GDPR/CCPA record-keeping).
// Public endpoint: consent happens before authentication. No raw IP is stored.
const CONSENT_METHODS = new Set(['accept_all', 'reject_all', 'custom', 'privacy_signal', 'reset']);

// A plain SHA-256 of an IP is reversible (the IPv4 space is trivially
// brute-forceable), so pseudonymize with a keyed HMAC. Set CONSENT_IP_PEPPER in
// prod for stable hashes; otherwise a random per-process pepper is used. The
// missing-variable warning is logged once at boot, by startServer (F-G-11): it
// stays a warning and not a boot failure, because refusing to start would take
// the site down over a hardening variable.
const CONSENT_IP_PEPPER = process.env.CONSENT_IP_PEPPER || crypto.randomBytes(32).toString('hex');
function hashConsentIp(ip) {
  return crypto.createHmac('sha256', CONSENT_IP_PEPPER).update(String(ip || '')).digest('hex').slice(0, 32);
}

app.post('/api/consent-audit', consentRateLimit, express.json({ limit: '4kb' }), async function (req, res) {
  const body = req.body || {};
  const consent = body.consent;
  if (!consent || typeof consent !== 'object' ||
      ['analytics', 'preferences', 'marketing'].some(function (key) { return typeof consent[key] !== 'boolean'; })) {
    return res.status(400).json({ error: 'Invalid consent payload' });
  }
  const receivedAt = new Date();
  const record = {
    visitorId: typeof body.visitorId === 'string' ? body.visitorId.slice(0, 64) : null,
    consent: {
      strictlyNecessary: true,
      analytics: consent.analytics,
      preferences: consent.preferences,
      marketing: consent.marketing,
    },
    policyVersion: typeof body.policyVersion === 'string' ? body.policyVersion.slice(0, 20) : 'unknown',
    method: CONSENT_METHODS.has(body.method) ? body.method : 'custom',
    gpc: Boolean(body.gpc),
    dnt: Boolean(body.dnt),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    ipHash: hashConsentIp(resolveClientIp(req)),
    createdAt: receivedAt.toISOString(),
    // When the visitor chose, from their browser, if believable (see
    // sanitizeConsentDecidedAt); null = the receipt time above is all there is.
    decidedAt: sanitizeConsentDecidedAt(body.decidedAt, receivedAt.getTime()),
  };

  try {
    const persist = async function () {
      await queryWithRlsBypass(
        `INSERT INTO public.consent_records (visitor_id, consent, policy_version, method, gpc, dnt, user_agent, ip_hash, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [record.visitorId, JSON.stringify(record.consent), record.policyVersion, record.method,
         record.gpc, record.dnt, record.userAgent, record.ipHash, record.decidedAt]
      );
    };
    try {
      await persist();
    } catch (firstErr) {
      // UXE-006: one bounded retry — a transient pool hiccup should not
      // silently drop GDPR/CCPA consent evidence. If the retry also fails,
      // the failure surfaces below (no unbounded PII fallback files here).
      await new Promise(function (resolve) { setTimeout(resolve, 150); });
      await persist();
    }
    return res.status(202).json({ received: true });
  } catch (err) {
    log('error', 'Consent audit persistence failed', { error: err });
    // UXE-006: surface the failure as retryable (503) so the client can offer
    // a retry instead of silently pretending the consent record was kept.
    return res.status(503).json({ error: 'Failed to record consent', retryable: true });
  }
});

// ─── CSP VIOLATION REPORTS (F-F-07) ───
// The Content-Security-Policy in server-security.cjs names this path in report-uri
// and report-to. Before it existed, a host the policy blocked (a Google endpoint
// GA4 needs, say) failed silently in the visitor's console and nobody found out.
// Public by necessity (the browser sends it, unauthenticated), so it is small:
// its own limiter, an 8 KB body cap, a cap on logged reports per minute across all
// callers, and a log line per report that holds no URL path, query, script sample
// or user agent (see summarizeCspReports). It answers 204 whatever it was sent.
const cspReportRateLimit = perRouteRateLimit(30, 60_000);
const CSP_REPORTS_LOGGED_PER_MINUTE = 300;
let cspReportWindowStart = 0;
let cspReportsLogged = 0;

function takeCspReportSlot() {
  const now = Date.now();
  if (now - cspReportWindowStart >= 60_000) {
    cspReportWindowStart = now;
    cspReportsLogged = 0;
  }
  cspReportsLogged += 1;
  return cspReportsLogged <= CSP_REPORTS_LOGGED_PER_MINUTE;
}

app.post(
  '/api/csp-report',
  cspReportRateLimit,
  express.json({ type: ['application/json', 'application/csp-report', 'application/reports+json'], limit: '8kb' }),
  function (req, res) {
    summarizeCspReports(req.body).forEach(function (report) {
      if (takeCspReportSlot()) log('warn', 'CSP violation report', report);
    });
    res.status(204).end();
  }
);

// ─── SALESBOT CHAT ENGINE ───
// A keyword table, not a model: the first entry whose pattern matches wins, so
// the order below IS the routing. Specific topics come first and the generic
// overview comes last. Before this, a catch-all sat ahead of the regulatory
// entries and answered "Tell me about CBAM" and "What about the SEC climate
// rule?" with its most over-claiming text, so the careful entries were
// unreachable (F-A-11).
//
// Every reply states only what the product does today, and anything unbuilt is
// labelled roadmap. Limits are read from plan-limits.json (the file the server
// enforces); prices are not in that file, so they are literals here, and
// tests/chat-kb.test.ts checks them and every limit against src/content/pricing.ts
// and plan-limits.json.
function planSummary(planId) {
  const limits = planLimits(planId);
  const scopes = limits.scope3 ? 'Scope 1, 2 and 3' : 'Scope 1 and 2 only (no Scope 3)';
  const facilities = limits.facilities === null
    ? 'unlimited facilities'
    : limits.facilities === 1 ? '1 facility' : 'up to ' + limits.facilities + ' facilities';
  const imports = limits.csvImportsPerMonth === null
    ? 'unlimited CSV imports'
    : limits.csvImportsPerMonth + ' CSV imports a month';
  return scopes + ', ' + facilities + ', ' + imports;
}

// The bot cannot book anything: a demo request is one row plus a notification
// to the team (see announceLead), and a person follows up by email.
const DEMO_INTRO = "I'd be happy to set up a demo. I'll take a few details and our team will follow up by email. I can't book a time myself. What's your name?";

const ECOAUDITOR_KB = [
  {
    id: 'trial',
    pattern: /free trial|\btrial\b|for free|free (plan|tier|version|account|to use|of charge)|try (it|eco|this)|no card|credit card/i,
    response: "There is a 14-day free trial (there is no permanent free plan):\n\n• Sign up without a card and you get Starter-level access for 14 days (" + planSummary('starter') + ").\n• You can also start a monthly Starter or Growth plan with a 14-day trial at checkout, which asks for a payment method. Pro has no trial.\n\nWould you like me to walk you through the plans?"
  },
  {
    id: 'pricing',
    pattern: /pricing|prices?\b|\bcost|how much|\bplans?\b|subscription|per month|\bannual\b|discount|billing|\btiers?\b|\bstarter\b|\bgrowth\b|\bpro\b/i,
    response: "We offer three plans, billed monthly (annual billing is also available):\n\n• **Starter** — $149/mo: " + planSummary('starter') + "\n• **Growth** — $399/mo: " + planSummary('growth') + "\n• **Pro** — $999/mo: " + planSummary('pro') + "\n\nEvery plan includes a PDF emissions summary. Starter and Growth can be tried free for 14 days on monthly billing. Would you like help choosing a plan?"
  },
  {
    id: 'demo',
    pattern: /\bdemos?\b|demonstrat|schedule a call|talk to sales|book a call|see it in action|walk ?through/i,
    response: DEMO_INTRO,
    // Asks for a name, so it has to start the flow that collects it; otherwise
    // the visitor's name is answered as a fresh question.
    flow: 'demo'
  },
  {
    id: 'contact',
    pattern: /contact|reach out|\bemail\b|phone|call you|(speak|talk) (to|with) (someone|a human|a person)/i,
    response: "You can reach us at:\n\n• Email: hello@developer312.com\n• Phone: (510) 591-0163\n\nOr choose **Contact Sales** and I'll take your details here; our team will follow up by email."
  },
  {
    id: 'audit',
    pattern: /audit[- ]?(ready|readiness|trail|log|able)|\bassurance\b|\bassured\b|third[- ]party|\bverif(y|ied|ication)\b/i,
    response: "Eco-Auditor calculates your emissions and gives you a PDF emissions summary and a JSON data export. It does not yet keep an audit trail (a history of who changed what), and it does not provide third-party assurance or verification. An audit trail is on our roadmap.\n\nIf a customer or regulator needs assured numbers, an independent assurance provider has to review your inventory."
  },
  {
    id: 'cbam',
    pattern: /\bcbam\b|carbon border|\beu\b|europe/i,
    response: "CBAM is the EU's Carbon Border Adjustment Mechanism. Its obligations fall on EU importers of covered goods (such as iron and steel, aluminium, cement and fertilisers), who report the emissions embedded in those goods. Non-EU suppliers are not directly subject to it, but their EU customers may ask them for emissions data.\n\nEco-Auditor is not a CBAM tool: it does not calculate CBAM embedded emissions or produce CBAM reports. It calculates a company-level emissions inventory from your activity data. Check what your EU customer's template requires before you choose a tool."
  },
  {
    id: 'california',
    pattern: /california|\bsb[- ]?(253|261)\b|\bab[- ]?1305\b|climate corporate|\bcarb\b/i,
    response: "California's SB 253 applies to companies with more than $1 billion in annual revenue that do business in California. Eco-Auditor is aimed at smaller companies, which usually meet SB 253 only indirectly, when a covered customer asks them for emissions data.\n\nEco-Auditor calculates emissions from your activity data. It is not an SB 253 filing tool and it does not provide assurance. The dates have shifted while CARB finalizes its rules, so please check CARB's program page for the current deadlines: https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk\n\nRelated laws: SB 261 (climate-risk reports) was paused by a court injunction as of CARB's December 2025 advisory, and AB 1305 is a separate law about voluntary carbon offsets and net-zero claims. Eco-Auditor does not produce reports for either."
  },
  {
    id: 'sec',
    pattern: /\bsec\b|securities and exchange|climate[- ]disclosure rule|climate rule/i,
    response: "The SEC's climate-disclosure rules have not taken effect: they were stayed in 2024, and the SEC has since proposed rescinding them. Please check sec.gov for their current status.\n\nEco-Auditor does not produce SEC filings. It calculates greenhouse-gas emissions from your activity data, which you can use for voluntary reporting or to answer customer requests for emissions data."
  },
  {
    id: 'scope',
    pattern: /scope ?[123]|\bghg\b|greenhouse|protocol|emission factors?|\bfactors?\b|methodolog/i,
    response: "Eco-Auditor sorts emissions into the GHG Protocol's three scopes:\n\n• **Scope 1**: direct emissions from sources you own or control\n• **Scope 2**: indirect emissions from purchased energy\n• **Scope 3**: other indirect emissions in your value chain\n\nYou import activity data by CSV and we calculate emissions with EPA and eGRID factors and IPCC AR5 global-warming potentials. Scope 1 and 2 are on every plan; Scope 3 needs Growth or Pro. Some factors, mostly for Scope 3, are our own internal estimates or provisional values; the Methodology page explains which."
  },
  {
    id: 'integrations',
    pattern: /integrat|\bapi\b|connect|\berp\b|salesforce|quickbooks|xero|zapier|\bcsv\b|upload|spreadsheet/i,
    response: "CSV import is the only way to bring data in today: export from your spreadsheets or systems and upload the file.\n\nOn our roadmap, not available yet: QuickBooks and Xero integrations, API access and supplier data requests. If one of these matters to you, tell our team using Contact Sales."
  },
  {
    id: 'smb',
    pattern: /\bsmb\b|small business|startup|start-up|affordable|small compan|mid[- ]?size/i,
    response: "Eco-Auditor is aimed at small and mid-sized businesses. The Starter plan is $149/mo (" + planSummary('starter') + ") and you can move up to Growth or Pro as your needs grow. You can try it free for 14 days.\n\nWould you like to see the plans side by side?"
  },
  // Generic overview LAST: it is the catch-all for "what is this", and anything
  // placed after it would never be reached.
  {
    id: 'overview',
    pattern: /\bhow\b[^?.!]{0,40}\bwork|features?|what (is|does|can) (eco|this|it|you)|what do you do|about (you|eco|this)|overview|tell me (more|about (eco|your))|carbon accounting|carbon footprint|calculat/i,
    response: "Eco-Auditor helps small and mid-sized businesses calculate their greenhouse-gas emissions:\n\n• **CSV import** of activity data\n• **Scope 1 and 2 calculations** on every plan and **Scope 3** on Growth and Pro, using EPA and eGRID factors\n• **Dashboard totals** and a **PDF emissions summary**\n\nOn our roadmap, not available yet: supplier requests, accounting-software integrations, an audit trail and API access.\n\nWant to see it in action? I can take your details and our team will follow up by email to arrange a demo."
  }
];

function matchKbEntry(message) {
  return ECOAUDITOR_KB.find(function (entry) { return entry.pattern.test(message); }) || null;
}

// A prompt example in the past makes the bot look stale (it used to suggest
// 2026-05-15 in September), so the example date is always two weeks ahead.
function exampleDemoDate() {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function getBotResponse(message, state = {}) {
  const lowerMsg = message.toLowerCase().trim();

  // Handle multi-step flows
  if (state.flow === 'demo') {
    if (!state.name) {
      return {
        response: `Nice to meet you, ${message}! What's your email address?`,
        state: { ...state, name: message, step: 'email' }
      };
    }
    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(message)) {
        return {
          response: "That doesn't look like a valid email. Please enter a valid email address:",
          state
        };
      }
      return {
        response: "Great! What company are you with?",
        state: { ...state, email: message, step: 'company' }
      };
    }
    if (state.step === 'company') {
      return {
        response: `Perfect! What day would you prefer for the demo? (Please provide a date, e.g., "${exampleDemoDate()}")`,
        state: { ...state, company: message, step: 'date' }
      };
    }
    if (state.step === 'date') {
      return {
        response: "What time of day do you prefer? (e.g., 'Morning', 'Afternoon', or specific time like '2:00 PM PST')",
        state: { ...state, date: message, step: 'time' }
      };
    }
    if (state.step === 'time') {
      // Save lead (sanitized — state is client-controlled)
      const demoSaved = await writeChatLead({
        type: 'demo_request',
        name: state.name,
        email: state.email,
        company: state.company,
        preferredDate: state.date,
        preferredTime: message,
      });
      // writeChatLead returns false when the payload is rejected or the lead
      // could not be stored. Confirming a request we never recorded loses the
      // lead silently.
      if (!demoSaved) {
        return {
          response: `I couldn't save your demo request just now. Please email hello@developer312.com with your preferred time and the team will follow up.`,
          state,
        };
      }

      // The lead is stored and the team has been notified (writeLead ->
      // announceLead), but nothing is booked and nobody has confirmed a slot:
      // the reply must say exactly that. It used to announce "Demo booked!" and
      // a "personalized presentation" that was a generic third-party link
      // (F-A-07 / F-B-12). The third-party deck link is gone with it: the
      // deck's content is not reviewed against what the product does.
      return {
        response: `✅ Thanks, ${state.name}! Your details are saved and our team will follow up by email at ${state.email}.\n\nI can't book a time myself, so ${state.date} (${message}) is your preference, not a confirmed slot.\n\nIn the meantime, take a look at [Pricing](/pricing) or ask me anything else.`,
        state: {}
      };
    }
  }

  if (state.flow === 'contact') {
    if (!state.name) {
      // The name has just been captured from `message`; asking for it again
      // (the old copy) made every user repeat it, and the repeat was then
      // rejected as an invalid email.
      return {
        response: `Thanks, ${message}! What's your email address?`,
        state: { ...state, name: message, step: 'email' }
      };
    }
    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(message)) {
        return {
          response: "Please enter a valid email address:",
          state
        };
      }
      return {
        response: "How can our sales team help you today?",
        state: { ...state, email: message, step: 'message' }
      };
    }
    if (state.step === 'message') {
      const contactSaved = await writeChatLead({
        type: 'contact_request',
        name: state.name,
        email: state.email,
        message: message,
      });
      if (!contactSaved) {
        return {
          response: `I couldn't send that just now. Please email hello@developer312.com directly and our team will pick it up.`,
          state,
        };
      }
      return {
        response: `✅ Thanks! Your message is saved and our team will follow up by email at ${state.email}.\n\nIs there anything else I can help you with?`,
        state: {}
      };
    }
  }

  // Quick reply triggers
  if (lowerMsg === '💰 pricing' || lowerMsg === 'pricing') {
    const match = matchKbEntry('pricing');
    return { response: match ? match.response : "Our plans start at $149/mo. Would you like more details?", state };
  }
  if (lowerMsg === '📅 book a demo' || lowerMsg === 'book a demo') {
    return {
      response: DEMO_INTRO,
      state: { flow: 'demo', step: 'name' }
    };
  }
  if (lowerMsg === '🚀 how it works' || lowerMsg === 'how it works') {
    const match = matchKbEntry('how it works');
    return { response: match ? match.response : "Eco-Auditor helps you calculate emissions from your activity data. Want a demo?", state };
  }
  if (lowerMsg === '📞 contact sales' || lowerMsg === 'contact sales') {
    return {
      response: "I'd be happy to take your details for our sales team; they will follow up by email. What's your name?",
      state: { flow: 'contact', step: 'name' }
    };
  }

  // Regex KB matching: first match wins, see the order note on ECOAUDITOR_KB.
  const entry = matchKbEntry(message);
  if (entry) {
    return { response: entry.response, state: entry.flow ? { flow: entry.flow, step: 'name' } : state };
  }

  // Default response
  return {
    response: "I'm not sure I understand. I can help you with:\n\n• 💰 Pricing and plans\n• 📅 Requesting a demo\n• 🚀 How Eco-Auditor works\n• 📞 Contacting sales\n\nOr ask me about carbon accounting, emissions reporting, or compliance!",
    state
  };
}

// ─── CHAT API ───
app.post('/api/chat', express.json({ limit: '16kb' }), chatRateLimit, async function (req, res) {
  const { message } = req.body || {};
  const state = sanitizeChatState(req.body && req.body.state);

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  if (message.length > 5000) {
    return res.status(400).json({ success: false, error: 'Message too long (max 5000 chars)' });
  }

  // Use salesbot engine first
  // Salesbot engine v2
  // Previously an unguarded await plus a bare `if (botResult.response)` meant
  // any throw took the process down (unhandledRejection -> process.exit) and
  // any empty response left the request hanging with no reply at all.
  const FALLBACK_REPLY = "I'm having trouble answering that right now. You can reach us at hello@developer312.com and we'll follow up.";
  let botResult;
  try {
    botResult = await getBotResponse(message.trim(), state);
  } catch (err) {
    log('error', 'Chat bot response failed', { error: err });
    return res.status(500).json({ success: false, error: 'Chat is temporarily unavailable' });
  }

  const reply = (botResult && botResult.response) || FALLBACK_REPLY;
  const nextState = (botResult && botResult.state) || state;
  return res.json({
    success: true,
    response: reply,
    state: nextState,
    quickReplies: !nextState?.flow ? ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] : undefined
  });
});

// ─── LEADS API ───
app.post('/api/leads', express.json({ limit: '8kb' }), leadsRateLimit, async function (req, res) {
  // Lightweight honeypot: bots often fill hidden fields; legitimate users won't.
  if (req.body && req.body.website) {
    return res.status(400).json({ success: false, error: 'Invalid submission' });
  }

  const lead = sanitizeLeadPayload(req.body);
  if (!lead.ok) {
    return res.status(lead.status).json({ success: false, error: lead.error });
  }

  try {
    await writeLead(lead.value);
    return res.json({ success: true, message: 'Lead captured successfully' });
  } catch (err) {
    log('error', 'Lead capture failed', { error: err });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to capture lead. Please try again.' });
  }
});

// A failed read is logged with the driver's error and rethrown without its text,
// in every environment (there is no fixture fallback, F-G-07): the routes answer
// 503 through failureStatus/classifyApiFailure.
async function loadEmissionEntries(companyId, period) {
  try {
    const params = [companyId];
    // factor_value and catalog_version: the engine prices and classifies a row
    // by its own pin (a row without one by the frozen 2026-07-24 catalog), so
    // a catalog correction never restates stored history. Every read that
    // feeds the engine must select both (tests/entry-dashboard-parity.test.ts).
    // factor_source rides along for report snapshots; activity_date is for the
    // period rule and the trend.
    let sql = 'SELECT id, company_id, facility_id, scope, category, source, amount, unit, method, confidence, factor_value, factor_source, catalog_version, activity_date, created_at FROM emission_entries WHERE company_id = $1';
    if (period) {
      // One period rule for the dashboard summary and for reports (K3, audit
      // review R2), so the two agree: an entry belongs to the period its
      // activity date falls in, else the day it was recorded. `period` is a
      // year ('2026') or an inclusive range ('2025-04-01/2026-03-31');
      // anything else matches nothing, as the old year comparison did.
      const bounds = reportingPeriodBounds(period);
      if (!bounds) return [];
      params.push(bounds.start, bounds.end);
      sql += ' AND COALESCE(activity_date, created_at::date) BETWEEN $2::date AND $3::date';
    }
    // PERF-004: hard ceiling on rows pulled per request. An SMB inventory
    // is orders of magnitude below this; the LIMIT only stops a pathological
    // dataset from turning every dashboard call into an unbounded read.
    sql += ' ORDER BY created_at ASC LIMIT 50000';
    const { rows } = await pgPool.query(sql, params);
    return rows.map(function (row) {
      return {
        ...row,
        amount: Number(row.amount),
        confidence: row.confidence == null ? undefined : Number(row.confidence),
        factor_value: row.factor_value == null ? null : Number(row.factor_value),
        activity_date: toDateOnly(row.activity_date),
      };
    });
  } catch (err) {
    log('error', 'Emission data store unavailable', { error: err, companyId });
    throw new Error('Emission data store unavailable');
  }
}

// Scope label normalizer that tolerates junk instead of throwing — used by the
// plan gate, which runs before per-row validation and must not 500 on bad input.
// Delegates to the engine's own normaliser: a hand-rolled copy here stripped
// different characters than the engine (no '/'), so "Scope/3" was null to the
// paywall but scope3 to the engine — a starter account could import Scope 3.
function normalizeScopeLabel(value) {
  try {
    return normalizeScope(value);
  } catch {
    return null;
  }
}

async function loadFacilities(companyId) {
  try {
    const { rows } = await pgPool.query(
      'SELECT id, company_id, name, type, city FROM facilities WHERE company_id = $1 ORDER BY name ASC',
      [companyId]
    );
    return rows;
  } catch (err) {
    log('error', 'Facilities data store unavailable', { error: err, companyId });
    throw new Error('Facilities data store unavailable');
  }
}

// Loads one of the company's own facilities by id. Returns null when there is
// none: an id that is not 1 to 18 digits (the rule of every other id route, DB_ID;
// a longer number is beyond bigint, which Postgres refuses with 22003) cannot match
// and never reaches the database, and another company's facility is not found
// either, because the company is part of the query.
async function loadFacilityById(companyId, facilityId) {
  if (!DB_ID.test(String(facilityId))) return null;
  try {
    const { rows } = await pgPool.query(
      'SELECT id, company_id, name, type, city FROM facilities WHERE id = $1 AND company_id = $2',
      [facilityId, companyId]
    );
    return rows[0] || null;
  } catch (err) {
    log('error', 'Facilities data store unavailable', { error: err, facilityId });
    throw new Error('Facilities data store unavailable');
  }
}

// Size cap for the summary cache (PERF-010): entries are small dashboard
// summaries, but without a cap the map grew with (company, period)
// cardinality for the life of the process.
const EMISSIONS_SUMMARY_CACHE_MAX = 500;

function cacheGet(key) {
  const hit = emissionsSummaryCache.get(key);
  if (!hit || Date.now() > hit.expiresAt) {
    emissionsSummaryCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  emissionsSummaryCache.set(key, { value: value, expiresAt: Date.now() + ttlMs });
  // Oldest-insert eviction: Map preserves insertion order, so dropping from
  // the front evicts the least-recently-inserted keys once the cap is hit.
  while (emissionsSummaryCache.size > EMISSIONS_SUMMARY_CACHE_MAX) {
    const oldestKey = emissionsSummaryCache.keys().next().value;
    emissionsSummaryCache.delete(oldestKey);
  }
}

// Drops one company's cached figures after a write to its entries. Keys are
// `<kind>:<companyId>:...`. Every writer used to call a whole-map clear(), so
// one tenant's import evicted every other tenant's dashboards, and the writes
// that never reached Express (the calculator's) cleared nothing at all: the
// dashboard stayed stale for up to 5 minutes (F-E-12, F-G-10). Per process
// only: with more than one replica the other replicas keep their copy until
// the TTL.
function invalidateCompanyCache(companyId) {
  const id = String(companyId);
  for (const key of emissionsSummaryCache.keys()) {
    if (key.split(':')[1] === id) emissionsSummaryCache.delete(key);
  }
}

app.post('/api/calculate', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const body = req.body || {};
    const companyId = await requireCompanyAccess(req, res, body.company_id || body.companyId);
    if (!companyId) return;
    const period = body.period || String(new Date().getFullYear());

    if (Array.isArray(body.entries) || body.scope) {
      // Same unit conversion and strict amount parsing as a CSV row (units.cjs),
      // so the calculator and the importer give one number for one activity.
      const entries = (Array.isArray(body.entries) ? body.entries : [body]).map(prepareCalculatorEntry);

      // Scope 3 is a paid tier feature; calculating it here would hand a
      // starter account the number the upgrade is meant to buy.
      const plan = (req.billing && req.billing.plan) || 'starter';
      const scope3Check = canUseScope3(plan);
      if (!scope3Check.allowed && entries.some((entry) => normalizeScopeLabel(entry && entry.scope) === 'scope3')) {
        return res.status(402).json({
          success: false,
          code: 'upgrade_required',
          requiredPlan: scope3Check.requiredPlan,
          error: `Scope 3 workflows are included from the ${scope3Check.requiredPlan} plan up.`,
        });
      }

      // A preview prices the activity the way a new entry would be priced: by
      // the current catalog, from the activity alone. Without a version the engine
      // would read these as legacy rows and quote the frozen 2026-07-24 factors; and
      // a factor_value the client sends would pin the price (the engine honours a
      // stored row's pin), so the preview would disagree with the entry saved from
      // the same input.
      const preview = entries.map((entry) => {
        const given = entry && typeof entry === 'object' ? entry : {};
        return {
          scope: given.scope,
          category: given.category,
          source: given.source,
          amount: given.amount,
          unit: given.unit,
          activity_date: given.activity_date,
          catalog_version: CATALOG_VERSION,
        };
      });
      const summary = summarizeEntries(preview, { companyId: companyId, period: period });
      log('info', 'Calculator API completed', { companyId: companyId, period: period, entries: entries.length });
      return res.json(summary);
    }

    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });
    log('info', 'Calculator API completed', { companyId: companyId, period: period, entries: entries.length });
    return res.json(summary);
  } catch (err) {
    // Engine validation errors are client 400s; a DB outage surfacing through
    // loadEmissionEntries must not be mislabeled as bad input (nor leak the
    // driver message). classifyApiFailure splits the two.
    const failure = classifyApiFailure(err);
    if (failure.status >= 500) {
      log('error', 'Calculate failed on infrastructure', { error: err, userId: req.user && req.user.id });
    }
    return res.status(failure.status).json({ error: failure.message });
  }
});

// /api/emissions/summary takes only a 4-digit year for `period` — the
// calendar year the dashboard's year selector sends (and compares with the
// year before). Validating BEFORE the value
// becomes a cache key stops arbitrary strings from minting unbounded cache
// entries (PERF-003/PERF-010); a non-year period would have returned empty
// data anyway.
const SUMMARY_PERIOD_PATTERN = /^\d{4}$/;

app.get('/api/emissions/summary', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.query.company_id);
  if (!companyId) return;
  // defaultReportingYear is also what a report generated without a period covers.
  const period = req.query.period ? String(req.query.period) : defaultReportingYear();
  if (!SUMMARY_PERIOD_PATTERN.test(period)) {
    return res.status(400).json({ success: false, error: 'period must be a 4-digit year, e.g. 2026' });
  }

  try {
    const cacheKey = `summary:${companyId}:${period}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });
    // F-E-10: a row the engine cannot price is left out of every total; the
    // response says so (excluded_rows) and so does the log.
    if (summary.excluded_rows.count > 0) {
      log('warn', 'Emission entries excluded from totals', {
        companyId: companyId,
        period: period,
        count: summary.excluded_rows.count,
        reasons: summary.excluded_rows.reasons.map((group) => group.reason.slice(0, 200)),
      });
    }

    const priorYear = Number(period) - 1;
    const priorEntries = await loadEmissionEntries(companyId, String(priorYear));
    const priorSummary = summarizeEntries(priorEntries, { companyId: companyId, period: String(priorYear) });

    const response = { success: true, data: toDashboardSummary(summary, priorSummary), methodology: summary.methodology };
    cacheSet(cacheKey, response, 5 * 60 * 1000);
    return res.json(response);
  } catch (err) {
    log('error', 'Emissions summary failed', { error: err, companyId: companyId });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to load emissions summary' });
  }
});

app.get('/api/emissions/trend', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.query.company_id);
  if (!companyId) return;
  const period = req.query.period || 'monthly';
  const year = Number(req.query.year) || new Date().getFullYear();

  try {
    // PERF-004: buildTrend recomputed every row on every request. Cache per
    // (company, period, year) in the same store the summary cache uses —
    // every entry-changing path drops the company's keys through
    // invalidateCompanyCache (CSV ingest, /api/entries, account deletion),
    // and the size cap bounds key cardinality.
    const cacheKey = `trend:${companyId}:${period}:${year}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const entries = await loadEmissionEntries(companyId);
    // H5: buildTrend covers all 12 months, filters to a single year, and
    // isolates per-row calc errors (delegated to summarizeEntries).
    const data = buildTrend(entries, { companyId: companyId, period: period, year: year });
    cacheSet(cacheKey, data, 5 * 60 * 1000);
    return res.json({ success: true, data: data });
  } catch (err) {
    log('error', 'Emissions trend failed', { error: err, companyId: companyId });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to load emissions trend' });
  }
});

// ─── CSV import (K4) ───
// Two phases: ?dry_run=1 validates the whole file and stores nothing; the commit
// stores every row or none, as one import the customer can list and undo. An
// identical file is refused (409) unless the caller replaces the earlier import
// or imports it anyway; a retried commit with the same Idempotency-Key returns
// the stored import. Rows are priced and pinned like manual entries and keep
// created_at as the time they were stored; the activity date decides the period.
// server-csv-import-routes.cjs has the handlers and their transactions.
const csvImportHandlers = createCsvImportHandlers({
  pool: pgPool,
  requireCompanyAccess: requireCompanyAccess,
  loadFacilities: loadFacilities,
  invalidateCompanyCache: invalidateCompanyCache,
  log: log,
});
app.post('/api/ingest/csv', express.text({ type: ['text/*', 'application/csv'], limit: '100kb' }), apiAuthGuard, requirePlan('starter'), csvImportHandlers.ingest);
app.get('/api/ingest/imports', apiAuthGuard, requirePlan('starter'), csvImportHandlers.list);
// No requirePlan: like deleting an entry, undoing your own import stays possible
// after the trial ends (the K2 owner decision for DELETE /api/entries/:id).
app.post('/api/ingest/imports/:id/undo', express.json({ limit: '1kb' }), apiAuthGuard, csvImportHandlers.undo);

// requirePlan added: these reads return the customer's own paid data, so an
// expired trial or canceled subscription must lose access to them too. The
// dashboard summary/trend were already gated, but the same figures were
// reachable per-facility, and report download regenerates a fresh PDF from
// live data on every call.
app.get('/api/companies/:id/facilities', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.params.id);
  if (!companyId) return;
  // loadFacilities throws when the data store is unavailable.
  // Express 4 does not catch async handler rejections, and the process-level
  // unhandledRejection handler calls process.exit(1) — so an unguarded await
  // here turns one transient DB error into a full outage for every tenant.
  try {
    const facilities = await loadFacilities(companyId);
    return res.json({ success: true, data: facilities });
  } catch (err) {
    log('error', 'Facilities list failed', { error: err, companyId });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to load facilities' });
  }
});

// Canonical facility types — the set the app's facility concepts use. A short enum keeps junk (and unbounded strings) out
// of the column, which had no CHECK constraint and no server-side validation
// (API-003). The list and the string bound (FACILITY_FIELD_MAX, mirroring the
// facilities.name cap in initial-schema.sql) live in server-company.cjs, which
// validates facility renames with the same limits.
const FACILITY_TYPES = new Set(FACILITY_TYPE_LIST);

app.post('/api/companies/:id/facilities', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.params.id);
  if (!companyId) return;
  const body = req.body || {};
  // API-003: name/type/city must be non-empty bounded strings. Previously type
  // and city were only presence-checked, so non-strings were coerced
  // (String({}) → "[object Object]") and 100KB values were persisted. `type`
  // is additionally an enum.
  if (typeof body.name !== 'string' || !body.name.trim() ||
      typeof body.type !== 'string' || !body.type.trim() ||
      typeof body.city !== 'string' || !body.city.trim()) {
    return res.status(400).json({ success: false, error: 'name, type, and city are required' });
  }
  const facilityName = body.name.trim();
  const facilityCity = body.city.trim();
  const facilityType = body.type.trim().toLowerCase();
  if (facilityName.length > FACILITY_FIELD_MAX || facilityCity.length > FACILITY_FIELD_MAX) {
    return res.status(400).json({ success: false, error: 'name and city must be 200 characters or fewer' });
  }
  if (!FACILITY_TYPES.has(facilityType)) {
    return res.status(400).json({ success: false, error: 'type must be one of: ' + FACILITY_TYPE_LIST.join(', ') });
  }

  try {
    // Facility cap. requirePlan has already attached req.billing. This has to
    // sit inside the try — the data store can be unavailable, and Express 4
    // does not catch async rejections, so an uncaught one would hang the
    // request instead of erroring cleanly.
    const plan = (req.billing && req.billing.plan) || 'starter';
    const capReached = function (facilityCheck) {
      return res.status(402).json({
        success: false,
        code: 'upgrade_required',
        requiredPlan: facilityCheck.requiredPlan,
        error: `Your ${plan} plan includes ${facilityCheck.limit} ${facilityCheck.limit === 1 ? 'facility' : 'facilities'}. Upgrade to ${facilityCheck.requiredPlan} to add more.`,
      });
    };

    // Count and insert in one transaction that locks the company row: a
    // count read before a separate INSERT let six parallel requests at a cap
    // of 1 create six facilities (F-X1-01).
    const outcome = await insertFacilityWithinCap(pgPool, {
      companyId: companyId, plan: plan, name: facilityName, type: facilityType, city: facilityCity,
    });
    if (outcome.refused) return capReached(outcome.refused);
    return res.status(201).json({ success: true, data: outcome.facility });
  } catch (err) {
    log('error', 'Facility create failed', { error: err, companyId });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to create facility' });
  }
});

// ─── Company profile, onboarding and facility edits (K5: F-B-03 = F-C-03) ───
// The company used to be invented on the first call and never renamed, and a
// facility could be created but not changed. server-company-routes.cjs owns the
// ownership rules (company id from the session, every statement scoped by it), the
// field allow-lists and the onboarding state. They need the database (no in-memory
// stand-in). Rate limiting is the global /api limiter, like the facility routes above.
const companyHandlers = createCompanyHandlers({ pool: pgPool, requireCompanyAccess: requireCompanyAccess, log: log });
app.get('/api/company', apiAuthGuard, requirePlan('starter'), companyHandlers.get);
app.patch('/api/companies/:id', express.json({ limit: '8kb' }), apiAuthGuard, requirePlan('starter'), companyHandlers.update);
app.post('/api/companies/:id/onboarding/skip', apiAuthGuard, requirePlan('starter'), companyHandlers.skipOnboarding);
app.patch('/api/companies/:id/facilities/:facilityId', express.json({ limit: '8kb' }), apiAuthGuard, requirePlan('starter'), companyHandlers.updateFacility);
app.delete('/api/companies/:id/facilities/:facilityId', apiAuthGuard, requirePlan('starter'), companyHandlers.removeFacility);

app.get('/api/facilities/:id/emissions', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    // Resolve the caller's own company FIRST. Loading the facility before the
    // tenant check made the response an existence oracle: a foreign-but-real
    // facility id returned 403 while a nonexistent one returned 404, letting
    // any authenticated user enumerate which sequential ids exist across all
    // tenants. Both cases now return an identical 404, and the lookup is scoped
    // by that company, so another tenant's row is never loaded.
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    const facility = await loadFacilityById(companyId, req.params.id);
    if (!facility) {
      return res.status(404).json({ success: false, error: 'Facility not found' });
    }
    const entries = await loadEmissionEntries(companyId);
    const result = buildFacilityEmissions([facility], entries);
    return res.json({ success: true, data: result[0] });
  } catch (err) {
    log('error', 'Facility emissions failed', { error: err, facilityId: req.params.id });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to load facility emissions' });
  }
});

// ─── Emission entries (K2) ───
// The calculator's only way to write entries. It used to insert and delete them
// through the records API as the browser role, where RLS checks ownership only:
// no plan, no trial end, no Scope 3 gate, and client-computed numbers stored as
// sent (F-D-01, F-E-05). server-entry-routes.cjs computes every value from the
// factor catalog and keeps the tenant's dashboard cache fresh.
const entryHandlers = createEntryHandlers({
  pool: pgPool,
  requireCompanyAccess: requireCompanyAccess,
  invalidateCompanyCache: invalidateCompanyCache,
  log: log,
});
app.get('/api/entries', apiAuthGuard, requirePlan('starter'), entryHandlers.list);
app.post('/api/entries', express.json({ limit: '8kb' }), apiAuthGuard, requirePlan('starter'), entryHandlers.create);
app.patch('/api/entries/:id', express.json({ limit: '8kb' }), apiAuthGuard, requirePlan('starter'), entryHandlers.update);
// No requirePlan: like export and delete-data, deleting your own entries stays
// possible after the trial ends (owner decision, docs/runbooks/k2-rollout.md).
app.delete('/api/entries/:id', apiAuthGuard, entryHandlers.remove);

// ─── Retired: Slice 6 compliance tracking (F-A-18 / F-E-07) ───
// Compliance status, deadlines and sign-off were dropped from the product, but
// the routes stayed and kept serving regulatory data that was wrong: SB 253
// "overdue" from 2026-01-01 (that date was never a filing deadline), a Scope 3
// row fixed at 2027-01-01 that flips to "due_soon" on 2026-10-03 for a schedule
// CARB has not set, CSRD "overdue" for every tenant, and an applicability check
// that used the pre-Omnibus thresholds. Nothing in src/ calls any of them.
//
// 410 Gone, not 404, so an integration that did call them learns the route is
// retired on purpose. No date, status or applicability verdict is served at all:
// regulatory dates belong on the reviewed public pages, not in an API table.
// The sign-off route carried no wrong data; it goes with the rest of the slice
// because nothing calls it and a sign-off nobody can review is not an audit
// trail.
function complianceRetired(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    success: false,
    error: 'Compliance tracking has been retired and this endpoint no longer returns data.',
  });
}

app.get('/api/companies/:id/compliance', complianceRetired);
app.get('/api/compliance/deadlines', complianceRetired);
app.post('/api/compliance/:id/signoff', complianceRetired);

// ─── Reports (K3: audit AUDIT-RUN-20260929 F-E-03, F-B-04, F-B-05, F-G-20) ───
// A report is computed ONCE, when it is generated, from the entries in its
// period, and stored with the exact PDF it was rendered to (reports.snapshot and
// reports.pdf, migrations/20260930110000_report-snapshots.sql). Downloads serve
// the stored bytes and never recompute. A report created before snapshots
// existed has nothing frozen to serve, and says so. Sign-off moves a draft to
// final; after that nothing about the report can change (409 here, and a DB
// trigger for any other writer). Reports need the database: the in-memory dev
// store is gone, because a second store was a second set of rules.

// At most 18 digits, like DB_ID in server-entry-routes.cjs: a longer id cannot exist
// (bigint) and would only reach Postgres as an out-of-range error, a 500 instead of a 404.
const REPORT_ID_PATTERN = /^\d{1,18}$/;
const REPORT_LIST_LIMIT = 200;
const REPORT_COLUMNS = `id, title, status, period, pdf_sha256, signed_off_by, signed_off_at, created_at,
  to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
  snapshot->'period'->>'label' AS period_label, snapshot->>'total_emissions_tCO2e' AS total_tco2e,
  snapshot->'by_scope' AS by_scope, snapshot->>'entry_count' AS entry_count`;
const LEGACY_REPORT_ERROR = 'This report was created before reports were stored as snapshots, so its figures were never frozen. It cannot be downloaded or signed off; generate a new report for the same period.';
const FINAL_REPORT_ERROR = 'This report is signed off and final. It cannot be changed or signed off again; generate a new report to include later data.';

function reportNotFound(res) {
  return res.status(404).json({ success: false, error: 'Report not found' });
}

// The API shape of a reports row. A row without a stored PDF predates
// snapshots: it is listed as legacy and never presented as frozen.
function toReportListItem(row) {
  const frozen = Boolean(row.pdf_sha256);
  return {
    id: String(row.id),
    title: row.title,
    status: frozen ? row.status : 'legacy',
    period: row.period,
    period_label: row.period_label || row.period || 'All time',
    period_start: row.period_start,
    period_end: row.period_end,
    generated_at: row.created_at,
    total_tco2e: frozen && row.total_tco2e != null ? Number(row.total_tco2e) : null,
    by_scope: frozen ? row.by_scope : null,
    entry_count: frozen && row.entry_count != null ? Number(row.entry_count) : null,
    pdf_sha256: row.pdf_sha256 || null,
    signed_off_by: row.signed_off_by || null,
    signed_off_at: row.signed_off_at || null,
    download_url: frozen ? `/api/reports/${row.id}/download` : null,
  };
}

app.get('/api/reports', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.query.company_id);
    if (!companyId) return;
    const [company, reports] = await Promise.all([
      pgPool.query('SELECT id, name FROM public.companies WHERE id = $1', [companyId]),
      pgPool.query(
        `SELECT ${REPORT_COLUMNS} FROM public.reports WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${REPORT_LIST_LIMIT}`,
        [companyId]
      ),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      success: true,
      company: { id: String(companyId), name: company.rows.length ? company.rows[0].name : null },
      default_period: defaultReportingYear(),
      reports: reports.rows.map(toReportListItem),
    });
  } catch (err) {
    log('error', 'Report list failed', { error: err, userId: req.user && req.user.id });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to load reports' });
  }
});

app.post('/api/companies/:id/reports/generate', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.params.id);
    if (!companyId) return;
    // No period asked for: the reporting year the dashboard opens on (F-B-05).
    // Anything but a calendar year or a date range is refused (F-E-03: "FY2025"
    // used to be saved as a final report that printed 0).
    const requested = req.body ? req.body.period : undefined;
    const parsed = parseReportPeriod(requested === undefined || requested === null || requested === '' ? defaultReportingYear() : requested);
    if (!parsed.ok) return res.status(400).json({ success: false, code: 'invalid_period', error: parsed.error });
    const period = parsed.period;

    // The same rows and the same summarizeEntries call as the dashboard.
    // The company row carries the reporting basis (Settings > Company): the
    // consolidation approach and base year print on this report, and a report
    // generated before they were set keeps saying "not specified" / "not set".
    const [entries, facilities, company] = await Promise.all([
      loadEmissionEntries(companyId, period.value),
      loadFacilities(companyId),
      pgPool.query('SELECT id, name, consolidation_approach, base_year FROM public.companies WHERE id = $1', [companyId]),
    ]);
    const generatedAt = new Date().toISOString();
    const snapshot = buildReportSnapshot({
      company: company.rows[0] || { id: companyId, name: null },
      period: period,
      entries: entries,
      facilities: facilities,
      generatedAt: generatedAt,
      generatedBy: req.user.id,
    });
    if (snapshot.entry_count === 0) {
      // Nothing to report is said, not saved as a zero report.
      return res.status(422).json({
        success: false,
        code: 'empty_period',
        error: snapshot.excluded_count
          ? `None of the ${snapshot.excluded_count} entries in ${period.label} could be calculated, so no report was created.`
          : `There are no emission entries in ${period.label}, so no report was created.`,
      });
    }

    // Counted here, once a report will be made, and not at the top: a refused period
    // (400) or an empty one (422) stores nothing, so it must not spend the company's
    // reports for the hour (VERIFY-FINAL-DATA D-4).
    if (!reportLimits.allowGenerate(res, companyId)) return;

    // The id is taken first so the PDF can print it; the row is then written
    // once, complete, and never updated except for its sign-off.
    const next = await queryWithRlsBypass("SELECT nextval(pg_get_serial_sequence('public.reports', 'id')) AS id", []);
    const reportId = String(next.rows[0].id);
    const pdf = renderReportPdf(snapshot, { reportId: reportId });
    const pdfSha256 = crypto.createHash('sha256').update(pdf).digest('hex');
    const inserted = await queryWithRlsBypass(
      `INSERT INTO public.reports
         (id, company_id, title, type, status, last_updated, signoff, period, period_start, period_end, snapshot, pdf, pdf_sha256, created_at)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, $3, 'carbon', 'draft', $4, 'pending', $5, $6, $7, $8, $9, $10, $4)
       RETURNING ${REPORT_COLUMNS}`,
      [reportId, companyId, 'Emissions report - ' + period.label, generatedAt, period.value, period.start, period.end,
        JSON.stringify(snapshot), pdf, pdfSha256]
    );
    log('info', 'Report generated', { reportId: reportId, companyId: companyId, period: period.value, entries: snapshot.entry_count });
    return res.json({
      success: true,
      report_id: reportId,
      download_url: `/api/reports/${reportId}/download`,
      report: toReportListItem(inserted.rows[0]),
    });
  } catch (err) {
    // Every throw past validation is infrastructure (store read, report insert)
    // or an internal engine fault, so respond generically instead of echoing
    // the internal error string.
    log('error', 'Report generation failed', { error: err, companyId: req.params.id });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to generate report' });
  }
});

app.get('/api/reports/:id/download', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    // Resolve the caller's own company FIRST, then look the report up scoped
    // to it: an unknown id and another tenant's id are identical 404s, so the
    // sequential ids cannot be enumerated across tenants.
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    if (!REPORT_ID_PATTERN.test(req.params.id)) return reportNotFound(res);
    const { rows } = await pgPool.query(
      'SELECT pdf, pdf_sha256 FROM public.reports WHERE id = $1 AND company_id = $2',
      [req.params.id, companyId]
    );
    if (rows.length === 0) return reportNotFound(res);
    const stored = rows[0];
    if (!stored.pdf || !stored.pdf_sha256) {
      return res.status(409).json({ success: false, code: 'legacy_report', error: LEGACY_REPORT_ERROR });
    }
    // Served exactly as stored. The digest check stops a damaged row from being
    // handed out as the document someone generated or signed off.
    const sha256 = crypto.createHash('sha256').update(stored.pdf).digest('hex');
    if (sha256 !== stored.pdf_sha256) {
      log('error', 'Stored report PDF failed its integrity check', { reportId: req.params.id, companyId: companyId });
      return res.status(500).json({ success: false, error: 'Failed to load report PDF' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ecoauditor-report-${req.params.id}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Report-SHA256', sha256);
    return res.send(stored.pdf);
  } catch (err) {
    log('error', 'Report download failed', { error: err, reportId: req.params.id });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to load report PDF' });
  }
});

app.post('/api/reports/:id/signoff', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    if (!REPORT_ID_PATTERN.test(req.params.id)) return reportNotFound(res);
    // Optional digest of the PDF the signer reviewed: a sign-off binds to those
    // exact bytes (audit review R2), so a different document is refused.
    const expected = req.body ? req.body.pdf_sha256 : undefined;
    if (expected !== undefined && expected !== null && !(typeof expected === 'string' && /^[0-9a-f]{64}$/.test(expected))) {
      return res.status(400).json({ success: false, error: 'pdf_sha256 must be the 64-character hex SHA-256 of the report PDF' });
    }
    const signed = await queryWithRlsBypass(
      `UPDATE public.reports
          SET status = 'final', signoff = 'completed', signed_off_by = $3, signed_off_at = now(), last_updated = now()
        WHERE id = $1 AND company_id = $2 AND status = 'draft' AND pdf_sha256 IS NOT NULL
          AND ($4::text IS NULL OR pdf_sha256 = $4::text)
        RETURNING ${REPORT_COLUMNS}`,
      [req.params.id, companyId, String(req.user.id), expected || null]
    );
    if (signed.rows.length) {
      log('info', 'Report signed off', { reportId: req.params.id, companyId: companyId });
      return res.json({ success: true, report: toReportListItem(signed.rows[0]) });
    }
    // Nothing was signed: say why (still scoped to the caller's company).
    const { rows } = await pgPool.query(
      'SELECT status, pdf_sha256 FROM public.reports WHERE id = $1 AND company_id = $2',
      [req.params.id, companyId]
    );
    if (rows.length === 0) return reportNotFound(res);
    if (!rows[0].pdf_sha256) return res.status(409).json({ success: false, code: 'legacy_report', error: LEGACY_REPORT_ERROR });
    if (rows[0].status === 'final') return res.status(409).json({ success: false, code: 'report_final', error: FINAL_REPORT_ERROR });
    return res.status(409).json({
      success: false,
      code: 'pdf_mismatch',
      error: 'This report is not the document you reviewed (its SHA-256 differs). Reload the report list and try again.',
    });
  } catch (err) {
    // restrict_violation comes from the frozen-report trigger: someone else
    // signed or changed the report first.
    if (err && err.code === '23001') {
      return res.status(409).json({ success: false, code: 'report_final', error: FINAL_REPORT_ERROR });
    }
    log('error', 'Report sign-off failed', { error: err, reportId: req.params.id });
    return res.status(failureStatus(err)).json({ success: false, error: 'Failed to sign off report' });
  }
});

app.get('/api/video', function (req, res) {
  const filePath = findVideoPath();
  if (!filePath) {
    return res.status(404).json({ error: 'Video not found' });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    log('error', 'Failed to stat video file', { path: filePath, error: err });
    return res.status(500).json({ error: 'Internal server error' });
  }

  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parsed = parseRange(range, fileSize);
    if (parsed.invalid) {
      return res.status(416).setHeader('Content-Range', 'bytes */' + fileSize).end();
    }

    const start = parsed.start;
    const end = parsed.end;
    const chunkSize = parsed.contentLength;

    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
    });

    const stream = fs.createReadStream(filePath, { start: start, end: end });
    stream.on('error', function (err) {
      log('error', 'Video stream error', { error: err });
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      else res.end();
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', function (err) {
      log('error', 'Video stream error', { error: err });
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      else res.end();
    });
    stream.pipe(res);
  }
});

// ─── Server-rendered pages (F-F-01) ───
// Before express.static, which would answer /sitemap.xml and /blog/ with the
// files in static/: a sitemap without the posts and a blog index without a post.
// /blog also matches /blog/ (non-strict routing) and /blog/:slug matches
// /blog/<slug>/; the handlers redirect the bare form to the slash form, which is
// the canonical one. A URL no handler here accepts (/blog/a/b) reaches the 404
// below, it is not the homepage.
app.get('/sitemap.xml', pages.sitemap);
app.get('/blog', pages.blogIndex);
app.get('/blog/:slug', pages.blogPost);

// ─── Static files with cache headers ───
// A directory requested without its trailing slash (/pricing) is redirected to
// the slash form, which is what scripts/prerender.mjs writes and the canonical
// URL of every page, so internal links are written in that form (F-F-12).
app.use(express.static(path.join(__dirname, 'static'), {
  setHeaders: function (res, filePath) {
    // Extracted to server-http-utils.cjs (RT-05) so the policy is testable
    // without booting the server.
    const cacheControl = getStaticCacheHeaders(filePath);
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  },
}));

app.get(['/features', '/features/'], function (_req, res) {
  res.redirect(308, '/#features');
});

// Reserved legacy paths that should not soft-404 to the homepage.
app.get(['/dashboard', '/dashboard/'], function (_req, res) {
  res.redirect(302, '/login');
});

// Catch-all for unknown /api routes so they return JSON 404s instead of the
// SPA HTML shell.
app.use('/api', function (_req, res) {
  res.status(404).json({ error: 'Not found' });
});

// ─── SPA fallback ───
// Only serve the SPA shell with a 200 for known client-side routes. Everything
// else is a real 404 so crawlers don't index an infinite duplicate-content
// space of soft-404 homepages. Both answers use static/app-shell.html (noindex,
// empty #root), not the prerendered homepage: that one painted the marketing
// hero on every hard load of /app/* and /auth/* (F-F-03). They are sent
// no-cache: a cached shell after a deploy would request hashed asset filenames
// that no longer exist, a blank /app until reload. For an unknown URL the
// client router has no route and renders the same NotFound screen as a link
// clicked inside the app (F-C-25; this used to be a separate inline page).
// /blog/<slug> never reaches here: pages.blogPost answers it, with its own 404
// for an unknown slug.
app.get('*', function (req, res) {
  const spaRoots = ['/app', '/auth'];
  const isKnownSpa = spaRoots.some(function (root) {
    return req.path === root || req.path.startsWith(root + '/');
  });
  if (isKnownSpa) {
    return pages.appShell(req, res);
  }
  return pages.notFound(req, res);
});

// ─── Terminal error handler (F-D-04, F-G-06) ───
// Every error ends here: body-parser failures (fixed 400/413/415 messages, as
// F-D-04 made them) and every handler failure, thrown or rejected (the
// forwarding installed next to express() above). A handler failure is logged
// once, with stack and driver code, and answered with a fixed message and the
// request id: never a stack, path or SQL text. See server-errors.cjs. This must
// stay the LAST middleware.
app.use(createErrorHandler({ log: log, classifyApiFailure: classifyApiFailure }));

// ─── Structured logging ───
function log(level, message, context) {
  const entry = {
    level: level,
    timestamp: new Date().toISOString(),
    message: toLogValue(message),
    // Explicit context wins; otherwise take the id of whichever request (if
    // any) this call is running inside (INFRA-007).
    requestId: context && context.requestId || requestIdStore.getStore() || undefined,
  };
  if (context) {
    // An Error becomes { name, message, code, stack } instead of {} (F-G-08), and
    // credentials in any string (a connection string in a driver message) are
    // redacted (server-errors.cjs). level, timestamp, message and requestId are
    // the line's own: a context key of the same name never overwrites them.
    Object.keys(context).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(entry, k)) entry[k] = toLogValue(context[k]);
    });
  }
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

// ─── Global error handlers ───
// These used to exit on every unhandled rejection, so one missed await took every
// tenant down (F-G-06). A rejection is now logged and the process continues; an
// uncaught exception, or ten rejections within a minute, is logged and the
// process exits after a short grace so Railway restarts it (restartPolicyType
// ON_FAILURE). Needs a human security review (see the obs-a report).
let server;

const processGuards = createProcessGuards({
  log: log,
  stopServer: function () { if (server) server.close(); },
});
process.on('uncaughtException', processGuards.onUncaughtException);
process.on('unhandledRejection', processGuards.onUnhandledRejection);

// ─── Graceful shutdown ───

async function startServer() {
  if (process.env.NODE_ENV === 'production' && INSFORGE_BASE_URL && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when InsForge authentication is configured');
  }

  // Half-configured billing is worse than no billing: the site stays up and
  // looks healthy while real customers hit dead redirects, unverifiable
  // webhooks, or "Invalid plan selection" on every buy button. Fail loudly at
  // boot instead of discovering it from a support ticket.
  if (process.env.NODE_ENV === 'production' && STRIPE_SECRET_KEY) {
    if (!process.env.APP_URL) {
      throw new Error(
        'APP_URL is required when STRIPE_SECRET_KEY is set — Stripe would redirect paying customers to http://localhost:3000'
      );
    }
    if (!STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set — without it every Stripe webhook is rejected with 503 and paying customers lose access at their first renewal'
      );
    }
    const missingPrices = [
      'STRIPE_PRICE_STARTER_MONTHLY',
      'STRIPE_PRICE_STARTER_ANNUAL',
      'STRIPE_PRICE_GROWTH_MONTHLY',
      'STRIPE_PRICE_GROWTH_ANNUAL',
      'STRIPE_PRICE_PRO_MONTHLY',
      'STRIPE_PRICE_PRO_ANNUAL',
      // Through resolvePriceId, so a VITE_-only Railway deploy — which is what
      // production actually sets — is not reported as missing every boot.
    ].filter(function (name) { return !resolvePriceId(name); });
    if (missingPrices.length) {
      log('warn', 'Stripe price IDs missing — those plans cannot be purchased', { missing: missingPrices });
    }
  }
  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
    const database = await probeDatabase();
    if (!database.ok) throw new Error('DATABASE_URL is configured but unreachable');
  }

  // Configuration a boot survives but an owner has to fix (F-G-11, F-G-13,
  // F-F-18): one structured warning per variable, never its value. The list,
  // including the missing CONSENT_IP_PEPPER warning and why it does not stop the
  // boot, is in server-config.cjs.
  serverConfig.warnings.forEach(function (warning) {
    log('warn', warning.message, { variable: warning.variable, action: warning.action });
  });

  server = app.listen(PORT, '0.0.0.0', function () {
    var videoPath = findVideoPath();
    log('info', 'Eco-Auditor listening', { port: PORT, video: videoPath || 'not-found' });
  });
}

startServer().catch(function (err) {
  log('error', 'Server startup failed', { error: err });
  process.exit(1);
});

function shutdown(signal) {
  log('info', 'Shutting down', { signal: signal });
  if (!server) return process.exit(0);
  server.close(function () {
    log('info', 'All connections closed');
    process.exit(0);
  });
  setTimeout(function () {
    log('error', 'Forced shutdown after timeout');
    process.exit(1);
  }, 9000);
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });
