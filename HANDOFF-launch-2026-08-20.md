# Handoff — EcoAuditor launch fixes, 2026-08-20

14 files changed in `eco-auditor-deploy`. Verified here before delivery:
`npx eslint .` clean · `npx vitest run` **190/190 pass (23 files)** · `npm run build` OK, prerender **14/14 routes**.

Everything below is a command **you** run — I have no GitHub credentials for the private repo and no network path to Railway or InsForge from this session.

---

## 1. Review the diff

```powershell
cd C:\Users\embro\.openclaw\workspace\eco-auditor-deploy
git status
git diff
```

`ecoauditor-launch-fixes.patch` in the repo root is the same diff as a single file if you'd rather read it that way. Delete it before committing — it's a review artifact, not source:

```powershell
Remove-Item ecoauditor-launch-fixes.patch
```

**One change needs a human decision before it ships:** `src/pages/TermsOfService.tsx` §9. I rewrote the free-trial clause so it stops denying an auto-converting trial that the code actually performs. It's marked with a `*** HAVE COUNSEL REVIEW THIS WORDING ***` comment. If you'd rather change the code than the terms, the alternative is adding `payment_method_collection: 'if_required'` to the checkout session in `server.cjs` and reverting the ToS edit — but don't ship the current mismatch either way.

## 2. Verify locally

```powershell
npm run lint
npm test
npm run build
```

Expect 190 passing. One existing test was rewritten: `tests/server-security.test.ts` previously asserted that company IDs were harvested from `user_metadata` / `app_metadata` — it was encoding the IDOR. It now asserts the opposite, plus a new case proving an injected `user_metadata.company_id` is refused.

## 3. Branch, commit, push

You're currently on `master`. Don't commit straight to it:

```powershell
git checkout -b launch/mvp-readiness-fixes-2026-08-20

git add server.cjs server-security.cjs Dockerfile railway.toml railway.env.example .env.example `
        scripts/prerender.mjs src/pages/Signup.tsx src/pages/Pricing.tsx src/pages/TermsOfService.tsx `
        src/pages/MethodologyPublic.tsx src/pages/Security.tsx src/pages/SampleReport.tsx `
        tests/server-security.test.ts ecoauditor-mvp-readiness-audit-2026-08-20.md

git commit -m "fix: unblock trial provisioning, close paywall and IDOR gaps before launch

E-1 requirePlan now provisions the company row (and its 14-day trial) when a
user has none. Provisioning previously lived only inside handlers that sat
behind requirePlan itself, so a new signup was 402'd off its own free trial.

E-3 /api/checkout refuses to open a second subscription for a customer who
already has one (409) instead of double-billing them.

E-4 getAuthorizedCompanyIds trusts only the server-resolved company_id and no
longer honours client-writable user_metadata/app_metadata claims.

E-5 VITE_GTM_ID passed as a Docker build arg so analytics is not silently
disabled in the production bundle.

Config: APP_URL and DATABASE_URL documented; production boot now fails fast
when STRIPE_SECRET_KEY is set without APP_URL or STRIPE_WEBHOOK_SECRET.

Copy/legal: ToS trial clause matches actual Stripe behaviour (NEEDS COUNSEL
REVIEW); 'No card required' suppressed on the plan-intent signup path;
unsourced consultant-fee comparison removed; Footer (privacy/terms/DPA links)
added to /methodology, /security, /sample-report."

git push -u origin launch/mvp-readiness-fixes-2026-08-20
```

Then open the PR and merge:

```powershell
gh pr create --base master --title "Launch readiness fixes (E-1..E-9)" --body-file ecoauditor-mvp-readiness-audit-2026-08-20.md
gh pr merge --squash
```

## 4. Railway — set these BEFORE redeploying

`VITE_GTM_ID` must be set as a **variable** so `railway.toml`'s new `[[build.args]]` block can resolve `${VITE_GTM_ID}`. A runtime-only value does nothing; Vite inlines it at build time.

```powershell
railway variables --set "VITE_GTM_ID=GTM-PS2XR44V"
railway variables --set "APP_URL=https://ecoauditor.io"
```

Confirm these are all present, or the new boot check will (deliberately) refuse to start:

- `DATABASE_URL`
- `APP_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER_MONTHLY` / `_ANNUAL`, `STRIPE_PRICE_GROWTH_MONTHLY` / `_ANNUAL`, `STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL`

Missing price IDs only log a warning (those plans just can't be bought). Missing `APP_URL` or `STRIPE_WEBHOOK_SECRET` with a Stripe key present now throws at boot — that's intentional. It's better than discovering it from a customer who paid and got redirected to `localhost`.

Also point the Stripe webhook endpoint at `https://ecoauditor.io/api/webhook` in the Stripe dashboard if you haven't. (Corrected 2026-09-30: the path given here before does not exist and answers 404. The only webhook route is `app.post('/api/webhook')` in `server.cjs`; `DEPLOY.md` §7 was already right.)

## 5. Still open — I could not do these from here

### E-2 — the calculator bypasses the paywall entirely (revenue leak, day one)

`/app/calculator` writes `emission_entries` and `facilities` straight to InsForge with the user's own token, skipping every `requirePlan`, facility cap, and Scope-3 gate on the Express side. Free account → unlimited facilities → Scope 3 → forever.

This needs your InsForge RLS policies, which I can't reach. On your machine:

```powershell
npx @insforge/cli login --user-api-key <your key>
npx @insforge/cli link --project-id 9844fe32-612f-4eb2-bdd3-018f5fbab7fa
npx @insforge/cli db migrations list
```

Then either add RLS policies on `companies` / `facilities` / `emission_entries` that check billing state, or route those writes through the Express API. The Express-side enforcement is already correct — it's only the direct-SDK path that's open.

### E-4 — confirm the metadata write policy

The code fix means an injected `user_metadata.company_id` is now ignored regardless, so this is no longer urgent. Still worth knowing: check whether your InsForge project lets account holders write their own `user_metadata`. If it does, audit anything else that reads it.

### Also worth checking before ads run

- **Load `/signup` in a browser.** I couldn't fetch it (your `robots.txt` disallows it, correctly), and the entire funnel goes through it.
- **Run one real signup end-to-end** on the deployed build and confirm the dashboard loads instead of the paywall. That is the direct test of E-1.
- **Run one real checkout per plan** and confirm the price charged matches `src/content/pricing.ts` — checklist item 3 there is still unresolved.

## 6. Not fixed — decisions, not bugs

From the audit, deliberately left alone because they're your call:

- **L-1** — 4 of 6 feature cards on the landing page say "Coming soon", and the testimonials are labeled composite/illustrative, under a "Now live" badge. Fine as honesty; questionable as a paid-ad destination. Either trim the landing page or constrain ad copy to shipped features.
- **L-2** — `/pricing` defaults to the annual toggle showing $124/$333/$833. I updated the meta description to cover both, but you may prefer defaulting to monthly instead.
- **L-3 / L-4** — all 6 blog posts serve the homepage (SPA fallback) and `/blog` prerenders empty. The content exists at `/api/blog-posts`; it just isn't reachable by crawlers. Worth fixing before content marketing, not before Friday.
- **Accessibility** — Signup/Login have no visible labels (placeholders at 2.46:1); error text on tinted panels is 4.13:1; the pricing toggle is 1.38:1. Real WCAG AA failures on the conversion path. Not launch-blocking, but they're on the exact screens paid traffic lands on.

---

**Rotate the InsForge key and Railway token** that were pasted into the chat, once you're done using them today.
