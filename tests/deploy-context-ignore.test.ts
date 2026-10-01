// @vitest-environment node
/**
 * F-G-17: what leaves the machine and what enters the image. `railway up`
 * uploads the working directory minus .railwayignore (.gitignore syntax), and the
 * Docker build context is that minus .dockerignore (patterns relative to the
 * context root). Local credentials (.env files, the InsForge CLI state, editor MCP
 * config), the old lead and consent file store, agent state and the root-level
 * audit transcripts (three of them held credentials, see
 * docs/runbooks/credential-rotation.md) must stay out of both; what the build and
 * the runtime read must stay in.
 *
 * ponytail: a small matcher for the syntax both files use (`*`, `?`, `[..]`,
 * `**`, `!`, a trailing `/`), not Docker or the Railway CLI themselves.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

interface Rule { negate: boolean; dirOnly: boolean; regex: RegExp }

/** One glob as a regex source over a posix path: `*` and `?` stop at `/`; `**` does not. */
function globSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // "**/" is zero or more directories; any other "**" is anything.
      if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else if (ch === '[') { const end = glob.indexOf(']', i); out += glob.slice(i, end + 1); i = end; }
    else out += ch.replace(/[.+^${}()|\\]/u, '\\$&');
  }
  return out;
}

/** .dockerignore patterns are all relative to the root; in .gitignore syntax one without a slash matches at any depth. */
function rules(file: string, alwaysAnchored: boolean): Rule[] {
  return readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!');
      let glob = negate ? line.slice(1) : line;
      const dirOnly = glob.endsWith('/');
      if (dirOnly) glob = glob.slice(0, -1);
      const anchored = alwaysAnchored || glob.includes('/');
      glob = glob.replace(/^\//u, '');
      return { negate, dirOnly, regex: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${globSource(glob)}$`, 'u') };
    });
}

const parents = (path: string) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));

/** Docker: the last pattern matching the path or one of its parent directories decides. */
function dockerIgnores(list: Rule[], path: string): boolean {
  let ignored = false;
  for (const rule of list) {
    if (rule.regex.test(path) || parents(path).some((dir) => rule.regex.test(dir))) ignored = !rule.negate;
  }
  return ignored;
}

/** .gitignore: nothing under an ignored directory comes back; otherwise the last matching pattern decides. */
function gitIgnores(list: Rule[], path: string): boolean {
  const decide = (target: string, isDir: boolean) =>
    list.reduce((ignored, rule) => ((isDir || !rule.dirOnly) && rule.regex.test(target) ? !rule.negate : ignored), false);
  return parents(path).some((dir) => decide(dir, true)) || decide(path, false);
}

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true })
    .map((name) => `${dir}/${String(name).replace(/\\/gu, '/')}`)
    .filter((path) => statSync(join(ROOT, path)).isFile());
}

const docker = rules('.dockerignore', true);
const railway = rules('.railwayignore', false);
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

// Credentials, local state and agent state, at the root or deeper.
const LOCAL = [
  '.env', '.env.local', '.env.production', '.env.ollama', 'prod.env', 'config/.env', 'deploy/staging.env',
  '.data/leads.json', '.data/consent.json', '.insforge/project.json', 'opencode.json', 'opencode.jsonc', 'gsc-key-temp.json',
  '.omc/state/run.json', '.claude/settings.local.json', '.claude-flow/metrics.json', '.codex/config.toml', '.agents/notes.md',
  '.opencode/state.json', '.swarm/memory.db', 'ruvector.db',
];
// Root-level audit transcripts, reports, prompts and scan output.
const TRANSCRIPTS = [
  'Ecoauditor-audit-8-14.txt', 'ecoprime-8-22.txt', 'gov-perplex-audit-8-16.txt', 'eco-Audit-8-17-perplex.txt', 'Prompt.txt',
  'social-login.txt', 'findings.sarif', 'vulnerability-backlog.csv', 'ecoauditor-launch-fixes.patch', 'AUDIT_REPORT.md',
  'AUDIT-REPORT-2026-08-22.md', 'LAUNCH_AUDIT.json', 'LAUNCH-READINESS-2026-08-17.md', 'HANDOFF-launch-2026-08-20.md',
  'ecoauditor-mvp-audit-2026-08-05.md', 'security-audit-summary.md', 'augment-saas-find-fix-audit-prompt.md',
  'ecoauditor_AUDIT_PROMPT_corrected.md', 'dogfood-report.md', 'dogfood-output/screenshots/home.png',
  'audit-live/2026-08-14/report.md', 'reports/trivy-fs-2026-09.json', 'docs/audits/2026-08.md', 'docs/archive/audits/AUDIT_REPORT.md',
];
// What `npm run build` reads at the root, and every file the Dockerfile copies by name.
const BUILD = ['package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'tailwind.config.js', 'postcss.config.js'];
const COPIED = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.+)$/gmu)]
  .flatMap((match) => match[1].trim().split(/\s+/u).slice(0, -1))
  .filter((source) => source !== '.' && !source.includes('*'));
const TEMPLATES = ['.env.example', 'railway.env.example'];

describe('F-G-17: nothing local or secret leaves with `railway up` or enters the image', () => {
  it('credentials, the old file store, local config and agent state are ignored by both files', () => {
    expect(LOCAL.filter((path) => !dockerIgnores(docker, path))).toEqual([]);
    expect(LOCAL.filter((path) => !gitIgnores(railway, path))).toEqual([]);
  });

  it('the root-level audit transcripts, reports and scan output are ignored by both files', () => {
    expect(TRANSCRIPTS.filter((path) => !dockerIgnores(docker, path))).toEqual([]);
    expect(TRANSCRIPTS.filter((path) => !gitIgnores(railway, path))).toEqual([]);
  });
});

describe('what the build and the runtime read still ships', () => {
  it('src/, public/, scripts/, the build configs and every file the Dockerfile copies', () => {
    const needed = [...BUILD, ...COPIED, ...['src', 'public', 'scripts'].flatMap(filesUnder)];
    expect(COPIED).toContain('server.cjs');
    expect(needed).toEqual(expect.arrayContaining(['src/lib/consent-audit.ts', 'public/robots.txt', 'public/llms.txt']));
    expect(needed.filter((path) => dockerIgnores(docker, path))).toEqual([]);
    expect([...needed, 'Dockerfile', 'railway.toml'].filter((path) => gitIgnores(railway, path))).toEqual([]);
  });

  it('the committed *.example templates stay in', () => {
    expect(TEMPLATES.filter((path) => dockerIgnores(docker, path) || gitIgnores(railway, path))).toEqual([]);
  });

  it('the image provisions no .data directory (F-G-12: the lead and consent file store is gone)', () => {
    expect(dockerfile).not.toMatch(/\.data\b/u);
  });
});
