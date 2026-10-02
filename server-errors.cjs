'use strict';

/**
 * How the server fails (F-G-06, F-G-08).
 *
 * Express 4 does not pass a rejected promise from an async handler to the error
 * middleware, and the process used to exit on every unhandled rejection. So each
 * async route carried its own try/catch, and one await left outside it (server.cjs
 * records six such incidents) turned a transient database error into a process
 * exit: every tenant got 502s until the platform restarted it. The protection now
 * sits where handlers are registered, not inside each of them:
 *
 *   installAsyncErrorForwarding(app)  every handler registered after this call,
 *                                     through app.METHOD, app.all, app.use or
 *                                     app.route(path).METHOD, has its rejection
 *                                     passed to next(err). A new async route needs
 *                                     no try/catch to be safe.
 *   createErrorHandler(deps)          the ONE terminal (err, req, res, next)
 *                                     middleware: logs once (stack and driver code
 *                                     kept), answers with a fixed message and the
 *                                     request id, never a stack, path or SQL text.
 *   createProcessGuards(deps)         an unhandled rejection is logged and the
 *                                     process continues; an uncaught exception, or a
 *                                     storm of rejections, is logged and the process
 *                                     exits after a short grace so the platform
 *                                     restarts it (restartPolicyType ON_FAILURE).
 *   serializeError, toLogValue        what log() writes for an Error, with
 *                                     credentials and keys redacted.
 *
 * Express 5 forwards rejections natively; upgrading is a dependency change and an
 * owner decision. A router created with express.Router() is not covered by the
 * app-level install: pass it through installAsyncErrorForwarding too.
 */

const http = require('node:http');

// Every verb Express 4 exposes as app.<verb> (it derives them from the same list),
// plus the two registration calls that take handlers for any verb.
const REGISTRATION_METHODS = http.METHODS.map(function (method) { return method.toLowerCase(); }).concat(['all', 'use']);

const forwarding = new WeakSet();

function asError(reason) {
  if (reason instanceof Error) return reason;
  // A falsy reason reaching next() would read as success and leave the request
  // hanging; a bare 'route' string would skip routes. Neither is a real outcome.
  return new Error('Handler rejected with a non-Error value (' + typeof reason + ')');
}

function forwardRejection(result, next) {
  if (result && typeof result.then === 'function') {
    result.then(undefined, function (reason) { next(asError(reason)); });
  }
}

/**
 * Wraps one handler. Express tells error middleware from request middleware by
 * arity (exactly 4 parameters), so the wrapper keeps it: a 4-ary function stays
 * 4-ary, anything shorter becomes 3-ary (Express treats both the same way), and a
 * longer one, which Express never calls, is left alone. A router or sub-app (it
 * has its own .handle) is left alone too, so Express still mounts it as one.
 */
function withForwarding(fn) {
  if (typeof fn !== 'function' || forwarding.has(fn) || typeof fn.handle === 'function') return fn;
  let wrapped;
  if (fn.length === 4) {
    wrapped = function (err, req, res, next) { forwardRejection(fn.apply(this, arguments), next); };
  } else if (fn.length <= 3) {
    wrapped = function (req, res, next) { forwardRejection(fn.apply(this, arguments), next); };
  } else {
    return fn;
  }
  forwarding.add(wrapped);
  return wrapped;
}

// Handlers can arrive nested in arrays; paths can be arrays of strings. Only
// functions are wrapped, so both shapes pass through intact, and so does the
// one-argument app.get(setting) read.
function wrapArguments(args) {
  return Array.prototype.map.call(args, function (arg) {
    return Array.isArray(arg) ? wrapArguments(arg) : withForwarding(arg);
  });
}

function patchRegistration(target, names) {
  names.forEach(function (name) {
    const original = target[name];
    if (typeof original !== 'function') return;
    target[name] = function () {
      return original.apply(this, wrapArguments(arguments));
    };
  });
}

function installAsyncErrorForwarding(app) {
  patchRegistration(app, REGISTRATION_METHODS);
  const originalRoute = app.route;
  if (typeof originalRoute === 'function') {
    app.route = function () {
      const route = originalRoute.apply(this, arguments);
      patchRegistration(route, REGISTRATION_METHODS.filter(function (name) { return name !== 'use'; }));
      return route;
    };
  }
  return app;
}

// ─── Error serialisation for the log ───
// Credentials inside URLs (a connection string in a driver message), Stripe and
// InsForge secret keys, and bearer tokens. Applied to every string log() writes.
const SECRET_PATTERNS = [
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, '$1[redacted]@'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, '[redacted]'],
  [/\bwhsec_[A-Za-z0-9]+/g, '[redacted]'],
  [/\bik_[A-Za-z0-9]{8,}/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]'],
];
const MAX_STACK_CHARS = 4000;

function redactSecrets(text) {
  return SECRET_PATTERNS.reduce(function (out, pattern) {
    return out.replace(pattern[0], pattern[1]);
  }, String(text));
}

/**
 * { name, message, code, stack } for an Error. A driver error's `detail` and
 * `where` are left out on purpose: they can quote row values.
 */
function serializeError(err) {
  if (!(err instanceof Error)) return { message: redactSecrets(String(err)) };
  const out = { name: err.name, message: redactSecrets(err.message) };
  if (err.code !== undefined && err.code !== null) out.code = String(err.code);
  if (typeof err.stack === 'string') out.stack = redactSecrets(err.stack).slice(0, MAX_STACK_CHARS);
  return out;
}

function toLogValue(value) {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === 'string') return redactSecrets(value);
  return value;
}

/** The route pattern a request matched ('/api/reports/:id/download'), never its URL. */
function routePattern(req) {
  const route = req && req.route;
  if (!route || route.path === undefined) return null;
  const pattern = Array.isArray(route.path) ? route.path.join('|') : String(route.path);
  return (req.baseUrl || '') + pattern;
}

// ─── The terminal error middleware ───
// Body-parser failures (malformed JSON 400, oversize 413, bad charset 415) keep
// the fixed messages F-D-04 gave them. Nothing from the error reaches a response.
const CLIENT_ERROR_MESSAGES = {
  400: 'Bad request',
  403: 'Forbidden',
  413: 'Request body too large',
  415: 'Unsupported content type',
};

function wantsJson(req) {
  if (req.path === '/api' || req.path.startsWith('/api/')) return true;
  return req.accepts(['html', 'json']) === 'json';
}

/**
 * deps.log                 server.cjs log()
 * deps.classifyApiFailure  server-security.cjs: a data-store fault answers its
 *                          generic 503. Its 400 branch echoes the error message,
 *                          which is right only inside a handler that knows the
 *                          error is a user-facing validation message; here the
 *                          error is unknown, so everything else is a 500.
 */
function createErrorHandler(deps) {
  const log = deps.log;
  const classifyApiFailure = deps.classifyApiFailure;

  // Four parameters, or Express does not treat it as error middleware.
  return function terminalErrorHandler(err, req, res, _next) {
    const clientStatus = Number(err && (err.status || err.statusCode));
    if (clientStatus >= 400 && clientStatus < 500 && !res.headersSent) {
      const message = err.type === 'entity.parse.failed'
        ? 'Invalid JSON body'
        : CLIENT_ERROR_MESSAGES[clientStatus] || 'Bad request';
      return res.status(clientStatus).json({ error: message });
    }

    const failure = classifyApiFailure(err);
    const status = failure.status === 503 ? 503 : 500;
    log('error', 'Request failed', {
      requestId: req.requestId,
      method: req.method,
      route: routePattern(req),
      status: status,
      error: serializeError(err),
    });

    if (res.headersSent) {
      // Part of the response is already out, so the only honest signal left is
      // to cut the connection (what Express's default handler does).
      if (!res.writableEnded) res.destroy();
      return undefined;
    }
    const message = status === 503 ? failure.message : 'Internal server error';
    if (wantsJson(req)) {
      return res.status(status).json({ error: message, requestId: req.requestId });
    }
    return res
      .status(status)
      .type('text/plain')
      .send(message + (req.requestId ? ' (request id ' + req.requestId + ')' : ''));
  };
}

// ─── Process-level policy (needs a human security review: see the report) ───
// A rejection that no handler awaited no longer takes every tenant down: it is
// logged (with the request id when the runtime carries the async context into the
// handler) and the process continues. Ten of them inside a minute means something
// is wedged, so the process exits and the platform restarts it. An uncaught
// exception leaves the process in an unknown state, so it always exits. Either
// exit is bounded: stop accepting connections, then exit after a short grace in
// which the log line reaches the platform.
const REJECTION_STORM_LIMIT = 10;
const REJECTION_STORM_WINDOW_MS = 60_000;
const EXIT_GRACE_MS = 1000;

/**
 * deps.log         server.cjs log()
 * deps.stopServer  closes the listener (optional)
 * deps.exit        process.exit, injectable for tests
 * deps.now         Date.now, injectable for tests
 * deps.exitGraceMs defaults to EXIT_GRACE_MS
 */
function createProcessGuards(deps) {
  const log = deps.log;
  const stopServer = deps.stopServer || function () {};
  const exit = deps.exit || function (code) { process.exit(code); };
  const now = deps.now || Date.now;
  const graceMs = deps.exitGraceMs === undefined ? EXIT_GRACE_MS : deps.exitGraceMs;
  const recentRejections = [];
  let exiting = false;

  function exitAfterGrace() {
    if (exiting) return;
    exiting = true;
    try {
      stopServer();
    } catch (err) {
      log('error', 'Closing the listener before exit failed', { error: serializeError(err) });
    }
    setTimeout(function () { exit(1); }, graceMs);
  }

  return {
    onUnhandledRejection: function (reason) {
      const at = now();
      recentRejections.push(at);
      while (recentRejections.length && at - recentRejections[0] > REJECTION_STORM_WINDOW_MS) recentRejections.shift();
      log('error', 'Unhandled rejection', {
        error: serializeError(reason),
        rejectionsInWindow: recentRejections.length,
      });
      if (recentRejections.length >= REJECTION_STORM_LIMIT) {
        log('error', 'Rejection storm: exiting so the platform restarts the process', {
          rejectionsInWindow: recentRejections.length,
          windowMs: REJECTION_STORM_WINDOW_MS,
        });
        exitAfterGrace();
      }
    },
    onUncaughtException: function (err) {
      log('error', 'Uncaught exception: exiting so the platform restarts the process', { error: serializeError(err) });
      exitAfterGrace();
    },
  };
}

module.exports = {
  installAsyncErrorForwarding,
  createErrorHandler,
  createProcessGuards,
  serializeError,
  redactSecrets,
  toLogValue,
  routePattern,
  REJECTION_STORM_LIMIT,
  REJECTION_STORM_WINDOW_MS,
};
