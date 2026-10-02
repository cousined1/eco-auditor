// @vitest-environment node
/**
 * F-G-13 / F-F-18 / F-O-01, unit level: server-config.cjs. The spawned-server
 * half (the warnings reach the log at boot, never with a value) is in
 * tests/server-failure-policy.test.ts; the schema's parity with the code and
 * railway.env.example is tests/env-schema-parity.test.ts.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { loadServerConfig, resolveAppVersion } = require('../server-config.cjs');

type Warning = { message: string; variable: string; action: string };

const PRODUCTION_OK = {
  NODE_ENV: 'production',
  CONSENT_IP_PEPPER: 'p',
  DATABASE_URL: 'postgres://u:secret-db-marker@db/x',
  SITE_DEPLOY_TOKEN: 'token-marker',
  VITE_INSFORGE_BASE_URL: 'https://insforge.example',
  VITE_INSFORGE_ANON_KEY: 'anon-marker',
  VITE_GTM_ID: 'GTM-TEST',
};

const variables = (env: Record<string, string>) =>
  (loadServerConfig(env, { packageVersion: '2.0.0' }).warnings as Warning[]).map((w) => w.variable).sort();

describe('resolveAppVersion (F-O-01)', () => {
  it.each([
    [undefined, '2.0.0', null],
    ['', '2.0.0', null],
    ['1.0.0', '2.0.0', 'older than package.json 2.0.0'],
    ['1.99.99', '2.0.0', 'older than package.json 2.0.0'],
    ['2.0.0', '2.0.0', null],
    ['2.0.0-rc.1', '2.0.0-rc.1', null],
    ['2.0.1', '2.0.1', null],
    ['3.0.0+build.7', '3.0.0+build.7', null],
    ['v2.1.0', '2.0.0', 'not valid semver'],
    ['latest', '2.0.0', 'not valid semver'],
    ['2.1', '2.0.0', 'not valid semver'],
  ])('APP_VERSION=%j with package.json 2.0.0 reports %s', (override, expected, ignored) => {
    expect(resolveAppVersion(override, '2.0.0')).toEqual({ version: expected, ignored });
  });

  it('a stale APP_VERSION is ignored, with one warning telling the owner to delete it', () => {
    const config = loadServerConfig({ APP_VERSION: '1.0.0' }, { packageVersion: '2.0.0' });
    expect(config.appVersion).toBe('2.0.0');
    const warning = (config.warnings as Warning[]).find((w) => w.variable === 'APP_VERSION');
    expect(warning?.action).toMatch(/^Delete APP_VERSION/);
  });

  it('defaults to the real package.json version', () => {
    const { version } = require('../package.json');
    expect(loadServerConfig({}).appVersion).toBe(version);
  });
});

describe('typed getters with documented defaults (F-G-13)', () => {
  it('applies the same defaults the server used to inline', () => {
    const config = loadServerConfig({});
    expect(config.get('APP_URL')).toBe('http://localhost:3000');
    expect(config.get('PUBLIC_ORIGIN')).toBe('https://ecoauditor.io');
    expect(config.get('FORCE_HSTS')).toBe(false);
    expect(config.get('SITE_DEPLOY_TOKEN')).toBeNull();
    expect(config.isProduction).toBe(false);
    expect(config.buildSha).toBeNull();
  });

  it('types values and drops trailing slashes like the inline code did', () => {
    const config = loadServerConfig({
      APP_URL: 'https://ecoauditor.io///',
      FORCE_HSTS: 'true',
      NODE_ENV: 'production',
      RAILWAY_GIT_COMMIT_SHA: 'railway-sha',
      GIT_SHA: 'git-sha',
    });
    expect(config.get('APP_URL')).toBe('https://ecoauditor.io');
    expect(config.get('FORCE_HSTS')).toBe(true);
    expect(config.isProduction).toBe(true);
    expect(config.buildSha).toBe('railway-sha');
    expect(loadServerConfig({ GIT_SHA: 'git-sha' }).buildSha).toBe('git-sha');
  });

  it('refuses an undeclared name, so new code has to declare its variable', () => {
    expect(() => loadServerConfig({}).get('NOT_DECLARED_ANYWHERE')).toThrow(/not declared in ENV_SCHEMA/);
  });

  it('reads the environment once: later changes to the object do not leak in', () => {
    const env: Record<string, string> = { PUBLIC_ORIGIN: 'https://first.example' };
    const config = loadServerConfig(env);
    env.PUBLIC_ORIGIN = 'https://second.example';
    expect(config.get('PUBLIC_ORIGIN')).toBe('https://first.example');
  });
});

describe('boot warnings (F-G-13, F-F-18)', () => {
  it('a complete production environment has none', () => {
    expect(variables(PRODUCTION_OK)).toEqual([]);
  });

  it('names each missing required-in-production variable once', () => {
    expect(variables({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/x' })).toEqual([
      'CONSENT_IP_PEPPER',
      'SITE_DEPLOY_TOKEN',
      'VITE_GTM_ID',
      'VITE_INSFORGE_ANON_KEY',
      'VITE_INSFORGE_BASE_URL',
    ]);
  });

  it('asks for SITE_DEPLOY_TOKEN only when publishing is possible (a database is configured)', () => {
    expect(variables({ ...PRODUCTION_OK, DATABASE_URL: '', SITE_DEPLOY_TOKEN: '' })).toEqual([]);
  });

  it('keeps the CONSENT_IP_PEPPER warning the consent fix added (F-G-11), word for word', () => {
    const warnings = loadServerConfig({ ...PRODUCTION_OK, CONSENT_IP_PEPPER: '' }).warnings as Warning[];
    expect(warnings).toEqual([
      {
        message: 'CONSENT_IP_PEPPER is not set: consent records use a random per-process pepper, so ip_hash values cannot be compared across restarts or replicas',
        variable: 'CONSENT_IP_PEPPER',
        action: 'Set CONSENT_IP_PEPPER in the Railway service variables (see .env.example)',
      },
    ]);
  });

  // ALLOW_SAMPLE_DATA is gone with the sample data (F-G-07): the server ignores it.
  it('flags development-only variables set in production', () => {
    expect(variables({ ...PRODUCTION_OK, ALLOW_SAMPLE_DATA: 'true', ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: 's', DEV_COMPANY_ID: 'c' })).toEqual([
      'ALLOW_DEV_AUTH',
      'DEV_AUTH_SECRET',
      'DEV_COMPANY_ID',
    ]);
  });

  it('warns when both halves of a VITE_X || X pair are set and differ, naming them but never their values', () => {
    const warnings = loadServerConfig({
      INSFORGE_ANON_KEY: 'anon-key-one-marker',
      VITE_INSFORGE_ANON_KEY: 'anon-key-two-marker',
      STRIPE_PRICE_PRO_ANNUAL: 'price_same',
      VITE_STRIPE_PRICE_PRO_ANNUAL: 'price_same',
      STRIPE_PK: 'pk_live_a',
    }).warnings as Warning[];
    expect(warnings.map((w) => w.variable)).toEqual(['INSFORGE_ANON_KEY']);
    expect(warnings[0]!.message).toContain('VITE_INSFORGE_ANON_KEY');
    expect(JSON.stringify(warnings)).not.toMatch(/marker|price_same|pk_live/);
  });

  it('development is quiet about production-only variables', () => {
    expect(variables({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('no warning ever carries a secret value', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: PRODUCTION_OK.DATABASE_URL, DEV_AUTH_SECRET: 'dev-secret-marker', APP_VERSION: 'garbage' };
    const text = JSON.stringify(loadServerConfig(env).warnings);
    expect(text).not.toContain('secret-db-marker');
    expect(text).not.toContain('dev-secret-marker');
  });
});
