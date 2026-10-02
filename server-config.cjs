'use strict';

/**
 * The server's environment, read once at boot (F-G-13, F-F-18, F-O-01).
 *
 * ENV_SCHEMA is the inventory of every variable the server, the client build and
 * the platform use: where it matters, its default, what breaks without it.
 * tests/env-schema-parity.test.ts holds it to the code (a name read in server*.cjs
 * must be declared here; a name declared here must be used somewhere) and to
 * railway.env.example (the same names, no dead ones).
 *
 * loadServerConfig(env) reads the declared names once and answers:
 *   get(name)    the typed value with its documented default. An undeclared name
 *                throws, so new code has to declare its variable here first.
 *   appVersion   package.json's version. APP_VERSION overrides it only when it is
 *                valid semver and not older; production reported a stale 1.0.0 for
 *                a 2.0.0 build because APP_VERSION always won.
 *   buildSha     RAILWAY_GIT_COMMIT_SHA, else GIT_SHA, else null.
 *   warnings     one { message, variable, action } per problem a boot survives,
 *                logged at boot by server.cjs. No value is ever put in a warning
 *                except APP_VERSION's, which /api/version publishes anyway.
 *
 * Behaviour is unchanged: nothing here refuses to boot (server.cjs keeps its own
 * hard failures), and most of server.cjs still reads process.env directly. Moving
 * those reads to get() is a follow-up once the parallel route edits have merged.
 */

const packageJson = require('./package.json');

// kind: 'runtime' the server reads it; 'build' Vite inlines it into the client
// (a Dockerfile ARG) and the server may read it too; 'platform' Railway injects it.
// type: 'string' (default), 'url' (trailing slashes dropped) or 'boolean' ('true').
const ENV_SCHEMA = Object.freeze([
  { name: 'NODE_ENV', kind: 'runtime', description: 'production on Railway (the Dockerfile sets it): enables the production boot checks, HSTS and the boot warnings.' },
  { name: 'PORT', kind: 'platform', description: 'Injected by Railway; the server exits at boot without it. Do not set it by hand.' },
  { name: 'RAILWAY_GIT_COMMIT_SHA', kind: 'platform', description: 'Injected by Railway: the commit being served, reported by /health and /api/health.' },
  { name: 'GIT_SHA', kind: 'runtime', description: 'The commit being served when not on Railway (CI, local runs).' },
  { name: 'APP_VERSION', kind: 'runtime', description: "Optional override of package.json's version on /api/version, used only when it is valid semver and not older. Leave it unset." },
  { name: 'DATABASE_URL', kind: 'runtime', description: 'Postgres connection string, the only data store. Production boot fails without it when InsForge auth is configured, or when it is set but unreachable; without it every data route answers 503.' },
  { name: 'APP_URL', kind: 'runtime', type: 'url', default: 'http://localhost:3000', description: 'Public base URL for Stripe redirects. Production boot fails without it when STRIPE_SECRET_KEY is set.' },
  { name: 'PUBLIC_ORIGIN', kind: 'runtime', type: 'url', default: 'https://ecoauditor.io', description: 'Canonical origin of the blog pages, sitemap.xml and published posts.' },
  { name: 'INSFORGE_BASE_URL', kind: 'runtime', alias: 'VITE_INSFORGE_BASE_URL', description: 'InsForge URL the server verifies sessions against; the VITE_ name works too. Keep both equal if both are set.' },
  { name: 'VITE_INSFORGE_BASE_URL', kind: 'build', description: 'InsForge URL inlined into the client at build time. Without it sign-in is off.' },
  { name: 'INSFORGE_ANON_KEY', kind: 'runtime', alias: 'VITE_INSFORGE_ANON_KEY', description: 'InsForge anonymous key for /api/insforge-config; the VITE_ name wins there. Keep both equal if both are set.' },
  { name: 'VITE_INSFORGE_ANON_KEY', kind: 'build', description: 'InsForge anonymous key inlined into the client at build time. Without it sign-in is off.' },
  { name: 'VITE_GTM_ID', kind: 'build', description: 'Google Tag Manager container inlined at build time. Without it GTM never loads.' },
  { name: 'STRIPE_SECRET_KEY', kind: 'runtime', description: 'Stripe secret key. Unset: the billing routes answer 503.' },
  { name: 'STRIPE_WEBHOOK_SECRET', kind: 'runtime', description: 'Stripe webhook signing secret. Production boot fails without it when STRIPE_SECRET_KEY is set.' },
  { name: 'STRIPE_PK', kind: 'runtime', alias: 'VITE_STRIPE_PK', description: 'Stripe publishable key for /api/config/prices; the VITE_ name wins there.' },
  { name: 'VITE_STRIPE_PK', kind: 'build', description: 'Stripe publishable key, inlined at build time and served by /api/config/prices.' },
  { name: 'STRIPE_PRICE_STARTER_MONTHLY', kind: 'runtime', alias: 'VITE_STRIPE_PRICE_STARTER_MONTHLY', description: 'Stripe price id; checkout is allowlisted against the six price variables.' },
  { name: 'STRIPE_PRICE_STARTER_ANNUAL', kind: 'runtime', alias: 'VITE_STRIPE_PRICE_STARTER_ANNUAL', description: 'Stripe price id.' },
  { name: 'STRIPE_PRICE_GROWTH_MONTHLY', kind: 'runtime', alias: 'VITE_STRIPE_PRICE_GROWTH_MONTHLY', description: 'Stripe price id.' },
  { name: 'STRIPE_PRICE_GROWTH_ANNUAL', kind: 'runtime', alias: 'VITE_STRIPE_PRICE_GROWTH_ANNUAL', description: 'Stripe price id.' },
  { name: 'STRIPE_PRICE_PRO_MONTHLY', kind: 'runtime', alias: 'VITE_STRIPE_PRICE_PRO_MONTHLY', description: 'Stripe price id.' },
  { name: 'STRIPE_PRICE_PRO_ANNUAL', kind: 'runtime', alias: 'VITE_STRIPE_PRICE_PRO_ANNUAL', description: 'Stripe price id.' },
  { name: 'VITE_STRIPE_PRICE_STARTER_MONTHLY', kind: 'build', description: 'The server falls back to the VITE_ price names when the unprefixed ones are unset.' },
  { name: 'VITE_STRIPE_PRICE_STARTER_ANNUAL', kind: 'build', description: 'See VITE_STRIPE_PRICE_STARTER_MONTHLY.' },
  { name: 'VITE_STRIPE_PRICE_GROWTH_MONTHLY', kind: 'build', description: 'See VITE_STRIPE_PRICE_STARTER_MONTHLY.' },
  { name: 'VITE_STRIPE_PRICE_GROWTH_ANNUAL', kind: 'build', description: 'See VITE_STRIPE_PRICE_STARTER_MONTHLY.' },
  { name: 'VITE_STRIPE_PRICE_PRO_MONTHLY', kind: 'build', description: 'See VITE_STRIPE_PRICE_STARTER_MONTHLY.' },
  { name: 'VITE_STRIPE_PRICE_PRO_ANNUAL', kind: 'build', description: 'See VITE_STRIPE_PRICE_STARTER_MONTHLY.' },
  { name: 'SITE_DEPLOY_TOKEN', kind: 'runtime', description: 'Bearer token of POST /api/publish (the autoblog). Unset: publishing answers 503.' },
  { name: 'CONSENT_IP_PEPPER', kind: 'runtime', description: 'Key for the hash of visitor IPs in consent records. Unset: a random per-process value, so hashes cannot be compared across restarts.' },
  { name: 'LEAD_NOTIFY_WEBHOOK_URL', kind: 'runtime', description: 'Slack-compatible webhook announcing new leads. A secret: never commit it.' },
  { name: 'FORCE_HSTS', kind: 'runtime', type: 'boolean', description: 'true sends Strict-Transport-Security outside production too (production always sends it).' },
  { name: 'ALLOW_DEV_AUTH', kind: 'runtime', type: 'boolean', description: 'Development only: accept DEV_AUTH_SECRET as a bearer token. Ignored in production; never set it there.' },
  { name: 'DEV_AUTH_SECRET', kind: 'runtime', description: 'Development only (with ALLOW_DEV_AUTH). Never in production.' },
  { name: 'DEV_COMPANY_ID', kind: 'runtime', description: 'Development only: the company of the dev-auth user. Never in production.' },
]);

const SCHEMA_BY_NAME = new Map(ENV_SCHEMA.map(function (entry) { return [entry.name, entry]; }));

// Semantic Versioning 2.0.0, the regex published with the spec.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function versionCore(version) {
  const match = SEMVER.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * { version, ignored }: APP_VERSION wins only when it is valid semver whose
 * major.minor.patch is not below package.json's. `ignored` says why it did not.
 */
function resolveAppVersion(override, packageVersion) {
  if (!override) return { version: packageVersion, ignored: null };
  const wanted = versionCore(override);
  if (!wanted) return { version: packageVersion, ignored: 'not valid semver' };
  const current = versionCore(packageVersion) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (wanted[i] > current[i]) break;
    if (wanted[i] < current[i]) return { version: packageVersion, ignored: 'older than package.json ' + packageVersion };
  }
  return { version: override, ignored: null };
}

function railwayAction(name) {
  return 'Set ' + name + ' in the Railway service variables (see railway.env.example)';
}

function collectWarnings(values, versionResult) {
  const warnings = [];
  const isSet = function (name) { return Boolean(values[name]); };

  if (versionResult.ignored) {
    warnings.push({
      message: 'APP_VERSION ' + JSON.stringify(values.APP_VERSION) + ' is ignored (' + versionResult.ignored + '): /api/version reports ' + versionResult.version,
      variable: 'APP_VERSION',
      action: 'Delete APP_VERSION from the Railway service variables; the version comes from package.json',
    });
  }

  ENV_SCHEMA.forEach(function (entry) {
    if (entry.alias && isSet(entry.name) && isSet(entry.alias) && values[entry.name] !== values[entry.alias]) {
      warnings.push({
        message: entry.name + ' and ' + entry.alias + ' are both set and differ: server.cjs does not read them in the same order everywhere',
        variable: entry.name,
        action: 'Set only one of them, or give both the same value',
      });
    }
  });

  if (values.NODE_ENV !== 'production') return warnings;

  // A missing pepper does not stop the boot (F-G-11): the server falls back to a
  // random per-process one, so consent works and only the linkage between ip_hash
  // values recorded before and after a restart, or across replicas, is lost.
  // Refusing to start would take the site down over that, so it is one structured
  // warning at boot and an owner action.
  if (!isSet('CONSENT_IP_PEPPER')) {
    warnings.push({
      message: 'CONSENT_IP_PEPPER is not set: consent records use a random per-process pepper, so ip_hash values cannot be compared across restarts or replicas',
      variable: 'CONSENT_IP_PEPPER',
      action: 'Set CONSENT_IP_PEPPER in the Railway service variables (see .env.example)',
    });
  }
  // Publishing needs the database, so without one there is nothing to warn about.
  if (isSet('DATABASE_URL') && !isSet('SITE_DEPLOY_TOKEN')) {
    warnings.push({
      message: 'SITE_DEPLOY_TOKEN is not set: POST /api/publish answers 503, so the autoblog cannot publish',
      variable: 'SITE_DEPLOY_TOKEN',
      action: railwayAction('SITE_DEPLOY_TOKEN'),
    });
  }
  // Build-time values: the server only sees the runtime variables, which on
  // Railway are the same ones the image was built from.
  [
    ['VITE_INSFORGE_BASE_URL', 'the client bundle has no InsForge URL and sign-in is off'],
    ['VITE_INSFORGE_ANON_KEY', 'the client bundle has no InsForge key and sign-in is off'],
    ['VITE_GTM_ID', 'Google Tag Manager never loads'],
  ].forEach(function (pair) {
    if (!isSet(pair[0])) {
      warnings.push({
        message: pair[0] + ' is not set: if the image was built from the same variables, ' + pair[1],
        variable: pair[0],
        action: railwayAction(pair[0]) + ', then redeploy so the build picks it up',
      });
    }
  });
  ['ALLOW_DEV_AUTH', 'DEV_AUTH_SECRET', 'DEV_COMPANY_ID'].forEach(function (name) {
    if (isSet(name)) {
      warnings.push({
        message: name + ' is set in production: it is for development only',
        variable: name,
        action: 'Delete ' + name + ' from the Railway service variables',
      });
    }
  });
  return warnings;
}

function typed(entry, raw) {
  if (entry.type === 'boolean') return raw === 'true';
  const value = raw || entry.default || null;
  return entry.type === 'url' && value ? value.replace(/\/+$/, '') : value;
}

function loadServerConfig(env, options) {
  const packageVersion = (options && options.packageVersion) || packageJson.version;
  const values = {};
  ENV_SCHEMA.forEach(function (entry) { values[entry.name] = env[entry.name]; });
  Object.freeze(values);

  const versionResult = resolveAppVersion(values.APP_VERSION, packageVersion);
  return Object.freeze({
    get: function (name) {
      const entry = SCHEMA_BY_NAME.get(name);
      if (!entry) throw new Error('server-config: ' + name + ' is not declared in ENV_SCHEMA');
      return typed(entry, values[name]);
    },
    isProduction: values.NODE_ENV === 'production',
    appVersion: versionResult.version,
    buildSha: values.RAILWAY_GIT_COMMIT_SHA || values.GIT_SHA || null,
    warnings: Object.freeze(collectWarnings(values, versionResult)),
  });
}

module.exports = {
  ENV_SCHEMA,
  loadServerConfig,
  resolveAppVersion,
};
