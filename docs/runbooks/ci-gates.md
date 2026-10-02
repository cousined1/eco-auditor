# Runbook: CI gates in `.github/workflows/security.yml`

What each step of the `verify` job enforces today, what is still inert, and the
owner actions that make the remaining gates real (audit findings F-G-02,
F-G-03 and F-G-05).

| Step | Can it fail the build? | Notes |
|---|---|---|
| Test (`npm run build && npm test`) | yes | Includes the Docker-backed route suites (below). |
| Lint (`npm run lint`) | yes | Lints the whole repository. |
| Audit production dependencies | yes, on high/critical advisories in production dependencies | The allowlist in `scripts/audit-production.mjs` has no expiry dates (F-G-05 item 4, open). |
| Scan checked-out files for secrets | yes | gitleaks, `--no-git`. |
| Scan git history for secrets | **no**, until a redacted baseline exists | See `credential-rotation.md` step 7. Rotation comes first. |
| Check migration state | **no**, until the owner adds two secrets (below) | Runs on `push` to `master` only. A branch in this repository can still reach those secrets: see "Residual risk" below. |

Nothing here stops a red commit from reaching production. Deploys are gated only
once Railway "Wait for CI" is enabled (`credential-rotation.md` step 8).

## Owner action: enable the migration check (NEEDS-OWNER)

`npm run db:migrate:check` asks the InsForge platform which migrations are
applied, so CI needs credentials for it. Until they exist, the step prints a
warning and passes.

The credentials are `INSFORGE_ACCESS_TOKEN` (an InsForge CLI access token for an
account that can read this project's migrations) and `INSFORGE_PROJECT_ID` (the
id of the linked InsForge project; `npx @insforge/cli current` shows it). The
token is platform-admin, so where it lives is your decision: read "Residual
risk" below before you add it anywhere. The options, the recommended one first:

1. **A GitHub Environment**, if your GitHub plan supports environments for this
   repository. Its deployment rule keeps the token away from runs on other
   branches. The plan details and the steps are under "Residual risk" below. The
   workflow has to change for it (the check becomes its own job that names the
   environment); this change set does not touch `.github/workflows`.
2. **Otherwise, leave both unset.** The step prints its warning and passes, and
   you run `npm run db:migrate:check` locally before each deploy.
3. **Repository secrets**: the one route that works with the workflow as it is
   committed, on any plan. It turns the check on, and any branch in this
   repository can reach the token (D-11). Choose it only knowingly. In the GitHub
   repository, Settings, Secrets and variables, Actions, New repository secret,
   add both names above. Nothing else changes: the step already passes these two
   secrets to the script. It runs on pushes to `master` and never on
   `pull_request`, because the token is platform-admin and a pull-request job
   runs the pull request's code.

Whichever route turns the check on:

- Acceptance: the next push to `master` prints `Schema up to date — N
  migration(s) applied.` instead of the warning. If it lists pending migrations,
  the job fails. Apply them (`npm run db:migrate`) before that code deploys.
- Treat the token like any other production secret. If it is ever exposed,
  rotate it the same way as in `credential-rotation.md` step 4.

## Residual risk: a branch in this repository can reach the migration secret (D-11)

The migration check runs only on `push` (`if: github.event_name == 'push'`), so a pull
request's run does not get `INSFORGE_ACCESS_TOKEN`. That `if:` is part of the workflow
file, and a run uses the version of the file on the branch that triggered it. Anyone who
can push a branch to this repository can change `on:` or the `if:`, or add a step that
uses the secret, push that branch, and the run has every repository secret in reach,
including this platform-admin token. (Pull requests from forks do not receive secrets;
branches in the same repository do.) `master` is not protected either (F-G-02), so
pushing to it directly is no harder.

What closes it is a paid GitHub plan, the same decision as F-G-02. Environments can be
configured for a private repository only by users on GitHub Pro and organizations on
GitHub Team; on Free they are for public repositories only, and an environment's secrets
stop applying if a repository turns private. With the plan in place (owner):

1. Settings, Environments, New environment (for example `migration-check`). Deployment
   branches and tags: Selected branches and tags, add `master`.
2. Move `INSFORGE_ACCESS_TOKEN` and `INSFORGE_PROJECT_ID` into that environment's
   secrets and delete the repository-level copies.
3. Give the check its own job with `if: github.event_name == 'push'` and
   `environment: migration-check` (only a job can name an environment, not a step).
   Only a run on a ref the deployment rule allows can read the secrets.
4. Protect `master` with a required review (same plan). Without it, a change to the
   workflow can still reach `master` and run there.

Until then the exposure is limited to whoever can push to the repository. Keep that to
the owner, rotate the token as in `credential-rotation.md` step 4 if it is ever shared,
or leave the two secrets unset: the step then warns and passes, and you run
`npm run db:migrate:check` locally before each deploy.

## Running the Docker-backed suites locally

Every test file that imports `tests/e2e-helpers` belongs here, and
`grep -l e2e-helpers tests/*.test.ts*` lists them. Those that call its
`dockerRunPg` start their own throwaway Postgres; the others use only its
server-spawning helpers and need no Docker.

- Requirements: Docker running, and `npm run build` first (the video and page
  tests read `static/`). Then `npm test`, or one file at a time by its path
  (`npx vitest run tests/webhook-route.test.ts`).
- Each container is named `fix-tests-pg-*-<pid>-<random>`, labelled
  `eco-auditor.test-container=true`, and published on `127.0.0.1` with a port
  Docker picks. After the suite, the helpers remove it together with its
  anonymous volume. Two runs (two worktrees, or a shell next to the local e2e
  stack) therefore cannot collide or remove each other's containers.
- Spawned servers get an explicit environment plus only the OS basics (PATH,
  SystemRoot, TEMP, HOME ...), so variables in your shell (STRIPE_*,
  SITE_DEPLOY_TOKEN, DEV_COMPANY_ID ...) cannot change test results.
- After a crash, list leftovers with
  `docker ps -a --filter label=eco-auditor.test-container=true` and remove
  only the ones you started with `docker rm --force --volumes <name>`.
