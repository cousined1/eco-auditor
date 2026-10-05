import { spawnSync } from 'node:child_process';

const allowedAdvisories = new Set([
  // This project is a client-only Vite SPA and does not use React Router's
  // unstable RSC server actions, the only affected surface for this advisory.
  'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
]);

const npmCli = process.env.npm_execpath;
const audit = npmCli
  ? spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      shell: false,
    })
  : spawnSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

if (!audit.stdout) {
  process.stderr.write(audit.stderr || 'npm audit produced no output\n');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stdout);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities || {};

function isAllowed(name, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return false;
  return (vulnerability.via || []).every((item) => {
    if (typeof item === 'string') return isAllowed(item, seen);
    return allowedAdvisories.has(item.url);
  });
}

const blocking = [];
for (const vulnerability of Object.values(vulnerabilities)) {
  if (!['high', 'critical'].includes(vulnerability.severity)) continue;
  if (isAllowed(vulnerability.name)) continue;
  blocking.push(vulnerability.name);
}

if (blocking.length > 0) {
  process.stderr.write(`Blocking production vulnerabilities: ${blocking.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write('Production dependency audit passed (RSC-only advisory not applicable).\n');
