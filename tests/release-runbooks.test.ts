// @vitest-environment node
/**
 * Claims the release runbooks make about the server and the database, held to the
 * code the way tests/leads-runbook.test.ts holds leads.md:
 *
 *   D-S5  release-order.md step 5, a deploy that lost DATABASE_URL. It said such a
 *         deploy "looks healthy". With the InsForge URL set (every real production
 *         deploy) the server refuses to start instead (server.cjs, startServer); only
 *         with both variables missing does it start, answering 503 on every data
 *         route and 200 on /health and /ready.
 *   7b    the development-only switches that must be absent in production: the three
 *         the server warns about at boot are the three the runbooks name.
 *   D-6   k2-rollout.md detection query 1 lists both catalog identities, and
 *         release-order.md step 7 gates on the one old-bundle query.
 *   O-3   release-order.md: the onboarding backfill statement is run again after the
 *         deploy; the page names it exactly and says why that is safe.
 *   blog  blog-rows-update.md says the rows are fixed before the new image is deployed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { loadServerConfig } = require('../server-config.cjs');
const { CATALOG_VERSION, LEGACY_CATALOG_VERSION } = require('../emission-factors.cjs');
const { validateEntryEdit } = require('../server-entries.cjs');

const read = (path: string) => readFileSync(resolve(path), 'utf8');
// A page with its line breaks undone.
const flat = (path: string) => read(path).replace(/\s+/g, ' ');
const releaseOrder = flat('docs/runbooks/release-order.md');
const rotation = flat('docs/runbooks/credential-rotation.md');

describe('release-order.md: a production deploy that lost DATABASE_URL (D-S5)', () => {
  it('the server refuses to start in production when the InsForge URL is set and DATABASE_URL is not', () => {
    expect(read('server.cjs')).toMatch(
      /process\.env\.NODE_ENV === 'production' && INSFORGE_BASE_URL && !process\.env\.DATABASE_URL\) \{\s*throw new Error\('DATABASE_URL is required when InsForge authentication is configured'\)/,
    );
  });

  it('says so, and no longer says such a deploy looks healthy', () => {
    expect(releaseOrder).toContain('refuses to start');
    expect(releaseOrder).not.toMatch(/looks healthy/);
  });
});

describe('the development-only switches that must be absent in production (7b)', () => {
  const warnings = loadServerConfig({ NODE_ENV: 'production', ALLOW_SAMPLE_DATA: 'true', ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: 's', DEV_COMPANY_ID: 'c' })
    .warnings as Array<{ variable: string; message: string }>;
  const devOnly = warnings.filter((warning) => /for development only/.test(warning.message)).map((warning) => warning.variable).sort();

  it('are the three the server warns about at boot; ALLOW_SAMPLE_DATA is ignored without a warning', () => {
    expect(devOnly).toEqual(['ALLOW_DEV_AUTH', 'DEV_AUTH_SECRET', 'DEV_COMPANY_ID']);
    expect(warnings.map((warning) => warning.variable)).not.toContain('ALLOW_SAMPLE_DATA');
  });

  it.each([
    ['credential-rotation.md', rotation],
    ['release-order.md', releaseOrder],
  ])('%s names every one of them', (_page, text) => {
    for (const name of devOnly) expect(text, name).toContain('`' + name + '`');
  });

  it('credential-rotation.md does not imply a boot warning for ALLOW_SAMPLE_DATA', () => {
    expect(rotation).toContain('`ALLOW_SAMPLE_DATA` is not one of them');
    expect(rotation).toContain('logs no warning for it');
  });
});

describe('k2-rollout.md detection query 1 and release-order.md step 7 (D-6)', () => {
  const k2 = read('docs/runbooks/k2-rollout.md');
  const step7 = releaseOrder.slice(releaseOrder.indexOf('## Step 7'), releaseOrder.indexOf('## Step 8'));

  it('a legacy row whose date is edited is written with the frozen identity, not the image identity: the rows query 1 must not report', () => {
    const stored = {
      id: 1, scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_amount: null,
      activity_unit: null, activity_date: '2025-03-15', factor_value: null, catalog_version: null, facility_id: null, notes: null,
      method: 'calculation', confidence: 90,
    };
    const edited = validateEntryEdit(stored, { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 1000, unit: 'kWh', activity_date: '2025-04-01' }, new Date('2026-09-30T12:00:00Z'));
    expect(edited.ok).toBe(true);
    expect(edited.row.factor_value).not.toBeNull();
    expect(edited.row.catalog_version).toBe(LEGACY_CATALOG_VERSION);
    expect(LEGACY_CATALOG_VERSION).not.toBe(CATALOG_VERSION);
  });

  it('query 1 lists both identities, and the command the page gives prints them', () => {
    expect(k2).toContain("catalog_version NOT IN ('<image identity>', '<frozen identity>')");
    expect(k2).not.toContain("require('./server-entries.cjs').CATALOG_VERSION");
    const command = /node -p "([^"]*emission-factors\.cjs[^"]*)"/.exec(k2)?.[1];
    expect(command).toBeTruthy();
    const printed = spawnSync(process.execPath, ['-p', command as string], { cwd: resolve('.'), encoding: 'utf8' });
    expect(printed.stdout.trim()).toBe(`${CATALOG_VERSION},${LEGACY_CATALOG_VERSION}`);
  });

  it('step 7 gates on the one old-bundle query, which is the query k2-rollout.md names, and reviews the other checks apart', () => {
    const gate = "activity_amount IS NULL AND unit = 'kg CO2e'";
    expect(k2).toContain(gate);
    expect(step7).toContain(gate);
    expect(step7).toContain('The gate is ONE query');
    expect(step7).not.toMatch(/two detection queries/);
    // The facility check is documented as a lead, so step 7 must not wait for it to be empty.
    expect(k2).toContain('a hit is a company to look at, not proof');
    expect(step7).toContain('need not be empty');
  });
});

describe('release-order.md: the onboarding backfill is run again after the deploy (O-3)', () => {
  const migration = read('migrations/20260930121000_company-onboarding.sql');
  const statement = /UPDATE public\.companies AS c[\s\S]*?;/.exec(migration)?.[0] ?? '';
  const step5 = releaseOrder.slice(releaseOrder.indexOf('## Step 5'), releaseOrder.indexOf('## Step 6'));

  it('names the file and the statement, after the deploy check and before step 6', () => {
    expect(step5).toContain('migrations/20260930121000_company-onboarding.sql');
    expect(step5).toContain('UPDATE public.companies AS c SET auto_provisioned = true');
    expect(step5.indexOf('GET /health')).toBeGreaterThan(-1);
    expect(step5.indexOf('onboarding backfill')).toBeGreaterThan(step5.indexOf('GET /health'));
  });

  it('is the migration\'s one such statement, and it can be run again: it only sets true, on rows that are still false', () => {
    expect(migration.match(/UPDATE public\.companies AS c/g)).toHaveLength(1);
    const text = statement.replace(/\s+/g, ' ');
    expect(text).toContain('SET auto_provisioned = true WHERE c.auto_provisioned = false AND c.onboarding_completed_at IS NULL');
    // What the page gives as the reasons it is safe to run again is in the statement.
    expect(text).toContain("c.name = 'My Organization' OR c.name LIKE '% Organization'");
    for (const table of ['facilities', 'emission_entries', 'reports', 'csv_import_events']) expect(text).toContain('FROM public.' + table);
  });
});

describe('blog-rows-update.md: the rows are fixed before the new image is deployed', () => {
  const blog = flat('docs/runbooks/blog-rows-update.md');

  it('says the server-rendered blog ships with the image, renders the rows as stored, and that this runbook is step 2, before the deploy at step 5', () => {
    expect(blog).toContain('Do this before the new image is deployed');
    expect(blog).toContain('is live only once that image is deployed');
    expect(blog).toContain('renders the stored rows exactly as written');
    expect(blog).toContain('this runbook is step 2 and the deploy is step 5');
    expect(releaseOrder.indexOf('## Step 2: fix the live blog rows')).toBeGreaterThan(-1);
    expect(releaseOrder.indexOf('## Step 2: fix the live blog rows')).toBeLessThan(releaseOrder.indexOf('## Step 5: set the environment, then deploy the image'));
  });
});
