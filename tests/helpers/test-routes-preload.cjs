'use strict';

/**
 * Test-only preload for a spawned `node server.cjs` (node --require <this file>).
 *
 * Stands in for "a developer adds a route tomorrow without reading the F-G-06
 * fix": right before server.cjs registers its first route (GET /api/version), it
 * registers these on the REAL app through the same app.get every route uses, so
 * they sit behind the request-id, access-log, compression and limiter middleware
 * and before the fallbacks and the terminal error handler:
 *
 *   GET /api/__test/rejects        awaits a rejecting promise, no try/catch
 *   GET /api/__test/driver-error   the same with a pg-style code and a
 *                                  connection string in the message
 *   GET /api/__test/floating       starts a promise nobody awaits, which rejects
 *                                  after the response (an unhandled rejection)
 *   GET /api/__test/throws-later   throws from a timer (an uncaught exception)
 *   GET /api/__test/large-text     4 KB of text, for the compression check (the
 *                                  worktree has no built static/ to serve)
 *
 * server.cjs is not changed for the test and none of this exists in production.
 */

const express = require('express');

const application = express.application;
const originalGet = application.get;
let registered = false;

application.get = function (path) {
  if (!registered && path === '/api/version') {
    registered = true;
    this.get('/api/__test/rejects', async function () {
      await Promise.reject(new Error('simulated transient failure'));
    });
    this.get('/api/__test/driver-error', async function () {
      const err = new Error('terminating connection due to administrator command (postgres://eco:hunter2-marker@db.internal:5432/eco)');
      err.code = '57P01';
      throw err;
    });
    this.get('/api/__test/floating', function (_req, res) {
      new Promise(function (_resolve, reject) {
        setTimeout(function () { reject(new Error('floating rejection nobody awaited')); }, 5);
      });
      res.json({ started: true });
    });
    this.get('/api/__test/throws-later', function (_req, res) {
      setTimeout(function () { throw new Error('thrown from a timer'); }, 5);
      res.json({ scheduled: true });
    });
    this.get('/api/__test/large-text', function (_req, res) {
      res.type('text/plain').send('Eco-Auditor compressible text. '.repeat(140));
    });
  }
  return originalGet.apply(this, arguments);
};
