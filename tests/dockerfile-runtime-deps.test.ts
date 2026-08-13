/**
 * Guards the Dockerfile's runtime COPY list against the require graph.
 *
 * railway.toml builds this repo with the Dockerfile. Its *builder* stage does
 * `COPY . .`, but the *runtime* stage copies server modules explicitly by name.
 * So a new root-level module passes every local check — npm ci gives a full
 * working tree, vitest and `node server.cjs` both find it, `npm run build`
 * succeeds — and then dies in the container:
 *
 *   Error: Cannot find module './server-publish.cjs'
 *   Require stack: /app/server.cjs
 *
 * These are top-level requires, so the process does not lose one route, it
 * fails to boot and crash-loops — every route 502s. That happened when
 * server-publish.cjs was added without updating the COPY line.
 *
 * This walks the relative-require graph from server.cjs and asserts every file
 * it reaches is copied into the runtime image.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const ENTRYPOINT = 'server.cjs';

/** Relative require()/import specifiers in a CommonJS file. */
function relativeRequires(source: string): string[] {
  const found = new Set<string>();
  const pattern = /require\(\s*(['"])(\.[^'"]+)\1\s*\)/gu;
  for (const match of source.matchAll(pattern)) {
    found.add(match[2]);
  }
  return [...found];
}

/** Every file reachable from the entrypoint via relative requires, repo-relative and posix-style. */
function requireGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const absolute = join(ROOT, current);
    if (!existsSync(absolute)) continue;
    if (!/\.(cjs|js|json)$/u.test(current)) continue;
    // JSON is a leaf — it has no requires of its own.
    if (current.endsWith('.json')) continue;

    for (const specifier of relativeRequires(readFileSync(absolute, 'utf8'))) {
      const resolved = relative(ROOT, resolve(dirname(absolute), specifier));
      queue.push(resolved.split(/[\\/]/u).join(posix.sep));
    }
  }

  seen.delete(entry);
  return [entry, ...[...seen].sort()];
}

/**
 * Source paths copied by the runtime stage — every COPY after the final FROM.
 * `--from=<stage>` lines are skipped: they pull build output, not repo files.
 */
function runtimeCopySources(dockerfile: string): string[] {
  const lines = dockerfile.split(/\r?\n/u);
  const lastFrom = lines.reduce((acc, line, i) => (/^FROM\s/iu.test(line) ? i : acc), -1);
  const sources: string[] = [];

  for (const line of lines.slice(lastFrom + 1)) {
    const match = /^COPY\s+(.*)$/iu.exec(line.trim());
    if (!match) continue;
    const tokens = match[1].split(/\s+/u).filter(Boolean);
    if (tokens.some((t) => t.startsWith('--from='))) continue;
    // `COPY <src>... <dest>` — everything but the destination.
    for (const token of tokens.slice(0, -1)) {
      if (token.startsWith('--')) continue;
      sources.push(token.replace(/^\.\//u, ''));
    }
  }
  return sources;
}

function isCopied(file: string, sources: string[]): boolean {
  if (sources.includes(file)) return true;
  // Tolerate simple globs such as `package*.json`.
  return sources.some((source) => {
    if (!source.includes('*')) return false;
    const pattern = new RegExp(
      `^${source.replace(/[.+^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*')}$`,
      'u',
    );
    return pattern.test(file);
  });
}

describe('Dockerfile runtime stage ships everything server.cjs requires', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

  it('reaches the modules we expect from server.cjs', () => {
    // Sanity check on the walker itself: if this ever returns just the
    // entrypoint, the assertion below would pass vacuously.
    const graph = requireGraph(ENTRYPOINT);
    expect(graph).toContain(ENTRYPOINT);
    expect(graph).toContain('server-publish.cjs');
    expect(graph.length).toBeGreaterThan(3);
  });

  it('copies every file reachable from server.cjs into the runtime image', () => {
    const sources = runtimeCopySources(dockerfile);
    const missing = requireGraph(ENTRYPOINT).filter((file) => !isCopied(file, sources));

    expect(
      missing,
      missing.length > 0
        ? `These files are require()d at runtime but are not copied into the ` +
            `Dockerfile's runtime stage:\n  ${missing.join('\n  ')}\n\n` +
            `They are top-level requires, so the container will not boot — it ` +
            `crash-loops with MODULE_NOT_FOUND and every route 502s, even though ` +
            `local tests and the build pass (the builder stage uses COPY . .; only ` +
            `the runtime stage is selective).\n\n` +
            `Add them to the COPY line in the runtime stage of ./Dockerfile.`
        : undefined,
    ).toEqual([]);
  });
});
