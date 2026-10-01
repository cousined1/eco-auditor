/**
 * The environment-variable inventory, from three sides (F-F-18, F-G-13):
 *
 *   schemaNames()        what server-config.cjs declares (ENV_SCHEMA)
 *   serverReads()        what server*.cjs and the client bundle read
 *   usedOutsideSchema()  whether a declared name is used anywhere but its declaration
 *   exampleNames(file)   what an example file documents, as `NAME=` or `# NAME=`
 *
 * Shared by tests/env-schema-parity.test.ts (railway.env.example) and
 * tests/env-example-local-parity.test.ts (.env.example).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(__dirname, '..', '..');

const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

export function schemaNames(): string[] {
  const { ENV_SCHEMA } = require('../../server-config.cjs') as { ENV_SCHEMA: Array<{ name: string }> };
  return ENV_SCHEMA.map((entry) => entry.name);
}

export function serverFiles(): string[] {
  return readdirSync(ROOT).filter((file) => /^server.*\.cjs$/.test(file)).sort();
}

function clientFiles(dir = 'src'): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return clientFiles(relative);
    return /\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

function collect(source: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!));
}

/**
 * Names read from the environment, by file. server-billing.cjs names the six
 * price variables in a table and reads each as env[key] || env['VITE_' + key],
 * so a STRIPE_PRICE_* literal counts as a read of both forms.
 */
export function serverReads(): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  for (const file of serverFiles()) {
    const source = read(file);
    const names = collect(source, [
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
      /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
      /\benv\.([A-Z][A-Z0-9_]*)/g,
      /\benv\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
      /serverConfig\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/g,
    ]);
    for (const price of collect(source, [/['"](STRIPE_PRICE_[A-Z_]+)['"]/g])) names.push(price, 'VITE_' + price);
    reads.set(file, [...new Set(names)].sort());
  }
  const client = clientFiles().flatMap((file) => collect(read(file), [/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g]));
  reads.set('src (import.meta.env)', [...new Set(client)].sort());
  return reads;
}

/** Declared names that nothing uses outside ENV_SCHEMA itself. */
export function unusedSchemaNames(): string[] {
  const config = read('server-config.cjs');
  const logicStart = config.indexOf('const SCHEMA_BY_NAME');
  if (logicStart < 0) throw new Error('server-config.cjs: ENV_SCHEMA is expected before SCHEMA_BY_NAME');
  const corpus = [
    ...serverFiles().filter((file) => file !== 'server-config.cjs').map(read),
    config.slice(logicStart),
    ...clientFiles().map(read),
    read('Dockerfile'),
  ].join('\n');
  return schemaNames().filter((name) => !new RegExp(`\\b${name}\\b`).test(corpus));
}

export function exampleNames(file: string): string[] {
  const names = collect(read(file), [/^#?[ \t]*([A-Z][A-Z0-9_]*)=/gm]);
  return [...new Set(names)].sort();
}
