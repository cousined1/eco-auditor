// @vitest-environment node
/**
 * F-F-18 / F-G-13: one inventory of environment variables, held to the code and
 * to railway.env.example. It fails when:
 *   - server*.cjs or the client bundle reads a name ENV_SCHEMA does not declare
 *   - ENV_SCHEMA declares a name nothing uses (a dead variable)
 *   - railway.env.example misses a declared name, or documents an undeclared one
 *     (the audit found ENTRA_*, RAILWAY_DOMAIN and NIXPACKS_NODE_VERSION documented
 *     but dead, and SITE_DEPLOY_TOKEN, PUBLIC_ORIGIN and nine more live but
 *     undocumented)
 * The same check for .env.example is tests/env-example-local-parity.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { exampleNames, schemaNames, serverReads, unusedSchemaNames } from './helpers/env-inventory';

const declared = new Set(schemaNames());

describe('ENV_SCHEMA against the code', () => {
  it('declares every name the server and the client bundle read', () => {
    const undeclared: Record<string, string[]> = {};
    for (const [file, names] of serverReads()) {
      const missing = names.filter((name) => !declared.has(name));
      if (missing.length) undeclared[file] = missing;
    }
    expect(undeclared).toEqual({});
  });

  it('declares nothing that is unused', () => {
    expect(unusedSchemaNames()).toEqual([]);
  });

  it('declares each name once', () => {
    expect(schemaNames().length).toBe(declared.size);
  });

  it('actually sees the reads it checks (the scan is not vacuous)', () => {
    const all = new Set([...serverReads().values()].flat());
    for (const name of ['DATABASE_URL', 'SITE_DEPLOY_TOKEN', 'LEAD_NOTIFY_WEBHOOK_URL', 'ALLOW_DEV_AUTH', 'STRIPE_PRICE_PRO_ANNUAL', 'VITE_STRIPE_PRICE_PRO_ANNUAL', 'VITE_GTM_ID', 'PUBLIC_ORIGIN']) {
      expect(all.has(name), name).toBe(true);
    }
  });
});

describe('railway.env.example against ENV_SCHEMA', () => {
  const documented = exampleNames('railway.env.example');

  it('documents every declared name', () => {
    expect(schemaNames().filter((name) => !documented.includes(name))).toEqual([]);
  });

  it('documents no dead name', () => {
    expect(documented.filter((name) => !declared.has(name))).toEqual([]);
  });
});
