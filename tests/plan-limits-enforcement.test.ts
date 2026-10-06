/**
 * plan-limits.json enforcement invariants.
 *
 * The file's own note states the rule this suite makes executable:
 *
 *   "Every limit here MUST have a server-side check — if you add one with no
 *    enforcement, you are selling something you do not deliver."
 *
 * Nothing tested that rule. plan-limits.json was the only file in the repo with
 * zero test references, and server-billing.test.ts pinned the numbers as
 * hardcoded literals (1 / 5 / 10) rather than reading the file — so the test
 * suite held a *second copy* of the plan limits. Changing the file would break
 * that suite with a confusing failure, while the file's central claim stayed
 * unenforceable.
 *
 * Direction of truth: plan-limits.json is the oracle. These tests re-derive the
 * expected decision from the JSON and assert the server agrees, so a limit
 * hardcoded into server-billing.cjs is the thing that fails — not the file.
 *
 * The last trap here is the comment trap: server.cjs explains each gate in prose
 * that quotes the very identifiers being asserted, so a plain substring search
 * reports enforcement that does not exist. Comments are stripped with a
 * string-aware scanner before any source assertion.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import planLimitsFile from '../plan-limits.json';
import { PLAN_LIMITS, PLANS } from '../src/content/pricing';

const require = createRequire(import.meta.url);
const { planLimits, canAddFacility, canImportCsv, canUseScope3 } = require('../server-billing.cjs');

const root = resolve(__dirname, '..');
const serverSource = readFileSync(resolve(root, 'server.cjs'), 'utf8');

const LIMIT_KEYS = ['facilities', 'csvImportsPerMonth', 'scope3'] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];

/** The server function that must be consulted for each limit key. */
const GATE: Record<LimitKey, string> = {
  facilities: 'canAddFacility',
  csvImportsPerMonth: 'canImportCsv',
  scope3: 'canUseScope3',
};

const PLANS_IN_FILE = Object.keys(planLimitsFile.plans);

/**
 * Every limit key the FILE declares, derived rather than assumed — so adding a
 * limit to plan-limits.json is what makes these tests look at it.
 */
const DECLARED_KEYS = Array.from(
  new Set(PLANS_IN_FILE.flatMap((id) => Object.keys(planLimitsFile.plans[id as keyof typeof planLimitsFile.plans]))),
).sort();

/**
 * Remove `//` and block comments while respecting string and template literals,
 * preserving every newline so line offsets stay meaningful. Regex literals are
 * left alone — server.cjs has none containing a quote character, so they cannot
 * desynchronise the scanner.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const serverCode = stripComments(serverSource);

describe('plan-limits.json declares a shape the server can enforce', () => {
  it('every plan declares exactly the same limit keys', () => {
    for (const planId of PLANS_IN_FILE) {
      expect(Object.keys(planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans]).sort()).toEqual(
        [...LIMIT_KEYS].sort(),
        `plan "${planId}" does not declare every limit key`,
      );
    }
  });

  it('every limit key has an entry in the enforcement map', () => {
    // This is the rule from the file's note, made executable: adding a limit
    // without declaring where the server checks it now fails here. Keyed off
    // DECLARED_KEYS, so it fires on a limit added to the file, not just on a
    // limit this suite already knows about.
    for (const key of DECLARED_KEYS) {
      expect(
        Object.prototype.hasOwnProperty.call(planLimitsFile.enforcement, key),
        `limit "${key}" has no entry in plan-limits.json "enforcement" — it is advertised but nothing checks it`,
      ).toBe(true);
    }
  });

  it('a newly declared limit also has a gate contract here', () => {
    // Passing the enforcement check is not enough: this suite has to know how
    // to check it too, or the limit is advertised with no behavioural coverage.
    expect(
      [...DECLARED_KEYS].sort(),
      'a limit was added to plan-limits.json — add it to LIMIT_KEYS and GATE in this suite, or it ships unenforced and untested',
    ).toEqual([...LIMIT_KEYS].sort());
  });

  it('the enforcement map has no entry for a limit that no longer exists', () => {
    // The other direction: a stale entry names a gate for a deleted limit and
    // reads as proof of enforcement for something that is not sold.
    for (const key of Object.keys(planLimitsFile.enforcement)) {
      expect(LIMIT_KEYS).toContain(key, `enforcement entry "${key}" does not match any plan limit`);
    }
  });

  it('every limit value is a positive integer, null, or a boolean', () => {
    for (const planId of PLANS_IN_FILE) {
      const limits = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans] as Record<string, unknown>;
      for (const key of LIMIT_KEYS) {
        const value = limits[key];
        if (value === null) continue;
        if (key === 'scope3') {
          expect(typeof value, `scope3 on "${planId}" must be a boolean`).toBe('boolean');
          continue;
        }
        expect(typeof value, `${key} on "${planId}" must be a number or null`).toBe('number');
        expect(Number.isInteger(value as number)).toBe(true);
        expect(value as number).toBeGreaterThan(0);
      }
    }
  });

  it('allowances never shrink as the plan tier rises', () => {
    // A customer who upgrades must never lose capability. Checks counts and the
    // scope3 flag together so a "pro" tier cannot be published below "growth".
    const order = ['starter', 'growth', 'pro'];
    for (let i = 1; i < order.length; i += 1) {
      const lower = planLimitsFile.plans[order[i - 1] as keyof typeof planLimitsFile.plans] as Record<string, unknown>;
      const higher = planLimitsFile.plans[order[i] as keyof typeof planLimitsFile.plans] as Record<string, unknown>;
      for (const key of ['facilities', 'csvImportsPerMonth'] as const) {
        const low = lower[key] as number | null;
        const high = higher[key] as number | null;
        expect(
          high === null || (low !== null && high >= low),
          `${order[i]} offers fewer ${key} (${String(high)}) than ${order[i - 1]} (${String(low)})`,
        ).toBe(true);
      }
      expect(higher.scope3).not.toBe(false);
    }
  });
});

describe('the server enforces exactly what the file advertises', () => {
  it('planLimits() returns the file values, not a redefinition', () => {
    for (const planId of PLANS_IN_FILE) {
      expect(planLimits(planId)).toEqual(
        planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans],
        `server-billing.cjs resolves different limits than plan-limits.json for "${planId}"`,
      );
    }
  });

  it('an unknown plan falls back to the starter allowances rather than unlimited', () => {
    // Fail-closed: a plan id the server does not recognise must not inherit
    // pro's null (unlimited) limits.
    expect(planLimits('enterprise')).toEqual(planLimitsFile.plans.starter);
    expect(canAddFacility('enterprise', 0).allowed).toBe(true);
    expect(canAddFacility('enterprise', 1).allowed).toBe(false);
  });

  it('facility quota matches the file across the whole boundary', () => {
    for (const planId of PLANS_IN_FILE) {
      const limit = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans].facilities;
      for (const count of [0, 1, 2, 4, 5, 6, 10, 10_000]) {
        const expected = limit === null ? true : count < limit;
        expect(
          canAddFacility(planId, count).allowed,
          `facilities: ${planId} at count ${count} vs limit ${String(limit)}`,
        ).toBe(expected);
      }
    }
  });

  it('CSV import quota matches the file across the whole boundary', () => {
    for (const planId of PLANS_IN_FILE) {
      const limit = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans].csvImportsPerMonth;
      for (const used of [0, 1, 9, 10, 11, 25, 10_000]) {
        const expected = limit === null ? true : used < limit;
        expect(
          canImportCsv(planId, used).allowed,
          `csvImportsPerMonth: ${planId} at ${used} used vs limit ${String(limit)}`,
        ).toBe(expected);
      }
    }
  });

  it('a null limit is treated as unlimited, never as a cap of zero', () => {
    // The classic null bug: `count >= null` is true for count 0, so an
    // unlimited plan locks every customer out.
    for (const planId of PLANS_IN_FILE) {
      const limits = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans];
      if (limits.facilities === null) expect(canAddFacility(planId, 0).allowed).toBe(true);
      if (limits.csvImportsPerMonth === null) expect(canImportCsv(planId, 0).allowed).toBe(true);
    }
  });

  it('scope3 matches the file for every plan', () => {
    for (const planId of PLANS_IN_FILE) {
      const allowed = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans].scope3;
      expect(canUseScope3(planId).allowed, `scope3 on "${planId}"`).toBe(allowed);
    }
  });

  it('a denial reports the file limit and an upgrade that actually grants it', () => {
    // The 402 body names a number and a plan. If either is wrong the customer is
    // told to buy something that will not fix the problem.
    const checks: Array<[string, string, (p: string, n: number) => { allowed: boolean; limit?: number; requiredPlan?: string }]> = [
      ['facilities', 'facilities', canAddFacility],
      ['csvImportsPerMonth', 'csvImportsPerMonth', canImportCsv],
    ];
    for (const [key, planKey, gate] of checks) {
      for (const planId of PLANS_IN_FILE) {
        const limit = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans][
          planKey as 'facilities'
        ] as number | null;
        if (limit === null) continue;
        const denied = gate(planId, limit);
        expect(denied.allowed, `${key}: ${planId} should be denied at ${limit}`).toBe(false);
        expect(denied.limit, `${key}: denial on "${planId}" reports the wrong limit`).toBe(limit);
        expect(
          gate(denied.requiredPlan!, limit).allowed,
          `${key}: "${planId}" points customers at "${denied.requiredPlan}", which still blocks them at ${limit}`,
        ).toBe(true);
      }
    }
  });

  it('a scope3 denial points at a plan that includes scope3', () => {
    for (const planId of PLANS_IN_FILE) {
      const denial = canUseScope3(planId);
      if (denial.allowed) continue;
      expect(
        canUseScope3(denial.requiredPlan!).allowed,
        `"${planId}" points scope3 customers at "${denial.requiredPlan}", which excludes scope3`,
      ).toBe(true);
    }
  });
});

describe('each declared limit is actually called on the route that claims it', () => {
  for (const key of LIMIT_KEYS) {
    it(`"${key}" is enforced on the routes named in the enforcement map`, () => {
      const routes = String(planLimitsFile.enforcement[key]).match(/\/api\/[^\s,]+/g) ?? [];
      expect(routes.length, `enforcement entry for "${key}" names no route`).toBeGreaterThan(0);

      for (const route of routes) {
        const at = serverCode.indexOf(`app.post('${route}'`);
        expect(at, `route POST ${route} does not exist in server.cjs`).toBeGreaterThan(-1);

        // Handler body: from this route registration to the next one.
        const next = serverCode.indexOf('\napp.', at + 1);
        const handler = serverCode.slice(at, next === -1 ? serverCode.length : next);

        expect(
          new RegExp(`${GATE[key]}\\s*\\(`).test(handler),
          `${route} does not call ${GATE[key]}() to enforce "${key}"`,
        ).toBe(true);
      }
    });
  }

  it('the facility quota is checked inside a transaction holding a row lock', () => {
    // Count-then-insert without a lock lets concurrent uploads all observe the
    // same count and all pass. Assert the lock is present, not that a comment
    // describes it.
    const at = serverCode.indexOf("app.post('/api/companies/:id/facilities'");
    expect(at).toBeGreaterThan(-1);
    const next = serverCode.indexOf('\napp.', at + 1);
    const handler = serverCode.slice(at, next === -1 ? serverCode.length : next);
    expect(handler).toContain('FOR UPDATE');
  });

  it('a CSV import spends quota in the same transaction that persists the rows', () => {
    // If the quota insert and the data insert are separate, a failed save burns
    // one of the customer's monthly imports for an upload that stored nothing.
    const fn = serverCode.slice(
      serverCode.indexOf('async function reserveCsvImportQuota'),
      serverCode.indexOf('async function persistCsvEntries'),
    );
    expect(fn.length, 'reserveCsvImportQuota not found').toBeGreaterThan(0);
    const insertAt = fn.indexOf('INSERT INTO public.csv_import_events');
    const persistAt = fn.indexOf('persist(');
    const commitAt = fn.indexOf("'COMMIT'");
    expect(insertAt, 'quota is never recorded').toBeGreaterThan(-1);
    expect(persistAt, 'rows are never persisted inside the quota transaction').toBeGreaterThan(-1);
    expect(commitAt, 'the quota transaction never commits').toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(commitAt);
    expect(persistAt).toBeLessThan(commitAt);
  });
});

describe('the pricing page advertises the limits the API applies', () => {
  it('pricing.ts re-exports the file rather than restating the numbers', () => {
    expect(PLAN_LIMITS).toEqual(planLimitsFile.plans);
  });

  it('the advertised facility and import counts match the enforced ones', () => {
    for (const [planId, plan] of Object.entries(PLANS)) {
      const limits = planLimitsFile.plans[planId as keyof typeof planLimitsFile.plans];
      const advertised = [...plan.features, ...plan.locked].join(' | ');
      const facilities =
        limits.facilities === null ? 'Unlimited facilities' : `${limits.facilities} ${limits.facilities === 1 ? 'facility' : 'facilities'}`;
      const imports =
        limits.csvImportsPerMonth === null ? 'Unlimited CSV imports' : `${limits.csvImportsPerMonth} CSV imports per month`;
      expect(advertised, `${planId} does not advertise its facility limit`).toContain(facilities);
      expect(advertised, `${planId} does not advertise its CSV import limit`).toContain(imports);
    }
  });

  it('every plan the pricing page sells exists in the limits file', () => {
    for (const planId of Object.keys(PLANS)) {
      expect(PLANS_IN_FILE, `pricing sells "${planId}" with no server-side limits`).toContain(planId);
    }
  });
});