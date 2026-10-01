# Security History — Credential Incidents & Rotation Ledger

This file records credentials that were committed to git history in this
repository, what was done about them, and what remains. It intentionally
contains **no secret values** — only locations, commit references, and status.
Anyone re-running a history scan (`gitleaks detect` without `--no-git`) will
hit the findings below until the optional history purge is performed.

> **NOTE 2026-09-30: status stays OPEN until rotation is confirmed.** A history
> re-scan on 2026-09-29 (US Pacific; gitleaks with `--redact` and `.gitleaks.toml`)
> found 243 commits, 12 findings, and a clean HEAD tree. The findings are:
> - 3 Railway team-token matches at `907877a` (item 2). The ledger says two
>   distinct tokens, and the values are redacted, so every team token that
>   existed on 2026-08-22 has to be revoked.
> - The Ollama key at `edfa108` (item 3).
> - 4 InsForge `ik_` matches in `findings.sarif` at `907877a` (item 1).
> - One InsForge `ik_` key in `opencode.json` at `f2eaf94`, removed in `cc62540`.
>   It is not listed under item 1, and nobody has confirmed it is the key rotated
>   on 2026-09-10.
> - 3 non-functional test fixtures at `b20555c`.
>
> Items 2 and 3 remain OPEN. Item 1 needs confirmation that no `ik_` key created
> before 2026-09-10 is still active. From 2026-09-22 until the CI fixture fix,
> both gitleaks steps described at the end of this file were skipped, because
> the Test step failed first. Owner procedure: `docs/runbooks/credential-rotation.md`.

## Incident ledger

### 1. InsForge `ik_` API key in `findings.sarif` — rotated (2026-09-10)

An `ik_` (InsForge api-key) credential appeared in the tracked
`findings.sarif` audit artifact. The value was redacted in the same commit
that introduced the redaction pass (2026-09-10). **The underlying key was
rotated in the InsForge dashboard on 2026-09-10**, so the leaked value is
inert. Status: closed.

### 2. Railway team tokens in audit transcripts — ROTATION REQUIRED

Two distinct Railway team tokens were committed to git history in three audit
transcript files (`Ecoauditor-audit-8-14.txt`, `ecoprime-8-22.txt`,
`gov-perplex-audit-8-16.txt`) at commit `907877a`. The working tree was
redacted in `981124d`, but the values remain in immutable history.

**Action required:** an account admin must rotate both team tokens in the
Railway dashboard (Settings → Team → API tokens). The Railway CLI cannot
rotate team tokens. Until rotation happens, assume the historical values are
live credentials. Status: OPEN — rotation pending.

### 3. Ollama API key in `.env.ollama` — revoke/regenerate at provider

An Ollama API key was committed in `.env.ollama` (added `edfa108`, modified
`cb801b4`, file deleted in `dfdb256`). Deleting the file did not remove the
key from history.

**Action required:** revoke/regenerate the key at the provider. Status: OPEN —
revocation pending.

### 4. InsForge anon key in a historical committed bundle — no action

An InsForge anon (public) key appeared in a historical committed bundle. Anon
keys are public-by-design (RLS policies on the backend enforce data access
boundaries; see `.env.example`). No rotation is required. Status: closed
(no action needed).

## Git history purge — optional follow-up

All leaked values above are rotated, being rotated, or public-by-design. A
history rewrite (`git filter-repo` or BFG Repo-Cleaner) followed by a
force-push and a fresh clone for every contributor would remove the blobs so
future history scans come back clean. It is documented here as **optional**:
it invalidates existing clones and open PRs, so do it as a coordinated
follow-up, not as part of routine remediation.

## CI secret scanning

`.github/workflows/security.yml` runs gitleaks twice on every PR and push to
`master`:

1. **Tree scan** (`--no-git`): scans checked-out files; fails the job on any
   finding.
2. **History scan**: scans the full git history; currently reports findings
   (the items above) and emits a warning instead of failing, until the
   optional purge in the previous section is performed.

The scanner image is digest-pinned; the config lives in `.gitleaks.toml`.
