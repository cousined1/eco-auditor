'use strict';

/**
 * Test-only preload for a spawned `node server.cjs` (NODE_OPTIONS=--require <this file>).
 *
 * Replaces `pg` and `stripe` with in-process doubles so POST /api/checkout runs end
 * to end with no Postgres, no Docker and no network. The real `stripe` module is
 * never loaded, so nothing here can reach Stripe: the double only records what the
 * route asked of it.
 *
 *   FAKE_BILLING_STATE_FILE  JSON the test rewrites between requests:
 *                            { "company": <companies row | null>,
 *                              "stripeSubscriptions": [{ "id", "status" }] }
 *   FAKE_BILLING_LOG         every Stripe call, one JSON line each: { call, params }
 *   FAKE_BILLING_PG=real     leave `pg` alone (a real database, e.g. the Docker suites)
 *                            and double only Stripe
 *
 * The pg double answers only the queries the checkout path issues and is NOT a SQL
 * engine, so it proves what the route decides from the rows it reads, not the SQL.
 */

const fs = require('node:fs');
const Module = require('node:module');

const stateFile = process.env.FAKE_BILLING_STATE_FILE;
const logFile = process.env.FAKE_BILLING_LOG;

function state() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function record(call, params) {
  if (logFile) fs.appendFileSync(logFile, JSON.stringify({ call, params }) + '\n');
}

// users.insforge_user_id -> stripe_customer_id, as ensureStripeCustomer maintains it.
const customerByUser = new Map();
let sequence = 0;

class FakePool {
  constructor() {
    this.handlers = {};
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  async query(text, params) {
    const sql = String(text);
    // Boot: a non-zero count skips the blog seed.
    if (/SELECT count\(\*\) FROM blog_posts/.test(sql)) return { rows: [{ count: '1' }], rowCount: 1 };

    if (/SELECT stripe_customer_id FROM users WHERE insforge_user_id/.test(sql)) {
      const id = customerByUser.get(params[0]);
      return id ? { rows: [{ stripe_customer_id: id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO users/.test(sql)) {
      customerByUser.set(params[0], params[1]);
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE users SET stripe_customer_id/.test(sql)) {
      customerByUser.set(params[1], params[0]);
      return { rows: [], rowCount: 1 };
    }
    // loadBillingState: the company's billing columns.
    if (/FROM public\.companies WHERE user_id = \$1/.test(sql) && /trial_ends_at/.test(sql)) {
      const company = state().company;
      return company ? { rows: [company], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    throw new Error('fake billing pg: connect() is not supported');
  }
}

class FakeStripe {
  constructor() {
    // Lets a suite prove, before it sends anything, that the server holds this double
    // and not the real SDK (which would try the network).
    record('stripe.constructed', {});
    this.customers = {
      create: async (params) => {
        record('customers.create', params);
        return { id: 'cus_fake_' + ++sequence };
      },
    };
    this.subscriptions = {
      // Stripe's own semantics: status 'all' matches every subscription.
      list: async (params) => {
        record('subscriptions.list', params);
        const all = state().stripeSubscriptions || [];
        const matching = params.status === 'all' ? all : all.filter((s) => s.status === params.status);
        return { data: matching.slice(0, params.limit || 10) };
      },
    };
    this.checkout = {
      sessions: {
        create: async (params) => {
          record('checkout.sessions.create', params);
          return { id: 'cs_fake_' + ++sequence, url: 'https://checkout.stripe.test/c/pay/cs_fake' };
        },
      },
    };
  }
}

const doublePg = process.env.FAKE_BILLING_PG !== 'real';

const load = Module._load;
Module._load = function (request) {
  if (request === 'pg' && doublePg) return { Pool: FakePool };
  if (request === 'stripe') return FakeStripe;
  return load.apply(this, arguments);
};
