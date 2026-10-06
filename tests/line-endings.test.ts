/**
 * Line-ending guard.
 *
 * .gitattributes pins `* text=auto eol=lf`, so every tracked text file must be
 * LF in the working copy. Several regression tests slice server.cjs source and
 * match a literal "\n" marker, so a CRLF conversion silently breaks them:
 * indexOf returns -1, the slice runs to end-of-file, and the suite fails with
 * `ReferenceError: app is not defined` rather than anything pointing at line
 * endings.
 *
 * That happened for real: a PowerShell `WriteAllLines` used to delete a block
 * rejoined every line with Environment.NewLine (CRLF on Windows) and broke 31
 * tests. Prefer the file-edit tools over shell text rewrites for this reason.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '..');

// Scope: files a developer edits by hand. Deliberately excludes vendored or
// machine-generated trees — `.security-audit/` holds downloaded Node builds and
// audit-tool output, and `public/google*.html` is a Search Console
// verification file Google's tooling emits. Rewriting those would be churn, and
// they are not what broke the tests.
const SCOPED_DIRS = ['src', 'tests', 'scripts', 'migrations', 'public/sample-report'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'static', 'dist', '.insforge', '.security-audit']);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.css', '.html', '.md',
  '.yml', '.yaml', '.sql', '.xml', '.csv', '.txt', '.toml',
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function* scopedFiles(): Generator<string> {
  for (const dir of SCOPED_DIRS) {
    const full = join(root, dir);
    if (statSync(full).isDirectory()) yield* walk(full);
  }
  // Root-level server and config modules.
  for (const entry of readdirSync(root)) {
    if (!statSync(join(root, entry)).isFile()) continue;
    if (TEXT_EXT.has(entry.slice(entry.lastIndexOf('.')))) yield join(root, entry);
  }
}

describe('line endings', () => {
  const offenders: string[] = [];

  for (const file of scopedFiles()) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('\r\n')) offenders.push(relative(root, file));
  }

  it('has no CRLF in tracked text files (.gitattributes pins eol=lf)', () => {
    expect(
      offenders,
      `convert to LF before committing: ${offenders.slice(0, 10).join(', ')}`,
    ).toEqual([]);
  });

  it('keeps server.cjs readable by the source-slicing regression tests', () => {
    // This exact marker is what tests/server.test.ts slices on.
    const server = readFileSync(join(root, 'server.cjs'), 'utf8');
    expect(server).toContain('app.use(function (req, res, next) {\n  // Only meter the API surface');
  });

  it('does not start tracked source files with a BOM', () => {
    const bom: string[] = [];
    for (const file of scopedFiles()) {
      const bytes = readFileSync(file);
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        bom.push(relative(root, file));
      }
    }
    expect(bom, `strip the BOM: ${bom.join(', ')}`).toEqual([]);
  });
});