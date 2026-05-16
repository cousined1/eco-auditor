# Scan Evidence

## Commands

- `npm audit --audit-level=high`
- `npm run lint`
- `npm test`
- `npm run build`
- `semgrep --config auto --json --output semgrep-audit.json .`

## Results

- `npm audit --audit-level=high`: exit code 0. No high or critical advisories. Moderate advisories remain for `postcss` and transitive `esbuild`.
- `npm run lint`: passed.
- `npm test`: passed. 8 test files, 85 tests.
- `npm run build`: passed.
- `semgrep`: completed successfully after elevated retry. 331 tracked files scanned, 1059 community rules loaded, 265 rules run, 240 raw findings.

## Semgrep Notes

Semgrep initially failed because it attempted to write `C:\Users\embro\.semgrep\semgrep.log`, which was outside the workspace sandbox. The elevated retry completed.

Most Semgrep findings are in `openensemble/**`, which appears to be an embedded tracked project rather than the primary EcoAuditor app surface. App-scope Semgrep signal included:

- `.env.ollama:5`: generic API key detected.
- `server.cjs:65`: CSRF middleware not detected.
- `index.html:22`: subresource integrity warning. This appears low-signal for the canonical link line, but third-party scripts and fonts should still be reviewed under the CSP work.

## Tooling Gaps

The following tools were not available locally during this audit: `gitleaks`, `trivy`, `syft`, `grype`, `osv-scanner`, `zizmor`, `actionlint`.
