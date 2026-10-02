'use strict';

/**
 * Test-only preload for a spawned `node server.cjs` (node --require <this file>).
 *
 * Replaces the `pg` module with an in-process fake so a server that believes it
 * has a database can be exercised without Postgres or Docker:
 *
 *   FAKE_PG_MODE=ok    (default) every query succeeds; INSERTs into public.leads
 *                      are appended, one JSON line each, to FAKE_PG_LOG
 *   FAKE_PG_MODE=down  every query rejects like an unreachable database
 *   FAKE_PG_MODE=data-down  the caller's company and its billing row answer (a
 *                      trialing company, id 41), and so do the boot queries and
 *                      transaction statements; every other statement rejects like
 *                      a dropped connection. Auth and the plan check pass, the
 *                      data behind them fails: what used to fall back to fixtures.
 *
 * It only stands in for the queries server.cjs issues at boot and for the lead
 * write; anything else answers an empty result. It is NOT a SQL engine, so it
 * proves the server's behaviour around the database, not the SQL itself.
 */

const fs = require('node:fs');
const Module = require('node:module');

const mode = process.env.FAKE_PG_MODE || 'ok';
const logFile = process.env.FAKE_PG_LOG;

function record(entry) {
  if (logFile) fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// data-down: what loadBillingState and ensureCompanyForUser read (one row serves both).
const TRIALING_COMPANY = {
  id: '41',
  trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  subscription_status: null,
  subscription_plan: null,
  subscription_billing_cycle: null,
  subscription_current_period_end: null,
  subscription_cancel_at_period_end: false,
  stripe_customer_id: null,
  stripe_subscription_id: null,
};
const STILL_ANSWERS = /^\s*(SELECT 1$|SELECT count\(\*\) FROM blog_posts|BEGIN|COMMIT|ROLLBACK|SET LOCAL|CREATE )/;

class FakePool {
  constructor(options) {
    this.options = options;
    this.handlers = {};
  }

  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }

  async query(text, params) {
    if (mode === 'down') {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
    }
    const sql = String(text);
    if (mode === 'data-down') {
      if (/FROM public\.companies WHERE user_id = \$1/.test(sql)) return { rows: [TRIALING_COMPANY], rowCount: 1 };
      if (!STILL_ANSWERS.test(sql)) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
    }
    if (/INSERT INTO public\.leads/.test(sql)) {
      record({ table: 'leads', params: params });
      return { rows: [], rowCount: 1 };
    }
    // Boot: "SELECT count(*) FROM blog_posts". A non-zero count skips the seed.
    if (/SELECT count\(\*\) FROM blog_posts/.test(sql)) return { rows: [{ count: '1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    if (mode === 'data-down') return { query: (text, params) => this.query(text, params), release() {} };
    throw new Error('fake pg: connect() is not supported');
  }
}

const load = Module._load;
Module._load = function (request) {
  if (request === 'pg') return { Pool: FakePool };
  return load.apply(this, arguments);
};
