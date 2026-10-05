/**
 * Tenant isolation, pinned at the SQL layer.
 *
 * This is the highest-consequence surface in the product: a missing or wrong
 * RLS policy means one customer reading another's emissions data, and a
 * re-granted billing column means anyone granting themselves Pro from a browser
 * console. Both are invisible to every other kind of test in this repo — the
 * server tests, the UI tests and the runtime smoke gate all exercise code, not
 * database privileges.
 *
 * The protections currently live only as SQL plus the comments explaining them.
 * These tests make them executable, so a future migration that forgets a policy
 * or re-grants a column fails here instead of in production.
 *
 * No database required: the migrations are the artefact, and they are what runs
 * against production.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');
const migrationDir = resolve(repoRoot, 'migrations');

const files = readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort();
const allSql = files.map((f) => readFileSync(resolve(migrationDir, f), 'utf8')).join('\n');

/** Strip `--` comments so an assertion cannot match the prose explaining a rule. */
const sqlOnly = files
  .map((f) => readFileSync(resolve(migrationDir, f), 'utf8'))
  .map((s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'))
  .join('\n');

const createdTables = [
  ...new Set(
    [...sqlOnly.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?(\w+)"?/gi)].map(
      (m) => m[1].toLowerCase()
    )
  ),
];
const rlsEnabled = new Set(
  [...sqlOnly.matchAll(/ALTER TABLE\s+(?:public\.)?"?(\w+)"?\s+ENABLE ROW LEVEL SECURITY/gi)].map(
    (m) => m[1].toLowerCase()
  )
);
/**
 * Replay the migrations in order to get the FINAL policy state.
 *
 * Parsing every CREATE POLICY and ignoring DROP POLICY would be wrong: the
 * hardening migrations deliberately drop the anonymous insert policies on
 * leads and contact_submissions, and drop companies_owner_delete. What
 * matters is what the database looks like after the last migration runs, not
 * what was once written down.
 *
 * Statements must be applied in true source order, not "all creates then all
 * drops": add-csv-import-log.sql drops and immediately recreates
 * csv_import_events_owner_select, so a per-file create-then-drop pass silently
 * deletes it.
 */
const policyState = new Map<string, { table: string; body: string }>();
const policyStatements: RegExpExecArray[] = [];
for (const file of files) {
  const text = readFileSync(resolve(migrationDir, file), 'utf8')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

  const stmtRe =
    /(CREATE POLICY\s+"?([\w]+)"?\s+ON\s+(?:public\.)?"?(\w+)"?[\s\S]*?|DROP POLICY(?:\s+IF EXISTS)?\s+(?:public\.)?"?(\w+)"?\s+ON\s+(?:public\.)?"?(\w+)?"?\s*);/gi;
  for (const m of text.matchAll(stmtRe)) {
    if (m[2]) policyStatements.push(m);
    else policyStatements.push(m);
  }
}
for (const m of policyStatements) {
  if (m[2]) policyState.set(m[2].toLowerCase(), { table: m[3].toLowerCase(), body: m[0] });
  else policyState.delete(m[4].toLowerCase());
}
const policies = policyState;

const policiesFor = (table: string) =>
  [...policies.entries()].filter(([, p]) => p.table === table).map(([name]) => name);

/** Tables holding customer data that must never be reachable cross-tenant. */
const OWNER_SCOPED = ['companies', 'facilities', 'emission_entries', 'reports'];

describe('every table is protected by row level security', () => {
  it('found the tables and policies this suite expects', () => {
    expect(createdTables.length).toBeGreaterThanOrEqual(8);
    expect(policies.size).toBeGreaterThanOrEqual(16);
  });

  for (const table of createdTables) {
    it(`${table} has row level security enabled`, () => {
      // blog_posts is created at runtime by server.cjs, not in a migration.
      if (table === 'blog_posts') return;
      expect(rlsEnabled.has(table), `${table} has no ENABLE ROW LEVEL SECURITY`).toBe(true);
    });
  }
});

describe('owner-scoped tables carry every DML policy they are allowed to have', () => {
  // companies deliberately has no delete policy: deleting your own row cascaded
  // away csv_import_events (the monthly quota) and the next API call
  // re-provisioned a company with a fresh 14-day trial.
  const EXPECTED_OPS: Record<string, string[]> = {
    companies: ['select', 'insert', 'update'],
    facilities: ['select', 'insert', 'update', 'delete'],
    emission_entries: ['select', 'insert', 'update', 'delete'],
    reports: ['select', 'insert', 'update', 'delete'],
  };

  for (const table of OWNER_SCOPED) {
    it(`${table} has exactly its expected DML policies`, () => {
      const names = policiesFor(table).join(' ');
      for (const op of EXPECTED_OPS[table]) {
        expect(names, `${table} is missing a ${op} policy`).toContain(op);
      }
      // Nothing extra either: an unexpected policy is un-reviewed surface.
      expect(policiesFor(table).length).toBe(EXPECTED_OPS[table].length);
    });

    it(`${table} scopes through auth.uid() and never an unconditional clause`, () => {
      const own = [...policies.entries()].filter(([, p]) => p.table === table);
      for (const [name, policy] of own) {
        expect(policy.body, `${name} does not reference auth.uid()`).toMatch(/auth\.uid\(\)/);
        // WITH CHECK (true) on an owner table would let any authenticated user
        // insert a row for another tenant.
        expect(policy.body, `${name} has an unconditional WITH CHECK`).not.toMatch(
          /WITH CHECK\s*\(\s*true\s*\)/i
        );
        expect(policy.body, `${name} has an unconditional USING`).not.toMatch(
          /USING\s*\(\s*true\s*\)/i
        );
      }
    });
  }

  it('child tables resolve ownership through companies, not a bare user_id', () => {
    for (const table of ['facilities', 'emission_entries', 'reports', 'csv_import_events']) {
      const own = [...policies.entries()].filter(([, p]) => p.table === table);
      expect(own.length, `${table} has no policies`).toBeGreaterThan(0);
      for (const [name, policy] of own) {
        expect(
          policy.body,
          `${name} does not resolve the company via public.companies`
        ).toMatch(/public\.companies|EXISTS/i);
      }
    }
  });

  it('every UPDATE policy re-checks ownership on the written row', () => {
    // USING alone governs which rows are visible; WITH CHECK is what stops a
    // user reassigning a row they own to a company they do not.
    for (const [name, policy] of policies) {
      if (!name.endsWith('_owner_update')) continue;
      expect(policy.body, `${name} has USING but no WITH CHECK`).toMatch(/WITH CHECK/i);
    }
  });
});

describe('billing entitlements cannot be written by the browser', () => {
  it('UPDATE on companies is revoked and re-granted at column level', () => {
    expect(sqlOnly).toMatch(/REVOKE UPDATE ON public\.companies FROM anon, authenticated;/i);
    const grant = sqlOnly.match(/GRANT UPDATE \(([^)]*)\) ON public\.companies TO authenticated;/i);
    expect(grant, 'companies has no column-level UPDATE grant').toBeDefined();
    const columns = grant![1].split(',').map((c) => c.trim().toLowerCase());
    expect(columns, 'billing columns must never be browser-writable').not.toContain('subscription_plan');
    expect(columns).not.toContain('subscription_status');
    expect(columns).not.toContain('trial_ends_at');
    expect(columns).not.toContain('stripe_customer_id');
  });

  it('companies DELETE is revoked and its policy dropped', () => {
    // Deleting your own row cascaded away csv_import_events (the monthly quota)
    // and the next API call re-provisioned a company with a fresh 14-day trial.
    expect(sqlOnly).toMatch(/REVOKE DELETE ON public\.companies FROM anon, authenticated;/i);
    expect(sqlOnly).toMatch(/DROP POLICY IF EXISTS companies_owner_delete ON public\.companies;/i);
  });

  it('the reports table is server-owned', () => {
    // signoff = 'completed' is the compliance audit trail; a browser-writable
    // signoff is a forged audit record.
    expect(sqlOnly).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.reports FROM anon, authenticated;/i);
  });

  it('the client only writes the columns it was granted', () => {
    const onboarding = readFileSync(
      resolve(repoRoot, 'src', 'components', 'carbon-calculator', 'Onboarding.tsx'),
      'utf8'
    );
    const insert = onboarding.match(/\.insert\(\[\{([^}]*)\}\]/)?.[1] ?? '';
    const columns = insert.split(',').map((c) => c.split(':')[0].trim()).filter(Boolean);
    for (const forbidden of ['subscription_plan', 'subscription_status', 'trial_ends_at']) {
      expect(columns, `Onboarding inserts ${forbidden}, which is not granted`).not.toContain(forbidden);
    }
    expect(onboarding).toMatch(/from\('companies'\)\s*\n?\s*\.insert/);
  });

  it('no client code deletes companies or writes reports', () => {
    // Both were revoked. If a client write path appears it will 403 at runtime.
    const srcFiles = [
      'src/components/carbon-calculator/Onboarding.tsx',
      'src/components/carbon-calculator/index.tsx',
      'src/components/carbon-calculator/ReportGenerator.tsx',
      'src/pages/Reports.tsx',
      'src/pages/Dashboard.tsx',
    ];
    for (const f of srcFiles) {
      const source = readFileSync(resolve(repoRoot, f), 'utf8');
      expect(source, `${f} deletes companies`).not.toMatch(
        /from\('companies'\)[\s\S]{0,120}?\.delete\(\)/
      );
      expect(source, `${f} writes reports through the client SDK`).not.toMatch(
        /from\('reports'\)[\s\S]{0,120}?\.(insert|update|delete)\(/
      );
    }
  });
});

describe('public write surfaces stay closed', () => {
  it('leads and contact_submissions have no anonymous insert policy', () => {
    for (const table of ['leads', 'contact_submissions']) {
      const anon = [...policies.entries()].filter(
        ([, p]) => p.table === table && /anon/i.test(p.body)
      );
      expect(anon, `${table} still grants anon access`).toHaveLength(0);
      expect(sqlOnly).toMatch(new RegExp(`REVOKE INSERT ON public\\.${table} FROM anon, authenticated;`, 'i'));
    }
  });

  it('consent_records is deny-by-default and server-written only', () => {
    // The GDPR evidentiary trail must not be readable or writable by the browser.
    expect(policiesFor('consent_records')).toHaveLength(0);
    expect(rlsEnabled.has('consent_records')).toBe(true);
    const server = readFileSync(resolve(repoRoot, 'server.cjs'), 'utf8');
    expect(server).toMatch(/INSERT INTO public\.consent_records/);
    expect(server).toMatch(/queryWithRlsBypass/);
  });

  it('the users billing map has no browser-reachable policy', () => {
    expect(policiesFor('users')).toHaveLength(0);
    expect(rlsEnabled.has('users')).toBe(true);
  });
});

describe('migrations are well-formed', () => {
  it('every policy scopes to an explicit role', () => {
    for (const [name, policy] of policies) {
      expect(policy.body, `${name} has no TO <role>`).toMatch(/\bTO\s+(anon|authenticated|public)/i);
    }
  });

  it('migration filenames are timestamp-ordered and unique', () => {
    expect(files).toEqual([...files].sort());
    expect(new Set(files).size).toBe(files.length);
    for (const f of files) {
      expect(f, `${f} is not a timestamp-prefixed migration`).toMatch(/^\d{8,}/);
    }
  });

  it('no migration re-grants the revoked billing privileges', () => {
    // The single most dangerous edit someone could make to this repo, so it is
    // asserted directly rather than left to review. Table-level only: the
    // column-level grants on companies (name, industry, user_id) are the
    // intended onboarding write path and are not a re-grant of entitlement
    // control.
    for (const table of ['companies', 'reports']) {
      const reGrant = new RegExp(
        `GRANT\\s+(ALL|INSERT|UPDATE|DELETE)\\s+ON\\s+public\\.${table}\\s+TO\\s+(anon|authenticated)\\s*;`,
        'i'
      );
      expect(allSql, `a migration table-level GRANTs ${table} back to a browser role`).not.toMatch(reGrant);
    }
    // The billing columns specifically must never appear in a browser grant.
    expect(allSql).not.toMatch(/GRANT[^;]*subscription_(plan|status)[^;]*TO\s+(anon|authenticated)/i);
    expect(allSql).not.toMatch(/GRANT[^;]*trial_ends_at[^;]*TO\s+(anon|authenticated)/i);
  });
});