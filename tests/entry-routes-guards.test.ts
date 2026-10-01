// @vitest-environment node
/**
 * Two guards on the server-owned entry writes (server-entry-routes.cjs), from
 * the wave-2A data verification:
 *
 *   D-5  only a real outage answers 503 "retry later"; a constraint or data
 *        error is a bug and answers a generic 500. Neither echoes driver text.
 *   F1   these routes write with row_security off, so a statement on
 *        emission_entries or facilities without a company_id predicate would
 *        leak or change other tenants' rows silently. Every such statement
 *        must name the caller's company as a parameter.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createEntryHandlers } = require('../server-entry-routes.cjs');

async function answerTo(err: unknown): Promise<{ status: number; body: { error?: string } }> {
  const handlers = createEntryHandlers({
    pool: { query: async () => { throw err; } },
    requireCompanyAccess: async () => '7',
    invalidateCompanyCache: () => undefined,
    log: () => undefined,
  });
  const answer = { status: 0, body: {} };
  const res = {
    status(code: number) { answer.status = code; return res; },
    json(body: { error?: string }) { answer.body = body; return res; },
  };
  await handlers.list({ query: {} }, res);
  return answer;
}

const pgError = (code: string, message = `driver detail ${code}`) => Object.assign(new Error(message), { code });

describe('D-5: 503 only for an outage', () => {
  it.each([
    ['08006 connection_failure', pgError('08006')],
    // What the server's pool answers when no database is configured (F-G-07).
    ['08001 no database configured', pgError('08001', 'Data store unavailable: no database is configured')],
    ['53300 too_many_connections', pgError('53300')],
    ['57P01 admin_shutdown', pgError('57P01')],
    ['57014 statement_timeout', pgError('57014')],
    ['ECONNREFUSED', pgError('ECONNREFUSED')],
    ['pool connect timeout', new Error('timeout exceeded when trying to connect')],
    ['query_timeout', new Error('Query read timeout')],
    ['dropped connection', new Error('Connection terminated unexpectedly')],
  ])('%s answers 503 without driver text', async (_name, err) => {
    const { status, body } = await answerTo(err);
    expect(status).toBe(503);
    expect(body.error).toBe('Data store temporarily unavailable. Please retry.');
  });

  it.each([
    ['23505 unique_violation', pgError('23505')],
    ['23514 check_violation', pgError('23514')],
    ['22P02 invalid_text_representation', pgError('22P02')],
    ['42703 undefined_column', pgError('42703')],
    ['an error without a code', new Error('Idempotent insert found neither a new nor a stored row')],
  ])('%s answers a generic 500 without driver text', async (_name, err) => {
    const { status, body } = await answerTo(err);
    expect(status).toBe(500);
    expect(body.error).toBe('The entry could not be saved. Please retry.');
  });
});

// server.cjs holds the facility reads and the delete-data statements. Its facility lookup
// for GET /api/facilities/:id/emissions loaded by id alone and checked the owner after
// (VERIFY-FINAL-DATA D-2): the one statement there without the company.
const FILES = ['server-entry-routes.cjs', 'server-entries.cjs', 'server.cjs'];
const TOUCHES_TENANT_TABLE = /\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:public\.)?(?:emission_entries|facilities)\b/i;
const SCOPED_INSERT = /\bINSERT\s+INTO\s+(?:public\.)?(?:emission_entries|facilities)\s*\(\s*company_id\b[^)]*\)\s*VALUES\s*\(\s*\$1\b/i;
const SCOPED_PREDICATE = /\bcompany_id\s*=\s*\$\d+/;
// A statement that cannot name a company goes here verbatim (whitespace
// collapsed), with the reason in a comment. None today.
const ALLOWED_UNSCOPED: string[] = [];

/**
 * Every string expression in a file, read with the TypeScript parser: a
 * literal, a template, or a `+` chain, with `${}` standing in for code.
 * ponytail: strings nested inside a template's ${...} are not visited; no
 * statement is built that way here.
 */
function stringExpressions(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(resolve(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fold = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => '${}' + span.literal.text).join('');
    if (ts.isParenthesizedExpression(node)) return fold(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = fold(node.left);
      const right = fold(node.right);
      if (left !== null || right !== null) return (left ?? '${}') + (right ?? '${}');
    }
    return null;
  };
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const text = fold(node);
    if (text === null) ts.forEachChild(node, visit);
    else found.push(text.replace(/\s+/g, ' ').trim());
  };
  visit(source);
  return found;
}

const statements = FILES.flatMap((file) =>
  stringExpressions(file).filter((sql) => TOUCHES_TENANT_TABLE.test(sql)).map((sql) => ({ file, sql })));

describe('F1: every statement on emission_entries or facilities is scoped to the caller\'s company', () => {
  it('the scan sees the statements it guards (list, insert, re-select, lock, update, delete, facility count/insert/check)', () => {
    expect(statements.length).toBeGreaterThanOrEqual(9);
    // ... and the facility lookup behind GET /api/facilities/:id/emissions, in server.cjs.
    expect(statements.some(({ file, sql }) => file === 'server.cjs' && /FROM facilities WHERE id = \$1/.test(sql))).toBe(true);
  });

  it('each one has company_id = $n, or inserts company_id as $1', () => {
    const unscoped = statements.filter(({ sql }) => !ALLOWED_UNSCOPED.includes(sql)
      && !(/^INSERT\b/i.test(sql) ? SCOPED_INSERT.test(sql) : SCOPED_PREDICATE.test(sql)));
    expect(unscoped).toEqual([]);
  });
});

// VERIFY-FINAL-DATA D-1: an entry write checks its facility inside the write's transaction and keeps the row
// locked FOR KEY SHARE until it ends, so a facility delete (FOR UPDATE) waits for the write instead of committing
// between the check and the INSERT/UPDATE, where the foreign key fails (23503) and the caller got a 500. The same
// race on real Postgres: tests/facility-delete-race.test.ts (Docker).
describe('D-1: the facility check of an entry write locks the row until the transaction ends', () => {
  it('is a single FOR KEY SHARE select', () => {
    const checks = statements.filter(({ file, sql }) => file === 'server-entry-routes.cjs' && /^SELECT 1 FROM public\.facilities WHERE id = \$1/.test(sql));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.sql).toMatch(/ FOR KEY SHARE$/);
  });
});
