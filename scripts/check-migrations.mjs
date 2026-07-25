#!/usr/bin/env node
// Fails when a migration exists locally but has not been applied to the linked
// InsForge project.
//
// Why this exists: nothing in the repo verified migration state, so code could
// ship ahead of its schema. That is not theoretical — the plan-enforcement work
// added columns the server reads on every webhook and CSV import, and deploying
// it first would have 500'd those paths. Run this before a deploy.
//
// Exit codes: 0 up to date · 1 pending migrations · 2 cannot determine
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const VERSION_RE = /^(\d{14})_([a-z0-9-]+)\.sql$/;

function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => {
      const match = VERSION_RE.exec(file);
      // The CLI silently ignores files it cannot parse, so a typo'd name would
      // never apply and never be reported. Treat it as a hard error instead.
      if (!match) {
        console.error(`✗ Malformed migration filename: ${file}`);
        console.error('  Expected <14-digit-version>_<lowercase-hyphenated-name>.sql');
        process.exit(2);
      }
      return { version: match[1], name: match[2], file };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

function appliedVersions() {
  let raw;
  try {
    raw = execFileSync('npx', ['@insforge/cli', 'db', 'migrations', 'list', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch (err) {
    console.error('✗ Could not read applied migrations from InsForge.');
    console.error('  Check `npx @insforge/cli current` — the project must be linked and authenticated.');
    console.error(String(err.stderr || err.message || err).trim());
    process.exit(2);
  }

  try {
    const start = raw.indexOf('{');
    const parsed = JSON.parse(raw.slice(start));
    return new Set((parsed.migrations || []).map((m) => String(m.version)));
  } catch {
    console.error('✗ Unexpected output from the InsForge CLI; cannot verify migration state.');
    process.exit(2);
  }
}

const local = localMigrations();
const applied = appliedVersions();
const pending = local.filter((m) => !applied.has(m.version));

if (pending.length === 0) {
  console.log(`✓ Schema up to date — ${local.length} migration(s) applied.`);
  process.exit(0);
}

console.error(`✗ ${pending.length} migration(s) not applied to the linked project:`);
for (const m of pending) console.error(`    ${m.file}`);
console.error('\n  Apply them before deploying:  npm run db:migrate');
process.exit(1);
