'use strict';
// Offline stand-in for npm-cli.js, used by tests/audit-production.test.ts through
// npm_execpath. Records every invocation in AUDIT_STUB_LOG, so the test can prove
// the stub (not a real npm) answered. Then it answers `audit ...` with the canned
// report in AUDIT_STUB_REPORT; an empty value prints nothing, like an npm that
// failed. Never contacts a registry.
const fs = require('node:fs');

if (process.env.AUDIT_STUB_LOG) {
  fs.appendFileSync(process.env.AUDIT_STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
}
if (process.argv.includes('audit') && process.env.AUDIT_STUB_REPORT) {
  process.stdout.write(process.env.AUDIT_STUB_REPORT + '\n');
}
