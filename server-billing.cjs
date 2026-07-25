const PLAN_ORDER = ['starter', 'growth', 'pro'];
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const PRICE_ENV_KEYS = {
  starter: {
    monthly: 'STRIPE_PRICE_STARTER_MONTHLY',
    annual: 'STRIPE_PRICE_STARTER_ANNUAL',
  },
  growth: {
    monthly: 'STRIPE_PRICE_GROWTH_MONTHLY',
    annual: 'STRIPE_PRICE_GROWTH_ANNUAL',
  },
  pro: {
    monthly: 'STRIPE_PRICE_PRO_MONTHLY',
    annual: 'STRIPE_PRICE_PRO_ANNUAL',
  },
};

function resolvePlanPriceId(env, planId, billing) {
  const planConfig = PRICE_ENV_KEYS[planId];
  if (!planConfig) return null;
  const key = planConfig[billing];
  if (!key) return null;
  return env[key] || null;
}

function planFromPriceId(priceId, env) {
  for (const planId of Object.keys(PRICE_ENV_KEYS)) {
    const planConfig = PRICE_ENV_KEYS[planId];
    for (const billing of Object.keys(planConfig)) {
      if (env[planConfig[billing]] === priceId) {
        return { planId, billing };
      }
    }
  }
  return null;
}

function trialEligiblePriceIds(env) {
  return new Set([
    env.STRIPE_PRICE_STARTER_MONTHLY,
    env.STRIPE_PRICE_STARTER_ANNUAL,
    env.STRIPE_PRICE_GROWTH_MONTHLY,
    env.STRIPE_PRICE_GROWTH_ANNUAL,
  ].filter(Boolean));
}

function hasPlanAccess(planId, minPlanId) {
  const current = PLAN_ORDER.indexOf(planId);
  const minimum = PLAN_ORDER.indexOf(minPlanId);
  if (current === -1 || minimum === -1) return false;
  return current >= minimum;
}

function isFuture(value, now) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date > now;
}

// Maps a Stripe subscription object to the companies billing columns.
// Handles both legacy (subscription.current_period_end) and current
// (subscription.items.data[0].current_period_end) Stripe API shapes.
function subscriptionRecordFromStripe(subscription, env) {
  const item = subscription.items && subscription.items.data && subscription.items.data[0];
  const priceId = item && item.price ? item.price.id : null;
  const plan = priceId ? planFromPriceId(priceId, env) : null;
  const periodEndUnix = subscription.current_period_end || (item && item.current_period_end) || null;
  const customer = subscription.customer;

  // An active subscription whose price we cannot recognise — price rotation in
  // Stripe, or env drift between deploys — used to persist plan = null, and
  // billingStateFromCompany treats a null plan as inactive. That paywalls a
  // customer who is paying. Degrade to the lowest tier and surface the price id
  // so the mismatch gets fixed, rather than cutting off access.
  const unrecognizedActivePrice =
    !plan && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) ? priceId || 'unknown' : null;

  return {
    stripeSubscriptionId: subscription.id || null,
    stripeCustomerId: typeof customer === 'string' ? customer : (customer && customer.id) || null,
    status: subscription.status || null,
    plan: plan ? plan.planId : unrecognizedActivePrice ? 'starter' : null,
    billingCycle: plan ? plan.billing : null,
    unrecognizedActivePrice,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  };
}

// How long a webhook whose sync did not persist keeps asking Stripe to retry.
// Stripe redelivers a failing event for ~3 days, then gives up. Most sync
// failures are transient (a checkout landing before the user->customer mapping
// is written) and clear within seconds. Some are permanent — a subscription
// created straight in the Stripe dashboard for a customer this app has never
// seen will never map. Failing those for the full window makes the endpoint
// look broken to Stripe, and a sustained failure ratio can get it auto-disabled,
// which would take down webhook processing for every customer. So: retry hard
// for a day, then ack and leave an error in the log to be investigated.
const WEBHOOK_RETRY_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Decides whether a webhook whose sync did not persist should ask Stripe to
 * redeliver. Pure so the policy is testable without a database or Stripe.
 */
function shouldRetryWebhook(result, eventCreatedAt, nowSeconds) {
  if (!result || result.ok || !result.retryable) return false;
  if (!eventCreatedAt) return true;
  return nowSeconds - eventCreatedAt < WEBHOOK_RETRY_WINDOW_SECONDS;
}

// Per-plan allowances, shared with the pricing page so an advertised limit and
// an enforced limit cannot drift. null means unlimited.
const PLAN_LIMITS = require('./plan-limits.json').plans;

function planLimits(planId) {
  return PLAN_LIMITS[planId] || PLAN_LIMITS.starter;
}

/**
 * Whether `planId` may add one more facility given how many it already has.
 * Pure so the quota rules are testable without a database.
 */
function canAddFacility(planId, currentCount) {
  const limit = planLimits(planId).facilities;
  if (limit === null) return { allowed: true };
  if (currentCount < limit) return { allowed: true };
  return {
    allowed: false,
    limit,
    requiredPlan: nextPlanAbove(planId, 'facilities'),
  };
}

/** Whether `planId` may run one more CSV import this calendar month. */
function canImportCsv(planId, importsThisMonth) {
  const limit = planLimits(planId).csvImportsPerMonth;
  if (limit === null) return { allowed: true };
  if (importsThisMonth < limit) return { allowed: true };
  return {
    allowed: false,
    limit,
    requiredPlan: nextPlanAbove(planId, 'csvImportsPerMonth'),
  };
}

/** Whether `planId` includes Scope 3 workflows. */
function canUseScope3(planId) {
  if (planLimits(planId).scope3) return { allowed: true };
  return { allowed: false, requiredPlan: nextPlanAbove(planId, 'scope3') };
}

// The cheapest plan that actually raises the given limit, so the paywall can
// name a specific upgrade rather than a generic "upgrade required".
function nextPlanAbove(planId, key) {
  const start = PLAN_ORDER.indexOf(planId);
  const current = planLimits(planId)[key];
  for (let i = start + 1; i < PLAN_ORDER.length; i += 1) {
    const candidate = planLimits(PLAN_ORDER[i])[key];
    if (candidate === null) return PLAN_ORDER[i];
    if (key === 'scope3' ? candidate === true : candidate > current) return PLAN_ORDER[i];
  }
  return PLAN_ORDER[PLAN_ORDER.length - 1];
}

function billingStateFromCompany(company, now = new Date()) {
  const subscriptionStatus = company.subscription_status || null;
  const subscriptionPlan = company.subscription_plan || null;
  const subscriptionActive = Boolean(
    subscriptionPlan &&
    ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus) &&
    (!company.subscription_current_period_end || isFuture(company.subscription_current_period_end, now))
  );
  const trialActive = !subscriptionActive && isFuture(company.trial_ends_at, now);
  const plan = subscriptionActive ? subscriptionPlan : trialActive ? 'starter' : null;

  return {
    active: Boolean(plan),
    plan,
    status: subscriptionActive ? subscriptionStatus : trialActive ? 'trialing' : subscriptionStatus,
    trialActive,
    trialEndsAt: company.trial_ends_at || null,
    currentPeriodEnd: company.subscription_current_period_end || null,
    billingCycle: company.subscription_billing_cycle || null,
    cancelAtPeriodEnd: Boolean(company.subscription_cancel_at_period_end),
    stripeCustomerId: company.stripe_customer_id || null,
    stripeSubscriptionId: company.stripe_subscription_id || null,
  };
}

// ACTIVE_SUBSCRIPTION_STATUSES, PLAN_ORDER, and PRICE_ENV_KEYS stay internal —
// they are implementation detail of the helpers below, and nothing outside this
// file read them.
module.exports = {
  billingStateFromCompany,
  hasPlanAccess,
  planFromPriceId,
  resolvePlanPriceId,
  planLimits,
  canAddFacility,
  canImportCsv,
  canUseScope3,
  shouldRetryWebhook,
  WEBHOOK_RETRY_WINDOW_SECONDS,
  subscriptionRecordFromStripe,
  trialEligiblePriceIds,
};
