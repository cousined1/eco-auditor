// @vitest-environment node
/**
 * VERIFY-FINAL-SEC D-S6 and its follow-up: a catch that logs an error must not
 * answer a fixed 500 when the data store was what failed. "Retry later" is a 503
 * (failureStatus in server.cjs, isOutage in the entry, company and CSV routes), and
 * a data route that answers 500 for a dropped connection tells the client and the
 * monitor that the server has a bug. The Stripe-backed routes use
 * billingFailureStatus: a Stripe error is not a store failure, whatever its `code`.
 *
 * The pin reads every server*.cjs with the TypeScript parser (as
 * tests/server-error-logs.test.ts does). It fails on a catch clause that
 *   - logs with level 'error' and answers status(500), and
 *   - names none of failureStatus, billingFailureStatus, isOutage or classifyApiFailure;
 * and on a catch around a Stripe call that answers failureStatus instead of billingFailureStatus.
 * A 500 that is intended goes on ALLOWED_500 below, with its reason. The behaviour
 * of each fixed route with the database down is in tests/data-layer-outage.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

/**
 * Catches that log an error and answer a fixed 500 on purpose, by file and the
 * error text the client receives. Keep this short: a new entry needs a reason a
 * reviewer can check against the code.
 */
const ALLOWED_500: Record<string, string> = {
  'server.cjs: Authentication check failed':
    'authGuard: the call to the auth provider failed; the data store is not involved',
  'server.cjs: Webhook processing failed':
    'Stripe webhook: the 500 is deliberate, "so Stripe retries the delivery" (comment in the catch)',
  'server.cjs: Chat is temporarily unavailable':
    'the chat bot engine; its lead write catches its own store failure (writeChatLead returns false), so none reaches this catch',
  'server.cjs: Internal server error':
    'GET /api/video: fs.statSync of the video file; the data store is not involved',
  'server-publish.cjs: failed to publish':
    'POST /api/publish: a failed connect and a missing table answer 503 above it; a pg error inside the transaction can also be a rejected payload (22xxx, 23xxx), which a "retry later" would mislabel (not changed in this run; owner decision)',
};

const ROUTED = /\b(failureStatus|billingFailureStatus|isOutage|classifyApiFailure)\b/;

interface Catch {
  where: string;
  /** The error text of each status(500).json({ error: '...' }) answer in the catch, or "line N" when it has none. */
  answers500: string[];
  routed: boolean;
  /** Names failureStatus. */
  failure: boolean;
  /** Names billingFailureStatus. */
  billing: boolean;
  /** Its try block calls Stripe. */
  stripe: boolean;
}

function catches(file: string): Catch[] {
  const source = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: Catch[] = [];
  const callsIn = (node: ts.Node): ts.CallExpression[] => {
    const all: ts.CallExpression[] = [];
    const walk = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) all.push(child);
      ts.forEachChild(child, walk);
    };
    walk(node);
    return all;
  };
  const answerText = (status: ts.CallExpression): string => {
    const json = ts.isPropertyAccessExpression(status.parent) && ts.isCallExpression(status.parent.parent) ? status.parent.parent : null;
    const body = json && json.arguments[0] && ts.isObjectLiteralExpression(json.arguments[0]) ? json.arguments[0] : null;
    const field = body && body.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText() === 'error');
    return field && ts.isPropertyAssignment(field) && ts.isStringLiteralLike(field.initializer)
      ? field.initializer.text
      : `line ${source.getLineAndCharacterOfPosition(status.getStart()).line + 1}`;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) {
      const calls = callsIn(node.block);
      const logsError = calls.some((call) =>
        ts.isIdentifier(call.expression) && call.expression.text === 'log' && call.arguments[0] !== undefined &&
        ts.isStringLiteralLike(call.arguments[0]) && call.arguments[0].text === 'error');
      if (logsError) {
        const text = node.block.getText();
        found.push({
          where: `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
          answers500: calls
            .filter((call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'status' &&
              call.arguments[0] !== undefined && ts.isNumericLiteral(call.arguments[0]) && call.arguments[0].text === '500')
            .map((call) => `${file}: ${answerText(call)}`),
          routed: ROUTED.test(text),
          failure: /\bfailureStatus\b/.test(text),
          billing: /\bbillingFailureStatus\b/.test(text),
          stripe: /\bstripe\b|ensureStripeCustomer/.test((node.parent as ts.TryStatement).tryBlock.getText()),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const SERVER_FILES = readdirSync(ROOT).filter((name) => /^server.*\.cjs$/.test(name));
const logged = SERVER_FILES.flatMap((file) => catches(file));
const fixed500 = logged.filter((entry) => entry.answers500.length > 0);
const intended = (entry: Catch) => entry.answers500.every((answer) => ALLOWED_500[answer] !== undefined);

describe('a catch that logs an error answers 503 for a data-store failure', () => {
  it('the scan sees the catches it guards', () => {
    expect(SERVER_FILES.length).toBeGreaterThan(10);
    expect(logged.length).toBeGreaterThanOrEqual(40);
    expect(fixed500.length).toBeGreaterThanOrEqual(Object.keys(ALLOWED_500).length);
  });

  it('none answers a fixed 500 without failureStatus, billingFailureStatus or isOutage, unless it is on ALLOWED_500', () => {
    // Answer failureStatus(err): 503 when the data store failed, 500 otherwise (isOutage(err) in the entry,
    // company and CSV routes). A 500 that is intended goes on ALLOWED_500 with its reason.
    const unrouted = fixed500.filter((entry) => !entry.routed && !intended(entry)).map((entry) => `${entry.where} answers 500 ${entry.answers500.join(', ')}`);
    expect(unrouted).toEqual([]);
  });

  it('every ALLOWED_500 entry still names a catch that exists, so the list cannot go stale', () => {
    const present = new Set(fixed500.flatMap((entry) => entry.answers500));
    expect(Object.keys(ALLOWED_500).filter((key) => !present.has(key))).toEqual([]);
  });
});

describe('a catch around a Stripe call answers billingFailureStatus, not failureStatus (D-S6)', () => {
  it('the scan sees the five Stripe-backed routes', () => {
    expect(logged.filter((entry) => entry.billing).length).toBeGreaterThanOrEqual(5);
    expect(logged.filter((entry) => entry.stripe).length).toBeGreaterThanOrEqual(5);
  });

  it('no catch whose try block calls Stripe answers failureStatus: a Stripe error with a code is not a store failure', () => {
    expect(logged.filter((entry) => entry.stripe && entry.failure && !entry.billing).map((entry) => entry.where)).toEqual([]);
  });
});
