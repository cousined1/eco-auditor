'use strict';

/**
 * Test-only preload for a spawned `node server.cjs` (node --require <this file>).
 *
 * Makes the Stripe and pg constructors throw, the way a broken install or an
 * incompatible SDK would, so the test can check that server.cjs logs the failure
 * (F-G-13) instead of silently running without billing or a database. The error
 * messages carry a key and a password on purpose: the log must redact them.
 */

const Module = require('node:module');

function FailingStripe() {
  throw new Error('Stripe constructor failed for key sk_test_markerKEY123');
}

function FailingPool() {
  throw new Error('pg Pool constructor failed for postgres://eco:pw-marker@127.0.0.1:1/eco');
}

const load = Module._load;
Module._load = function (request) {
  if (request === 'stripe') return FailingStripe;
  if (request === 'pg') return { Pool: FailingPool };
  return load.apply(this, arguments);
};
