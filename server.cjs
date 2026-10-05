const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('node:zlib');
const { AsyncLocalStorage } = require('node:async_hooks');
const {
  calculateEntry,
  summarizeEntries,
  buildTrend,
  toDashboardSummary,
  parseEmissionCsv,
  getComplianceStatus,
  buildFacilityEmissions,
  normalizeScope,
} = require('./emissions-engine.cjs');
const { allDeadlines } = require('./compliance-deadlines.cjs');
const {
  buildSecurityHeaders,
  canUseDevAuth,
  classifyApiFailure,
  resolveAuthorizedCompanyId,
  sanitizeChatState,
  sanitizeLeadPayload,
} = require('./server-security.cjs');
const {
  billingStateFromCompany,
  planAccessDecision,
  planFromPriceId,
  priceIdFromEnv,
  resolvePlanPriceId,
  shouldRetryWebhook,
  canAddFacility,
  canImportCsv,
  planLimits,
  canUseScope3,
  subscriptionRecordFromStripe,
  trialEligiblePriceIds,
} = require('./server-billing.cjs');
const {
  buildReportText,
  createSimplePdf,
} = require('./src/lib/reports/report-generator.cjs');
const { createPublishHandler, sanitizeBlogHtml } = require('./server-publish.cjs');
const { parseRange, getStaticCacheHeaders } = require('./server-http-utils.cjs');

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
const APP_BASE_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

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
    // stripe package not installed — billing routes will return 503
  }
}

// ─── InsForge auth backend (used by authGuard) ───
const INSFORGE_BASE_URL =
  process.env.INSFORGE_BASE_URL || process.env.VITE_INSFORGE_BASE_URL;

// ─── Postgres pool (lazy init; used by billing user lookup) ───
let pgPool = null;
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
    // pg-pool emits 'error' on the pool when an IDLE client fails (DB restart,
    // maintenance, idle timeout). An unhandled EventEmitter 'error' throws,
    // reaches the uncaughtException handler below, and exits the process — so a
    // dropped idle connection would take down the whole server. Log and carry on;
    // the pool discards the broken client and opens a new one on next use.
    pgPool.on('error', function (err) {
      log('error', 'Idle Postgres client error', { error: String(err) });
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
      log('error', 'Runtime table migration/blog seed failed', { error: migErr.message });
    });
  } catch (err) {
    // pg package not installed — billing routes that need user lookup will return 503
  }
}

// ─── Blog seed data (inline so it ships inside the Docker image) ───
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
      body_html: '<h2>What SB 253 Means for Small and Mid-Sized Businesses</h2><p>California\'s Climate Corporate Data Accountability Act (SB 253) requires companies with over $1 billion in revenue operating in California to disclose their greenhouse gas (GHG) emissions. While the threshold places the direct reporting burden on large enterprises, the ripple effects reach small and mid-sized businesses (SMBs) throughout their supply chains.</p><p>If your SMB supplies goods or services to a covered entity, you will increasingly be asked to provide emissions data as part of their Scope 3 reporting. Getting ahead of this curve means building a defensible GHG inventory now — before it becomes a contract requirement.</p><h2>Understanding the Reporting Thresholds</h2><p>SB 253 applies a two-phase timeline:</p><ul><li><strong>Phase 1 (2026):</strong> Companies with revenue over $2 billion report Scope 1 and Scope 2 emissions.</li><li><strong>Phase 2 (2027):</strong> All covered companies ($1B+ revenue) report Scope 1, 2, and begin Scope 3.</li><li><strong>Phase 3 (2028+):</strong> Full Scope 3 reporting with third-party assurance.</li></ul><p>As an SMB, you are not directly covered by these thresholds. But your largest customers are. They need your emissions data to complete their own disclosures — and they will ask for it through procurement surveys, supplier portals, and ESG questionnaires.</p><h2>Building a Defensible GHG Inventory</h2><p>A defensible GHG inventory is one that can withstand external scrutiny — from auditors, customers, and regulators. The GHG Protocol Corporate Standard provides the accounting framework:</p><ol><li><strong>Define organizational and operational boundaries.</strong> Decide which facilities, vehicles, and activities are included. Use either the equity share or control approach.</li><li><strong>Collect activity data.</strong> Gather utility bills, fuel receipts, purchase records, and freight manifests. The more granular, the better.</li><li><strong>Apply emission factors.</strong> Convert activity data (therms, kWh, gallons, dollars) into CO2e using published factors from EPA, eGRID, and DEFRA.</li><li><strong>Document your methodology.</strong> Record which factors you used, where data came from, and any assumptions. This is what auditors check.</li></ol><h2>Scope 3: The Supply Chain Challenge</h2><p>Scope 3 emissions — those in your value chain — typically account for 70-90% of a company\'s total carbon footprint. For SMBs, the most relevant Scope 3 categories are:</p><ul><li><strong>Category 1: Purchased goods and services</strong> — The emissions embedded in everything you buy, from raw materials to office supplies.</li><li><strong>Category 4: Upstream transportation</strong> — Freight, shipping, and logistics.</li><li><strong>Category 11: Use of sold products</strong> — If your products consume energy during their lifetime.</li></ul><p>Start with a spend-based approach for Category 1: multiply purchase dollar amounts by industry-average emission factors. It is less precise than supplier-specific data, but it is defensible and scalable.</p><h2>How Eco-Auditor Helps</h2><p>Eco-Auditor automates the heavy lifting of GHG accounting for SMBs:</p><ul><li><strong>Emission factor library:</strong> Pre-loaded with EPA, eGRID, DEFRA, and GHG Protocol factors, updated quarterly.</li><li><strong>Scope 1, 2, and 3 calculations:</strong> Built-in formulas for stationary combustion, purchased electricity, purchased goods, and freight.</li><li><strong>SB 253-ready reports:</strong> Export disclosures in the format your customers\' auditors expect.</li><li><strong>Supply chain surveys:</strong> Send a single link to your suppliers and auto-calculate their contribution to your Scope 3.</li></ul><h2>Key Takeaways</h2><ul><li>SB 253 does not directly regulate SMBs, but supply chain pressure makes compliance unavoidable.</li><li>Start with Scope 1 and 2 — they are the easiest to measure and the first thing customers ask about.</li><li>Use spend-based methods for Scope 3 until you can collect supplier-specific data.</li><li>Document everything — a defensible methodology is worth more than precise numbers.</li></ul>',
      faq: JSON.stringify([
        { question: 'Does SB 253 apply to small businesses?', answer: 'SB 253 directly applies to companies with over $1 billion in revenue operating in California. However, SMBs in the supply chains of covered companies will be asked to provide emissions data as part of Scope 3 reporting requirements.' },
        { question: 'What is the deadline for SB 253 reporting?', answer: 'Phase 1 reporting (Scope 1 and 2 for companies over $2B revenue) begins in 2026. Full Scope 3 reporting with third-party assurance is required by 2028.' },
        { question: 'How do I calculate Scope 3 emissions as an SMB?', answer: 'Start with a spend-based approach: multiply purchase dollar amounts by industry-average emission factors. This provides a defensible estimate without requiring supplier-specific data.' },
        { question: 'What emission factors should I use?', answer: 'Use EPA Center for Corporate Climate Leadership factors for US operations, eGRID for electricity, and DEFRA for international activities. Eco-Auditor includes all of these in its pre-loaded factor library.' },
      ]),
      internal_links: JSON.stringify([
        { href: 'https://ecoauditor.io/features', anchor: 'Eco-Auditor features' },
        { href: 'https://ecoauditor.io/methodology', anchor: 'GHG methodology' },
      ]),
      external_links: JSON.stringify([
        { href: 'https://ghgprotocol.org/corporate-standard', anchor: 'GHG Protocol Corporate Standard' },
        { href: 'https://ww2.arb.ca.gov/our-work/programs/climate-corporate-data-accountability', anchor: 'CARB SB 253 program page' },
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
      body_html: '<h2>Why Scope 3 Matters for SMBs</h2><p>Scope 3 emissions — the indirect emissions in your value chain — typically represent 70-90% of a company\'s total carbon footprint. For small and mid-sized businesses, Scope 3 can feel overwhelming because it encompasses everything from purchased goods to employee commuting. But ignoring it is no longer an option.</p><p>Your enterprise customers need your emissions data to complete their own Scope 3 disclosures. Regulators like California\'s CARB are tightening reporting requirements. And investors increasingly factor carbon exposure into risk assessments. The good news: you do not need to measure all 15 Scope 3 categories to be defensible. You need to measure the ones that matter.</p><h2>The 15 Scope 3 Categories — Ranked for SMBs</h2><p>The GHG Protocol defines 15 Scope 3 categories. For most SMBs, only a handful are material:</p><h3>High priority (measure first)</h3><ul><li><strong>Category 1 — Purchased goods and services:</strong> The emissions embedded in everything you buy. Usually the largest Scope 3 category for product-based businesses.</li><li><strong>Category 4 — Upstream transportation and distribution:</strong> Freight, shipping, and logistics emissions from moving your inputs.</li><li><strong>Category 11 — Use of sold products:</strong> If your products consume energy during use, this can dwarf everything else.</li></ul><h3>Medium priority (estimate when feasible)</h3><ul><li><strong>Category 5 — Waste generated in operations:</strong> Use waste contractor data or estimate by waste type and volume.</li><li><strong>Category 6 — Business travel:</strong> Flight and hotel data from expense systems.</li><li><strong>Category 7 — Employee commuting:</strong> Survey-based or estimated by office size and region.</li></ul><h3>Low priority (screen and skip if immaterial)</h3><ul><li><strong>Categories 2, 3, 8, 9, 10, 12, 13, 14, 15:</strong> For most SMBs, these are either zero, negligible, or not applicable. Document that you screened them and explain why they are immaterial.</li></ul><h2>How to Measure Scope 3 Without a Sustainability Team</h2><p>You do not need a dedicated sustainability team to build a credible Scope 3 inventory. Here is the practical path:</p><ol><li><strong>Start with spend data.</strong> Export your accounts payable ledger and categorize purchases by industry sector. Multiply each category by an EPA or DEFRA spend-based emission factor.</li><li><strong>Pull freight records.</strong> Your shipping invoices contain mode, distance, and weight. Apply the EPA SmartWay factors to estimate Category 4.</li><li><strong>Estimate product use.</strong> If you sell physical products that consume energy, estimate lifetime energy consumption and multiply by the grid emission factor.</li><li><strong>Document what you skipped and why.</strong> A screening explanation for the categories you did not measure is itself part of a defensible inventory.</li></ol><h2>Building a Defensible Methodology</h2><p>Defensibility means your numbers can survive external review. Three principles:</p><ul><li><strong>Traceability:</strong> Every number should link back to a source document.</li><li><strong>Consistency:</strong> Use the same emission factors and boundary definitions year over year.</li><li><strong>Transparency:</strong> Document your assumptions, exclusions, and estimation methods.</li></ul><h2>How Eco-Auditor Simplifies Scope 3</h2><p>Eco-Auditor is built specifically for SMBs navigating Scope 3 for the first time:</p><ul><li><strong>Spend-based Category 1 calculator:</strong> Upload your AP ledger and get instant CO2e estimates.</li><li><strong>Freight emission estimator:</strong> Enter mode, distance, and weight to get Category 4 emissions.</li><li><strong>Pre-loaded emission factors:</strong> EPA, eGRID, DEFRA, and GHG Protocol factors — updated quarterly.</li><li><strong>Scope 3 screening template:</strong> Document which categories you assessed, measured, or excluded.</li><li><strong>Customer-ready exports:</strong> Generate reports in the format your enterprise customers\' auditors expect.</li></ul><h2>Key Takeaways</h2><ul><li>You do not need to measure all 15 Scope 3 categories. Focus on the 3-5 that are material to your business.</li><li>Spend-based methods are defensible for Category 1 — refine with supplier-specific data over time.</li><li>Documentation and screening explanations are part of a defensible inventory, not optional extras.</li><li>Start now. Your enterprise customers are already asking for this data.</li></ul>',
      faq: JSON.stringify([
        { question: 'Which Scope 3 categories should an SMB measure first?', answer: 'Start with Category 1 (purchased goods and services), Category 4 (upstream transportation), and Category 11 (use of sold products). These typically represent the largest share of Scope 3 emissions for SMBs.' },
        { question: 'Is spend-based Scope 3 reporting defensible?', answer: 'Yes. The GHG Protocol explicitly accepts spend-based methods as a valid estimation approach for Scope 3 Category 1. Document your data sources, emission factors, and assumptions.' },
        { question: 'How do I screen Scope 3 categories I decide not to measure?', answer: 'Document which categories you assessed, why they are immaterial, and keep this screening explanation as part of your inventory. This is standard GHG Protocol practice.' },
        { question: 'Do I need third-party assurance for Scope 3?', answer: 'Under SB 253, third-party assurance for Scope 3 is required starting in 2028 for covered companies. SMBs should prepare for assurance-level data quality but are not directly subject to the requirement.' },
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
      body_html: '<h2>Why SMBs Need Carbon Accounting Software Now</h2><p>Carbon accounting used to be a spreadsheet exercise managed by an external consultant once a year. In 2026, that approach no longer holds up. Regulatory pressure from SB 253, CBAM, and SEC climate disclosure rules means emissions data needs to be audit-ready, continuously updated, and defensible.</p><p>For SMBs, the challenge is finding software that fits your budget and team size without sacrificing the rigor that enterprise customers and regulators expect. Here is what to look for.</p><h2>Must-Have Features for SMB Carbon Accounting</h2><h3>1. Pre-loaded emission factor libraries</h3><p>Your software should ship with emission factors from EPA, eGRID, DEFRA, and the GHG Protocol — not require you to research and input them manually. Factors should be versioned, sourced, and updated at least quarterly.</p><h3>2. Scope 1, 2, and 3 support</h3><p>Many tools handle Scope 1 and 2 well but treat Scope 3 as an afterthought. For SMBs in supply chains of regulated companies, Scope 3 is where the scrutiny is. Look for spend-based Category 1 calculation, freight estimation, and a screening template.</p><h3>3. Audit-ready documentation</h3><p>Every calculation should be traceable to its source data and emission factor. Look for audit trails that record who entered data, when it was modified, and which factors were applied.</p><h3>4. Customer-ready reporting</h3><p>Can the tool export reports in the formats your enterprise customers request? CDP, GRI, TCFD, and custom supplier questionnaire formats should all be supported.</p><h3>5. Supply chain survey tools</h3><p>The best way to improve Scope 3 data quality is to collect primary data from your suppliers. Look for tools that let you send a single survey link and auto-calculate supplier contributions.</p><h2>Pricing Models: What Makes Sense for SMBs</h2><ul><li><strong>Per-facility pricing:</strong> Charged based on the number of facilities. Gets expensive for distributed operations.</li><li><strong>Per-user pricing:</strong> Charged per seat. Best for teams where only a few people need access.</li><li><strong>Tiered plans:</strong> Fixed monthly or annual price with feature gates. Best for SMBs — predictable cost, no surprises.</li></ul><p>Eco-Auditor uses tiered pricing (Starter, Growth, Pro) with no per-facility or per-user penalties.</p><h2>Red Flags to Watch For</h2><ul><li><strong>"AI-generated" emission estimates with no methodology:</strong> If a tool gives you a carbon number without showing the underlying factors, it is not defensible.</li><li><strong>No Scope 3 support:</strong> Tools that only cover Scope 1 and 2 leave you unprepared for supply chain reporting requests.</li><li><strong>Annual-only factor updates:</strong> Emission factors change as grids decarbonize. If your tool updates once a year, your numbers are stale within months.</li><li><strong>No data export:</strong> If you cannot export your raw data, you are locked in.</li></ul><h2>The Spreadsheet Question</h2><p>Many SMBs start with Excel. That is fine for a first-pass estimate, but spreadsheets break down fast: no version control on emission factors, no audit trail, no validation, no factor updates. If you are spending more than two hours a month maintaining a carbon spreadsheet, dedicated software will pay for itself.</p><h2>How Eco-Auditor Compares</h2><ul><li><strong>Pre-loaded factors:</strong> EPA, eGRID, DEFRA, GHG Protocol — updated quarterly.</li><li><strong>All three scopes:</strong> Scope 1, 2, and 3 with spend-based methods and screening templates.</li><li><strong>Audit-ready:</strong> Every calculation links to source data, factor version, and methodology.</li><li><strong>Customer-ready exports:</strong> CDP, GRI, TCFD, and custom formats.</li><li><strong>Supply chain surveys:</strong> Send one link, auto-calculate supplier contributions.</li><li><strong>Tiered pricing:</strong> Starter at $149/month, no per-facility or per-user penalties.</li></ul><h2>Key Takeaways</h2><ul><li>Carbon accounting software is no longer optional for SMBs in regulated supply chains.</li><li>Look for pre-loaded emission factors, full Scope 3 support, audit trails, and customer-ready reporting.</li><li>Avoid tools with opaque estimates, no Scope 3, or no data export.</li><li>Tiered pricing without per-facility penalties is the SMB-friendly model.</li></ul>',
      faq: JSON.stringify([
        { question: 'How much does carbon accounting software cost for an SMB?', answer: 'Carbon accounting software for SMBs typically ranges from $149 to $999 per month. Eco-Auditor offers tiered plans starting at $149/month with no per-facility or per-user penalties.' },
        { question: 'Can I use Excel for carbon accounting?', answer: 'Excel works for a first-pass estimate but breaks down due to lack of version control, audit trails, emission factor updates, and validation. Dedicated software saves time and reduces errors.' },
        { question: 'What emission factors should carbon accounting software include?', answer: 'Look for EPA, eGRID, DEFRA, and GHG Protocol factors. They should be versioned, sourced, and updated at least quarterly.' },
        { question: 'Do SMBs need Scope 3 reporting software?', answer: 'Yes. Enterprise customers in regulated supply chains require Scope 3 data from their suppliers. Look for software with spend-based Category 1 calculation and screening templates.' },
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
      body_html: '<h2>What Is CBAM and Why Should SMBs Care?</h2><p>The EU Carbon Border Adjustment Mechanism (CBAM) is a carbon tariff on imported goods entering the European Union. It targets carbon-intensive sectors — iron and steel, aluminum, cement, fertilizers, electricity, and hydrogen — and requires importers to report the embedded emissions of their products.</p><p>If your SMB manufactures, processes, or supplies goods in any CBAM sector, you are in scope — even if you never directly import into the EU. Your EU-based customers need your emissions data to comply with CBAM reporting obligations.</p><h2>CBAM Timeline: What Is Happening and When</h2><ul><li><strong>2023-2025 (Transitional period):</strong> Importers must report embedded emissions quarterly. No financial obligation yet.</li><li><strong>2026 (Definitive period begins):</strong> CBAM certificates must be purchased for embedded emissions. Financial liability starts.</li><li><strong>2026-2034:</strong> Phase-out of free EU ETS allowances, increasing the effective CBAM cost per tonne of CO2e.</li></ul><p>For SMBs, the transitional period is the window to get your emissions data in order. By 2026, your EU customers will need verified embedded emissions numbers — not estimates.</p><h2>Understanding Embedded Emissions</h2><p>CBAM focuses on "embedded emissions" — the direct emissions from producing a good, plus the emissions from electricity consumed in production. For SMBs, this means:</p><ul><li><strong>Scope 1 (direct):</strong> Combustion from your furnaces, boilers, and vehicles used in production.</li><li><strong>Scope 2 (electricity):</strong> Grid electricity consumed in manufacturing processes.</li><li><strong>Not included (for CBAM purposes):</strong> Upstream Scope 3 emissions from purchased goods, transportation, or waste. CBAM\'s boundary is narrower than a full GHG inventory.</li></ul><h2>How to Calculate Embedded Emissions for CBAM</h2><ol><li><strong>Identify CBAM goods.</strong> Determine which of your products fall under the six CBAM sectors. HS codes and product descriptions determine coverage.</li><li><strong>Allocate emissions to products.</strong> If you produce multiple products, use a rational allocation method — mass-based, economic, or physical-unit-based.</li><li><strong>Calculate specific embedded emissions (SEE).</strong> Total direct + electricity emissions divided by production volume. Express as tCO2e per tonne of product.</li><li><strong>Document your installation boundary.</strong> Map which processes, equipment, and facilities contribute to the CBAM good\'s production.</li></ol><h2>What Your EU Customers Will Ask For</h2><p>EU importers need to submit CBAM reports quarterly. To do so, they need from you:</p><ul><li>The total quantity of goods imported (in tonnes)</li><li>The specific embedded emissions per tonne</li><li>The production installation\'s name, address, and country</li><li>The emission factor for electricity used in production</li><li>A description of the production process and system boundary</li></ul><p>If you cannot provide this data, your EU customer must use default values (which are deliberately set high to encourage actual reporting). This makes your product less competitive.</p><h2>How to Prepare as an SMB</h2><ol><li><strong>Audit your product portfolio.</strong> Identify any products in CBAM sectors. Check HS codes.</li><li><strong>Map your installation boundary.</strong> Document which processes and equipment produce CBAM goods.</li><li><strong>Start tracking production-specific energy use.</strong> Sub-meter electricity and fuel use for CBAM production lines.</li><li><strong>Calculate your SEE now.</strong> Even a rough estimate tells you whether CBAM will be a material cost.</li><li><strong>Prepare a CBAM data pack.</strong> Create a standard report you can send to any EU customer.</li></ol><h2>How Eco-Auditor Helps with CBAM</h2><ul><li><strong>Product-level emission allocation:</strong> Allocate facility emissions to specific products using mass-based or economic methods.</li><li><strong>Sub-metering support:</strong> Track electricity and fuel use by production line.</li><li><strong>CBAM data pack export:</strong> Generate a standard CBAM report with installation details, SEE, electricity factors, and methodology.</li><li><strong>EU grid emission factors:</strong> Pre-loaded with EU Member State grid factors.</li></ul><h2>Key Takeaways</h2><ul><li>CBAM affects SMBs that produce or supply goods in six carbon-intensive sectors — even if they never directly import into the EU.</li><li>CBAM\'s boundary is narrower than full GHG accounting: direct production emissions plus electricity, allocated to specific products.</li><li>Your EU customers need verified embedded emissions data. Without it, they must use punitive default values.</li><li>Start calculating your specific embedded emissions now — preparation takes months, not weeks.</li></ul>',
      faq: JSON.stringify([
        { question: 'Does CBAM apply to small businesses?', answer: 'CBAM applies to importers of covered goods into the EU. SMBs that supply goods in CBAM sectors to EU-based customers must provide embedded emissions data for those customers to comply.' },
        { question: 'What is the difference between CBAM embedded emissions and Scope 3 emissions?', answer: 'CBAM embedded emissions include only direct production emissions (Scope 1) and electricity consumption (Scope 2) allocated to a specific product. Scope 3 includes all value chain emissions. CBAM\'s boundary is narrower.' },
        { question: 'When does CBAM start charging for emissions?', answer: 'The transitional period (reporting only) runs from 2023 to 2025. The definitive period with financial obligations begins in 2026, when importers must purchase CBAM certificates.' },
        { question: 'How are embedded emissions allocated to products?', answer: 'Use mass-based allocation (emissions divided by product weight), economic allocation (by revenue share), or physical-unit allocation. Document your chosen method and apply it consistently.' },
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

const sampleEmissionEntries = [
  { id: 'seed-1', company_id: 'test-company-1', facility_id: 'facility-1', scope: '1', category: 'stationary_combustion', source: 'natural_gas', amount: 345943, unit: 'therms', method: 'calculation', confidence: 90, created_at: '2026-01-15T00:00:00.000Z' },
  { id: 'seed-2', company_id: 'test-company-1', facility_id: 'facility-2', scope: '2', category: 'purchased_electricity', source: 'CAMX', amount: 6710, unit: 'MWh', method: 'calculation', confidence: 97, created_at: '2026-02-15T00:00:00.000Z' },
  { id: 'seed-3', company_id: 'test-company-1', facility_id: 'facility-3', scope: '3', category: 'purchased_goods', source: 'purchased_goods', amount: 6340000, unit: 'USD', method: 'spend_based', confidence: 65, created_at: '2026-03-15T00:00:00.000Z' },
];

const sampleFacilities = [
  { id: 'facility-1', company_id: 'test-company-1', name: 'Sacramento HQ', type: 'office', city: 'Sacramento' },
  { id: 'facility-2', company_id: 'test-company-1', name: 'Fresno Packaging', type: 'factory', city: 'Fresno' },
  { id: 'facility-3', company_id: 'test-company-1', name: 'Portland Distribution', type: 'warehouse', city: 'Portland' },
];

const sampleCompanies = {
  'test-company-1': { id: 'test-company-1', name: 'Green Table Foods', revenue: 1200000000, employees: 420, region: 'CA' },
  'empty-company-no-data': { id: 'empty-company-no-data', name: 'Empty Company', revenue: 0, employees: 1, region: 'CA' },
};

const ingestJobs = new Map();
const generatedReports = new Map();
const emissionsSummaryCache = new Map();

// Ingest job results are per-instance memory (see countCsvImportsThisMonth);
// an entry older than this TTL can no longer be meaningfully fetched, so the
// insert path and the shared prune interval both drop it (PERF-003 — the map
// used to grow without bound for the life of the process).
const INGEST_JOB_TTL_MS = 24 * 60 * 60 * 1000;

// Records an ingest result, pruning entries past the TTL on insert so the map
// stays bounded even between prune sweeps.
function recordIngestJob(job) {
  const now = Date.now();
  for (const [id, existing] of ingestJobs) {
    if (existing.created_at && now - Date.parse(existing.created_at) > INGEST_JOB_TTL_MS) {
      ingestJobs.delete(id);
    }
  }
  ingestJobs.set(job.id, job);
}

// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage app APIs use bearer Authorization headers, not ambient cookie auth.
const app = express();
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

// ─── Response compression ───
// Nothing upstream compresses: Railway's proxy passes the origin body through,
// and express.static has no compression of its own, so the entry bundle was
// going out at its full 496KB instead of ~121KB. That is the single largest
// contributor to LCP on a cold mobile load.
//
// zlib is stdlib, so this adds no dependency. It wraps write/end rather than
// piping a stream so that Content-Length is replaced correctly and the
// already-set security headers survive. Skips: clients that did not ask for
// gzip, HEAD/304 (no body), Range requests (byte offsets refer to the
// uncompressed entity — the video route serves those), and payloads that are
// already compressed (images, fonts, video, .gz/.br).
const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg\+xml)/i;
const COMPRESSION_THRESHOLD = 1024; // below this, gzip framing costs more than it saves

app.use(function (req, res, next) {
  const accepts = String(req.headers['accept-encoding'] || '');
  if (!/\bgzip\b/i.test(accepts) || req.method === 'HEAD' || req.headers.range) return next();

  const originalWrite = res.write;
  const originalEnd = res.end;
  let gzip = null;

  function start() {
    if (gzip !== null) return gzip;
    const type = String(res.getHeader('Content-Type') || '');
    const length = Number(res.getHeader('Content-Length') || 0);
    const encoded = res.getHeader('Content-Encoding');
    if (
      res.statusCode === 204 ||
      res.statusCode === 304 ||
      encoded ||
      !COMPRESSIBLE.test(type) ||
      (length && length < COMPRESSION_THRESHOLD)
    ) {
      gzip = false;
      return gzip;
    }
    res.setHeader('Content-Encoding', 'gzip');
    // Length changes, and caches must not serve one encoding for the other.
    res.removeHeader('Content-Length');
    res.setHeader('Vary', res.getHeader('Vary') ? res.getHeader('Vary') + ', Accept-Encoding' : 'Accept-Encoding');
    gzip = zlib.createGzip({ level: 6 });
    gzip.on('data', function (chunk) { originalWrite.call(res, chunk); });
    gzip.on('end', function () { originalEnd.call(res); });
    return gzip;
  }

  res.write = function (chunk, encoding, callback) {
    const stream = start();
    if (stream === false) return originalWrite.call(res, chunk, encoding, callback);
    if (chunk) stream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
    if (typeof callback === 'function') callback();
    return true;
  };

  res.end = function (chunk, encoding, callback) {
    const stream = start();
    if (stream === false) return originalEnd.call(res, chunk, encoding, callback);
    if (chunk) stream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
    stream.end();
    if (typeof callback === 'function') callback();
    return res;
  };

  next();
});

// ─── Security headers ───
// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage app APIs use bearer Authorization headers, not ambient cookie auth.
app.use(function (_req, res, next) {
  const headers = buildSecurityHeaders({
    hsts: process.env.NODE_ENV === 'production' || process.env.FORCE_HSTS === 'true',
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
  // Same prune pattern for ingest job results (PERF-003): drop anything past
  // the TTL even if no new import triggers the insert-path sweep.
  for (const [id, job] of ingestJobs) {
    if (job.created_at && now - Date.parse(job.created_at) > INGEST_JOB_TTL_MS) {
      ingestJobs.delete(id);
    }
  }
}, 120_000);

// Per-route rate limiter (tighter than the global one) for sensitive public
// endpoints. Keyed on resolveClientIp(req), with its own store pruned on access.
function perRouteRateLimit(max, windowMs) {
  const store = new Map();
  return function (req, res, next) {
    const key = resolveClientIp(req);
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

const APP_VERSION =
  process.env.APP_VERSION ||
  process.env.npm_package_version ||
  process.env.NEXT_PUBLIC_APP_VERSION ||
  require('./package.json').version;

// ─── Version endpoint (for forced-update watchdog) ───
app.get('/api/version', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    version: APP_VERSION,
    build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    timestamp: new Date().toISOString(),
  });
});

// ─── Health check with DB status + build SHA (AF-2) ───
// Build SHA self-report + no-store caching. The SHA is injected by the
// platform at build/deploy time (Railway: RAILWAY_GIT_COMMIT_SHA; Vercel:
// VERCEL_GIT_COMMIT_SHA; generic CI: GIT_SHA). null is a signal that
// the deploy pipeline isn't wiring the SHA — fix that before trusting
// gate-13 AC-P0-1 (F1) SHA-equality checks. Mirrors /api/version :143-152.
function buildSha() {
  return process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_SHA
    || null;
}

async function probeDatabase() {
  if (!pgPool) return { ok: false, configured: false };
  try {
    await pgPool.query('SELECT 1');
    return { ok: true, configured: true };
  } catch (err) {
    log('error', 'Database health probe failed', { error: String(err) });
    return { ok: false, configured: true };
  }
}

async function healthPayload() {
  const database = await probeDatabase();
  const dbStatus = database.ok ? 'ok' : database.configured ? 'unreachable' : 'not configured';

  return {
    status: database.configured && !database.ok ? 'degraded' : 'ok',
    sha: buildSha(),
    build: buildSha(), // alias kept for /api/version parity (impl-spec AF-2)
    uptime: process.uptime(),
    version: APP_VERSION,
    db: dbStatus,
    timestamp: new Date().toISOString(),
  };
}

app.get('/health', async function (_req, res) {
  // ponytail: no-store so cached health never defeats its purpose (godmythos HR #25).
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // A health probe must never be the thing that kills the process.
  try {
    const payload = await healthPayload();
    res.status(payload.status === 'degraded' ? 503 : 200).json(payload);
  } catch (err) {
    log('error', 'Health payload failed', { error: String(err) });
    res.status(503).json({ status: 'degraded', error: 'health check failed' });
  }
});

// ─── /api/health — godmythos HR #24 §0 mandatory health route (AF-2) ───
// Canonical SHA-self-report endpoint. Same payload as /health; the /api
// prefix aligns with the API surface so uptime monitors and the gate-13
// F1 check can probe a stable, semantically-named URL.
app.get('/api/health', async function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const payload = await healthPayload();
    res.status(payload.status === 'degraded' ? 503 : 200).json(payload);
  } catch (err) {
    log('error', 'Health payload failed', { error: String(err) });
    res.status(503).json({ status: 'degraded', error: 'health check failed' });
  }
});

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
// and ship those instead of up to 50 full body_html payloads.
function blogListReadMinutes(html) {
  const bounded = String(html || '').slice(0, 100000);
  const text = bounded.replace(/<[^\n>]*>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function blogListExcerpt(row) {
  const meta = row.meta_description && String(row.meta_description).trim();
  if (meta) return meta;
  const text = String(row.body_html || '').slice(0, 100000).replace(/<[^\n>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const sliced = text.slice(0, 160);
  const lastSpace = sliced.lastIndexOf(' ');
  return sliced.slice(0, lastSpace > 80 ? lastSpace : 160) + '\u2026';
}

app.get('/api/blog-posts', async function (_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (!pgPool) {
    return res.json({ posts: [] });
  }
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
        internal_links: row.internal_links,
        external_links: row.external_links,
        cta: row.cta,
        content_score: row.content_score,
        geo_score: row.geo_score,
        published_at: row.published_at,
      })),
    });
  } catch (err) {
    if (err.code === '42P01') { // table does not exist
      return res.json({ posts: [] });
    }
    log('error', 'GET /api/blog-posts:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

app.get('/api/blog-posts/:slug', async function (req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (!pgPool) {
    return res.status(404).json({ error: 'Post not found' });
  }
  try {
    const { rows } = await pgPool.query(
      'SELECT id, slug, title, meta_title, meta_description, body_html, primary_keyword, faq, internal_links, external_links, cta, content_score, geo_score, published_at FROM blog_posts WHERE slug = $1 LIMIT 1',
      [req.params.slug]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ post: { ...rows[0], body_html: sanitizeBlogHtml(rows[0].body_html) } });
  } catch (err) {
    if (err.code === '42P01') { // table does not exist
      return res.status(404).json({ error: 'Post not found' });
    }
    log('error', 'GET /api/blog-posts/:slug:', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Write side of the two blog routes above. SEO AI Regent posts scored articles
// here with a Bearer SITE_DEPLOY_TOKEN; rows land in the same blog_posts table
// those handlers read, so a published post is live on /blog with no rebuild.
// Body limit is generous because an article is full HTML, not a form payload.
app.post(
  '/api/publish',
  express.json({ limit: '1mb' }),
  createPublishHandler({
    pgPool,
    deployToken: process.env.SITE_DEPLOY_TOKEN,
    canonicalOrigin: process.env.PUBLIC_ORIGIN || 'https://ecoauditor.io',
    log,
  }),
);

// Readiness gates on the data store, not on a marketing video (INFRA-003/
// INFRA-008): a deployment whose DB is unreachable must not be marked ready,
// while a missing intro video is cosmetic and stays in the payload as
// information only. 200/503 semantics mirror /health: not configured (no
// DATABASE_URL) counts as ready, configured-but-unreachable is degraded 503.
app.get('/ready', async function (_req, res) {
  const videoPath = findVideoPath();
  // Hard 2s ceiling on the probe so a slow pool cannot stall the readiness
  // check itself; the pool's own query_timeout is 3s.
  const dbProbe = await Promise.race([
    probeDatabase(),
    new Promise(function (resolve) {
      const timer = setTimeout(function () {
        resolve({ ok: false, configured: Boolean(pgPool) });
      }, 2000);
      timer.unref();
    }),
  ]);
  const ready = dbProbe.ok || !dbProbe.configured;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    video: videoPath ? 'available' : 'not-found',
    db: dbProbe.ok ? 'ok' : dbProbe.configured ? 'unreachable' : 'not configured',
    timestamp: new Date().toISOString(),
  });
});

// ─── Trial status endpoint (used by frontend after OAuth) ───
app.get('/api/trial-status', authGuard, async function (req, res) {
  if (!pgPool) {
    return res.json({ trial: true, trialEndsAt: null, source: 'no-db' });
  }
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
    log('error', 'Trial status check failed', { error: String(err), userId: req.user.id });
    // Fail closed on the UI hint. Returning trial:true here told an expired
    // user their trial was still active; 503 lets the client retry instead of
    // caching a wrong answer. (Data access is gated separately by requirePlan.)
    return res.status(503).json({ error: 'Trial status unavailable', source: 'error-fallback' });
  }
});

// ─── Billing state endpoint (trial + subscription, synced from Stripe webhooks) ───
app.get('/api/billing', authGuard, async function (req, res) {
  if (!pgPool) {
    return res.json({ active: true, plan: 'starter', status: 'trialing', trialActive: true, source: 'no-db' });
  }
  try {
    const state = await loadBillingState(req.user.id);
    if (!state) {
      // Company not provisioned yet — trial starts on first data access.
      return res.json({ active: true, plan: 'starter', status: 'trialing', trialActive: true, trialEndsAt: null, source: 'pending' });
    }
    return res.json({ ...state, source: 'db' });
  } catch (err) {
    log('error', 'Billing state check failed', { error: String(err), userId: req.user.id });
    return res.status(500).json({ error: 'Failed to load billing state' });
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
// account holder already knows — no user_id, no billing columns.
async function loadCompanyExportRow(companyId) {
  if (pgPool) {
    const { rows } = await pgPool.query(
      'SELECT id, name, industry, created_at, updated_at, trial_ends_at FROM public.companies WHERE id = $1',
      [companyId]
    );
    return rows[0] || null;
  }
  return sampleCompanies[companyId] || null;
}

app.get('/api/account/export', apiAuthGuard, async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    const company = await loadCompanyExportRow(companyId);
    const facilities = await loadFacilities(companyId);
    let entries = await loadEmissionEntries(companyId);
    const notes = [];
    if (entries.length > EXPORT_MAX_ENTRIES) {
      // loadEmissionEntries returns rows created_at ASC; keep the newest.
      entries = entries.slice(entries.length - EXPORT_MAX_ENTRIES);
      notes.push('Export capped at the ' + EXPORT_MAX_ENTRIES + ' most recent emission entries.');
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      company: company,
      facilities: facilities,
      emissionEntries: entries,
    };
    if (notes.length) payload.notes = notes;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ecoauditor-export-' + companyId + '.json"');
    return res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    // loadEmissionEntries/loadFacilities throw "… data store unavailable" in
    // production when the DB is down; classifyApiFailure keeps that a generic
    // 503 instead of echoing driver text.
    const failure = classifyApiFailure(err);
    if (failure.status >= 500) {
      log('error', 'Account data export failed', { error: String(err.message || err), userId: req.user && req.user.id });
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
  if (!pgPool) {
    if (allowSampleData()) {
      // Dev / no-DB mode: drop the sample rows for the resolved company so the
      // in-memory fixtures reflect the deletion.
      let deletedEntries = 0;
      let deletedFacilities = 0;
      for (let i = sampleEmissionEntries.length - 1; i >= 0; i--) {
        if (String(sampleEmissionEntries[i].company_id) === String(companyId)) {
          sampleEmissionEntries.splice(i, 1);
          deletedEntries++;
        }
      }
      for (let i = sampleFacilities.length - 1; i >= 0; i--) {
        if (String(sampleFacilities[i].company_id) === String(companyId)) {
          sampleFacilities.splice(i, 1);
          deletedFacilities++;
        }
      }
      emissionsSummaryCache.clear();
      return res.json({ deleted: true, deletedEntries: deletedEntries, deletedFacilities: deletedFacilities });
    }
    return res.status(503).json({ success: false, error: 'Data store unavailable' });
  }

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
    emissionsSummaryCache.clear();
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
      // release. Map it to the same 503 the no-DB branch above uses so the
      // endpoint degrades instead of killing the process.
      log('error', 'Delete-data: failed to acquire a database client', { error: String(err), companyId: companyId });
      return res.status(503).json({ success: false, error: 'Data store unavailable' });
    }
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log('error', 'Delete-data rollback failed', { error: String(rollbackErr), companyId: companyId });
    }
    log('error', 'Account data deletion failed', { error: String(err), companyId: companyId });
    return res.status(500).json({ success: false, error: 'Failed to delete audit data' });
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
    log('error', 'authGuard error', { error: String(err) });
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
    log('error', 'Company provisioning unavailable', { error: String(err), userId: user.id });
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

function allowSampleData() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_SAMPLE_DATA === 'true';
}

// Ensures every authenticated user has a company row. Idempotent.
// Uses pgPool with RLS bypass (row_security = off) inside a transaction so
// the initial insert succeeds even before the user owns any company.
async function ensureCompanyForUser(user) {
  if (!pgPool) return null;
  const userId = user.id;
  const email = user.email || '';
  const defaultName = email ? email.split('@')[0] + ' Organization' : 'My Organization';
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
      `INSERT INTO public.companies (user_id, name, industry, updated_at, trial_ends_at)
       VALUES ($1, $2, 'other', now(), now() + INTERVAL '14 days')
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
      log('error', 'Company provisioning rollback failed', { error: String(rollbackErr), userId });
    }
    log('error', 'ensureCompanyForUser failed', { error: String(err), userId });
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
  if (!pgPool) throw new Error('Database not configured');
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
      log('warn', 'ROLLBACK failed after query error', { error: String(rollbackErr) });
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
  if (!pgPool) {
    log('warn', 'Subscription sync deferred: DATABASE_URL not configured');
    return { ok: false, reason: 'no_database', retryable: true };
  }
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
    log('warn', 'Subscription sync deferred: company provisioning failed', { userId, error: String(err) });
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
// when no DB is configured or the company has not been provisioned yet.
async function loadBillingState(userId) {
  if (!pgPool) return null;
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
// minPlanId. Skips enforcement when no DB is configured (dev mode).
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
    if (!pgPool) return next();
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
      log('error', 'requirePlan check failed', { error: String(err) });
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
    log('error', 'Subscription change failed', { error: String(err) });
    return res.status(500).json({ error: 'Subscription change failed' });
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
    log('error', 'Subscription cancel failed', { error: String(err) });
    return res.status(500).json({ error: 'Cancellation failed' });
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

    // Only allow a trial on eligible plans, and only once per customer — a
    // returning customer who already had a subscription (trial or paid) does not
    // get another free trial.
    if (trial && TRIAL_ELIGIBLE_PLANS.has(priceId)) {
      const hadPrior = await customerHasPriorSubscription(customerId);
      if (!hadPrior) {
        sessionParams.subscription_data = { trial_period_days: 14 };
      }
    }

    // The 409 guard above is check-then-act with no reservation, so two
    // concurrent POSTs (double-click, or a client retry after a network
    // timeout) both observe "no subscription" and both create a live session.
    // Completing both yields two concurrent subscriptions and a flapping
    // entitlement. An idempotency key makes a retry return the SAME session
    // instead of a second billable one. Scoped to this user+price for a short
    // window, so a genuine later repurchase is unaffected.
    const idempotencyKey = `checkout:${req.user.id}:${priceId}:${Math.floor(Date.now() / (10 * 60 * 1000))}`;
    const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });
    log('info', 'Checkout session created', { sessionId: session.id, userId: req.user.id });
    return res.json({ url: session.url });
  } catch (err) {
    log('error', 'Checkout session failed', { error: String(err) });
    return res.status(500).json({ error: 'Checkout session creation failed' });
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

    // The watermark must reflect WHEN THIS PURCHASE was true, not what time it
    // is now. Using the wall clock made the ordering guard in
    // syncSubscriptionRecord admit every write: the stored
    // subscription_event_at is always older than "now", so replaying a stale
    // session always won.
    //
    // Concretely: buy Growth (session A -> S1), cancel, buy Pro (session B ->
    // S2 active). Revisiting the old confirmation link passes the ownership
    // check above, loads S1 (canceled), and stamped that over the live Pro
    // entitlement — the customer was 402'd off a plan they were paying for,
    // while the route answered verified:true. Recovery waited for the next
    // genuine Stripe event, up to a billing cycle.
    //
    // session.created is the purchase's own ordering key, so a replayed old
    // session is rejected by the same guard that stops out-of-order webhooks.
    // syncSubscriptionRecord reports that as a correct skip
    // ({ok:true, reason:'stale_event'}), which means "the row already holds
    // state at least as fresh as this" — so we can still answer verified:true
    // with the CURRENT billing state.
    const sessionCreated = Number(session.created);
    const readAt = Number.isFinite(sessionCreated) && sessionCreated > 0
      ? sessionCreated
      : Math.floor(Date.now() / 1000);
    const subscription = typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;

    const result = await syncSubscriptionRecord(subscriptionRecordFromStripe(subscription, process.env), readAt);
    if (!result.ok) {
      log('error', 'Checkout verify could not persist subscription', { userId: req.user.id, reason: result.reason });
      return res.status(503).json({ error: 'Could not confirm your subscription yet', reason: result.reason });
    }

    const state = await loadBillingState(req.user.id);
    log('info', 'Checkout verified and subscription reconciled', {
      userId: req.user.id,
      subId: subscription.id,
      superseded: result.reason === 'stale_event',
    });
    return res.json({ verified: true, billing: state });
  } catch (err) {
    log('error', 'Checkout verify failed', { error: String(err) });
    return res.status(500).json({ error: 'Checkout verification failed' });
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
    log('error', 'Billing portal failed', { error: String(err) });
    return res.status(500).json({ error: 'Billing portal session creation failed' });
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
    log('error', 'Webhook signature verification failed', { error: String(err) });
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
    log('error', 'Webhook processing failed', { type: event.type, id: event.id, error: String(err) });
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

// ─── LEADS STORAGE ───
const LEADS_FILE = path.join(__dirname, '.data', 'leads.json');
function ensureLeadsDir() {
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function readLeads() {
  ensureLeadsDir();
  if (!fs.existsSync(LEADS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
async function writeLead(lead) {
  const record = { ...lead, id: crypto.randomUUID(), createdAt: new Date().toISOString() };

  if (pgPool) {
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
          record.createdAt,
        ]
      );
      return;
    } catch (err) {
      log('error', 'Failed to write lead to Postgres', { error: String(err) });
      // In production the JSON fallback is a lie (UXE-001): .data/ is an
      // ephemeral, unvolume'd filesystem nobody ever reads, so a 200 "captured"
      // would be false trust. Rethrow so /api/leads answers 500 and the UI can
      // offer a retry. The file fallback stays only for dev / no-DB runs.
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
    }
  }

  try {
    ensureLeadsDir();
    const leads = readLeads();
    leads.push(record);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  } catch (err) {
    log('error', 'Failed to write lead to file', { error: String(err) });
    throw err;
  }
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
    log('error', 'Failed to write chatbot lead', { error: String(err) });
    return false;
  }
}

// ─── CONSENT AUDIT TRAIL ───
// Server-side record of consent decisions (GDPR/CCPA record-keeping).
// Public endpoint: consent happens before authentication. No raw IP is stored.
const CONSENT_FILE = path.join(__dirname, '.data', 'consent-audit.json');
const CONSENT_METHODS = new Set(['accept_all', 'reject_all', 'custom', 'privacy_signal', 'reset']);

// A plain SHA-256 of an IP is reversible (the IPv4 space is trivially
// brute-forceable), so pseudonymize with a keyed HMAC. Set CONSENT_IP_PEPPER in
// prod for stable hashes; otherwise a random per-process pepper is used.
const CONSENT_IP_PEPPER = process.env.CONSENT_IP_PEPPER || crypto.randomBytes(32).toString('hex');
if (!process.env.CONSENT_IP_PEPPER) {
  log('warn', 'CONSENT_IP_PEPPER not set — using a random per-process pepper; consent IP hashes will not be stable across restarts');
}
function hashConsentIp(ip) {
  return crypto.createHmac('sha256', CONSENT_IP_PEPPER).update(String(ip || '')).digest('hex').slice(0, 32);
}

function appendConsentRecordToFile(record) {
  ensureLeadsDir();
  let records = [];
  if (fs.existsSync(CONSENT_FILE)) {
    try { records = JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf8')); } catch { records = []; }
  }
  records.push(record);
  fs.writeFileSync(CONSENT_FILE, JSON.stringify(records, null, 2));
}

app.post('/api/consent-audit', consentRateLimit, express.json({ limit: '4kb' }), async function (req, res) {
  const body = req.body || {};
  const consent = body.consent;
  if (!consent || typeof consent !== 'object' ||
      ['analytics', 'preferences', 'marketing'].some(function (key) { return typeof consent[key] !== 'boolean'; })) {
    return res.status(400).json({ error: 'Invalid consent payload' });
  }
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
    createdAt: new Date().toISOString(),
  };

  try {
    if (pgPool) {
      const persist = async function () {
        await queryWithRlsBypass(
          `INSERT INTO public.consent_records (visitor_id, consent, policy_version, method, gpc, dnt, user_agent, ip_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [record.visitorId, JSON.stringify(record.consent), record.policyVersion, record.method,
           record.gpc, record.dnt, record.userAgent, record.ipHash]
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
    } else {
      appendConsentRecordToFile(record);
    }
    return res.status(202).json({ received: true });
  } catch (err) {
    log('error', 'Consent audit persistence failed', { error: String(err) });
    // UXE-006: surface the failure as retryable (503) so the client can offer
    // a retry instead of silently pretending the consent record was kept.
    return res.status(503).json({ error: 'Failed to record consent', retryable: true });
  }
});

// ─── SALESBOT CHAT ENGINE ───
const ECOAUDITOR_KB = [
  {
    pattern: /pricing|cost|how much|plan/i,
    response: "We offer three plans:\n\n• **Starter** — $149/mo for basic carbon tracking\n• **Growth** — $399/mo for full Scope 1/2/3 reporting\n• **Pro** — $999/mo for multi-facility teams\n\nStarter and Growth include a 14-day free trial on monthly billing. Would you like me to help you choose the right plan?"
  },
  {
    pattern: /demo|book a demo|schedule a call|talk to sales/i,
    response: "I'd be happy to schedule a demo! To get started, could you tell me your name?"
  },
  {
    pattern: /contact|reach out|email|phone/i,
    response: "You can reach us at:\n\n• Email: hello@developer312.com\n• Phone: (510) 591-0163\n\nOr I can connect you with our sales team right here in the chat!"
  },
  {
    pattern: /how (it|does) work|features|what is|about/i,
    response: "EcoAuditor helps businesses track and report carbon emissions:\n\n• **CSV import** of activity data\n• **Scope 1/2/3 reporting** aligned with GHG Protocol\n• **Compliance readiness** for California SB 253/SB 261 and EU CBAM\n• **Scope 1/2/3 emission calculations** using EPA & eGRID factors\n\nWant to see it in action? I can book you a demo!"
  },
  {
    pattern: /scope 1|scope 2|scope 3|ghg|protocol/i,
    response: "We follow the GHG Protocol for comprehensive emissions accounting:\n\n• **Scope 1**: Direct emissions from owned/controlled sources\n• **Scope 2**: Indirect emissions from purchased energy\n• **Scope 3**: All other indirect emissions in your value chain\n\nImport your activity data by CSV and we calculate emissions across all three scopes using EPA, eGRID, and IPCC factors."
  },
  {
    pattern: /cbam|carbon border|eu|europe/i,
    response: "EcoAuditor helps you prepare for the EU Carbon Border Adjustment Mechanism (CBAM):\n\n• Build a Scope 1/2/3 emissions inventory from your activity data\n• Stay informed on compliance deadlines\n\nNeed help preparing for CBAM? Book a demo with our team!"
  },
  {
    pattern: /\bsec\b|disclosure|climate rule/i,
    response: "EcoAuditor helps you build audit-ready GHG disclosures:\n\n• CSV activity data import and validation\n• Scope 1/2/3 inventory with confidence scoring\n• PDF summaries for voluntary and regulatory reporting\n\nNote: the U.S. SEC climate-disclosure rule was withdrawn in 2025 — we focus on California SB 253/SB 261, EU CBAM, and voluntary GHG reporting."
  },
  {
    pattern: /california|ab 1305|climate corporate/i,
    response: "EcoAuditor is built for California's Climate Corporate Data Accountability Act (SB 253):\n\n• Scope 1/2/3 emissions inventory from your imported activity data\n• PDF emissions summary reports\n• SB 253 deadline information\n\nStay ahead of California's climate reporting requirements with EcoAuditor."
  },
  {
    pattern: /smb|small business|startup|affordable/i,
    response: "EcoAuditor is designed for businesses of all sizes:\n\n• **Starter plan** at $149/mo for small teams\n• Easy setup — no technical expertise needed\n• Templates and guides for first-time reporters\n• Scale up as your reporting needs grow\n\nStart your 14-day free trial on a monthly Starter or Growth plan today!"
  },
  {
    pattern: /integration|api|connect|erp|salesforce/i,
    response: "EcoAuditor works with your existing tools:\n\n• **CSV import** of activity data from spreadsheets\n\nMore integrations are on our roadmap. Need a specific integration? Let us know!"
  }
];

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
        response: `Perfect! What day works best for your demo? (Please provide a date, e.g., "2026-05-15")`,
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
      // writeChatLead returns false when the payload is rejected or both the
      // DB and file fallbacks fail. Confirming a booking we never recorded
      // loses the lead silently.
      if (!demoSaved) {
        return {
          response: `I couldn't save your demo request just now. Please email hello@developer312.com with your preferred time and we'll get you booked.`,
          state,
        };
      }

      // Generate PrismDeck presentation link. Only the non-identifying
      // product marker is sent: embedding the lead's company/email in the
      // query string handed personal data to a third-party host that is not a
      // disclosed subprocessor in the Privacy Policy or DPA (DATA-006). The
      // deck itself is generic; the lead stays in EcoAuditor's own leads store.
      const prismDeckUrl = 'https://radiant-alignment-production-b430.up.railway.app/?product=ecoauditor';
      
      return {
        response: `🎉 Demo booked!\n\nOur team will reach out to ${state.email} within 24 hours to confirm your demo for ${state.date} (${message}).\n\n📊 Meanwhile, I've prepared a personalized presentation for ${state.company}:\n🔗 [View Your EcoAuditor Deck](${prismDeckUrl})\n\nIn the meantime, check out our [Pricing](/pricing) or ask me anything else!`,
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
        response: `✅ Message sent!\n\nOur sales team will contact you at ${state.email} within 24 hours.\n\nIs there anything else I can help you with?`,
        state: {}
      };
    }
  }

  // Quick reply triggers
  if (lowerMsg === '💰 pricing' || lowerMsg === 'pricing') {
    const match = ECOAUDITOR_KB.find(k => k.pattern.test('pricing'));
    return { response: match ? match.response : "Our plans start at $149/mo. Would you like more details?", state };
  }
  if (lowerMsg === '📅 book a demo' || lowerMsg === 'book a demo') {
    return {
      response: "I'd be happy to schedule a demo! What's your name?",
      state: { flow: 'demo', step: 'name' }
    };
  }
  if (lowerMsg === '🚀 how it works' || lowerMsg === 'how it works') {
    const match = ECOAUDITOR_KB.find(k => k.pattern.test('how it works'));
    return { response: match ? match.response : "EcoAuditor automates carbon tracking and reporting. Want a demo?", state };
  }
  if (lowerMsg === '📞 contact sales' || lowerMsg === 'contact sales') {
    return {
      response: "I'd be happy to connect you with our sales team! What's your name?",
      state: { flow: 'contact', step: 'name' }
    };
  }

  // Regex KB matching
  for (const entry of ECOAUDITOR_KB) {
    if (entry.pattern.test(message)) {
      return { response: entry.response, state };
    }
  }

  // Default response
  return {
    response: "I'm not sure I understand. I can help you with:\n\n• 💰 Pricing and plans\n• 📅 Booking a demo\n• 🚀 How EcoAuditor works\n• 📞 Contacting sales\n\nOr ask me about carbon accounting, emissions reporting, or compliance!",
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
    log('error', 'Chat bot response failed', { error: String(err) });
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
    log('error', 'Lead capture failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to capture lead. Please try again.' });
  }
});

async function loadEmissionEntries(companyId, period) {
  if (pgPool) {
    try {
      const params = [companyId];
      let sql = 'SELECT id, company_id, facility_id, scope, category, source, amount, unit, method, confidence, created_at FROM emission_entries WHERE company_id = $1';
      if (period) {
        params.push(String(period));
        sql += ' AND EXTRACT(YEAR FROM created_at)::text = $2';
      }
      // PERF-004: hard ceiling on rows pulled per request. An SMB inventory
      // is orders of magnitude below this; the LIMIT only stops a pathological
      // dataset from turning every dashboard call into an unbounded read.
      sql += ' ORDER BY created_at ASC LIMIT 50000';
      const { rows } = await pgPool.query(sql, params);
      return rows.map(function (row) {
        return { ...row, amount: Number(row.amount), confidence: row.confidence == null ? undefined : Number(row.confidence) };
      });
    } catch (err) {
      if (!allowSampleData()) {
        log('error', 'Emission data store unavailable', { error: String(err), companyId });
        throw new Error('Emission data store unavailable');
      }
      log('warn', 'Falling back to in-memory emissions data', { error: String(err), companyId });
    }
  }
  if (!allowSampleData()) {
    throw new Error('Emission data store unavailable');
  }
  return sampleEmissionEntries.filter(function (entry) {
    return String(entry.company_id) === String(companyId);
  });
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

// Imports accepted this calendar month, for the per-plan quota. Counts from the
// durable log — the in-memory ingestJobs map resets on deploy and is per
// instance, so it can't back a billing limit.
async function countCsvImportsThisMonth(companyId) {
  if (!pgPool) return 0;
  let rows;
  try {
    ({ rows } = await pgPool.query(
      `SELECT COUNT(*)::int AS used FROM public.csv_import_events
        WHERE company_id = $1 AND created_at >= date_trunc('month', now())`,
      [companyId]
    ));
  } catch (err) {
    // A driver timeout ('Query read timeout') carries no pg error code, so
    // classifyApiFailure answered 400 with the raw driver text as if the
    // customer's file were at fault. Name it as the outage it is.
    log('error', 'CSV import quota lookup failed', { error: String(err), companyId });
    throw new Error('Import quota data store unavailable');
  }
  return rows.length ? rows[0].used : 0;
}

// Atomically persists rows and spends one CSV-import unit. The company
// row is locked FOR UPDATE for the whole transaction, so concurrent imports
// serialize on the check-then-insert instead of all reading the same count and
// passing it. Returns true when a unit was spent, false when the plan is
// already at its limit. row_security = off matches the other server-owned
// writes (ensureCompanyForUser / syncSubscriptionRecord).
async function reserveCsvImportQuota(planId, companyId, rowCount, persist) {
  const limit = planLimits(planId).csvImportsPerMonth;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = off');
    const locked = await client.query(
      'SELECT id FROM public.companies WHERE id = $1 FOR UPDATE',
      [companyId]
    );
    if (locked.rowCount === 0) {
      throw new Error('Import company no longer exists');
    }
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS used FROM public.csv_import_events
        WHERE company_id = $1 AND created_at >= date_trunc('month', now())`,
      [companyId]
    );
    const used = rows.length ? rows[0].used : 0;
    if (limit !== null && used >= limit) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      'INSERT INTO public.csv_import_events (company_id, row_count) VALUES ($1, $2)',
      [companyId, rowCount]
    );
    await persist(client);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log('error', 'Quota reservation rollback failed', { error: String(rollbackErr), companyId });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function persistCsvEntries(client, entries) {
  const cols = ['company_id', 'facility_id', 'scope', 'category', 'source', 'amount', 'unit', 'factor', 'method', 'confidence', 'co2e_kg', 'activity_date', 'notes', 'created_at'];
  // Keep each statement below PostgreSQL's 65,535 bind-parameter ceiling.
  // All batches use the quota transaction, so a failed batch rolls back all rows.
  for (let offset = 0; offset < entries.length; offset += 1000) {
    const insertParams = [];
    const valueGroups = entries.slice(offset, offset + 1000).map((entry) => {
      const placeholders = cols.map((column) => {
        insertParams.push(entry[column]);
        return '$' + insertParams.length;
      });
      return '(' + placeholders.join(', ') + ')';
    });
    await client.query(
      'INSERT INTO public.emission_entries (' + cols.join(', ') + ') VALUES ' + valueGroups.join(', '),
      insertParams
    );
  }
}

async function loadFacilities(companyId) {
  if (pgPool) {
    try {
      const { rows } = await pgPool.query(
        'SELECT id, company_id, name, type, city FROM facilities WHERE company_id = $1 ORDER BY name ASC',
        [companyId]
      );
      return rows;
    } catch (err) {
      if (!allowSampleData()) {
        log('error', 'Facilities data store unavailable', { error: String(err), companyId });
        throw new Error('Facilities data store unavailable');
      }
      log('warn', 'Falling back to in-memory facilities data', { error: String(err), companyId });
    }
  }
  if (!allowSampleData()) {
    throw new Error('Facilities data store unavailable');
  }
  return sampleFacilities.filter(function (facility) {
    return String(facility.company_id) === String(companyId);
  });
}

// Loads a single facility by id (Postgres when configured, sample otherwise).
// Returns null when not found. DB ids are numeric; a non-numeric id in a
// DB-backed deployment simply cannot match, so it returns null (404).
async function loadFacilityById(facilityId) {
  if (pgPool) {
    if (!/^\d+$/.test(String(facilityId))) return null;
    try {
      const { rows } = await pgPool.query(
        'SELECT id, company_id, name, type, city FROM facilities WHERE id = $1',
        [facilityId]
      );
      return rows[0] || null;
    } catch (err) {
      if (!allowSampleData()) {
        log('error', 'Facilities data store unavailable', { error: String(err), facilityId });
        throw new Error('Facilities data store unavailable');
      }
      log('warn', 'Falling back to in-memory facility', { error: String(err), facilityId });
    }
  }
  if (!allowSampleData()) {
    throw new Error('Facilities data store unavailable');
  }
  return sampleFacilities.find(function (facility) {
    return String(facility.id) === String(facilityId);
  }) || null;
}

function getCompany(companyId) {
  return sampleCompanies[companyId] || { id: companyId, name: 'Company', revenue: 0, employees: 0, region: 'CA' };
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

app.post('/api/calculate', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const body = req.body || {};
    const companyId = await requireCompanyAccess(req, res, body.company_id || body.companyId);
    if (!companyId) return;
    const period = body.period || String(new Date().getFullYear());

    if (Array.isArray(body.entries) || body.scope) {
      const entries = Array.isArray(body.entries) ? body.entries : [body];

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

      const summary = summarizeEntries(entries, { companyId: companyId, period: period });
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
      log('error', 'Calculate failed on infrastructure', { error: String(err.message || err), userId: req.user && req.user.id });
    }
    return res.status(failure.status).json({ error: failure.message });
  }
});

// /api/emissions/summary takes only a 4-digit year for `period` — that is
// what loadEmissionEntries compares against EXTRACT(YEAR ...) and what the
// dashboard sends (it omits the param entirely). Validating BEFORE the value
// becomes a cache key stops arbitrary strings from minting unbounded cache
// entries (PERF-003/PERF-010); a non-year period would have returned empty
// data anyway.
const SUMMARY_PERIOD_PATTERN = /^\d{4}$/;

app.get('/api/emissions/summary', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.query.company_id);
  if (!companyId) return;
  const period = req.query.period ? String(req.query.period) : String(new Date().getFullYear());
  if (!SUMMARY_PERIOD_PATTERN.test(period)) {
    return res.status(400).json({ success: false, error: 'period must be a 4-digit year, e.g. 2026' });
  }

  try {
    const cacheKey = `summary:${companyId}:${period}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });

    const priorYear = Number(period) - 1;
    const priorEntries = await loadEmissionEntries(companyId, String(priorYear));
    const priorSummary = summarizeEntries(priorEntries, { companyId: companyId, period: String(priorYear) });

    const response = { success: true, data: toDashboardSummary(summary, priorSummary), methodology: summary.methodology };
    cacheSet(cacheKey, response, 5 * 60 * 1000);
    return res.json(response);
  } catch (err) {
    log('error', 'Emissions summary failed', { error: String(err), companyId: companyId });
    return res.status(500).json({ success: false, error: 'Failed to load emissions summary' });
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
    // every entry-changing path already clears it (ingest, facility
    // emissions, account deletion), and the size cap bounds key cardinality.
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
    log('error', 'Emissions trend failed', { error: String(err), companyId: companyId });
    return res.status(500).json({ success: false, error: 'Failed to load emissions trend' });
  }
});

app.post('/api/ingest/csv', express.text({ type: ['text/*', 'application/csv'], limit: '100kb' }), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  // Declared outside the try: the catch below logs it, and a const inside the
  // block was a ReferenceError there — turning any 5xx-classified failure
  // (facilities store down, quota lookup timeout) into an unhandled rejection
  // that exited the whole process.
  let companyId = null;
  try {
    companyId = await requireCompanyAccess(req, res, req.query.company_id);
    if (!companyId) return;
    const csvText = req.body || '';
    const rawRows = parseEmissionCsv(csvText);
    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, error: 'CSV file is empty or has no data rows after the header.' });
    }

    const plan = (req.billing && req.billing.plan) || 'starter';

    // Monthly import quota. Checked before any parsing work so a blocked import
    // costs nothing, and counted from the durable log rather than the in-memory
    // job map, which resets on deploy.
    const usedThisMonth = await countCsvImportsThisMonth(companyId);
    const quotaCheck = canImportCsv(plan, usedThisMonth);
    if (!quotaCheck.allowed) {
      return res.status(402).json({
        success: false,
        code: 'upgrade_required',
        requiredPlan: quotaCheck.requiredPlan,
        error: `Your ${plan} plan includes ${quotaCheck.limit} CSV imports per month and you have used all of them. Upgrade to ${quotaCheck.requiredPlan} for unlimited imports.`,
      });
    }

    // Scope 3 is a paid tier feature. Reject the whole file rather than silently
    // dropping the Scope 3 rows — a partial import would understate the
    // inventory without the customer realising it.
    const scope3Check = canUseScope3(plan);
    if (!scope3Check.allowed && rawRows.some((row) => normalizeScopeLabel(row.scope) === 'scope3')) {
      return res.status(402).json({
        success: false,
        code: 'upgrade_required',
        requiredPlan: scope3Check.requiredPlan,
        error: `This file contains Scope 3 rows. Scope 3 workflows are included from the ${scope3Check.requiredPlan} plan up.`,
      });
    }

    const jobId = crypto.randomUUID();
    // Resolve facilities from the real store (Postgres when configured, sample
    // array otherwise) so CSV rows link to persisted facilities, not in-memory ones.
    const companyFacilities = await loadFacilities(companyId);
    const SCOPE_LABELS = { scope1: 'Scope 1', scope2: 'Scope 2', scope3: 'Scope 3' };
    const entries = [];
    var importErrors = [];   // fatal per-row errors
    var importWarnings = []; // non-fatal per-row notes

    for (var i = 0; i < rawRows.length; i++) {
      var row = rawRows[i];
      var rowNum = i + 2; // 1-indexed + header row
      var rowErrors = [];
      var rowWarnings = [];
      var facilityId = null;

      // Resolve optional facility_name → facility_id
      if (row.facility_name) {
        var nameQuery = String(row.facility_name).trim().toLowerCase();
        var facility = companyFacilities.find(function (f) { return String(f.name).trim().toLowerCase() === nameQuery; });
        if (facility) {
          facilityId = facility.id;
        } else {
          rowWarnings.push('Row ' + rowNum + ': Facility "' + row.facility_name + '" not found — row stored without facility association');
        }
      }

      // Try to calculate CO2e via emissions engine
      var calculated;
      try {
        calculated = calculateEntry(row);
      } catch (calcErr) {
        rowErrors.push('Row ' + rowNum + ': ' + calcErr.message);
      }

      // Map the engine's normalized scope back to the DB's CHECK format.
      var scopeLabel = SCOPE_LABELS[calculated && calculated.scope];
      if (rowErrors.length === 0 && calculated && !scopeLabel) {
        rowErrors.push('Row ' + rowNum + ': Unrecognized scope "' + row.scope + '" (expected Scope 1, 2, or 3)');
      }
      // The DB CHECKs confidence to 0..100. Catch it per row here; otherwise one
      // bad value fails the whole multi-row INSERT as a generic 500 with no row
      // number, and the customer cannot tell which line to fix.
      if (rowErrors.length === 0 && calculated &&
          !(Number.isFinite(calculated.confidence) && calculated.confidence >= 0 && calculated.confidence <= 100)) {
        rowErrors.push('Row ' + rowNum + ': confidence must be between 0 and 100');
      }

      // Carry the row's own date into created_at when valid, so imported
      // historical data is attributed to the right period (not the import time).
      // The activity date is ALSO stored in its own column now: overwriting
      // created_at alone destroyed the real import timestamp, so there was no
      // audit trail of when data entered the system.
      var importedAt = new Date().toISOString();
      var createdAt = importedAt;
      var activityDate = null;
      if (row.date) {
        var parsedDate = Date.parse(row.date);
        if (Number.isFinite(parsedDate)) {
          createdAt = new Date(parsedDate).toISOString();
          activityDate = new Date(parsedDate).toISOString().slice(0, 10);
        } else {
          rowWarnings.push('Row ' + rowNum + ': Unparseable date "' + row.date + '" — using import time');
        }
      }

      if (rowErrors.length === 0 && calculated && scopeLabel) {
        var entry = {
          id: crypto.randomUUID(),
          company_id: companyId,
          facility_id: facilityId,
          scope: scopeLabel,
          category: String(row.category || ''),
          source: String(row.source || ''),
          amount: Number(row.amount),
          unit: String(row.unit || ''),
          method: String(row.method || 'calculation'),
          co2e_tonnes: calculated.co2e_tonnes,
          // Persist the computed result so consumers never have to re-derive
          // it from the polymorphic `amount` column.
          co2e_kg: Number(calculated.co2e_tonnes) * 1000,
          factor: String(calculated.factor),
          confidence: Number(calculated.confidence),
          date: row.date || null,
          activity_date: activityDate,
          notes: row.notes || null,
          created_at: createdAt,
        };
        entries.push(entry);
      }

      // Collect errors and warnings for this row. UAD-02: warnings are only
      // meaningful for rows that actually persist — a rejected row's
      // "stored without facility association" / "using import time" note
      // describes storage that never happened.
      rowErrors.forEach(function (e) { importErrors.push(e); });
      if (rowErrors.length === 0) {
        rowWarnings.forEach(function (w) { importWarnings.push(w); });
      }
    }

    // Persist valid entries. Postgres (via RLS-bypass transaction) when a DB is
    // configured; otherwise the in-memory sample store (dev/preview only).
    if (entries.length > 0) {
      if (pgPool) {
        try {
          const reserved = await reserveCsvImportQuota(plan, companyId, entries.length,
            (client) => persistCsvEntries(client, entries));
          if (!reserved) {
            const quota = canImportCsv(plan, planLimits(plan).csvImportsPerMonth);
            return res.status(402).json({
              success: false,
              code: 'upgrade_required',
              requiredPlan: quota.requiredPlan,
              error: `Your ${plan} plan includes ${quota.limit} CSV imports per month and you have used all of them. Upgrade to ${quota.requiredPlan} for unlimited imports.`,
            });
          }
        } catch (dbErr) {
          log('error', 'CSV ingest DB insert failed', { error: String(dbErr), companyId, rows: entries.length });
          return res.status(500).json({ success: false, error: 'Failed to save imported rows. No data was imported.' });
        }
      } else if (allowSampleData()) {
        sampleEmissionEntries.push.apply(sampleEmissionEntries, entries);
      }
      emissionsSummaryCache.clear();
    }

    var ingestResult = {
      id: jobId,
      status: entries.length > 0 ? 'completed' : 'failed',
      imported: entries.length,
      total_rows: rawRows.length,
      errors: importErrors,
      warnings: importWarnings,
      company_id: companyId,
      // Timestamps the entry for TTL pruning (PERF-003); also useful in the
      // /api/ingest/status payload. Additive field.
      created_at: new Date().toISOString(),
    };
    recordIngestJob(ingestResult);

    return res.json({
      success: true,
      job_id: jobId,
      imported: entries.length,
      total_rows: rawRows.length,
      errors: importErrors,
      warnings: importWarnings,
    });
  } catch (err) {
    // Same split as /api/calculate: CSV header/parse validation is a 400 with
    // a user-facing message; a quota-count or store failure behind this point
    // is infrastructure and must not be echoed back as bad input.
    const failure = classifyApiFailure(err);
    if (failure.status >= 500) {
      log('error', 'CSV ingest failed on infrastructure', { error: String(err.message || err), companyId });
    }
    return res.status(failure.status).json({ success: false, error: failure.message });
  }
});

app.get('/api/ingest/status/:job_id', apiAuthGuard, async function (req, res) {
  try {
    // Resolve the caller's own company FIRST (API-012): looking the job up
    // before the tenant check returned 404 for unknown ids but 403 for
    // foreign-but-real ones — an existence oracle over ingest jobs. Both now
    // return an identical 404, matching the facility/report siblings.
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    const job = ingestJobs.get(req.params.job_id);
    if (!job || String(job.company_id) !== String(companyId)) {
      return res.status(404).json({ success: false, error: 'Ingest job not found' });
    }
    return res.json({ success: true, data: job });
  } catch (err) {
    log('error', 'Ingest status lookup failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to load ingest status' });
  }
});

// requirePlan added: these reads return the customer's own paid data, so an
// expired trial or canceled subscription must lose access to them too. The
// dashboard summary/trend were already gated, but the same figures were
// reachable per-facility, and report download regenerates a fresh PDF from
// live data on every call.
app.get('/api/companies/:id/facilities', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.params.id);
  if (!companyId) return;
  // loadFacilities throws in production when the data store is unavailable.
  // Express 4 does not catch async handler rejections, and the process-level
  // unhandledRejection handler calls process.exit(1) — so an unguarded await
  // here turns one transient DB error into a full outage for every tenant.
  try {
    const facilities = await loadFacilities(companyId);
    return res.json({ success: true, data: facilities });
  } catch (err) {
    log('error', 'Facilities list failed', { error: String(err), companyId });
    return res.status(500).json({ success: false, error: 'Failed to load facilities' });
  }
});

// Canonical facility types — the set the sample fixtures and the app's
// facility concepts use. A short enum keeps junk (and unbounded strings) out
// of the column, which had no CHECK constraint and no server-side validation
// (API-003).
const FACILITY_TYPES = new Set(['office', 'factory', 'warehouse']);

// Shared bounds for persisted facility strings, mirroring the
// facilities.name cap in initial-schema.sql (char_length BETWEEN 1 AND 200).
const FACILITY_FIELD_MAX = 200;

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
    return res.status(400).json({ success: false, error: 'type must be one of: office, factory, warehouse' });
  }

  try {
    // Facility cap. requirePlan has already attached req.billing. This has to
    // sit inside the try — loadFacilities throws when the data store is
    // unavailable, and Express 4 does not catch async rejections, so an
    // uncaught one would hang the request instead of erroring cleanly.
    const plan = (req.billing && req.billing.plan) || 'starter';
    const existing = await loadFacilities(companyId);
    const facilityCheck = canAddFacility(plan, existing.length);
    if (!facilityCheck.allowed) {
      return res.status(402).json({
        success: false,
        code: 'upgrade_required',
        requiredPlan: facilityCheck.requiredPlan,
        error: `Your ${plan} plan includes ${facilityCheck.limit} ${facilityCheck.limit === 1 ? 'facility' : 'facilities'}. Upgrade to ${facilityCheck.requiredPlan} to add more.`,
      });
    }

    if (pgPool) {
      const result = await queryWithRlsBypass(
        `INSERT INTO public.facilities (company_id, name, type, city)
         VALUES ($1, $2, $3, $4) RETURNING id, company_id, name, type, city`,
        [companyId, facilityName, facilityType, facilityCity]
      );
      emissionsSummaryCache.clear();
      return res.status(201).json({ success: true, data: result.rows[0] });
    }
    if (allowSampleData()) {
      const facility = { id: crypto.randomUUID(), company_id: companyId, name: facilityName, type: facilityType, city: facilityCity };
      sampleFacilities.push(facility);
      return res.status(201).json({ success: true, data: facility });
    }
    return res.status(503).json({ success: false, error: 'Data store unavailable' });
  } catch (err) {
    log('error', 'Facility create failed', { error: String(err), companyId });
    return res.status(500).json({ success: false, error: 'Failed to create facility' });
  }
});

app.get('/api/facilities/:id/emissions', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    // Resolve the caller's own company FIRST. Loading the facility before the
    // tenant check made the response an existence oracle: a foreign-but-real
    // facility id returned 403 while a nonexistent one returned 404, letting
    // any authenticated user enumerate which sequential ids exist across all
    // tenants. Both cases now return an identical 404.
    const companyId = await requireCompanyAccess(req, res, null);
    if (!companyId) return;
    const facility = await loadFacilityById(req.params.id);
    if (!facility || String(facility.company_id) !== String(companyId)) {
      return res.status(404).json({ success: false, error: 'Facility not found' });
    }
    const entries = await loadEmissionEntries(companyId);
    const result = buildFacilityEmissions([facility], entries);
    return res.json({ success: true, data: result[0] });
  } catch (err) {
    log('error', 'Facility emissions failed', { error: String(err), facilityId: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to load facility emissions' });
  }
});

app.get('/api/companies/:id/compliance', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.params.id);
    if (!companyId) return;
    // getCompany() only resolves the in-memory sample fixtures. Real company
    // rows carry no revenue/employees/region (see initial-schema.sql), so it
    // used to fall through to a {revenue:0, employees:0, region:'CA'} stub and
    // return "not_applicable" for every real tenant — a confidently wrong
    // compliance verdict. Answer honestly until those fields are modelled.
    const company = sampleCompanies[companyId];
    if (!company) {
      return res.status(501).json({
        success: false,
        error: 'Compliance profiling needs your company revenue, headcount, and operating regions. Add them in Settings to enable this report.',
      });
    }
    return res.json({ success: true, data: getComplianceStatus(company) });
  } catch (err) {
    log('error', 'Compliance status failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to load compliance status' });
  }
});

app.get('/api/compliance/deadlines', apiAuthGuard, function (_req, res) {
  // Dates come from the shared compliance-deadlines table. This route used to
  // return a hardcoded SB 253 "2026-01-01", which on 2026-10-05 reported the
  // deadline as overdue nine months before it was actually due — see
  // compliance-deadlines.cjs.
  const now = Date.now();
  const deadlines = allDeadlines(now);
  // Applicability is only knowable from a company profile (revenue/employees/
  // region). Real tenant rows carry none of those yet, so the response says so
  // instead of implying every framework applies to every company.
  return res.json({
    success: true,
    data: deadlines,
    applicability: 'unknown',
    applicability_note:
      'Applicability requires your company revenue, headcount, and operating region, which are not recorded yet.',
  });
});

app.post('/api/compliance/:id/signoff', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.body && req.body.company_id);
    if (!companyId) return;
    // Previously this echoed {status:'completed'} for ANY :id without writing
    // anything — including report ids belonging to other tenants. Sign-off is
    // an audit-trail action; it must actually persist and must be scoped to
    // the caller's own company.
    if (!/^\d+$/.test(String(req.params.id))) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    if (!pgPool) {
      return res.status(503).json({ success: false, error: 'Sign-off is unavailable while the data store is offline' });
    }
    const signedAt = new Date().toISOString();
    const result = await queryWithRlsBypass(
      `UPDATE public.reports
          SET signoff = 'completed', last_updated = $3
        WHERE id = $1 AND company_id = $2
        RETURNING id`,
      [req.params.id, companyId, signedAt]
    );
    if (!result || result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    return res.json({ success: true, data: { id: req.params.id, status: 'completed', signed_off_at: signedAt } });
  } catch (err) {
    log('error', 'Compliance signoff failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to record sign-off' });
  }
});

app.post('/api/companies/:id/reports/generate', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.params.id);
    if (!companyId) return;
    const period = req.body && req.body.period ? String(req.body.period) : null;
    // Same validation the summary route applies. reports.period is an
    // unconstrained TEXT column, so an unvalidated body field let any
    // authenticated account persist a ~100 KB "period" string per request.
    if (period !== null && !SUMMARY_PERIOD_PATTERN.test(period)) {
      return res.status(400).json({ success: false, error: 'period must be a 4-digit year, e.g. 2026' });
    }
    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });

    if (pgPool) {
      // Persist report metadata; the PDF is regenerated deterministically on
      // download from the stored company + period (no in-memory PDF store).
      const title = 'Carbon Report ' + new Date().toISOString().split('T')[0];
      const result = await queryWithRlsBypass(
        `INSERT INTO public.reports (company_id, title, type, status, last_updated, completeness, signoff, period)
         VALUES ($1, $2, 'carbon', 'final', now(), 100, 'pending', $3) RETURNING id`,
        [companyId, title, period]
      );
      const reportId = result.rows[0].id;
      return res.json({ success: true, report_id: reportId, download_url: `/api/reports/${reportId}/download` });
    }

    // Dev / no-DB fallback: keep the PDF in memory for the immediate download.
    const reportId = crypto.randomUUID();
    const pdf = createSimplePdf(buildReportText(summary, period));
    generatedReports.set(reportId, { id: reportId, company_id: companyId, period: period, pdf: pdf });
        // PERF-003 residual: cap the in-memory report store so repeated
        // generates cannot grow it for the life of the process.
        while (generatedReports.size > 50) {
          const oldestReportId = generatedReports.keys().next().value;
          generatedReports.delete(oldestReportId);
        }
    return res.json({ success: true, report_id: reportId, download_url: `/api/reports/${reportId}/download` });
  } catch (err) {
    // Every throw on this route is infrastructure (store read, report insert)
    // or an internal engine fault — there is no user-input validation path —
    // so respond generically instead of echoing the internal error string.
    log('error', 'Report generation failed', { error: String(err), companyId: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to generate report' });
  }
});

app.get('/api/reports/:id/download', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    let companyId;
    let period = null;

    if (pgPool && /^\d+$/.test(req.params.id)) {
      // Resolve the caller's own company FIRST, then look the report up
      // scoped to it. Fetching the row before the tenant check returned 404
      // for a nonexistent id but 403 for a foreign-but-real one, letting any
      // authenticated user enumerate which sequential report ids exist across
      // all tenants (same oracle the facilities route closed). Both cases now
      // return an identical 404.
      companyId = await requireCompanyAccess(req, res, null);
      if (!companyId) return;
      const { rows } = await pgPool.query(
        'SELECT company_id, period FROM reports WHERE id = $1 AND company_id = $2',
        [req.params.id, companyId]
      );
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'Report not found' });
      period = rows[0].period;
    } else {
      // Dev / no-DB fallback: serve the in-memory PDF captured at generate time.
      // Tenant check BEFORE the map lookup (API-012): unknown and foreign ids
      // are indistinguishable 404s here too.
      companyId = await requireCompanyAccess(req, res, null);
      if (!companyId) return;
      const report = generatedReports.get(req.params.id);
      if (!report || String(report.company_id) !== String(companyId)) {
        return res.status(404).json({ success: false, error: 'Report not found' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ecoauditor-report-${req.params.id}.pdf"`);
      return res.send(report.pdf);
    }

    // Regenerate the PDF from persisted data for the report's period.
    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });
    const pdf = createSimplePdf(buildReportText(summary, period));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ecoauditor-report-${req.params.id}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    log('error', 'Report download failed', { error: String(err), reportId: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to generate report PDF' });
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
    log('error', 'Failed to stat video file', { path: filePath, error: String(err) });
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
      log('error', 'Video stream error', { error: String(err) });
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
      log('error', 'Video stream error', { error: String(err) });
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      else res.end();
    });
    stream.pipe(res);
  }
});

// ─── Static files with cache headers ───
app.use(express.static(path.join(__dirname, 'static'), {
  setHeaders: function (res, filePath) {
    // Extracted to server-http-utils.cjs (RT-05) so the policy is testable
    // without booting the server.
    const cacheControl = getStaticCacheHeaders(filePath);
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  },
}));

// ─── Prerendered marketing routes ───
// scripts/prerender.mjs writes static/<route>/index.html for each
// marketing path. express.static serves these on requests with a trailing
// slash, but crawlers and most inbound links hit the bare path
// (/pricing, /methodology, …). Map those to the prerendered file BEFORE
// the SPA fallback so non-JS clients receive real content. Routes NOT
// in this set (/app/*, /auth/*) fall through to the client-side shell as
// before. /login and /signup are prerendered (noindex) so non-JS clients
// and crawlers see route-appropriate content instead of the homepage shell.
var PRERENDERED_ROUTES = [
  '/pricing', '/methodology', '/sample-report', '/security', '/demo',
  '/contact', '/privacy', '/terms', '/dpa',
  '/login', '/signup',
];
PRERENDERED_ROUTES.forEach(function (route) {
  app.get(route, function (_req, res, next) {
    var file = path.join(__dirname, 'static', route, 'index.html');
    if (fs.existsSync(file)) {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.sendFile(file);
    } else {
      // Prerender artifact missing (build regression) — fall back to SPA shell
      // so the page still loads for humans. Loud fix is to repair the build.
      next();
    }
  });
});

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
// Only serve the SPA shell for known client-side routes. Everything else
// should return a real 404 so crawlers don't index an infinite duplicate-
// content space of soft-404 homepages.
app.get('*', function (req, res) {
  const spaRoots = ['/app', '/auth', '/blog'];
  const isKnownSpa = spaRoots.some(function (root) {
    return req.path === root || req.path.startsWith(root + '/');
  });
  if (isKnownSpa) {
    // no-cache like the sibling HTML responses: sendFile sets Last-Modified/ETag,
    // so without it browsers heuristically reuse a stale shell after a deploy and
    // request hashed asset filenames that no longer exist — blank /app until reload.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    return res.sendFile(path.join(__dirname, 'static', 'index.html'));
  }
  // UXE-003: unknown marketing URLs previously got an unbranded plaintext
  // "Not found". Serve a minimal branded page (still noindex, still a real
  // 404 for crawlers) so the dead end stays on-brand.
  res.status(404)
    .setHeader('Cache-Control', 'no-cache, no-transform')
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Not found — Eco-Auditor</title><meta name="robots" content="noindex">' +
      '<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7faf9;color:#1b2a27}' +
      'main{text-align:center;padding:2rem}a{color:#0e7a5f}</style></head>' +
      '<body><main><h1>Not found</h1><p>The page you are looking for does not exist.</p>' +
      '<p><a href="/">Go to Eco-Auditor</a></p></main></body></html>');
});

// ─── Structured logging ───
function log(level, message, context) {
  const entry = {
    level: level,
    timestamp: new Date().toISOString(),
    message: message,
    // Explicit context wins; otherwise take the id of whichever request (if
    // any) this call is running inside (INFRA-007).
    requestId: context && context.requestId || requestIdStore.getStore() || undefined,
  };
  if (context) {
    Object.keys(context).forEach(function (k) {
      if (k !== 'requestId') entry[k] = context[k];
    });
  }
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

// ─── Global error handlers ───
process.on('uncaughtException', function (err) {
  log('error', 'Uncaught exception', { error: String(err), stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', function (reason) {
  log('error', 'Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

// ─── Graceful shutdown ───
let server;

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

  server = app.listen(PORT, '0.0.0.0', function () {
    var videoPath = findVideoPath();
    log('info', 'Eco-Auditor listening', { port: PORT, video: videoPath || 'not-found' });
  });
}

startServer().catch(function (err) {
  log('error', 'Server startup failed', { error: String(err) });
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
