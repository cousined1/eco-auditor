# Eco-Auditor — P0 Conversion + Auth Work Order

> **For:** GODMYTHOS v10.6 (Claude Code CLI / OpenCode)
> **Target:** `ecoauditor.io` (React SPA · InsForge backend · Railway)
> **Posture:** `TRACTION_FIRST` + `MVP_COMPRESS`
> **Mode:** `ULTRATHINK` on all auth-flow design decisions (security-sensitive)
> **Scope:** MEDIUM (WS-1) · MEDIUM→LARGE (WS-2; email/password may warrant its own pass)
> **Source:** Public-funnel MVP audit, 2026-06-15 (findings reproduced inline below)

---

## 0. Context & intent

The marketing funnel makes three promises in the hero — *"No credit card required · 14-day free trial · Set up in under 10 minutes"* — and then dead-ends them at an ambiguous sign-in page. Every trial CTA routes to `/login`, which shows returning-user copy and only offers Google + Apple SSO. The result: a large share of the stated ICP (CFOs / ops / sustainability leads at $10M–$500M firms, skewing Microsoft 365) **cannot create an account at all**, and those who can are shown a page that implies they already have one.

This work order fixes the conversion path and widens auth. It is intentionally **traction-first**: ship the smallest change that lets a net-new visitor go from CTA → working trial, then expand auth surface.

**Do not assume the current implementation.** Phase 0 recon is gating — discover the real auth layer, router, and trial-provisioning logic before writing changes.

---

## 1. Evidence (from live audit)

| Observation | Source |
|---|---|
| All three "Start Free Trial" / "Start Your Free Trial" CTAs have `href="/login"` | DOM anchor scan, `/` |
| `/login` renders only **"Continue with Google"** and **"Continue with Apple"** — no email/password, no Microsoft | rendered `/login` |
| `/login` copy is returning-user framed: *"Sign in to Eco-Auditor — Continue to your emissions ledger, reports, and compliance dashboard."* | rendered `/login` |
| Hero promises no-CC 14-day trial, <10 min setup | rendered `/` |
| Unknown routes (e.g. `/signup`) silently fall through to `/` (catch-all) | navigation test |
| `/app` correctly redirects unauthenticated users to `/login` (gating works — preserve this) | navigation test |
| "Book a Demo" is a raw `mailto:` (out of scope here; see §6) | DOM anchor scan |

---

## 2. Phase 0 — Recon (GATING — no edits until complete)

Produce a short `RECON.md` answering each before touching code:

- [ ] **Auth layer identity.** What actually implements the Google/Apple OAuth? (InsForge native auth? Auth.js / Better Auth / Clerk / Lucia / custom on Drizzle?) Name the library/version and the files.
- [ ] **Session model.** How are sessions issued/stored (JWT, DB session table, cookie attributes)? Where is the `/app` auth guard enforced?
- [ ] **Trial provisioning.** On first successful OAuth, is a tenant/company + 14-day trial record created automatically, or does login assume a pre-existing account? Locate the exact code path. **This is the crux of the "no signup path" bug** — confirm whether first-time OAuth even succeeds today.
- [ ] **Router.** Where are routes declared; where is the catch-all that sends unknown paths to `/`; is there any `/signup` route at all?
- [ ] **CTA wiring.** Confirm all trial CTAs and their copy; list every file/component that hard-codes `/login`.
- [ ] **Shared-stack check.** Does this auth code share lineage with `prismdeck.net`? That project has a known **Google OAuth PKCE/state-cookie** failure under investigation. If shared, assert whether the same defect is present here — it would silently break the exact path that converts trials. Capture cookie `SameSite`/`Secure`/domain and PKCE/state handling.
- [ ] **Provider capability.** Does the identified auth layer support adding **Microsoft (Entra/Azure AD)** and **email/password** as first-class providers, and what's required (app registration, redirect URIs, secrets via Railway env)?

> Apply **Hard Rule on vendored/critical code review** ("guilty until proven evidenced") to the auth layer before modifying it. Run **CI Gate 9 (blast-radius / codeindex)** to map every call site that touches auth/session before changes — auth edits have wide radius.

---

## 3. Workstream 1 — Fix the conversion path (P0-1)

**Goal:** A net-new visitor clicking any trial CTA reaches a flow that creates an account + 14-day trial and lands them in `/app`, with copy that addresses a first-time user.

### Tasks
1. **Distinguish new-user from returning-user intent.** Either (a) introduce a real `/signup` route, or (b) make `/login` dual-mode and route trial CTAs to it with a `?intent=trial` (or equivalent) signal. Pick whichever is smaller given the recon findings — `MVP_COMPRESS`.
2. **Rewrite the new-user copy.** Replace "Sign in… Continue to your emissions ledger" with start-a-trial framing that mirrors the hero promise (no credit card, 14-day trial). Keep a clear "Already have an account? Sign in" affordance.
3. **Guarantee trial provisioning on first auth.** Ensure first successful OAuth (any provider) auto-creates the company/tenant + trial and routes to `/app`. If recon shows this is missing, this is the highest-value fix in the entire order.
4. **Repoint CTAs** to the correct new-user destination across every file found in recon.
5. **Catch-all hygiene (P2, include if cheap):** unknown routes should 404 or redirect intentionally, not silently land on `/`.

### Acceptance criteria
- [ ] Clicking "Start Free Trial" from `/`, `/pricing`, and the closing CTA all reach a new-user start-trial surface (not returning-user copy).
- [ ] A brand-new identity completing OAuth ends on `/app` with an active 14-day trial record persisted (verify in DB).
- [ ] Returning users still sign in cleanly; `/app` gating for unauthenticated users is unchanged.
- [ ] Copy no longer implies a pre-existing account on the new-user path.
- [ ] Compiler/validation loop green; no regressions in the auth call sites flagged by Gate 9.

### Design
- Use the **frontend-design** skill + **GODMYTHOS Cartography** design tokens for any login/signup UI changes. No raw hex; tokens only.

---

## 4. Workstream 2 — Widen auth providers (P0-2)

**Goal:** The ICP can actually sign up. Sequence by traction leverage, not by effort symmetry.

### 4a. Microsoft (Entra/Azure AD) SSO — **do first**
Frictionless OAuth, directly unblocks the Microsoft-365-heavy ICP, and reuses the existing OAuth machinery.

- [ ] Register the app (Entra), configure redirect URIs, store client ID/secret in Railway env (never in repo).
- [ ] Add "Continue with Microsoft" to `/login` and the new-user surface, wired through the same provisioning path as WS-1 task 3.
- [ ] Verify PKCE/state handling matches the hardened pattern (cross-check against the prismdeck PKCE finding from recon).

### 4b. Email + password — **follow-on (may escalate to LARGE scope)**
Treat as a distinct security surface: password hashing (argon2id), email verification, reset flow, and rate limiting / lockout. Do **not** rush this under MVP pressure — flag for its own scoped pass if it can't meet the security bar cleanly.

- [ ] Hashing: argon2id (or platform-recommended), never plaintext/reversible.
- [ ] Email verification before trial activation (or clearly time-boxed).
- [ ] Password reset + rate limiting / brute-force protection.
- [ ] Same provisioning path as all other providers (no divergent trial logic).

### Acceptance criteria
- [ ] "Continue with Microsoft" works end-to-end and provisions a trial identically to Google/Apple.
- [ ] (4b) Email/password sign-up provisions a trial, requires verification, supports reset, and is rate-limited.
- [ ] All providers converge on one provisioning/session code path (no per-provider drift).
- [ ] Secrets live in Railway env; nothing committed.

---

## 5. Instrumentation & gates (apply per doctrine)

- [ ] **Hard Rule #22 — `INSTRUMENT_BEFORE_MERGE`:** add **superlog-debug** spans across the funnel — CTA click → provider chosen → OAuth callback → provisioning → first `/app` render — so trial conversion and drop-off are observable from day one. This funnel was previously a black box; do not merge it blind again.
- [ ] Apply **Hard Rules #19–22** as defined in your doctrine to all changes.
- [ ] Run **CI Gates 1–10**; **Gate 9 (blast-radius)** must pass given auth radius.
- [ ] Compiler validation loop must close green before merge.
- [ ] Threat-model the new surfaces (OAuth state/PKCE, open-redirect on post-auth `next=`, account-enumeration on email/password) — reuse the `godmythos-review` BOLA/IDOR/OAuth threat model.

---

## 6. Explicitly OUT of scope for this work order

These were P0/P1 in the audit but are **not code-agent tasks** — handle separately:

- **Social-proof authenticity (audit P0-3):** named customer logos, attributed testimonials, "$2M contract" quote, and "Join hundreds of SMBs" while labeled *beta*. This is a content/legal decision (FTC endorsement exposure, doubly sensitive for a compliance product), not a code change. Make them real, label as illustrative, or remove.
- **`mailto:` demo (P1):** swap for an embedded scheduler — separate task.
- **Branded email + remove `Developer312` from public contact/meta (P1).**
- **Footer link bug (P1):** "Sim2Real" → `https://sim2real.com` should be `https://sim-2-real.com`. One-line fix; trivial enough to fold in opportunistically.

---

## 7. Suggested commit sequence (MVP_COMPRESS)

1. WS-1 routing + copy + provisioning fix (unblocks the existing OAuth funnel).
2. WS-2a Microsoft SSO (widens reachable ICP, low effort).
3. Instrumentation merge gate (§5) — should land *with* 1 and 2, not after.
4. WS-2b email/password as its own scoped pass.

> Ship 1–3 first. They convert the funnel that already exists and make it measurable. 4 expands reach but carries the most security surface — don't let it block the traction unlock.
