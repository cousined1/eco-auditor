const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  calculateEntry,
  summarizeEntries,
  toDashboardSummary,
  parseEmissionCsv,
  getComplianceStatus,
  buildFacilityEmissions,
} = require('./emissions-engine.cjs');
const {
  buildSecurityHeaders,
  canUseDevAuth,
  resolveAuthorizedCompanyId,
  sanitizeLeadPayload,
} = require('./server-security.cjs');
const {
  billingStateFromCompany,
  hasPlanAccess,
  planFromPriceId,
  resolvePlanPriceId,
  subscriptionRecordFromStripe,
  trialEligiblePriceIds,
} = require('./server-billing.cjs');

// ─── Version 2.0.1 - Added Cache-Control: no-transform for Cloudflare fix ───

// ─── Stripe SDK (lazy init) ───
let stripe = null;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    stripe = new Stripe(STRIPE_SECRET_KEY);
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
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  } catch (err) {
    // pg package not installed — billing routes that need user lookup will return 503
  }
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

// nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage app APIs use bearer Authorization headers, not ambient cookie auth.
const app = express();
const PORT = process.env.PORT;

if (!PORT) {
  console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), message: 'PORT environment variable is required' }));
  process.exit(1);
}

// ─── Trust proxy for correct client IP behind Railway/Cloudflare ───
// Railway terminates TLS and forwards X-Forwarded-For; without this,
// req.ip resolves to the proxy IP and rate limiting collapses all users.
app.set('trust proxy', 1);

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

app.use(function (req, res, next) {
  // Key on req.ip, which honors `trust proxy` above. Parsing the leftmost
  // X-Forwarded-For entry directly is client-spoofable (rate-limit bypass
  // and unbounded store growth from forged keys).
  const key = req.ip || 'unknown';
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

// ─── Version endpoint (for forced-update watchdog) ───
app.get('/api/version', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    version: process.env.APP_VERSION || process.env.npm_package_version || process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
    build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    timestamp: new Date().toISOString(),
  });
});

// ─── Health check with DB status ───
app.get('/health', function (_req, res) {
  // Check InsForge/DB connectivity if configured
  let dbStatus = 'not configured';
  const insforgeUrl = process.env.INSFORGE_URL || process.env.NEXT_PUBLIC_INSFORGE_URL;
  if (insforgeUrl) {
    dbStatus = 'configured';
  }

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.APP_VERSION || process.env.npm_package_version || '0.0.0',
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// ─── InsForge config endpoint (for auth) ───
app.get('/api/insforge-config', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.json({
    url: process.env.INSFORGE_URL || process.env.NEXT_PUBLIC_INSFORGE_URL || null,
    anonKey: process.env.INSFORGE_ANON_KEY || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || null,
  });
});

app.get('/ready', function (_req, res) {
  const videoPath = findVideoPath();
  res.json({
    status: videoPath ? 'ok' : 'degraded',
    video: videoPath ? 'available' : 'not-found',
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
    return res.json({ trial: true, trialEndsAt: null, source: 'error-fallback' });
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
    if (req.headers.authorization === 'Bearer invalid-token') {
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
  const companyId = await ensureCompanyForUser(user);
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
    const insert = await client.query(
      `INSERT INTO public.companies (user_id, name, industry, updated_at, trial_ends_at)
       VALUES ($1, $2, 'other', now(), now() + INTERVAL '14 days')
       RETURNING id, trial_ends_at`,
      [userId, defaultName]
    );
    await client.query('COMMIT');
    log('info', 'Auto-provisioned company with 14-day trial', { userId, companyId: insert.rows[0].id, trialEndsAt: insert.rows[0].trial_ends_at });
    return insert.rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'ensureCompanyForUser failed', { error: String(err), userId });
    return null;
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
    await pgPool.query(
      'INSERT INTO users (insforge_user_id, stripe_customer_id, email) VALUES ($1, $2, $3)',
      [insforgeUserId, customer.id, email]
    );
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
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Persists a subscription snapshot (from a Stripe webhook or API mutation)
// onto the owning user's company row. Returns true when a row was updated.
async function syncSubscriptionRecord(record) {
  if (!pgPool) {
    log('warn', 'Subscription sync skipped: DATABASE_URL not configured');
    return false;
  }
  if (!record.stripeCustomerId) return false;

  const { rows } = await pgPool.query(
    'SELECT insforge_user_id FROM users WHERE stripe_customer_id = $1',
    [record.stripeCustomerId]
  );
  if (rows.length === 0) {
    log('warn', 'Subscription sync skipped: no user for Stripe customer', { customerId: record.stripeCustomerId });
    return false;
  }
  const userId = rows[0].insforge_user_id;

  // Companies are normally provisioned on first data access; make sure the
  // row exists so a checkout completed before app usage is not dropped.
  await ensureCompanyForUser({ id: userId });

  const result = await queryWithRlsBypass(
    `UPDATE public.companies SET
       stripe_customer_id = $2,
       stripe_subscription_id = $3,
       subscription_status = $4,
       subscription_plan = $5,
       subscription_billing_cycle = $6,
       subscription_current_period_end = $7,
       subscription_cancel_at_period_end = $8,
       updated_at = now()
     WHERE user_id = $1`,
    [userId, record.stripeCustomerId, record.stripeSubscriptionId, record.status,
     record.plan, record.billingCycle, record.currentPeriodEnd, record.cancelAtPeriodEnd]
  );
  if (result.rowCount === 0) {
    log('warn', 'Subscription sync found no company row', { userId });
    return false;
  }
  log('info', 'Subscription synced to DB', { userId, status: record.status, plan: record.plan });
  return true;
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
// minPlanId. Skips enforcement when no DB is configured (dev mode) or the
// company row does not exist yet (trial is provisioned on first data access).
function requirePlan(minPlanId) {
  return async function (req, res, next) {
    if (!pgPool) return next();
    try {
      const state = await loadBillingState(req.user.id);
      if (!state) return next();
      if (!state.active || !hasPlanAccess(state.plan, minPlanId)) {
        return res.status(402).json({
          success: false,
          error: 'An active subscription is required for this feature',
          code: 'upgrade_required',
          requiredPlan: minPlanId,
        });
      }
      req.billing = state;
      return next();
    } catch (err) {
      log('error', 'requirePlan check failed', { error: String(err) });
      return next(); // fail-open: a billing check outage must not take down core APIs
    }
  };
}

// Finds the customer's current subscription (active first, then trialing).
async function findActiveSubscription(customerId) {
  const active = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
  if (active.data.length) return active.data[0];
  const trialing = await stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 1 });
  return trialing.data.length ? trialing.data[0] : null;
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
    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: subscription.items.data[0].id, price: priceId }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
    });
    await syncSubscriptionRecord(subscriptionRecordFromStripe(updated, process.env));
    log('info', 'Subscription changed', { subId: updated.id, planId, billing, userId: req.user.id });
    return res.json({ success: true, plan: planId, billing });
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
    const updated = await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
    await syncSubscriptionRecord(subscriptionRecordFromStripe(updated, process.env));
    log('info', 'Subscription set to cancel at period end', { subId: updated.id, userId: req.user.id });
    return res.json({ success: true, cancelAtPeriodEnd: true });
  } catch (err) {
    log('error', 'Subscription cancel failed', { error: String(err) });
    return res.status(500).json({ error: 'Cancellation failed' });
  }
});

app.get('/api/checkout', function (_req, res) {
  res.status(404).json({ error: 'Not found' });
});

// ─── Public config endpoint for Stripe price IDs (frontend fetches these at runtime) ───
app.get('/api/config/prices', function (_req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min client-side cache
  res.json({
    starter: {
      monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || process.env.VITE_STRIPE_PRICE_STARTER_MONTHLY || null,
      annual:  process.env.STRIPE_PRICE_STARTER_ANNUAL  || process.env.VITE_STRIPE_PRICE_STARTER_ANNUAL  || null,
    },
    growth: {
      monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || process.env.VITE_STRIPE_PRICE_GROWTH_MONTHLY || null,
      annual:  process.env.STRIPE_PRICE_GROWTH_ANNUAL  || process.env.VITE_STRIPE_PRICE_GROWTH_ANNUAL  || null,
    },
    pro: {
      monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.VITE_STRIPE_PRICE_PRO_MONTHLY || null,
      annual:  process.env.STRIPE_PRICE_PRO_ANNUAL  || process.env.VITE_STRIPE_PRICE_PRO_ANNUAL  || null,
    },
    pk: process.env.VITE_STRIPE_PK || null,
  });
});

// Allowed Stripe price IDs (prevents client-controlled price injection)
const ALLOWED_PRICE_IDS = new Set([
  process.env.STRIPE_PRICE_STARTER_MONTHLY,
  process.env.STRIPE_PRICE_STARTER_ANNUAL,
  process.env.STRIPE_PRICE_GROWTH_MONTHLY,
  process.env.STRIPE_PRICE_GROWTH_ANNUAL,
  process.env.STRIPE_PRICE_PRO_MONTHLY,
  process.env.STRIPE_PRICE_PRO_ANNUAL,
].filter(Boolean));

// Plans eligible for trial (prevent trial abuse on higher tiers)
const TRIAL_ELIGIBLE_PLANS = new Set([
  process.env.STRIPE_PRICE_STARTER_MONTHLY,
  process.env.STRIPE_PRICE_GROWTH_MONTHLY,
].filter(Boolean));

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

    const sessionParams = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (process.env.APP_URL || 'http://localhost:3000') + '/app?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (process.env.APP_URL || 'http://localhost:3000') + '/pricing',
    };

    // Only allow trial on eligible plans
    if (trial && TRIAL_ELIGIBLE_PLANS.has(priceId)) {
      sessionParams.subscription_data = { trial_period_days: 14 };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    log('info', 'Checkout session created', { sessionId: session.id, userId: req.user.id });
    return res.json({ url: session.url });
  } catch (err) {
    log('error', 'Checkout session failed', { error: String(err) });
    return res.status(500).json({ error: 'Checkout session creation failed' });
  }
});

app.post('/api/portal', express.json(), stripeGuard, authGuard, async function (req, res) {
  try {
    const customerId = await ensureStripeCustomer(req.user.id, req.user.email);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: (process.env.APP_URL || 'http://localhost:3000') + '/app/settings',
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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        log('info', 'Checkout completed', { sessionId: session.id });
        if (session.subscription) {
          const subscription = typeof session.subscription === 'string'
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription;
          await syncSubscriptionRecord(subscriptionRecordFromStripe(subscription, process.env));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        log('info', 'Subscription lifecycle event', { subId: subscription.id, status: subscription.status });
        await syncSubscriptionRecord(subscriptionRecordFromStripe(subscription, process.env));
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

  return res.json({ received: true });
});

// ─── Video streaming ───
const VIDEO_FILENAME = 'eco-auditor-intro.mp4';
const VIDEO_PATHS = [
  path.join('/app/videos', VIDEO_FILENAME),
  path.join(__dirname, 'static', VIDEO_FILENAME),
  path.join(__dirname, 'public', VIDEO_FILENAME),
];

function findVideoPath() {
  for (const p of VIDEO_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore permission errors
    }
  }
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
function writeLead(lead) {
  ensureLeadsDir();
  const leads = readLeads();
  leads.push({ ...lead, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// ─── CONSENT AUDIT TRAIL ───
// Server-side record of consent decisions (GDPR/CCPA record-keeping).
// Public endpoint: consent happens before authentication. No raw IP is stored.
const CONSENT_FILE = path.join(__dirname, '.data', 'consent-audit.json');
const CONSENT_METHODS = new Set(['accept_all', 'reject_all', 'custom', 'privacy_signal', 'reset']);

function appendConsentRecordToFile(record) {
  ensureLeadsDir();
  let records = [];
  if (fs.existsSync(CONSENT_FILE)) {
    try { records = JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf8')); } catch { records = []; }
  }
  records.push(record);
  fs.writeFileSync(CONSENT_FILE, JSON.stringify(records, null, 2));
}

app.post('/api/consent-audit', express.json({ limit: '4kb' }), async function (req, res) {
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
    ipHash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 32),
    createdAt: new Date().toISOString(),
  };

  try {
    if (pgPool) {
      await queryWithRlsBypass(
        `INSERT INTO public.consent_records (visitor_id, consent, policy_version, method, gpc, dnt, user_agent, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [record.visitorId, JSON.stringify(record.consent), record.policyVersion, record.method,
         record.gpc, record.dnt, record.userAgent, record.ipHash]
      );
    } else {
      appendConsentRecordToFile(record);
    }
    return res.status(202).json({ received: true });
  } catch (err) {
    log('error', 'Consent audit persistence failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to record consent' });
  }
});

// ─── SALESBOT CHAT ENGINE ───
const ECOAUDITOR_KB = [
  {
    pattern: /pricing|cost|how much|plan/i,
    response: "We offer three plans:\n\n• **Starter** — $149/mo for basic carbon tracking\n• **Growth** — $399/mo for full Scope 1/2/3 reporting\n• **Pro** — $999/mo for multi-facility teams\n\nAll plans include a 14-day free trial. Would you like me to help you choose the right plan?"
  },
  {
    pattern: /demo|book a demo|schedule a call|talk to sales/i,
    response: "I'd be happy to schedule a demo! To get started, could you tell me your name?"
  },
  {
    pattern: /contact|reach out|email|phone/i,
    response: "You can reach us at:\n\n• Email: hello@developer312.com\n• Phone: (510) 401-1225\n\nOr I can connect you with our sales team right here in the chat!"
  },
  {
    pattern: /how (it|does) work|features|what is|about/i,
    response: "EcoAuditor helps businesses track and report carbon emissions:\n\n• **CSV import** of activity data\n• **Scope 1/2/3 reporting** aligned with GHG Protocol\n• **Compliance readiness** for California SB 253/SB 261 and EU CBAM\n• **Scope 1/2/3 emission calculations** using EPA & eGRID factors\n\nWant to see it in action? I can book you a demo!"
  },
  {
    pattern: /scope 1|scope 2|scope 3|ghg|protocol/i,
    response: "We follow the GHG Protocol for comprehensive emissions accounting:\n\n• **Scope 1**: Direct emissions from owned/controlled sources\n• **Scope 2**: Indirect emissions from purchased energy\n• **Scope 3**: All other indirect emissions in your value chain\n\nOur platform automates data collection and reporting across all three scopes."
  },
  {
    pattern: /cbam|carbon border|eu|europe/i,
    response: "EcoAuditor helps you prepare for the EU Carbon Border Adjustment Mechanism (CBAM):\n\n• Track embedded emissions in imports\n• Generate CBAM-compliant reports\n• Monitor compliance deadlines\n• Calculate carbon costs\n\nNeed help getting CBAM-ready? Book a demo with our team!"
  },
  {
    pattern: /\bsec\b|disclosure|climate rule/i,
    response: "EcoAuditor helps you build audit-ready GHG disclosures:\n\n• Emissions data collection and validation\n• Scope 1/2/3 inventory with confidence scoring\n• Exportable summaries for voluntary and regulatory reporting\n\nNote: the U.S. SEC climate-disclosure rule was withdrawn in 2025 — we focus on California SB 253/SB 261, EU CBAM, and voluntary GHG reporting."
  },
  {
    pattern: /california|ab 1305|climate corporate/i,
    response: "EcoAuditor is built for California's Climate Corporate Data Accountability Act (SB 253):\n\n• Automated emissions reporting\n• Third-party verification support\n• Public disclosure templates\n• Compliance timeline tracking\n\nStay ahead of California's climate reporting requirements with EcoAuditor."
  },
  {
    pattern: /smb|small business|startup|affordable/i,
    response: "EcoAuditor is designed for businesses of all sizes:\n\n• **Starter plan** at $149/mo for small teams\n• Easy setup — no technical expertise needed\n• Templates and guides for first-time reporters\n• Scale up as your reporting needs grow\n\nStart your 14-day free trial today!"
  },
  {
    pattern: /integration|api|connect|erp|salesforce/i,
    response: "EcoAuditor works with your existing tools:\n\n• **CSV import/export** for spreadsheets\n\nMore integrations are on our roadmap. Need a specific integration? Let us know!"
  }
];

function getBotResponse(message, state = {}) {
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
      // Save lead
      writeLead({
        type: 'demo_request',
        name: state.name,
        email: state.email,
        company: state.company,
        preferredDate: state.date,
        preferredTime: message,
        source: 'chatbot'
      });
      
      // Generate PrismDeck presentation link
      const prismDeckUrl = `https://radiant-alignment-production-b430.up.railway.app/?product=ecoauditor&company=${encodeURIComponent(state.company)}&email=${encodeURIComponent(state.email)}`;
      
      return {
        response: `🎉 Demo booked!\n\nOur team will reach out to ${state.email} within 24 hours to confirm your demo for ${state.date} (${message}).\n\n📊 Meanwhile, I've prepared a personalized presentation for ${state.company}:\n🔗 [View Your EcoAuditor Deck](${prismDeckUrl})\n\nIn the meantime, check out our [Pricing](/pricing) or ask me anything else!`,
        state: {}
      };
    }
  }

  if (state.flow === 'contact') {
    if (!state.name) {
      return {
        response: `Thanks for reaching out! What's your name?`,
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
      writeLead({
        type: 'contact_request',
        name: state.name,
        email: state.email,
        message: message,
        source: 'chatbot'
      });
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
app.post('/api/chat', express.json({ limit: '16kb' }), async function (req, res) {
  const startTime = Date.now();
  const { message, sessionId, state = {} } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  if (message.length > 5000) {
    return res.status(400).json({ success: false, error: 'Message too long (max 5000 chars)' });
  }

  // Use salesbot engine first
  // Salesbot engine v2
  const botResult = getBotResponse(message.trim(), state);
  
  // If we have a specific flow response, return it immediately
  if (botResult.response) {
    return res.json({
      success: true,
      response: botResult.response,
      state: botResult.state || state,
      quickReplies: !botResult.state?.flow ? ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] : undefined
    });
  }

  // Fallback to AI if no pattern matched and no flow is active
  const chatModel = process.env.CHAT_MODEL;
  const chatApiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!chatApiKey) {
    return res.json({
      success: true,
      response: "I'm here to help! I can assist with:\n\n• 💰 Pricing and plans\n• 📅 Booking a demo\n• 🚀 How EcoAuditor works\n• 📞 Contacting sales\n• Carbon accounting and compliance questions\n\nWhat would you like to know?",
      quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales']
    });
  }

  try {
    const systemPrompt = `You are the EcoAuditor AI assistant — an expert in carbon accounting, emissions reporting, GHG protocols, Scope 1/2/3, California SB 253/SB 261, EU CBAM, and sustainability compliance for SMBs. Answer clearly and concisely. When uncertain, say so rather than guessing. Do not provide legal or regulatory advice — recommend consulting a specialist for specific compliance questions.`;

    let result;
    if (chatModel === 'anthropic' || process.env.ANTHROPIC_API_KEY) {
      const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: message.trim() }],
        }),
      });
      const data = await response.json();
      result = data.content?.[0]?.text || 'Sorry, I could not process that request.';
    } else {
      const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message.trim() },
          ],
        }),
      });
      const data = await response.json();
      result = data.choices?.[0]?.message?.content || 'Sorry, I could not process that request.';
    }

    return res.json({ success: true, response: result.trim(), quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] });
  } catch (err) {
    log('error', 'Chat API error', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Internal error. Please try again.', quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] });
  }
});

// ─── LEADS API ───
app.post('/api/leads', express.json({ limit: '8kb' }), async function (req, res) {
  const lead = sanitizeLeadPayload(req.body);
  if (!lead.ok) {
    return res.status(lead.status).json({ success: false, error: lead.error });
  }

  writeLead(lead.value);

  return res.json({ success: true, message: 'Lead captured successfully' });
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
      sql += ' ORDER BY created_at ASC';
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
}

app.post('/api/calculate', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const body = req.body || {};
    const companyId = await requireCompanyAccess(req, res, body.company_id || body.companyId);
    if (!companyId) return;
    const period = body.period || String(new Date().getFullYear());

    if (Array.isArray(body.entries) || body.scope) {
      const entries = Array.isArray(body.entries) ? body.entries : [body];
      const summary = summarizeEntries(entries, { companyId: companyId, period: period });
      log('info', 'Calculator API completed', { companyId: companyId, period: period, entries: entries.length });
      return res.json(summary);
    }

    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });
    log('info', 'Calculator API completed', { companyId: companyId, period: period, entries: entries.length });
    return res.json(summary);
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
});

app.get('/api/emissions/summary', apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.query.company_id);
  if (!companyId) return;
  const period = req.query.period || String(new Date().getFullYear());

  try {
    const cacheKey = `summary:${companyId}:${period}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const entries = await loadEmissionEntries(companyId, period);
    const summary = summarizeEntries(entries, { companyId: companyId, period: period });
    const response = { success: true, data: toDashboardSummary(summary), methodology: summary.methodology };
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

  try {
    const entries = await loadEmissionEntries(companyId);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
    const monthly = monthNames.map(function (month, index) {
      const monthEntries = entries.filter(function (entry) {
        const date = entry.created_at ? new Date(entry.created_at) : null;
        return date && date.getMonth() === index;
      });
      const summary = summarizeEntries(monthEntries, { companyId: companyId });
      return {
        month: month,
        scope1: summary.by_scope.scope1,
        scope2: summary.by_scope.scope2,
        scope3: summary.by_scope.scope3,
      };
    });

    if (period === 'quarterly') {
      const quarterly = [
        { quarter: 'Q1', rows: monthly.slice(0, 3) },
        { quarter: 'Q2', rows: monthly.slice(3, 6) },
        { quarter: 'Q3', rows: monthly.slice(6, 9) },
      ].map(function (bucket) {
        return {
          quarter: bucket.quarter,
          scope1: bucket.rows.reduce((sum, row) => sum + row.scope1, 0),
          scope2: bucket.rows.reduce((sum, row) => sum + row.scope2, 0),
          scope3: bucket.rows.reduce((sum, row) => sum + row.scope3, 0),
        };
      });
      return res.json({ success: true, data: quarterly });
    }

    return res.json({ success: true, data: monthly });
  } catch (err) {
    log('error', 'Emissions trend failed', { error: String(err), companyId: companyId });
    return res.status(500).json({ success: false, error: 'Failed to load emissions trend' });
  }
});

app.post('/api/ingest/csv', express.text({ type: ['text/*', 'application/csv'], limit: '100kb' }), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.query.company_id);
    if (!companyId) return;
    const csvText = req.body || '';
    const rawRows = parseEmissionCsv(csvText);
    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, error: 'CSV file is empty or has no data rows after the header.' });
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

      // Carry the row's own date into created_at when valid, so imported
      // historical data is attributed to the right period (not the import time).
      var createdAt = new Date().toISOString();
      if (row.date) {
        var parsedDate = Date.parse(row.date);
        if (Number.isFinite(parsedDate)) {
          createdAt = new Date(parsedDate).toISOString();
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
          factor: String(calculated.factor),
          confidence: Number(calculated.confidence),
          date: row.date || null,
          notes: row.notes || null,
          created_at: createdAt,
        };
        entries.push(entry);
      }

      // Collect errors and warnings for this row
      rowErrors.forEach(function (e) { importErrors.push(e); });
      rowWarnings.forEach(function (w) { importWarnings.push(w); });
    }

    // Persist valid entries. Postgres (via RLS-bypass transaction) when a DB is
    // configured; otherwise the in-memory sample store (dev/preview only).
    if (entries.length > 0) {
      if (pgPool) {
        try {
          var cols = ['company_id', 'facility_id', 'scope', 'category', 'source', 'amount', 'unit', 'factor', 'method', 'confidence', 'created_at'];
          var valueGroups = [];
          var insertParams = [];
          var p = 1;
          entries.forEach(function (e) {
            var placeholders = cols.map(function () { return '$' + (p++); });
            valueGroups.push('(' + placeholders.join(', ') + ')');
            insertParams.push(
              e.company_id, e.facility_id, e.scope, e.category, e.source,
              e.amount, e.unit, e.factor, e.method, e.confidence, e.created_at
            );
          });
          await queryWithRlsBypass(
            'INSERT INTO public.emission_entries (' + cols.join(', ') + ') VALUES ' + valueGroups.join(', '),
            insertParams
          );
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
    };
    ingestJobs.set(jobId, ingestResult);

    return res.json({
      success: true,
      job_id: jobId,
      imported: entries.length,
      total_rows: rawRows.length,
      errors: importErrors,
      warnings: importWarnings,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: String(err.message || err) });
  }
});

app.get('/api/ingest/status/:job_id', apiAuthGuard, async function (req, res) {
  const job = ingestJobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ success: false, error: 'Ingest job not found' });
  const companyId = await requireCompanyAccess(req, res, job.company_id);
  if (!companyId) return;
  return res.json({ success: true, data: job });
});

app.get('/api/companies/:id/facilities', apiAuthGuard, async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.params.id);
  if (!companyId) return;
  const facilities = await loadFacilities(companyId);
  return res.json({ success: true, data: facilities });
});

app.post('/api/companies/:id/facilities', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.params.id);
  if (!companyId) return;
  const body = req.body || {};
  if (!body.name || !body.type || !body.city) {
    return res.status(400).json({ success: false, error: 'name, type, and city are required' });
  }
  if (String(body.name).length > 200) {
    return res.status(400).json({ success: false, error: 'name must be 200 characters or fewer' });
  }
  try {
    if (pgPool) {
      const result = await queryWithRlsBypass(
        `INSERT INTO public.facilities (company_id, name, type, city)
         VALUES ($1, $2, $3, $4) RETURNING id, company_id, name, type, city`,
        [companyId, String(body.name), String(body.type), String(body.city)]
      );
      emissionsSummaryCache.clear();
      return res.status(201).json({ success: true, data: result.rows[0] });
    }
    if (allowSampleData()) {
      const facility = { id: crypto.randomUUID(), company_id: companyId, name: body.name, type: body.type, city: body.city };
      sampleFacilities.push(facility);
      return res.status(201).json({ success: true, data: facility });
    }
    return res.status(503).json({ success: false, error: 'Data store unavailable' });
  } catch (err) {
    log('error', 'Facility create failed', { error: String(err), companyId });
    return res.status(500).json({ success: false, error: 'Failed to create facility' });
  }
});

app.get('/api/facilities/:id/emissions', apiAuthGuard, async function (req, res) {
  try {
    const facility = await loadFacilityById(req.params.id);
    if (!facility) return res.status(404).json({ success: false, error: 'Facility not found' });
    const companyId = await requireCompanyAccess(req, res, facility.company_id);
    if (!companyId) return;
    const entries = await loadEmissionEntries(companyId);
    const result = buildFacilityEmissions([facility], entries);
    return res.json({ success: true, data: result[0] });
  } catch (err) {
    log('error', 'Facility emissions failed', { error: String(err), facilityId: req.params.id });
    return res.status(500).json({ success: false, error: 'Failed to load facility emissions' });
  }
});

app.get('/api/companies/:id/compliance', apiAuthGuard, async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.params.id);
  if (!companyId) return;
  return res.json({ success: true, data: getComplianceStatus(getCompany(companyId)) });
});

app.get('/api/compliance/deadlines', apiAuthGuard, function (_req, res) {
  // Derive status from the current date so past deadlines aren't reported as
  // "upcoming" (e.g. EU CSRD 2025-01-01 was returned as upcoming in mid-2026).
  const now = Date.now();
  const SOON_MS = 90 * 24 * 60 * 60 * 1000; // within 90 days = "due_soon"
  const deadlines = [
    { framework: 'SB 253', due_date: '2026-01-01', scope: 'Scope 1 and Scope 2' },
    { framework: 'SB 253', due_date: '2027-01-01', scope: 'Scope 3' },
    { framework: 'EU CSRD', due_date: '2025-01-01', scope: 'Sustainability report' },
  ].map(function (d) {
    const due = Date.parse(d.due_date + 'T00:00:00Z');
    let status = 'upcoming';
    if (due < now) status = 'overdue';
    else if (due - now <= SOON_MS) status = 'due_soon';
    return Object.assign({}, d, { status: status });
  });
  return res.json({ success: true, data: deadlines });
});

app.post('/api/compliance/:id/signoff', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.body && req.body.company_id);
  if (!companyId) return;
  return res.json({ success: true, data: { id: req.params.id, status: 'completed', signed_off_at: new Date().toISOString() } });
});

// Renders the emissions summary into the plain text the PDF is built from.
function buildReportText(summary, period) {
  const lines = [
    'EcoAuditor Emissions Report',
    'Generated: ' + new Date().toISOString().split('T')[0],
    'Reporting period: ' + (period || 'All time'),
    '',
    'Total: ' + summary.total_emissions_tCO2e + ' tCO2e',
    'Scope 1: ' + summary.by_scope.scope1 + ' tCO2e',
    'Scope 2: ' + summary.by_scope.scope2 + ' tCO2e',
    'Scope 3: ' + summary.by_scope.scope3 + ' tCO2e',
    'Confidence: ' + summary.confidence_score + '%',
    'Methodology: ' + summary.methodology,
  ];
  return lines.join('\n');
}

app.post('/api/companies/:id/reports/generate', express.json(), apiAuthGuard, requirePlan('starter'), async function (req, res) {
  try {
    const companyId = await requireCompanyAccess(req, res, req.params.id);
    if (!companyId) return;
    const period = req.body && req.body.period ? String(req.body.period) : null;
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
    return res.json({ success: true, report_id: reportId, download_url: `/api/reports/${reportId}/download` });
  } catch (err) {
    log('error', 'Report generation failed', { error: String(err) });
    return res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

app.get('/api/reports/:id/download', apiAuthGuard, async function (req, res) {
  try {
    let companyId;
    let period = null;

    if (pgPool && /^\d+$/.test(req.params.id)) {
      const { rows } = await pgPool.query('SELECT company_id, period FROM reports WHERE id = $1', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ success: false, error: 'Report not found' });
      companyId = await requireCompanyAccess(req, res, rows[0].company_id);
      if (!companyId) return;
      period = rows[0].period;
    } else {
      // Dev / no-DB fallback: serve the in-memory PDF captured at generate time.
      const report = generatedReports.get(req.params.id);
      if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
      companyId = await requireCompanyAccess(req, res, report.company_id);
      if (!companyId) return;
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

function createSimplePdf(text) {
  const safeText = String(text).replace(/[()\\]/g, '\\$&').split('\n').join(') Tj\n0 -16 Td\n(');
  const stream = `BT /F1 12 Tf 72 740 Td (${safeText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach(function (object, index) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

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
    const parts = range.replace(/bytes=/, '').split('-');
    const rawStart = parseInt(parts[0], 10);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(rawStart) || isNaN(rawEnd) || rawStart < 0 || rawEnd < rawStart || rawStart >= fileSize) {
      return res.status(416).setHeader('Content-Range', 'bytes */' + fileSize).end();
    }

    const start = rawStart;
    const end = Math.min(rawEnd, fileSize - 1);
    const chunkSize = end - start + 1;

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
    if (filePath.includes('/assets/') && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
    }
  },
}));

// ─── Prerendered marketing routes ───
// scripts/prerender.mjs writes static/<route>/index.html for each
// marketing path. express.static serves these on requests with a trailing
// slash, but crawlers and most inbound links hit the bare path
// (/pricing, /methodology, …). Map those to the prerendered file BEFORE
// the SPA fallback so non-JS clients receive real content. Routes NOT
// in this set (/app/*, /login, /signup, /auth/*) fall through to the
// client-side shell as before.
var PRERENDERED_ROUTES = [
  '/pricing', '/methodology', '/sample-report', '/security',
  '/contact', '/privacy', '/terms', '/dpa',
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

// ─── SPA fallback ───
app.get('*', function (_req, res) {
  res.setHeader('Cache-Control', 'no-transform');
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// ─── Structured logging ───
function log(level, message, context) {
  const entry = {
    level: level,
    timestamp: new Date().toISOString(),
    message: message,
    requestId: context && context.requestId || undefined,
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
const server = app.listen(PORT, '0.0.0.0', function () {
  var videoPath = findVideoPath();
  log('info', 'Eco-Auditor listening', { port: PORT, video: videoPath || 'not-found' });
});

function shutdown(signal) {
  log('info', 'Shutting down', { signal: signal });
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
