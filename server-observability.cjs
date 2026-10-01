'use strict';

/**
 * What the operator can see (F-G-08, F-F-08).
 *
 *   createAccessLog({ log })           one JSON line per request, written when the
 *                                      response finishes or the client goes away.
 *   accessLogFields(req, res, ms, ab)  the field selection, a strict allowlist
 *                                      (ACCESS_LOG_FIELDS): method, route PATTERN,
 *                                      status, duration, request id, and the opaque
 *                                      user and company ids once a guard resolved
 *                                      them. Never the URL, query string, body, IP
 *                                      address, user agent, cookie or email.
 *   createClientErrorHandler(deps)     POST /api/client-error. The browser reports
 *                                      a render crash (ErrorBoundary) or an uncaught
 *                                      error / unhandled rejection. The payload is
 *                                      validated against a small schema and only its
 *                                      message, a truncated stack and the page PATH
 *                                      are logged, with emails, query strings and
 *                                      tokens scrubbed, plus the server's build sha.
 *                                      No cookie, IP or user agent is read or logged,
 *                                      so a report holds no personal data and is not
 *                                      gated by the cookie banner. The route adds its
 *                                      own per-address limit and body cap in server.cjs.
 */

const { redactSecrets, routePattern } = require('./server-errors.cjs');

const ACCESS_LOG_FIELDS = Object.freeze([
  'requestId',
  'method',
  'route',
  'status',
  'durationMs',
  'userId',
  'companyId',
  'aborted',
]);

/**
 * `aborted` is true when the connection closed before the response finished
 * (the client went away, or the server cut a half-sent response).
 */
function accessLogFields(req, res, durationMs, aborted) {
  const fields = {
    requestId: req.requestId,
    method: req.method,
    route: routePattern(req),
    status: res.statusCode,
    durationMs: Math.round(durationMs * 10) / 10,
  };
  const user = req.user;
  if (user && typeof user === 'object') {
    if (user.id !== undefined && user.id !== null) fields.userId = String(user.id);
    if (user.company_id !== undefined && user.company_id !== null) fields.companyId = String(user.company_id);
  }
  if (aborted) fields.aborted = true;
  return fields;
}

/**
 * Registered right after the request-id middleware, so it sees every request,
 * including the ones the limiter, the static files or the 404 fallback answer.
 * deps.clock is process.hrtime.bigint, injectable for tests.
 */
function createAccessLog(deps) {
  const log = deps.log;
  const clock = deps.clock || process.hrtime.bigint;
  return function accessLog(req, res, next) {
    const started = clock();
    let written = false;
    function write(aborted) {
      if (written) return;
      written = true;
      log('info', 'request', accessLogFields(req, res, Number(clock() - started) / 1e6, aborted));
    }
    res.once('finish', function () { write(false); });
    res.once('close', function () { write(true); });
    next();
  };
}

// ─── Client error reports ───
const CLIENT_ERROR_SOURCES = new Set(['boundary', 'error', 'unhandledrejection']);
const MAX_MESSAGE_INPUT = 1000;
const MAX_STACK_INPUT = 6000;
const LOGGED_MESSAGE_CHARS = 500;
const LOGGED_STACK_CHARS = 1500;
const LOGGED_STACK_LINES = 15;
// A page path: no query string, no fragment, nothing but path characters.
const PAGE_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]{0,199}$/;
const CLIENT_ERRORS_LOGGED_PER_MINUTE = 300;

const SCRUB_PATTERNS = [
  // Also percent-encoded, as it appears in a page path.
  [/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, '[email]'],
  // A URL keeps its origin and path; the query string and fragment go (a stack
  // frame's :line:col after them stays): an absolute URL of any scheme (https://,
  // wss://) and a relative one ("/auth/callback?code=..."). A colon inside the
  // query ("?next=https://...") belongs to it, unless it starts that :line:col.
  [/((?:\b[a-z][a-z0-9+.-]{0,31}:\/\/|(?<![\w.:/])\/)[^\s?#'"()]*)[?#](?:[^\s'"():]|:(?!\d+(?::\d+)?(?:[\s'")]|$)|[\s'"()]|$))*/gi, '$1'],
  // JWT-shaped tokens (three base64url parts, the first a JSON header).
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]'],
  // JSON.stringify escapes what is below U+0020 and leaves U+2028, U+2029 and the C1
  // controls (NEL is U+0085) as they are; a viewer that breaks lines on one of them
  // shows a single report as two.
  [/[\u0080-\u009f\u2028\u2029]/g, ' '],
];

function scrub(text) {
  return SCRUB_PATTERNS.reduce(function (out, pattern) {
    return out.replace(pattern[0], pattern[1]);
  }, redactSecrets(text));
}

function isOptionalString(value, maxLength) {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

/**
 * The logged fields, { source, route?, error: { message, stack? } } (the same
 * error shape as a server-side failure), or null when the payload does not
 * match the schema.
 */
function parseClientErrorReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { message, stack, route, source } = body;
  if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_INPUT) return null;
  if (!isOptionalString(stack, MAX_STACK_INPUT)) return null;
  if (route !== undefined && (typeof route !== 'string' || !PAGE_PATH.test(route))) return null;
  if (source !== undefined && !CLIENT_ERROR_SOURCES.has(source)) return null;

  const error = { message: scrub(message.trim()).slice(0, LOGGED_MESSAGE_CHARS) };
  if (stack) {
    error.stack = scrub(stack).split('\n').slice(0, LOGGED_STACK_LINES).join('\n').slice(0, LOGGED_STACK_CHARS);
  }
  const report = { source: source || 'error', error: error };
  if (route) report.route = scrub(route);
  return report;
}

/**
 * deps.log       server.cjs log()
 * deps.buildSha  () => the running build's sha, so a report names the release
 * deps.now       Date.now, injectable for tests
 *
 * Answers 204 for a valid report (logged or, past the per-minute cap across all
 * callers, dropped) and 400 for anything else.
 */
function createClientErrorHandler(deps) {
  const log = deps.log;
  const buildSha = deps.buildSha;
  const now = deps.now || Date.now;
  let windowStart = 0;
  let loggedInWindow = 0;

  return function clientErrorHandler(req, res) {
    const report = parseClientErrorReport(req.body);
    if (!report) return res.status(400).json({ error: 'Invalid client error report' });

    const at = now();
    if (at - windowStart >= 60_000) {
      windowStart = at;
      loggedInWindow = 0;
    }
    loggedInWindow += 1;
    if (loggedInWindow <= CLIENT_ERRORS_LOGGED_PER_MINUTE) {
      log('warn', 'Client error report', Object.assign({ build: buildSha() }, report));
    }
    return res.status(204).end();
  };
}

module.exports = {
  ACCESS_LOG_FIELDS,
  accessLogFields,
  createAccessLog,
  parseClientErrorReport,
  createClientErrorHandler,
  CLIENT_ERRORS_LOGGED_PER_MINUTE,
};
