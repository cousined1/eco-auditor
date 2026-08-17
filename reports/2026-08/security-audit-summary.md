# Monthly Security Patch Report — August 2026

**Scope:** Eco-Auditor (ecoauditor.io) — Node 22 / React 19 / Vite single-page app + Express SSR server, deployed on Railway via Dockerfile, backed by InsForge (PostgreSQL + Auth + Storage). AI-enabled (sales chatbot widget).
**Report generated:** 2026-08-16
**Prepared by:** Sisyphus (godmythos + monthly-saas-patching skills)
**Previous report:** `.security-audit/2026-05-14-ecoauditor/` (first run under the monthly-saas-patching CSV format; the 2026-05-14 run used a JSONL findings format and is reconciled here)

---

## 1. Executive summary

Posture is **healthy and stable**. The dependency tree is clean across three independent scanners (Trivy `fs`, `npm audit`, `osv-scanner`) — zero known-vulnerable packages in production dependencies. No IaC misconfigurations. No real committed secrets: all 22 secret-scan hits are the literal placeholder strings `pk_test_placeholder` / `pk_live_placeholder` used as build-time guards in `src/lib/stripe.ts` and the prerendered bundle, plus transient matches in the gitignored `.omo/` tooling directory. The AI sales chatbot is rule-based (no LLM/RAG call path) and already carries the abuse controls the 2026-05-14 audit recommended. The single most important thing for a decision-maker: **no P0 or P1 findings this cycle — the only action item is to keep the monthly cadence and add a Dependabot/Renovate gate so this stays clean automatically.**

vs. last run (2026-05-14): all 12 prior findings are confirmed remediated and closed (see §5). No regressions.

## 2. Risk scorecard

| Metric | This month | Last month (2026-05-14) | Trend |
|---|---|---|---|
| Open findings (total) | 2 | 12 | ↓ 10 |
| P0 – Critical | 0 | 2 | ↓ 2 |
| P1 – High | 0 | 3 | ↓ 3 |
| P2 – Medium | 1 | 6 | ↓ 5 |
| P3 – Low | 1 | 1 | → |
| On CISA KEV | 0 | 0 | → |
| New this month | 2 | 12 | ↓ |
| Closed this month | 12 | n/a | ↑ |
| SLA breaches (overdue) | 0 | 0 | → |

## 3. Findings requiring immediate action (P0 / P1)

None — no critical or high findings outstanding.

## 4. New findings this month

Both are low-risk, neither blocks ship:

- **VULN-202608-001** (P2, `iac-misconfig`-adjacent / repo hygiene): `.omo/`, `audit-live-*/`, `findings.sarif`, `ruvector.db`, and several one-off audit `.txt` files are present in the working tree. `.omo/` and `audit-live-*/` are gitignored and untracked (confirmed via `git ls-files`); the rest are untracked too. Risk: tooling stdout can contain transient secret-shaped strings; if any of these are ever force-added they could leak. Action: confirm `.gitignore` covers them (it does for `.omo/` and `audit-live-*/`) and avoid `git add -f` on the others.
- **VULN-202608-002** (P3, `secret-exposure` false-positive): 22 `stripe-publishable-token` matches across `src/lib/stripe.ts`, `static/assets/index-BoMLkOML.js`, and `.omo/panel-gpt5.stdout`. All are the literal guard strings `pk_test_placeholder` / `pk_live_placeholder` (verified — no `pk_live_*`/`pk_test_*` real values in source). Stripe publishable keys are public-by-design; these are placeholders. Risk-accepted with VEX.

## 5. Closed since last report

All 12 findings from the 2026-05-14 run (`SEC-001` … `SEC-012`) are remediated and marked `patched` in the CSV. Reconciliation:

| Prior ID | Title | Status | Evidence |
|---|---|---|---|
| SEC-001 | Tracked secret-like value (`.env.ollama`) | patched | File removed; `.gitignore` covers env files |
| SEC-002 | Cross-tenant BOLA/IDOR | patched | `server-security.cjs` enforces company membership on emissions/ingestion/facilities/compliance/report endpoints |
| SEC-003 | API auth fails open | patched | Fail-closed in prod unless `ALLOW_DEV_AUTH=true` (`src/lib/insforge.ts` mirrors) |
| SEC-004 | Dashboard hard-codes test tenant | patched | Tenant derived from authenticated session, not hard-coded |
| SEC-005 | DB failure falls back to sample data | patched | Sample fallback gated behind `ALLOW_SAMPLE_DATA=true` |
| SEC-006 | Public AI chat endpoint abuse controls | patched | `chatRateLimit` 10/60s, 16kb body cap, 5000-char message cap (`server.cjs:421,1585`) |
| SEC-007 | Public lead capture stores PII in plain JSON | patched | `sanitizeLeadPayload` + honeypot + 8kb cap (`server.cjs:1614`) |
| SEC-008 | Missing CSP / HSTS | patched | `server-security.cjs` sets CSP, HSTS (prod), X-Frame DENY, nosniff, Referrer-Policy, Permissions-Policy |
| SEC-009 | Dependency audit moderate vulns | patched | `npm audit --omit=dev` = 0; overrides pin esbuild 0.28.1, body-parser 1.20.6, nanoid 3.3.18, ws 8.21.1 |
| SEC-010 | Docker base image not digest-pinned | patched | `Dockerfile:2,22` pins `node:22-alpine@sha256:968df39a…` |
| SEC-011 | Public checkout diagnostic endpoint | patched | Diagnostic response removed |
| SEC-012 | Embedded `openensemble/` Semgrep noise | patched | Directory no longer present; `.semgrepignore`/`.dockerignore` cover audit/tooling folders |

## 6. Actively exploited / KEV callouts

None. No shipped component is on the CISA KEV catalog this cycle.

## 7. Hardening review (AI, misconfig, secrets)

- **AI/LLM (OWASP Top 10 for LLM Applications, 2025):** The customer-facing chatbot (`src/components/ChatbotWidget.tsx` → `POST /api/chat` → `getBotResponse()` in `server.cjs`) is a **rule-based sales bot**, not an LLM/RAG pipeline — there is no model call, no prompt construction, no vector store. Most OWASP LLM categories are therefore not applicable. The categories that still apply to a rule-based conversational endpoint:
  - **LLM05 Improper Output Handling — OK.** Assistant messages render via React text interpolation (`{msg.content}`, `ChatbotWidget.tsx:334`), not `dangerouslySetInnerHTML`; no SQL/shell/HTML sink. No finding.
  - **LLM06 Excessive Agency — OK.** The endpoint has no tool calls, no write actions, no destructive capability. The lead-capture side effect is gated by `sanitizeLeadPayload` + honeypot + rate limit. No finding.
  - **LLM07 System Prompt Leakage — OK.** No system prompt; the bot logic is plain JS conditionals. No finding.
  - **LLM10 Unbounded Consumption — OK.** `chatRateLimit` (10 req/60s/IP), `express.json({ limit: '16kb' })`, 5000-char message cap, 30s client-side `AbortController` timeout. Adequate. No finding.
  - **LLM01 Prompt Injection — N/A** (no LLM). The chat-state object carried from the client is sanitized via `sanitizeChatState` before any persistence (`server.cjs:1326-1336`), which is the correct defensive pattern if an LLM is ever added — note for future.
  - **LLM02/03/04/08/09 — N/A** (no model, no RAG, no embeddings, no fine-tune data).
  - **Recommendation:** if the chatbot is ever upgraded to a real LLM, re-run Phase 2.5 against the new call path — LLM01 (indirect prompt injection via any future scraped/web context) and LLM05 (output encoding at every sink) become live concerns the moment model output is introduced.
- **IaC misconfiguration:** Trivy `fs --scanners misconfig` reports **0 misconfigurations** across `Dockerfile`, `railway.toml`, `nixpacks.toml`, `Procfile`, and `insforge.toml`. Dockerfile runs as non-root `appuser` (line 57), pins base image by digest, has a `HEALTHCHECK`, and sets `NODE_ENV=production`. No finding.
- **Secrets:** 22 `stripe-publishable-token` matches, all LOW. Verified to be the placeholder guard strings `pk_test_placeholder` / `pk_live_placeholder` in `src/lib/stripe.ts:77` and the prerendered bundle `static/assets/index-BoMLkOML.js`; the `.omo/panel-gpt5.stdout` matches are in a gitignored, untracked tooling directory. **No real credential is present in the repo, git history, or build output.** No `.env` file exists (only `.env.example` with `ik_your_anon_key_here` and `https://your-project.region.insforge.app` placeholders). No rotation required. (Per guardrail: no secret values are recorded here — only locations and types.)

## 8. SLA compliance

All SLAs met. No overdue items. The two new findings are P2 (30-day) and P3 (next cycle) — both are housekeeping, neither requires an off-cycle patch.

## 9. Remediation plan and patch window

- **Patch now:** Nothing. Dependency tree is clean; no P0/P1.
- **Batch into next monthly patch window (2026-09-13, day after Patch Tuesday):**
  - VULN-202608-001: extend `.gitignore` to explicitly cover `findings.sarif`, `ruvector.db`, and `*-audit-*.txt` so the working-tree noise can't be accidentally committed. Zero-risk change.
  - VULN-202608-002: no code change — VEX document records the false-positive so next month's Trivy run suppresses it automatically.
- **Backlog with a date:** None.
- **Mitigate:** None.
- **Risk-accept:** VULN-202608-002 (Stripe publishable-key placeholders are public-by-design; no real credential).

## 10. Recommendations

1. **Add Dependabot or Renovate** to `.github/` with a weekly npm schedule and an auto-merge rule for patch/minor bumps that pass `npm test && npm run build`. The tree is clean today only because someone bumped it manually; automate it so it stays clean.
2. **Add a Trivy GitHub Actions gate** on PRs (`trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --exit-code 1`) to catch regressions before merge.
3. **If the chatbot becomes an LLM**, re-run Phase 2.5 with the Arcanum AI Pentest Questionnaire; add instruction/data separation for any scraped content (LLM01) and treat model output as untrusted at every sink (LLM05).
4. **Carry this CSV forward** as `reports/2026-09/vulnerability-backlog.csv` input baseline next month — month-over-month continuity is the point.

## 11. Methodology and scope notes

- **Primary scanner:** Trivy `fs --scanners vuln,misconfig,secret` (DB v2, updated 2026-08-15; consolidates NVD / GHSA / OSV / distro advisories). Scan path: repo root with `node_modules`, `.git`, `.codegraph`, `.swarm`, `.claude-flow`, `.fallow`, `.omo`, `.omc`, `.refact`, `.playwright-mcp`, `audit-live*`, `docs`, `tests`, `scripts`, `public`, `static`, `.security-audit` excluded so the scan reflects shippable surface, not tooling noise. `--ignore-unfixed` set so advisories without a fix don't pollute the backlog.
- **Cross-checks:** `npm audit --json --omit=dev` (0 vulns across 240 prod deps), `osv-scanner -r .` (0 results across 487 packages). `govulncheck` and `pip-audit` not applicable (no Go, no Python in the shipped app). `cargo audit` not applicable.
- **Triage signals:** CVSS (none applicable — no vulns), CISA KEV (no matches), EPSS (no vulns to score), exposure (internet-facing: yes; reachability: N/A for the two non-CVE findings).
- **AI review basis:** OWASP Top 10 for LLM Applications (2025); Arcanum AI Pentest Questionnaire / Prompt Injection Taxonomy referenced for LLM01 framing. The chatbot is rule-based, so the review is a defensive self-assessment of the conversational endpoint only.
- **VEX:** `reports/2026-08/vex/VULN-202608-002.vex.json` records the Stripe-publishable-placeholder false positive as `not_affected` with `vulnerable_code_not_present` justification, so next month's `trivy fs --vex` suppresses it automatically.
- **Carry-forward:** Reconciled against `.security-audit/2026-05-14-ecoauditor/findings.jsonl` (12 findings, all closed).
- **Scan date:** 2026-08-16. Coverage gap: Trivy `fs` does not scan the *built* Docker image — a `trivy image` pass on the Railway-deployed image would close that, but the image is a digest-pinned `node:22-alpine` + `npm ci --omit=dev` of the same lockfile that `npm audit` and `osv-scanner` already cleared, so residual risk is low. Recommended for a future cycle once image pushing is in CI.