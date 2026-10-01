// Where browsers send Content-Security-Policy violation reports (F-F-07). The
// route lives in server.cjs; summarizeCspReports below is what it logs.
const CSP_REPORT_PATH = '/api/csp-report';
const CSP_REPORT_GROUP = 'csp-endpoint';

// Hosts for Google Tag Manager and GA4 after the visitor has accepted analytics
// (F-F-07). From Google's CSP guide, https://developers.google.com/tag-platform/security/guides/csp
// (last updated 2026-09-18), "Google Analytics without Ads features" plus the
// GTM container itself: script-src-elem https://www.googletagmanager.com;
// img-src https://www.googletagmanager.com https://*.google-analytics.com;
// connect-src https://www.googletagmanager.com https://*.google-analytics.com
// https://*.google.com. img-src already allows every https: image, so only
// connect-src needed the new hosts. Fonts are self-hosted (F-F-06), so no Google
// Fonts host is allowed. Not added: the extra Google Ads / Floodlight hosts the
// guide lists (googleadservices.com, *.g.doubleclick.net, pagead2.googlesyndication.com
// ...); they are only needed if the container runs such tags, and the reports below
// will say so if it does.
//
// script-src keeps 'unsafe-inline' (F-D-05, downgraded): the theme bootstrap in
// index.html is inline, tags inside the GTM container can inject inline script,
// and a nonce policy would need the HTML to be rendered per request, which the
// prerendered pages are not. The blog HTML is sanitized at publish and at read, so
// this is defence in depth that is not there yet; a nonce CSP is a separate piece
// of work and is deliberately not attempted here.
const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com https://*.insforge.app https://*.insforge.co",
  "form-action 'self'",
  "upgrade-insecure-requests",
  // report-to is the current mechanism (Reporting-Endpoints below); browsers that
  // understand it ignore report-uri, the rest fall back to it.
  'report-uri ' + CSP_REPORT_PATH,
  'report-to ' + CSP_REPORT_GROUP,
].join('; ');

function buildSecurityHeaders(options = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': options.csp || DEFAULT_CSP,
    // Names the endpoint group report-to refers to. A relative URL is resolved
    // against the page (W3C Reporting API, "Process reporting endpoints for response").
    'Reporting-Endpoints': CSP_REPORT_GROUP + '="' + CSP_REPORT_PATH + '"',
  };

  if (options.hsts) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  return headers;
}

function canUseDevAuth(env = process.env) {
  return env.NODE_ENV !== 'production' && env.ALLOW_DEV_AUTH === 'true';
}

function addStringValues(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(function (item) { addStringValues(target, item); });
    return;
  }
  const text = String(value).trim();
  if (text) target.add(text);
}

// The ONLY trusted source of a caller's company is the value the server itself
// resolved from the database by user_id (requireCompanyAccess sets
// user.company_id from `SELECT id FROM companies WHERE user_id = $1` before
// calling resolveAuthorizedCompanyId).
//
// This deliberately does NOT read user_metadata / app_metadata / company_ids.
// On Supabase-compatible backends (InsForge included) user_metadata is writable
// by the account holder via signUp({ options: { data } }) and updateUser({ data }).
// Honouring it here meant an attacker could set user_metadata.company_id = "5",
// then walk sequential integer ids and read or write another tenant's emissions,
// facilities and generated reports through /api/companies/:id/*.
// The data model is strictly one company per user (ensureCompanyForUser), so
// nothing legitimate needs the extra claims.
// See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-4).
function getAuthorizedCompanyIds(user) {
  const ids = new Set();
  if (!user || typeof user !== 'object') return [];

  addStringValues(ids, user.company_id);
  addStringValues(ids, user.companyId);

  return Array.from(ids);
}

function resolveAuthorizedCompanyId(user, requestedCompanyId) {
  const authorizedIds = getAuthorizedCompanyIds(user);
  const requested = requestedCompanyId == null ? '' : String(requestedCompanyId).trim();

  if (!authorizedIds.length) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (!requested) {
    if (authorizedIds.length === 1) {
      return { ok: true, companyId: authorizedIds[0] };
    }
    return { ok: false, status: 400, error: 'company_id is required' };
  }

  if (!authorizedIds.includes(requested)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, companyId: requested };
}

function boundedString(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

// Where a lead says it came from (F-B-21). The contact and demo pages send
// 'contact' and 'demo'; every lead used to be stored as 'api', so the owner
// could not tell entry points apart. It stays a client-supplied label, so it
// is checked against this list instead of being stored as sent: anything else
// becomes 'api'. The chatbot's own leads are labelled by the server
// (writeChatLead), never by the client.
const LEAD_SOURCES = new Set(['contact', 'demo', 'chat', 'api']);

function leadSource(value) {
  // Strings only: String(['contact']) is 'contact', and a JSON array is not a label.
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return LEAD_SOURCES.has(normalized) ? normalized : 'api';
}

function sanitizeLeadPayload(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const name = boundedString(body.name, 120);
  const email = boundedString(body.email, 254);

  if (!name || !email) {
    return { ok: false, status: 400, error: 'Name and email are required' };
  }

  const normalizedEmail = email.toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return { ok: false, status: 400, error: 'Invalid email address' };
  }

  return {
    ok: true,
    value: {
      type: boundedString(body.type, 50) || 'general',
      name: name,
      email: normalizedEmail,
      company: boundedString(body.company, 160),
      message: boundedString(body.message, 1000),
      preferredDate: boundedString(body.preferredDate, 40),
      preferredTime: boundedString(body.preferredTime, 40),
      source: leadSource(body.source),
    },
  };
}

const CHAT_FLOWS = new Set(['demo', 'contact']);
const CHAT_STEPS = new Set(['name', 'email', 'company', 'date', 'time', 'message']);

// Postgres error codes that indicate an infrastructure outage rather than bad
// client input (connection failures, auth to the DB, resource exhaustion).
// The set documents the common connection-family codes; it is deliberately
// non-exhaustive. ANY error carrying a driver-level `code` — listed or not —
// is treated as infra by classifyApiFailure (REL-018), so unlisted SQLSTATEs
// like 42501/42703 get the same generic 503 instead of echoing driver text.
const PG_INFRA_CODES = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE',
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
  '08000', '08001', '08003', '08006', '08007', '08P01', // connection_exception family
]);

/**
 * Classifies a caught error from an async API handler chain into the response
 * the client should receive. Engine/CSV validation errors are genuine 400s
 * whose message is user-facing; data-store and driver faults must NOT be
 * reported as bad input (that mislabels outages) nor echoed verbatim (that
 * leaks SQL and connection details). Returns { status, message }.
 */
function classifyApiFailure(err) {
  const raw = err instanceof Error ? err.message : String(err && err.message ? err.message : err);
  if (/data store unavailable/i.test(raw)) {
    return { status: 503, message: 'Data store temporarily unavailable. Please retry.' };
  }
  if (err && typeof err === 'object' && err.code !== undefined) {
    // REL-018: any `code`-bearing error is a driver-level fault per the
    // doc-block above — whether or not its code is listed in PG_INFRA_CODES.
    // Unlisted SQLSTATEs (42501 insufficient_privilege, 42703 undefined_column,
    // 23505 unique_violation, …) used to fall through to the 400 branch and
    // echo raw driver text, leaking SQL/schema details and mislabeling an
    // outage as bad input. Same generic 503 as the listed codes.
    return { status: 503, message: 'Data store temporarily unavailable. Please retry.' };
  }
  return { status: 400, message: raw };
}

/**
 * The status a catch around a Stripe call answers: 503 when the data store failed,
 * 500 otherwise. A Stripe SDK error (its `type` begins with "Stripe") is 500 even
 * when it carries a `code` such as resource_missing or card_declined: classifyApiFailure
 * reads every code-bearing error as a data-store fault, which a Stripe error is not.
 */
function billingFailureStatus(err) {
  if (err && typeof err === 'object' && typeof err.type === 'string' && err.type.startsWith('Stripe')) return 500;
  return classifyApiFailure(err).status === 503 ? 503 : 500;
}

function sanitizeChatState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const state = {};
  if (CHAT_FLOWS.has(value.flow)) state.flow = value.flow;
  if (CHAT_STEPS.has(value.step)) state.step = value.step;

  const fields = {
    name: 120,
    email: 254,
    company: 160,
    date: 40,
  };
  for (const [field, maxLength] of Object.entries(fields)) {
    const bounded = boundedString(value[field], maxLength);
    if (bounded) state[field] = bounded;
  }

  return state;
}

// ─── CSP violation reports (F-F-07) ───
//
// A browser POSTs one of two shapes to CSP_REPORT_PATH:
//   report-uri, application/csp-report:
//     { "csp-report": { "document-uri", "blocked-uri", "effective-directive", "disposition", "status-code", ... } }
//   report-to, application/reports+json (a batch):
//     [ { "type": "csp-violation", "url", "body": { "documentURL", "blockedURL", "effectiveDirective", "disposition", "statusCode", ... } } ]
// Both also carry things that must not reach a log: full URLs (a query string can
// hold a token or an email address), script samples, source files and the user
// agent. summarizeCspReports keeps only what is needed to act on a violation: the
// directive, WHAT was blocked (scheme and host, never path or query), on which page
// (path only), and the disposition and status. Nothing that identifies a visitor.
const CSP_REPORT_LIMIT = 5; // per request: a batch is capped so one POST cannot flood the log

function cspDirective(value) {
  const token = String(value == null ? '' : value).trim().split(/\s+/)[0].toLowerCase();
  return /^[a-z-]{1,40}$/.test(token) ? token : 'unknown';
}

// The body is the sender's, up to the route's 8 KB cap, so what reaches a log line
// is cut to the length of the real thing (D-W2A-6): a real host is at most 253
// characters plus a port, a real page path a few dozen. The URL parser does not
// enforce either, so without the cut a report could put kilobytes of its own
// choosing into every line it causes.
const CSP_HOST_MAX_LENGTH = 260;
const CSP_PAGE_MAX_LENGTH = 120;

function cspBlocked(value) {
  const text = String(value == null ? '' : value).trim();
  // The browser reports a keyword (inline, eval, self, data, blob) instead of a URL.
  if (/^[a-z-]{1,24}$/i.test(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    // Only web hosts are worth a name; an extension or data: URL is reduced to its scheme.
    return /^https?:$/.test(url.protocol) ? url.protocol + '//' + url.host.slice(0, CSP_HOST_MAX_LENGTH) : url.protocol;
  } catch (_err) {
    return 'unknown';
  }
}

function cspPage(value) {
  try {
    const url = new URL(String(value));
    // Only a web page has a path worth logging; javascript:, data: and the like
    // have an opaque "path" that is whatever the sender wrote.
    return /^https?:$/.test(url.protocol) ? url.pathname.slice(0, CSP_PAGE_MAX_LENGTH) : 'unknown';
  } catch (_err) {
    return 'unknown';
  }
}

function cspDisposition(value) {
  return value === 'enforce' || value === 'report' ? value : 'unknown';
}

function cspStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function summarizeCspReports(body) {
  const summaries = [];
  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    if (summaries.length >= CSP_REPORT_LIMIT) break;
    if (!item || typeof item !== 'object') continue;
    const legacy = item['csp-report'];
    if (legacy && typeof legacy === 'object') {
      summaries.push({
        directive: cspDirective(legacy['effective-directive'] || legacy['violated-directive']),
        blocked: cspBlocked(legacy['blocked-uri']),
        page: cspPage(legacy['document-uri']),
        disposition: cspDisposition(legacy.disposition),
        status: cspStatus(legacy['status-code']),
      });
    } else if (item.type === 'csp-violation' && item.body && typeof item.body === 'object') {
      summaries.push({
        directive: cspDirective(item.body.effectiveDirective || item.body.violatedDirective),
        blocked: cspBlocked(item.body.blockedURL),
        page: cspPage(item.body.documentURL || item.url),
        disposition: cspDisposition(item.body.disposition),
        status: cspStatus(item.body.statusCode),
      });
    }
  }
  return summaries;
}

// ─── Consent decision time (k10 follow-up) ───
//
// A consent record keeps the time the visitor chose, as their browser reported it
// (decidedAt), next to the time the server received the record (created_at). The
// two differ when a choice answered with a 429 waits in the browser's outbox and is
// delivered on a later visit. A browser clock is not evidence, so the time is taken
// only when it is a well-formed UTC timestamp no more than 5 minutes after the
// server's receipt time (a fast clock) and no more than 30 days before it; anything
// else is ignored (null) and the record stands on its receipt time. The record is
// stored either way: a wrong clock must never cost the consent evidence itself.
const CONSENT_DECIDED_MAX_FUTURE_MS = 5 * 60 * 1000;
const CONSENT_DECIDED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// What the browser's toISOString() writes, with or without milliseconds. No offset
// and no zone-less form: the server would read those in its own zone.
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * @param {unknown} value        body.decidedAt, as sent
 * @param {number} receivedAtMs  when the server received the record
 * @returns {string | null}      the time as an ISO string, or null when it is not to be taken
 */
function sanitizeConsentDecidedAt(value, receivedAtMs) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) return null;
  const decidedMs = Date.parse(value);
  if (!Number.isFinite(decidedMs)) return null;
  const iso = new Date(decidedMs).toISOString();
  // Date.parse rolls '2026-02-30' over to 2 March and reads 24:00 as the next day:
  // only a time that reads back as it was sent is a time.
  if (iso.slice(0, 19) !== value.slice(0, 19)) return null;
  if (decidedMs > receivedAtMs + CONSENT_DECIDED_MAX_FUTURE_MS) return null;
  if (decidedMs < receivedAtMs - CONSENT_DECIDED_MAX_AGE_MS) return null;
  return iso;
}

module.exports = {
  CONSENT_DECIDED_MAX_AGE_MS,
  CONSENT_DECIDED_MAX_FUTURE_MS,
  CSP_REPORT_PATH,
  billingFailureStatus,
  buildSecurityHeaders,
  canUseDevAuth,
  classifyApiFailure,
  getAuthorizedCompanyIds,
  resolveAuthorizedCompanyId,
  sanitizeChatState,
  sanitizeConsentDecidedAt,
  sanitizeLeadPayload,
  summarizeCspReports,
};
