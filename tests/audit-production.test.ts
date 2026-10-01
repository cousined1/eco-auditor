/**
 * F-G-14 — `npm run security:audit` must run on the maintainer's platform.
 * scripts/audit-production.mjs spawned `node <npm-cli> audit` through cmd.exe
 * with the unquoted "C:\Program Files\nodejs\node.exe", so on Windows the gate
 * errored before auditing anything.
 *
 * These tests run the real script offline: npm_execpath (which npm sets for
 * `npm run`) points at tests/fixtures/npm-audit-stub.cjs, which prints a canned
 * `npm audit --json` report and records each call, so no registry is contacted
 * and every test proves the stub answered. On Windows, where node lives under
 * "Program Files", a shell reintroduced on that spawn fails them. On every
 * platform they check the gate's verdicts: pass, block, fail closed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const STUB = resolve(ROOT, 'tests', 'fixtures', 'npm-audit-stub.cjs');
const scratch = mkdtempSync(join(tmpdir(), 'audit-stub-'));
let runs = 0;

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// Our values for these win only if no other spelling of the same name is
// inherited: Windows treats NPM_EXECPATH and npm_execpath as one variable, and
// under `npm test` the inherited copy (the real npm) would win.
const OVERRIDDEN = /^(npm_execpath|npm_config_offline|audit_stub_report|audit_stub_log)$/i;

interface AuditRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Arguments of every stub invocation; empty if the stub never ran. */
  stubCalls: string[][];
}

function runAudit(report?: unknown): AuditRun {
  runs += 1;
  const log = join(scratch, `run-${runs}.log`);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !OVERRIDDEN.test(key)));
  const res = spawnSync(process.execPath, ['scripts/audit-production.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...inherited,
      npm_execpath: STUB,
      // Backstop: if the stub were ever bypassed, npm fails offline instead of
      // contacting a registry, and the tests fail loudly.
      npm_config_offline: 'true',
      AUDIT_STUB_REPORT: report === undefined ? '' : JSON.stringify(report),
      AUDIT_STUB_LOG: log,
    },
  });
  const stubCalls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
    : [];
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, stubCalls };
}

/** Exactly one call, and it was the stub answering `npm audit`. */
function expectStubAnswered(res: AuditRun): void {
  expect(res.stubCalls.map((args) => args[0]), res.stderr).toEqual(['audit']);
}

describe('F-G-14 — the production dependency audit runs and decides offline', () => {
  it('a clean report passes (exit 0) instead of erroring before the audit runs', () => {
    const res = runAudit({ vulnerabilities: {} });
    expectStubAnswered(res);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Production dependency audit passed/);
  });

  it('a high-severity advisory in a production dependency still blocks and names the package', () => {
    const res = runAudit({
      vulnerabilities: {
        'left-pad': { name: 'left-pad', severity: 'high', via: [{ url: 'https://github.com/advisories/GHSA-test-only' }] },
      },
    });
    expectStubAnswered(res);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/Blocking production vulnerabilities: left-pad/);
  });

  it('an audit that prints nothing fails closed (exit 1)', () => {
    const res = runAudit();
    expectStubAnswered(res);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/npm audit produced no output/);
  });
});
