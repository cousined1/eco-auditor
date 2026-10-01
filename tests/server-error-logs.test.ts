// @vitest-environment node
/**
 * D-S3: a route-level failure used to be logged as { error: String(err) } (or
 * err.message), which keeps "Error: message" and drops the driver's code and the
 * stack, the two things an operator needs to tell a dropped connection from a
 * missing column. log() in server.cjs turns an Error into { name, message, code,
 * stack } and redacts credentials in it (server-errors.cjs), so a call site passes
 * the Error itself.
 *
 *   - the line: a spawned server whose database fails behind a passing plan check
 *     logs the route-level failures of two modules with the driver's code and a
 *     stack (no Docker; tests/helpers/spawn-server.ts);
 *   - the pin: no log(...) call in any server*.cjs gives `error:` a stringified
 *     error. A new route that logs String(err) brings the old blind spot back.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, waitFor, type LogLine, type Spawned } from './helpers/spawn-server';

const ROOT = resolve(__dirname, '..');
const TOKEN = 'server-error-logs-token';

/** The `error:` field of every log(...) call in a file, with the source text of its value. */
function errorFields(file: string): Array<{ line: number; value: string }> {
  const source = ts.createSourceFile(file, readFileSync(resolve(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: Array<{ line: number; value: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'log') {
      const context = node.arguments[2];
      if (context && ts.isObjectLiteralExpression(context)) {
        for (const property of context.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText() === 'error') {
            found.push({ line: source.getLineAndCharacterOfPosition(property.getStart()).line + 1, value: property.initializer.getText() });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const SERVER_FILES = readdirSync(ROOT).filter((name) => /^server.*\.cjs$/.test(name));
const fields = SERVER_FILES.flatMap((file) => errorFields(file).map((field) => ({ file, ...field })));

describe('D-S3: a log call passes the Error, not its text', () => {
  it('the scan sees the calls it guards', () => {
    expect(SERVER_FILES.length).toBeGreaterThan(10);
    expect(fields.length).toBeGreaterThanOrEqual(50);
  });

  it('no log(...) call gives `error:` a String(...), a .message or a .toString() of an error', () => {
    const stringified = fields
      .filter(({ value }) => /\bString\(|\.message\b|\.toString\(/.test(value))
      .map(({ file, line, value }) => `${file}:${line} error: ${value}`);
    // Pass the Error itself (`error: err`): log() keeps its name, message, code and stack and redacts credentials.
    expect(stringified).toEqual([]);
  });
});

describe('D-S3: a route-level failure is logged with the driver code and the stack', () => {
  let app: Spawned;

  beforeAll(async () => {
    // Auth and the plan check pass, then every data statement fails like a dropped
    // connection (tests/helpers/fake-pg-preload.cjs, code ECONNRESET).
    app = await startServer({ ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: TOKEN, DEV_COMPANY_ID: 'test-company-1' }, { fakePg: 'data-down' });
  }, 60_000);

  afterAll(() => app?.stop());

  const get = (path: string) => fetch(`${app.base}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const lineFor = (message: string): Promise<LogLine> => waitFor(() => app.logs.find((line) => line.message === message), 5000, `the "${message}" line`);

  it.each([
    ['server.cjs', '/api/emissions/summary?period=2026', 'Emission data store unavailable'],
    ['server-entry-routes.cjs', '/api/entries', 'Emission entry list failed'],
  ])('%s: GET %s logs "%s" with the code and a stack', async (_module, path, message) => {
    expect((await get(path)).status).toBe(503);
    const error = (await lineFor(message)).error as Record<string, string>;
    expect(error).toMatchObject({ name: 'Error', message: 'Connection terminated unexpectedly', code: 'ECONNRESET' });
    expect(error.stack).toContain('Connection terminated unexpectedly');
    expect(error.stack).toContain('fake-pg-preload.cjs');
  });
});
