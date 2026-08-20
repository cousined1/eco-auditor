const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://www.google-analytics.com https://*.insforge.app https://*.insforge.co",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

function buildSecurityHeaders(options = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': options.csp || DEFAULT_CSP,
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
      source: 'api',
    },
  };
}

const CHAT_FLOWS = new Set(['demo', 'contact']);
const CHAT_STEPS = new Set(['name', 'email', 'company', 'date', 'time', 'message']);

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

module.exports = {
  buildSecurityHeaders,
  canUseDevAuth,
  getAuthorizedCompanyIds,
  resolveAuthorizedCompanyId,
  sanitizeChatState,
  sanitizeLeadPayload,
};
