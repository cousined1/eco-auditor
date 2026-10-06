/**
 * STRIPE-EMAIL: a session payload without an email must not take out billing.
 *
 * authGuard validated only `user.id`, yet all five billing routes forward
 * req.user.email into
 *
 *   INSERT INTO public.users (insforge_user_id, stripe_customer_id, email)
 *
 * and public.users.email was declared `TEXT NOT NULL`. node-postgres converts
 * an undefined bind parameter to NULL, so a session whose payload omitted the
 * address produced a not-null violation and a 500 on checkout, checkout verify,
 * the billing portal, plan change and cancellation alike. One absent field, and
 * a paying customer could not subscribe, change plan, open the portal or cancel
 * -- with a database error in the log naming neither the cause nor the user.
 *
 * Whether InsForge always returns an email was not verifiable from here, which
 * is exactly why the code must not depend on it. The constraint on a field that
 * mirrors an optional upstream field was the defect: a Stripe customer does not
 * need an email to exist.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeAuthEmail } = require('../server-billing.cjs');

const root = resolve(__dirname, '..');
const read = (...p: string[]) => readFileSync(resolve(root, ...p), 'utf8');
const serverSrc = read('server.cjs');

const MIGRATION = 'migrations/20261005000000_users-email-nullable.sql';
const CREATE_MIGRATION = 'migrations/20260706000000_add-users-billing-map.sql';

describe('normalizeAuthEmail', () => {
  it('returns null for every shape that would become a NOT NULL violation', () => {
    // These are the values that previously reached the driver as undefined/null
    // and blew up the insert.
    expect(normalizeAuthEmail(undefined)).toBeNull();
    expect(normalizeAuthEmail(null)).toBeNull();
    expect(normalizeAuthEmail('')).toBeNull();
    expect(normalizeAuthEmail('   \n\t ')).toBeNull();
    expect(normalizeAuthEmail(42)).toBeNull();
    expect(normalizeAuthEmail({})).toBeNull();
    expect(normalizeAuthEmail(['a@b.co'])).toBeNull();
  });

  it('keeps a real address, trimmed', () => {
    expect(normalizeAuthEmail('buyer@example.com')).toBe('buyer@example.com');
    expect(normalizeAuthEmail('  buyer@example.com  ')).toBe('buyer@example.com');
  });

  it('never returns undefined, so it can never reach a bind parameter as NULL', () => {
    for (const v of [undefined, null, '', 0, false, NaN, {}, []]) {
      expect(normalizeAuthEmail(v as unknown)).not.toBeUndefined();
    }
  });
});

describe('the users.email constraint matches what the auth layer guarantees', () => {
  it('the original migration did declare email NOT NULL', () => {
    // Premise: without this the later DROP NOT NULL would be a no-op and the
    // test below would prove nothing.
    expect(read(CREATE_MIGRATION)).toMatch(/email\s+TEXT\s+NOT\s+NULL/i);
  });

  it('a later migration drops that constraint', () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/ALTER\s+TABLE\s+(public\.)?users/i);
    expect(sql).toMatch(/ALTER\s+COLUMN\s+email\s+DROP\s+NOT\s+NULL/i);
  });

  it('no other migration re-imposes NOT NULL on users.email after it', () => {
    const later = readdirSync(resolve(root, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => f > '20261005000000_users-email-nullable.sql');
    for (const f of later) {
      const sql = readFileSync(resolve(root, 'migrations', f), 'utf8');
      expect(
        /users[\s\S]{0,200}?email[\s\S]{0,80}?NOT\s+NULL/i.test(sql),
        `${f} re-imposes NOT NULL on users.email`,
      ).toBe(false);
    }
  });
});

describe('authGuard normalises the email before anything else uses it', () => {
  it('assigns req.user from the normalised value, not the raw payload', () => {
    expect(serverSrc).toContain('const email = normalizeAuthEmail(user.email);');
    expect(serverSrc).toMatch(/req\.user\s*=\s*\{\s*\.\.\.user,\s*email\s*\}/);
  });

  it('logs when the address is missing, so the gap is diagnosable', () => {
    // The whole point of normalising instead of failing: a missing email is now
    // visible in the log rather than an opaque constraint violation.
    expect(serverSrc).toMatch(/authGuard: InsForge session carried no usable email/);
  });

  it('every req.user assignment produces a normalised email', () => {
    const assignments = serverSrc.match(/req\.user\s*=/g) || [];
    // Exactly two: authGuard (normalised) and the dev-auth branch (literal).
    expect(assignments.length).toBe(2);
    const dev = serverSrc.slice(serverSrc.indexOf('function apiAuthGuard'));
    expect(dev).toMatch(/req\.user\s*=\s*\{[\s\S]*?email:\s*'dev@example\.com'/);
  });
});

describe('ensureStripeCustomer does not require an email from Stripe or the database', () => {
  it('omits the email key entirely when there is none', () => {
    // Stripe accepts a customer with no email; sending `email: null` would be a
    // different, and stricter, request than omitting it.
    const fn = serverSrc.slice(
      serverSrc.indexOf('async function ensureStripeCustomer'),
      serverSrc.indexOf('// Runs a statement with RLS bypassed'),
    );
    expect(fn).toMatch(/\.\.\.\(email\s*\?\s*\{\s*email\s*\}\s*:\s*\{\}\)/);
    expect(fn).not.toMatch(/^\s*email:\s*email,/m);
  });

  it('still records the address when there is one', () => {
    const fn = serverSrc.slice(
      serverSrc.indexOf('async function ensureStripeCustomer'),
      serverSrc.indexOf('// Runs a statement with RLS bypassed'),
    );
    expect(fn).toContain('INSERT INTO users (insforge_user_id, stripe_customer_id, email)');
  });

  it('all five billing routes go through the one normalised path', () => {
    // checkout, checkout verify, portal, plan change, cancel.
    const callSites = serverSrc.match(/ensureStripeCustomer\(req\.user\.id, req\.user\.email\)/g) || [];
    expect(callSites.length).toBe(5);
  });
});