// @vitest-environment node
/**
 * F-F-18: .env.example against ENV_SCHEMA, the same rule as railway.env.example
 * in tests/env-schema-parity.test.ts.
 *
 * SKIPPED ON PURPOSE (owner action). The fix run that wrote it was not allowed to
 * open .env* files, so .env.example was neither updated from the schema nor
 * checked. Apply the edits listed in the obs-a report (drop ENTRA_CLIENT_ID,
 * ENTRA_REDIRECT_URI, ENTRA_TENANT_SUBDOMAIN, RAILWAY_DOMAIN and
 * NIXPACKS_NODE_VERSION; add every missing name, for example by copying the
 * sections of railway.env.example), then remove `.skip` so CI holds the file to
 * the schema from then on.
 */
import { describe, expect, it } from 'vitest';
import { exampleNames, schemaNames } from './helpers/env-inventory';

describe.skip('.env.example against ENV_SCHEMA', () => {
  it('documents every declared name', () => {
    const documented = exampleNames('.env.example');
    expect(schemaNames().filter((name) => !documented.includes(name))).toEqual([]);
  });

  it('documents no dead name', () => {
    const declared = new Set(schemaNames());
    expect(exampleNames('.env.example').filter((name) => !declared.has(name))).toEqual([]);
  });
});
