# Runbook: rotate the credentials leaked in git history

Owner: the account owner (Railway team admin, Stripe admin, InsForge admin).
Time: about 1-2 hours, plus one short production redeploy.
Why: `SECURITY-HISTORY.md` items 2 and 3 are still OPEN. Git history still holds
Railway team tokens and an Ollama API key (audit finding F-G-01, P0 while
rotation is unconfirmed). A Railway team token can redeploy production and read
every service variable, including the Stripe keys, the database password and the
deploy token.

## Ground rules (read first)

- Never paste a secret value into chat, an issue, a commit, a screenshot or a
  shared terminal. Copy new values straight from the provider into the Railway
  variable (or other secret store) and nowhere else.
- Never run `git log -p`, `git show`, `git grep` or any tool that prints the
  contents of the old commits (`907877a`, `edfa108`, `f2eaf94` and their
  neighbours). Use only `gitleaks ... --redact`, which prints locations, not values.
- Record evidence as dates, token names/creation dates, provider audit-event ids,
  Railway deployment ids and HTTP status codes. Never record values.
- Do not make the repository public for any reason, including to unlock branch
  protection (see step 8). Making it public would publish every credential below.

## What the history contains

Re-scan of 2026-09-29 (US Pacific; 2026-09-30 UTC), gitleaks with `--redact` and
the repo's `.gitleaks.toml`: 243 commits scanned, 12 findings. The HEAD tree
(current files) is clean.

| Finding | Where (commit: file:line) | Ledger item | Action |
|---|---|---|---|
| 3 Railway team-token matches | `907877a`: `Ecoauditor-audit-8-14.txt:85`, `ecoprime-8-22.txt:14`, `gov-perplex-audit-8-16.txt:194` | #2 (ledger says "two distinct tokens") | step 1 |
| Ollama API key | `edfa108`: `.env.ollama:5` | #3 | step 2 |
| 4 InsForge `ik_` key matches | `907877a`: `findings.sarif:70,76,77,252` | #1 (rotated 2026-09-10 per ledger) | step 3 (confirm) |
| InsForge `ik_` key | `f2eaf94`: `opencode.json:11` (removed in `cc62540`) | not in the ledger | step 3 (confirm) |
| 3 test fixtures | `b20555c`: `tests/audit-20260917-regressions.test.ts:33,39,50` | none (non-functional test values) | none |

Who can read the private history today: the Railway GitHub app (it has write
access), the CodeRabbit app, every GitHub Actions run (`fetch-depth: 0`), and every
local clone or worktree. Private does not mean unexposed.

## Step 1: Railway team tokens (revoke)

1. Railway dashboard, team settings, API tokens (the ledger's path is
   Settings, Team, API tokens).
2. The scan found three matches and the ledger says two distinct tokens. Values
   are redacted, so which live token each one is cannot be established from
   the repo. Revoke **every** team token that existed on 2026-08-22.
3. Re-issue only the tokens an integration still needs. Prefer a project-scoped
   token over a team token wherever the integration allows it.
4. Acceptance: the token list shows no team token created before today.

## Step 2: Ollama API key (regenerate)

1. In the Ollama account's API-key settings, revoke the key and create a new
   one only if something still uses it.
2. Update that consumer (a local `.env.ollama` is gitignored; never commit it).
3. Acceptance: the old key is gone from the provider's key list.

## Step 3: InsForge `ik_` keys (confirm)

1. In the InsForge dashboard, list the project's API keys.
2. Confirm that **no `ik_` key created before 2026-09-10 is still active**. This
   covers ledger item #1 and the `opencode.json` key, which the ledger does not
   list. Nobody has verified that key is the one rotated on 2026-09-10.
3. If one is active, revoke it and give its consumer (typically a local MCP
   configuration) a new key.
4. Acceptance: no active `ik_` key predates 2026-09-10.

## Step 4: rotate what a stolen team token could read

The leak is from 2026-08-22, and nobody can rule out that a token was used since.
Treat every secret-bearing variable on the Railway service as read. Railway
shows variable names without values, so start from that list. For each secret,
generate the new value at its provider **and update the Railway variable in the
same sitting**, staging all changes so they ship in one deploy (step 5).
Provider and Railway must never disagree for longer than that.

| Railway variable | Rotate at | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard, Developers, API keys: roll the secret key | If Stripe offers to keep the old key valid for a short overlap, keep it only until step 5 passes. |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard, Webhooks, the endpoint: roll the signing secret | Check the endpoint URL is exactly `https://ecoauditor.io/api/webhook` while you are there. Any other path answers 404. |
| `DATABASE_URL` | the database provider (InsForge): change the database password | Paste the new connection string; the app reconnects on deploy. |
| `SITE_DEPLOY_TOKEN` | generate a new random value (for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` in a private terminal) | Update the blog publisher that calls `POST /api/publish` in the same sitting. |
| `CONSENT_IP_PEPPER` | generate a new random value (same command as above) | If it is set, rotate it: whoever holds the pepper and `DATABASE_URL` together can brute-force the IPv4 space against the stored consent IP hashes. Rotation protects only rows written afterwards and makes new hashes unlinkable to old ones. If it is **unset** (production boots without it, finding F-G-11), set it in this same deploy. |
| `LEAD_NOTIFY_WEBHOOK_URL` | Slack (or the chosen receiver): regenerate the incoming webhook | Only if it was configured before this rotation; a webhook URL is a bearer secret. Do not set it at all until the Privacy Policy and the DPA list the team-messaging workspace as a recipient of lead notifications. |
| every other secret-bearing variable on the list | its issuer | The InsForge anon key is public by design and needs no rotation. |

Also check the variable list for development-only switches that must never exist in
production: `ALLOW_DEV_AUTH`, `DEV_AUTH_SECRET` and `DEV_COMPANY_ID`. The server
logs a boot warning naming each one that is set in production (never its value). If
any is present, remove it and treat whatever it could have unlocked as exposed.
`ALLOW_SAMPLE_DATA` is not one of them: it is gone, the server has no sample-data
mode any more and ignores it (F-G-07) and logs no warning for it, so if it is still
in the list, delete it.

## Step 5: redeploy and verify

1. Deploy the staged variable changes (one Railway deployment). Record its id.
2. `GET https://ecoauditor.io/api/health` must answer 200 with `"status":"ok"` and
   the expected commit `sha`. The anonymous body carries only those two fields. If
   the database is unreachable it answers 503 with `"status":"degraded"`, so a 200
   also shows the new `DATABASE_URL` works.
3. Send a Stripe test event to the endpoint (Stripe Dashboard, Webhooks, the
   endpoint, send test event, or the Stripe CLI in test mode). The delivery must
   be 2xx. How to read failures:
   - 404 `{"error":"Not found"}`: wrong endpoint path.
   - 400 "Webhook signature verification failed": the endpoint's signing secret
     and `STRIPE_WEBHOOK_SECRET` differ (compare only the last 4 characters).
   - 503 "Webhook signature secret not configured" or "Billing not configured":
     a Stripe variable is missing on the service.
4. Sign in to the app with a real account and open the dashboard (database + auth).
5. Only now revoke any old Stripe key you kept for the overlap in step 4.

## Step 6: close the ledger (only after steps 1-5 pass)

Edit `SECURITY-HISTORY.md`:
- item 2: `Status: closed. All Railway team tokens that existed on 2026-08-22 revoked on <date>; service variables rotated on <date> (deployment <id>).`
- item 3: `Status: closed. Ollama key revoked on <date>.`
- item 1: add the `opencode.json` location (`f2eaf94`, removed `cc62540`) and
  `Confirmed <date>: no ik_ key created before 2026-09-10 is active.`
- replace the dated OPEN note at the top with the closing dates.

## Step 7: make the history scan blocking (only after step 6)

A baseline tells CI "these findings are known and dead". Created before
rotation, it would mark live credentials as accepted, which is why it comes last.

1. From the repository root, with full history (a normal clone, not shallow), use
   the same digest-pinned image CI uses and `--redact`. Write the report to a
   scratch folder, because the repo is mounted read-only:
   ```sh
   mkdir -p .gitleaks-out
   docker run --rm -v "$PWD:/repo:ro" -v "$PWD/.gitleaks-out:/out" \
     zricethezav/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854 \
     detect --source /repo --redact --config /repo/.gitleaks.toml \
     --report-format json --report-path /out/gitleaks-baseline.json --exit-code 0
   ```
2. Check that nothing unredacted landed in the file before it goes anywhere near
   git (expect the 12 findings listed above):
   ```sh
   node -e "const f=require('./.gitleaks-out/gitleaks-baseline.json');const bad=f.filter(x=>x.Secret!=='REDACTED'||!String(x.Match).includes('REDACTED')||(x.Line&&!String(x.Line).includes('REDACTED')));console.log(f.length+' findings, '+bad.length+' not fully redacted');process.exit(bad.length?1:0)"
   ```
   If it reports anything not fully redacted, stop and delete the folder. Do not
   commit it.
3. Move the file to `.gitleaks-baseline.json` at the repo root, delete
   `.gitleaks-out/`, and commit the baseline.
4. In `.github/workflows/security.yml`, in the history-scan step, remove
   `|| echo "::warning::..."`, add `--baseline-path /repo/.gitleaks-baseline.json`,
   and keep `--exit-code 1`.
5. Acceptance: the step passes on master. On a throwaway branch, commit a
   file with an obviously fake key in a real format (for example `sk_test_`
   followed by 24 random letters), then delete the file in a second commit and
   push. The key now lives only in history: the tree scan passes and the
   history step must fail. Delete the branch afterwards.

## Step 8: gate merges and deploys on CI

Today neither merge nor deploy waits for CI. 6 of the last 20 production deploys
shipped a commit whose CI had failed (finding F-G-02).

- Preferred: Railway service settings, enable **Wait for CI**. Railway then
  deploys a commit only after its GitHub checks pass. It needs no new secret and
  works on GitHub Free. Enable it only once CI is green on master, or every
  deploy halts.
- Branch protection and rulesets on a private repository need **GitHub Pro**
  (GitHub answers 403 "Upgrade to GitHub Pro or make this repository public").
  Never take the "make this repository public" option. It would publish the
  credentials in the history above.
- If you deploy from a workflow instead of Railway auto-deploy, use a
  project-scoped Railway token (never a team token), `needs: verify`, and run the
  job only on `push` to `master`.

## Optional: history purge

`git filter-repo` or BFG can remove the blobs, but only after rotation, and never
instead of it. A purge rewrites every commit, invalidates all clones and open PRs,
and does not remove GitHub's `refs/pull/*` copies (that needs GitHub Support).
Plan it as a separate, coordinated change.
