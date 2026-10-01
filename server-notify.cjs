'use strict';

/**
 * Lead notifier (F-A-07 / F-B-12).
 *
 * Every lead-capture surface tells the visitor a human will follow up, but
 * until this module nothing told a human: a lead was one row in public.leads
 * that nobody was alerted about. After a lead is stored, server.cjs hands it
 * to notify(), which POSTs a Slack-compatible {"text": "..."} JSON body to the
 * operator-configured LEAD_NOTIFY_WEBHOOK_URL.
 *
 * Hard rules (a notifier problem must never cost a lead or take the site down):
 *   - fire-and-forget: notify() never rejects and never throws, so the caller
 *     does not have to await it (an unhandled rejection exits the process);
 *   - 3 s timeout per delivery, then the request is aborted;
 *   - the target is the operator's env var, never anything the visitor sent,
 *     and redirects are never followed (redirect: 'manual'; a 3xx is a failure),
 *     so a misbehaving webhook host cannot bounce the POST somewhere else;
 *   - the URL must be https. Plain http is taken only for loopback and only when
 *     NODE_ENV is not production (a local sink for the tests): in production it
 *     would send every lead in the clear to a listener on the same host. It may
 *     carry a secret path, so it is never logged;
 *   - failures are logged as structured warnings WITHOUT lead data or the URL;
 *   - a global cap keeps an unauthenticated public form from flooding the
 *     operator's channel (or getting the webhook rate-limited).
 *
 * The webhook payload itself does carry the lead (that is the point: the team
 * needs a name and an address to reply to). Visitor text is escaped for Slack
 * (&, <, >) so it cannot raise @channel or build a masked link, and flattened to
 * one line per field so it cannot fake another field. Slack still auto-links a
 * bare URL in the text, so whoever reads the channel should treat it as untrusted.
 */

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PER_WINDOW = 30;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function noop() {}

// Fails closed: any spelling of "production" counts (Production, " production "),
// so a variant that the rest of the server would not recognise cannot open the
// plain-http door, and something that is not an environment object is read as the
// process's own.
function isProduction(env) {
  const source = env && typeof env === 'object' ? env : process.env;
  return String(source.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * Validates the configured webhook URL: https, or plain http to loopback outside
 * production.
 * @param {unknown} raw
 * @param {object} [env] the environment to read NODE_ENV from; defaults to process.env
 * @returns {{ ok: true, url: string } | { ok: false, reason: string }}
 */
function parseWebhookUrl(raw, env = process.env) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, reason: 'unset' };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  if (url.protocol === 'https:') return { ok: true, url: url.href };
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && !isProduction(env)) return { ok: true, url: url.href };
  return { ok: false, reason: 'not_https' };
}

function slackEscape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One field is always one line: format characters (bidi overrides, zero-width
// joiners) are dropped, control characters and every kind of whitespace,
// including the Unicode line and paragraph separators, collapse to one space.
function cleanField(value, maxLength) {
  if (value == null) return '';
  const flat = String(value).replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return slackEscape(flat.length > maxLength ? flat.slice(0, maxLength - 3) + '...' : flat);
}

/** The text a human reads in the channel. Field limits mirror sanitizeLeadPayload. */
function formatLeadMessage(lead) {
  const source = lead || {};
  const lines = [
    'New Eco-Auditor lead: ' + (cleanField(source.type, 50) || 'general') + ' (source: ' + (cleanField(source.source, 40) || 'api') + ')',
    'Name: ' + cleanField(source.name, 120),
    'Email: ' + cleanField(source.email, 254),
  ];
  const optional = [
    ['Company', source.company, 160],
    ['Preferred date', source.preferredDate, 40],
    ['Preferred time', source.preferredTime, 40],
    ['Message', source.message, 1000],
  ];
  for (const [label, value, maxLength] of optional) {
    const text = cleanField(value, maxLength);
    if (text) lines.push(label + ': ' + text);
  }
  lines.push('The site told them the team will follow up by email.');
  return lines.join('\n');
}

// Never put err.message in a log line: fetch errors can name the host or URL.
function describeFailure(err) {
  if (err && err.name === 'AbortError') return { reason: 'timeout' };
  const cause = err && err.cause;
  return {
    reason: 'network_error',
    errorName: (err && err.name) || undefined,
    code: (err && err.code) || (cause && cause.code) || undefined,
  };
}

async function discardBody(response) {
  try {
    if (response && response.body && typeof response.body.cancel === 'function') await response.body.cancel();
  } catch {
    // The status is all we need.
  }
}

/**
 * @param {object} options
 * @param {string} options.url               already validated by parseWebhookUrl
 * @param {function} [options.fetchImpl]     defaults to the global fetch
 * @param {number} [options.timeoutMs]
 * @param {function} [options.log]           (level, message, context) => void
 * @param {function} [options.now]           () => ms, injectable for tests
 * @param {number} [options.maxPerWindow]
 * @param {number} [options.windowMs]
 */
function createLeadNotifier(options) {
  const url = options.url;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const log = options.log || noop;
  const now = options.now || Date.now;
  const maxPerWindow = options.maxPerWindow || DEFAULT_MAX_PER_WINDOW;
  const windowMs = options.windowMs || DEFAULT_WINDOW_MS;

  let windowStart = -Infinity;
  let sentInWindow = 0;
  let throttleLogged = false;

  /** Resolves true when the webhook accepted the message. Never rejects. */
  async function notify(lead) {
    try {
      if (typeof fetchImpl !== 'function') {
        log('warn', 'Lead notification skipped: fetch is not available');
        return false;
      }

      const t = now();
      if (t - windowStart >= windowMs) {
        windowStart = t;
        sentInWindow = 0;
        throttleLogged = false;
      }
      if (sentInWindow >= maxPerWindow) {
        if (!throttleLogged) {
          throttleLogged = true;
          log('warn', 'Lead notifications throttled; leads are still stored in public.leads', {
            maxPerWindow: maxPerWindow,
            windowMinutes: Math.round(windowMs / 60000),
          });
        }
        return false;
      }
      sentInWindow += 1;

      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: formatLeadMessage(lead) }),
          redirect: 'manual',
          signal: controller.signal,
        });
        await discardBody(response);
        if (response.status >= 300 && response.status < 400) {
          log('warn', 'Lead notification refused: the webhook answered with a redirect', { status: response.status });
          return false;
        }
        if (!response.ok) {
          log('warn', 'Lead notification rejected by the webhook', { status: response.status });
          return false;
        }
        return true;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      log('warn', 'Lead notification failed', describeFailure(err));
      return false;
    }
  }

  return { enabled: true, notify: notify };
}

const DISABLED_NOTIFIER = Object.freeze({
  enabled: false,
  notify: async function () { return false; },
});

/**
 * Builds the notifier from LEAD_NOTIFY_WEBHOOK_URL and logs ONE startup warning
 * when it cannot: a site whose leads reach nobody should say so at boot, not
 * stay silent. A missing or unusable URL disables notifications; it never stops
 * the server (leads are still stored).
 */
function createLeadNotifierFromEnv(env, deps) {
  const options = deps || {};
  const log = options.log || noop;
  const parsed = parseWebhookUrl(env && env.LEAD_NOTIFY_WEBHOOK_URL, env || {});

  if (!parsed.ok) {
    if (parsed.reason === 'unset') {
      log('warn', 'LEAD_NOTIFY_WEBHOOK_URL is not set: new leads are stored in public.leads but nobody is notified');
    } else {
      log('warn', 'LEAD_NOTIFY_WEBHOOK_URL is not usable, lead notifications are disabled (it must be an https URL)', { reason: parsed.reason });
    }
    return DISABLED_NOTIFIER;
  }
  return createLeadNotifier(Object.assign({}, options, { url: parsed.url, log: log }));
}

module.exports = {
  createLeadNotifier,
  createLeadNotifierFromEnv,
  formatLeadMessage,
  parseWebhookUrl,
};
